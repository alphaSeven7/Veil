import Foundation
import Network

public struct HTTPRequest {
    public var method: String = "GET"
    public var path: String = "/"
    public var query: [String: String] = [:]
    public var headers: [String: String] = [:]
    public var body: Data = Data()
    public var remote: String = ""
    public func header(_ k: String) -> String? { headers[k.lowercased()] }
    public var json: [String: Any]? {
        (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    }
}

public struct HTTPResponse {
    public var status: Int = 200
    public var headers: [String: String] = [:]
    public var body: Data = Data()
    public init(status: Int = 200, headers: [String: String] = [:], body: Data = Data()) {
        self.status = status; self.headers = headers; self.body = body
    }
    public static func json(_ obj: Any, status: Int = 200) -> HTTPResponse {
        let d = (try? JSONSerialization.data(withJSONObject: obj, options: [])) ?? Data("{}".utf8)
        return HTTPResponse(status: status, headers: ["Content-Type": "application/json; charset=utf-8"], body: d)
    }
    public static func text(_ s: String, status: Int = 200, type: String = "text/plain; charset=utf-8") -> HTTPResponse {
        HTTPResponse(status: status, headers: ["Content-Type": type], body: Data(s.utf8))
    }
    public static func html(_ s: String, status: Int = 200) -> HTTPResponse {
        HTTPResponse(status: status, headers: ["Content-Type": "text/html; charset=utf-8"], body: Data(s.utf8))
    }
    public static func notFound(_ msg: String = "Not Found") -> HTTPResponse { .text(msg, status: 404) }
}

public typealias HTTPHandler = (HTTPRequest) async -> HTTPResponse

/// 轻量 HTTP/1.1 服务（仅监听 127.0.0.1）
public final class HTTPServer {
    public private(set) var port: UInt16 = 0
    private var listener: NWListener?
    private let q: DispatchQueue
    private var handler: HTTPHandler
    private var conns = Set<ObjectIdentifier>()
    public var onRequest: ((HTTPRequest) -> Void)?
    public private(set) var running = false

    public init(handler: @escaping HTTPHandler, label: String = "veil.http") {
        self.handler = handler
        self.q = DispatchQueue(label: label, qos: .userInitiated, attributes: .concurrent)
    }

    public func start(port wanted: UInt16 = 0) throws -> UInt16 {
        var p = wanted
        var err: Error?
        for attempt in 0..<12 {
            do {
                let port = p == 0 ? try Net.freeTCPPort() : p
                let params = NWParameters.tcp
                params.allowLocalEndpointReuse = true
                // 只允许回环接口监听（requiredLocalEndpoint 在本 SDK 上会 EINVAL）
                params.prohibitedInterfaceTypes = [.wifi, .wiredEthernet, .cellular, .other]
                let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
                l.newConnectionHandler = { [weak self] c in self?.accept(c) }
                var ok = false, failed = ""
                let sem = DispatchSemaphore(value: 0)
                l.stateUpdateHandler = { st in
                    if case .ready = st { ok = true; sem.signal() }
                    if case .failed(let e) = st { failed = e.localizedDescription; sem.signal() }
                    if case .waiting(let e) = st { failed = e.localizedDescription; sem.signal() }
                }
                listener = l
                l.start(queue: q)
                _ = sem.wait(timeout: .now() + 3)
                if ok {
                    self.port = port
                    self.running = true
                    VeilLog.info("[http] 监听 127.0.0.1:\(port)")
                    return port
                } else {
                    l.cancel()
                    if wanted == 0 { continue }
                    p = 0   // 指定端口被占用 -> 自动改用随机端口
                    err = NSError(domain: "veil", code: -2, userInfo: [NSLocalizedDescriptionKey: failed])
                    VeilLog.warn("[http] 端口 \(wanted) 不可用(\(failed))，改用随机端口")
                    continue
                }
            } catch let e {
                err = e
                p = 0
                _ = attempt
                continue
            }
        }
        throw err ?? NSError(domain: "veil", code: -3, userInfo: [NSLocalizedDescriptionKey: "HTTP 服务启动失败"])
    }

    public func stop() {
        running = false
        listener?.cancel(); listener = nil
    }

    private func accept(_ c: NWConnection) {
        let conn = HTTPConn(server: self, conn: c)
        q.async { self.conns.insert(ObjectIdentifier(conn)); conn.retain = conn }
        conn.start()
    }
    fileprivate func release(_ c: HTTPConn) { q.async { self.conns.remove(ObjectIdentifier(c)); c.retain = nil } }

    func route(_ req: HTTPRequest) async -> HTTPResponse {
        onRequest?(req)
        return await handler(req)
    }
    var queue: DispatchQueue { q }
}

final class HTTPConn {
    let server: HTTPServer
    let conn: NWConnection
    var retain: AnyObject?
    var buf = Data()
    var requestsServed = 0
    var closed = false

    init(server: HTTPServer, conn: NWConnection) { self.server = server; self.conn = conn }

    func start() {
        // 应用层兜底：只接受回环来源
        if case NWEndpoint.hostPort(let host, _) = conn.endpoint {
            let hs = "\(host)"
            let loopback = hs.contains("127.0.0.1") || hs.contains("localhost") || hs.contains("::1") || hs.contains("127.")
            if !loopback {
                VeilLog.warn("[http] 拒绝非回环来源: \(hs)")
                close(); return
            }
        }
        conn.stateUpdateHandler = { [weak self] st in
            if case .failed(_) = st { self?.close() }
            if case .cancelled = st { self?.close() }
        }
        conn.start(queue: server.queue)
        pump()
    }

    private func pump() {
        guard !closed else { return }
        conn.receive(minimumIncompleteLength: 1, maximumLength: 512 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if error != nil { self.close(); return }
            if let d = data, !d.isEmpty { self.buf.append(d) }
            self.process()
            if isComplete && self.buf.isEmpty { self.close(); return }
            if !self.closed { self.pump() }
        }
    }

    private func process() {
        while !closed {
            guard let headEnd = buf.range(of: Data("\r\n\r\n".utf8)) else {
                if buf.count > 1_000_000 { close() }
                return
            }
            let headData = Data(buf[buf.startIndex..<headEnd.lowerBound])
            guard let head = String(data: headData, encoding: .utf8) else { close(); return }
            var req = HTTPRequest()
            let lines = head.components(separatedBy: "\r\n")
            guard let rl = lines.first else { close(); return }
            let parts = rl.split(separator: " ").map(String.init)
            guard parts.count >= 2 else { close(); return }
            req.method = parts[0].uppercased()
            let raw = parts[1]
            if let qi = raw.firstIndex(of: "?") {
                req.path = String(raw[raw.startIndex..<qi])
                let qs = String(raw[raw.index(after: qi)...])
                for kv in qs.split(separator: "&") {
                    let p = kv.split(separator: "=", maxSplits: 1).map(String.init)
                    if p.count == 2 {
                        req.query[p[0].removingPercentEncoding ?? p[0]] = p[1].removingPercentEncoding ?? p[1]
                    } else if p.count == 1 { req.query[p[0]] = "" }
                }
            } else { req.path = raw }
            for l in lines.dropFirst() {
                if let ci = l.firstIndex(of: ":") {
                    let k = String(l[l.startIndex..<ci]).lowercased()
                    let v = String(l[l.index(after: ci)...]).trimmingCharacters(in: .whitespaces)
                    req.headers[k] = v
                }
            }
            let contentLength = Int(req.headers["content-length"] ?? "0") ?? 0
            let rest = Data(buf[headEnd.upperBound..<buf.endIndex])
            if req.method == "POST" || req.method == "PUT" || req.method == "PATCH" {
                if rest.count < contentLength { return } // 等待更多数据
            }
            req.body = contentLength > 0 ? Data(rest.prefix(contentLength)) : Data()
            buf = (contentLength > 0 && rest.count > contentLength) ? Data(rest.suffix(rest.count - contentLength)) : Data()
            req.remote = String(describing: conn.endpoint)
            requestsServed += 1
            let keepAlive = (req.headers["connection"]?.lowercased() ?? "keep-alive") != "close" && requestsServed < 200
            handle(req, keepAlive: keepAlive)
            return // 等待响应写完后继续
        }
    }

    private func handle(_ req: HTTPRequest, keepAlive: Bool) {
        Task {
            let resp = await server.route(req)
            var head = "HTTP/1.1 \(resp.status) \(statusText(resp.status))\r\n"
            var h = resp.headers
            h["Content-Length"] = "\(resp.body.count)"
            h["Connection"] = keepAlive ? "keep-alive" : "close"
            if h["Access-Control-Allow-Origin"] == nil { h["Access-Control-Allow-Origin"] = "*" }
            if h["Cache-Control"] == nil && resp.status == 200 { h["Cache-Control"] = "no-store" }
            for (k, v) in h.sorted(by: { $0.key < $1.key }) { head += "\(k): \(v)\r\n" }
            head += "\r\n"
            var out = Data(head.utf8)
            out.append(resp.body)
            self.conn.send(content: out, completion: .contentProcessed { [weak self] err in
                guard let self = self else { return }
                if err != nil || !keepAlive { self.close() }
            })
        }
    }

    private func close() {
        guard !closed else { return }
        closed = true
        conn.cancel()
        retain = nil
        server.release(self)
    }

    private func statusText(_ c: Int) -> String {
        switch c {
        case 200: return "OK"; case 201: return "Created"; case 204: return "No Content"
        case 301: return "Moved Permanently"; case 302: return "Found"; case 304: return "Not Modified"
        case 400: return "Bad Request"; case 401: return "Unauthorized"; case 403: return "Forbidden"
        case 404: return "Not Found"; case 405: return "Method Not Allowed"; case 409: return "Conflict"
        case 500: return "Internal Server Error"; case 502: return "Bad Gateway"; case 503: return "Service Unavailable"
        default: return "OK"
        }
    }
}
