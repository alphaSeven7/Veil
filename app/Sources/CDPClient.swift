import Foundation

public enum CDPError: Error, CustomStringConvertible {
    case notConnected
    case closed
    case protocolError(Int, String)
    case timeout(String)
    case badResponse(String)
    public var description: String {
        switch self {
        case .notConnected: return "CDP 未连接"
        case .closed: return "CDP 连接已关闭"
        case .protocolError(let c, let m): return "CDP 错误 \(c): \(m)"
        case .timeout(let m): return "CDP 超时: \(m)"
        case .badResponse(let m): return "CDP 响应异常: \(m)"
        }
    }
}

/// 极简 CDP WebSocket 客户端：支持 flatten 多 session 事件路由
public final class CDPClient: NSObject, URLSessionWebSocketDelegate {
    public let url: URL
    private var urlSession: URLSession!
    private var task: URLSessionWebSocketTask?
    private let q = DispatchQueue(label: "veil.cdp." + UUID().uuidString.prefix(8).description)
    private var nextId = 1
    private var pending: [Int: (Result<[String: Any], Error>) -> Void] = [:]
    private var open = false
    private var closedPermanently = false

    /// (method, params, sessionId?)
    public var onEvent: ((String, [String: Any], String?) -> Void)?
    public var onDisconnected: ((String) -> Void)?
    public private(set) var sessionIdHint: String?

    public init(url: URL) {
        self.url = url
        super.init()
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.timeoutIntervalForResource = .infinity
        cfg.waitsForConnectivity = false
        urlSession = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }

    public var isConnected: Bool { q.sync { open } }

    public func connect(timeout: TimeInterval = 20) async throws {
        let task = urlSession.webSocketTask(with: url)
        task.maximumMessageSize = 256 * 1024 * 1024
        self.task = task
        task.resume()
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            var resumed = false
            let finish: (Result<Void, Error>) -> Void = { r in
                self.q.async { if !resumed { resumed = true; cont.resume(with: r) } }
            }
            let t = DispatchWorkItem { finish(.failure(CDPError.timeout("握手"))) }
            q.async {
                self.onOpenInternal = { finish(.success(())) }
                self.onFatalInternal = { finish(.failure($0)) }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: t)
        }
        q.async { self.open = true; self.receiveLoop(task) }
    }

    private var onOpenInternal: (() -> Void)?
    private var onFatalInternal: ((Error) -> Void)?

    private func receiveLoop(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let msg):
                switch msg {
                case .string(let s): self.handle(raw: s.data(using: .utf8) ?? Data())
                case .data(let d): self.handle(raw: d)
                @unknown default: break
                }
                self.q.async { if self.open { self.receiveLoop(task) } }
            case .failure(let err):
                self.q.async {
                    guard self.open else { return }
                    self.open = false
                    let reason = err.localizedDescription
                    for (_, cb) in self.pending { cb(.failure(CDPError.closed)) }
                    self.pending.removeAll()
                    self.onDisconnected?(reason)
                }
            }
        }
    }

    private func handle(raw: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: raw) as? [String: Any] else { return }
        if let id = obj["id"] as? Int {
            let cb = q.sync { () -> ((Result<[String: Any], Error>) -> Void)? in
                let c = self.pending[id]; self.pending[id] = nil; return c
            }
            if let cb = cb {
                if let err = obj["error"] as? [String: Any] {
                    cb(.failure(CDPError.protocolError((err["code"] as? Int) ?? -1, (err["message"] as? String) ?? "unknown")))
                } else {
                    cb(.success((obj["result"] as? [String: Any]) ?? [:]))
                }
            }
            return
        }
        if let method = obj["method"] as? String {
            let params = (obj["params"] as? [String: Any]) ?? [:]
            let sid = obj["sessionId"] as? String
            onEvent?(method, params, sid)
        }
    }

    public func close(code: URLSessionWebSocketTask.CloseCode = .normalClosure) {
        q.async {
            self.closedPermanently = true
            self.open = false
            for (_, cb) in self.pending { cb(.failure(CDPError.closed)) }
            self.pending.removeAll()
            self.task?.cancel(with: code, reason: nil)
            self.task = nil
        }
    }

    /// 发送命令（不等待）
    public func send(_ method: String, _ params: [String: Any] = [:], sessionId: String? = nil) {
        Task { _ = try? await sendAsync(method, params, sessionId: sessionId, timeout: 8) }
    }

    @discardableResult
    public func sendAsync(_ method: String, _ params: [String: Any] = [:], sessionId: String? = nil,
                          timeout: TimeInterval = 20) async throws -> [String: Any] {
        let id: Int = q.sync { let i = self.nextId; self.nextId += 1; return i }
        var msg: [String: Any] = ["id": id, "method": method]
        if !params.isEmpty { msg["params"] = params }
        if let s = sessionId { msg["sessionId"] = s }
        guard let data = try? JSONSerialization.data(withJSONObject: msg),
              let str = String(data: data, encoding: .utf8) else { throw CDPError.badResponse(method) }
        return try await withCheckedThrowingContinuation { cont in
            var done = false
            let finish: (Result<[String: Any], Error>) -> Void = { r in if !done { done = true; cont.resume(with: r) } }
            q.async {
                guard self.open, let task = self.task else { finish(.failure(CDPError.notConnected)); return }
                self.pending[id] = finish
                task.send(.string(str)) { err in
                    if let err = err {
                        self.q.async { self.pending[id] = nil; finish(.failure(err)) }
                    }
                }
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { finish(.failure(CDPError.timeout(method)) ) }
        }
    }

    // MARK: URLSessionWebSocketDelegate
    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        q.async { self.onOpenInternal?(); self.onOpenInternal = nil; self.onFatalInternal = nil }
    }
    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        q.async {
            guard !self.closedPermanently else { return }
            self.open = false
            self.onFatalInternal?(CDPError.closed)
            self.onDisconnected?("closed code=\(closeCode.rawValue)")
        }
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error = error else { return }
        q.async {
            if !self.open { self.onFatalInternal?(error); return }
            self.open = false
            for (_, cb) in self.pending { cb(.failure(CDPError.closed)) }
            self.pending.removeAll()
            self.onDisconnected?(error.localizedDescription)
        }
    }
}
