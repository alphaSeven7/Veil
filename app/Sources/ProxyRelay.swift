import Foundation
import Network
import Security

/// 本地代理中继：为需要账号密码的上游代理自动完成认证。
/// Chrome 以 --proxy-server=http://127.0.0.1:<localPort> 连接本中继，
/// 中继再转发到真实上游（HTTP/HTTPS/SOCKS5），并注入凭据。
public final class ProxyRelay {
    public let upstream: ProxyConfig
    public private(set) var localPort: UInt16 = 0
    private var listener: NWListener?
    let lq = DispatchQueue(label: "veil.relay." + UUID().uuidString.prefix(6).description)
    private var conns = Set<ObjectIdentifier>()
    public private(set) var bytesUp: Int = 0
    public private(set) var bytesDown: Int = 0
    public private(set) var errorCount: Int = 0
    private var lastError: String = ""

    public init(upstream: ProxyConfig) { self.upstream = upstream }

    public func start() throws -> UInt16 {
        let port = try Net.freeTCPPort()
        let params: NWParameters = (upstream.type == "https") ? tlsParams() : NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.prohibitedInterfaceTypes = [.wifi, .wiredEthernet, .cellular, .other]
        let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { [weak self] st in
            switch st {
            case .ready: break
            case .failed(let e):
                self?.lastError = e.localizedDescription
                VeilLog.error("[relay] listener failed: \(e.localizedDescription)")
                self?.listener?.cancel()
            case .cancelled: break
            default: break
            }
        }
        listener = l
        l.start(queue: lq)
        // 等待 ready
        let sem = DispatchSemaphore(value: 0)
        var ready = false
        l.stateUpdateHandler = { [weak self] st in
            if case .ready = st { ready = true; sem.signal() }
            if case .failed(let e) = st { self?.lastError = e.localizedDescription; sem.signal() }
            if case .waiting(let e) = st { self?.lastError = e.localizedDescription; sem.signal() }
        }
        _ = sem.wait(timeout: .now() + 3)
        guard ready else { throw NSError(domain: "veil", code: -1, userInfo: [NSLocalizedDescriptionKey: "代理中继启动失败: \(lastError)"]) }
        localPort = port
        VeilLog.info("[relay] 已启动 127.0.0.1:\(port) -> \(upstream.type)://\(upstream.host):\(upstream.port)\(upstream.hasAuth ? " (带认证)" : "")")
        return port
    }

    private func tlsParams() -> NWParameters {
        let opts = NWProtocolTLS.Options()
        // 上游代理证书多为自签名：放宽校验（仅用于到代理本身的 TLS 隧道，不影响端到端加密）
        sec_protocol_options_set_verify_block(opts.securityProtocolOptions, { _, _, complete in
            complete(true)
        }, DispatchQueue.global())
        return NWParameters(tls: opts, tcp: NWProtocolTCP.Options())
    }

    public func stop() {
        listener?.cancel(); listener = nil
        lq.async { [weak self] in self?.conns.removeAll() }
    }

    private func accept(_ client: NWConnection) {
        if case NWEndpoint.hostPort(let host, _) = client.endpoint {
            let hs = "\(host)"
            if !(hs.contains("127.0.0.1") || hs.contains("localhost") || hs.contains("::1") || hs.contains("127.")) {
                VeilLog.warn("[relay] 拒绝非回环来源: \(hs)")
                client.cancel(); return
            }
        }
        let conn = RelayConn(client: client, relay: self)
        lq.async { self.conns.insert(ObjectIdentifier(conn)); conn.retain = conn }
        conn.start()
    }
    fileprivate func release(_ c: RelayConn) { lq.async { self.conns.remove(ObjectIdentifier(c)); c.retain = nil } }
    fileprivate func note(error: String) { lq.async { self.errorCount += 1; self.lastError = error } }
    public var lastErrorMessage: String { lq.sync { lastError } }

    var authHeader: String? {
        guard upstream.hasAuth || !upstream.password.isEmpty else { return nil }
        let s = "\(upstream.username):\(upstream.password)"
        return "Proxy-Authorization: Basic " + s.data(using: .utf8)!.base64EncodedString()
    }

    func upstreamParameters() -> NWParameters {
        if upstream.type == "https" { return tlsParams() }
        return NWParameters.tcp
    }
}

// MARK: - 单条中继连接

final class RelayConn {
    let client: NWConnection
    let relay: ProxyRelay
    var upstreamConn: NWConnection?
    var retain: AnyObject?
    var headBuf = Data()
    var phase: Int = 0    // 0 读取请求头, 1 管道
    var leftoverClient = Data()
    var upstreamHeadBuf = Data()
    var expectConnectResponse = false
    var pendingToUpstream = Data()

    init(client: NWConnection, relay: ProxyRelay) {
        self.client = client
        self.relay = relay
    }

    func start() {
        client.stateUpdateHandler = { [weak self] st in
            if case .failed(_) = st { self?.fail("client failed") }
            if case .waiting(_) = st { self?.fail("client waiting") }
        }
        client.start(queue: relay.lq)
        pumpClientHead()
    }

    private func pumpClientHead() {
        client.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let error = error { self.fail("recv head: \(error.localizedDescription)"); return }
            if let d = data, !d.isEmpty { self.headBuf.append(d) }
            if self.phase == 1 {
                // 已切换到管道模式：直接转发
                if let d = data, !d.isEmpty { self.toUpstream(d) }
                if isComplete { self.finish(); return }
                self.pumpClientBody()
                return
            }
            if let range = self.headBuf.range(of: Data("\r\n\r\n".utf8)) {
                VeilLog.debug("[relay] 收到请求头 \(self.headBuf.count)B: \(String(data: self.headBuf.prefix(120), encoding: .utf8)?.split(separator: "\n").first.map(String.init) ?? "?")")
                let head = self.headBuf.subdata(in: self.headBuf.startIndex..<range.lowerBound + 4)
                self.leftoverClient = self.headBuf.subdata(in: range.upperBound..<self.headBuf.endIndex)
                self.headBuf = Data()
                self.handleHead(String(data: head, encoding: .utf8) ?? "", headData: head)
                return
            }
            if self.headBuf.count > 128 * 1024 { self.fail("head too large"); return }
            if isComplete { self.fail("client closed before head"); return }
            self.pumpClientHead()
        }
    }

    private func pumpClientBody() {
        client.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if error != nil || isComplete { self.finish(); return }
            if let d = data, !d.isEmpty { self.toUpstream(d) }
            self.pumpClientBody()
        }
    }

    private func toUpstream(_ d: Data) {
        guard let u = upstreamConn else { pendingToUpstream.append(d); return }
        u.send(content: d, completion: .contentProcessed { [weak self] err in
            if err != nil { self?.finish() }
        })
    }

    private func toClient(_ d: Data) {
        client.send(content: d, completion: .contentProcessed { [weak self] err in
            if err != nil { self?.finish() }
        })
    }

    // MARK: 请求头处理

    private func handleHead(_ text: String, headData: Data) {
        let lines = text.components(separatedBy: "\r\n")
        guard let reqLine = lines.first, !reqLine.isEmpty else { fail("bad request line"); return }
        let parts = reqLine.split(separator: " ").map(String.init)
        guard parts.count >= 2 else { fail("bad request"); return }
        let method = parts[0].uppercased()
        let target = parts[1]

        var host = "", port = 80, path = "/"
        if method == "CONNECT" {
            let hp = target.split(separator: ":")
            host = String(hp[0])
            port = hp.count > 1 ? (Int(hp[1]) ?? 443) : 443
        } else if target.hasPrefix("http://") || target.hasPrefix("https://") {
            let u = URL(string: target)
            host = u?.host ?? ""
            port = u?.port ?? (u?.scheme == "https" ? 443 : 80)
            path = (u?.path.isEmpty == false ? u!.path : "/") + (u?.query.map { "?\($0)" } ?? "")
        } else {
            // origin-form（少见，通常来自已建立隧道后的复用）
            path = target
            for l in lines where l.lowercased().hasPrefix("host:") {
                let v = l.dropFirst(5).trimmingCharacters(in: .whitespaces)
                let hp = v.split(separator: ":")
                host = String(hp[0]); port = hp.count > 1 ? (Int(hp[1]) ?? 80) : 80
            }
        }
        guard !host.isEmpty else { fail("no host"); return }

        // Loopback 目标直接连接，不走上游代理
        // 原因：上游代理在公网，连不到 127.0.0.1/localhost，会 RST，
        //       导致客户端收到空响应（ERR_EMPTY_RESPONSE）。即使将来 Chrome 把 loopback
        //       从 bypass list 里漏掉，中继这层也兜底，让本地 API（127.0.0.1:54345）等
        //       回环地址永远能通。
        if isLoopbackHost(host) {
            connectDirect(host: host, port: port, isConnect: method == "CONNECT",
                         originalHead: text, rewrittenPath: path, method: method, leftover: leftoverClient)
            return
        }

        if relay.upstream.type == "socks5" {
            connectViaSocks5(host: host, port: port, isConnect: method == "CONNECT",
                             originalHead: text, rewrittenPath: path, method: method, leftover: leftoverClient)
        } else {
            connectViaHttpProxy(host: host, port: port, isConnect: method == "CONNECT",
                                originalHead: text, leftover: leftoverClient)
        }
    }

    // MARK: 直连（loopback 目标不走上游）

    /// 判断是否为 loopback / 本机地址。
    /// - 命中规则：127.0.0.0/8、::1、localhost 等同物。
    /// - 含方括号包裹的 IPv6（如 `[::1]`）。
    private func isLoopbackHost(_ host: String) -> Bool {
        let h = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
        if h == "localhost" || h == "ip6-localhost" || h == "ip6-loopback" { return true }
        if h == "::1" { return true }
        // 127.0.0.0/8
        if h.hasPrefix("127.") {
            let parts = h.split(separator: ".")
            if parts.count == 4, parts.allSatisfy({ Int($0) != nil }) { return true }
        }
        return false
    }

    /// 直接连到目标主机（绕开上游代理）。仅用于 loopback 目标。
    private func connectDirect(host: String, port: Int, isConnect: Bool, originalHead: String,
                               rewrittenPath: String, method: String, leftover: Data) {
        VeilLog.debug("[relay] loopback 直连 -> \(host):\(port) (connect=\(isConnect))")
        let up = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: UInt16(port))!, using: NWParameters.tcp)
        upstreamConn = up
        up.stateUpdateHandler = { [weak self] st in
            switch st {
            case .ready:
                guard let self = self else { return }
                if isConnect {
                    // HTTPS 隧道：客户端期望 "200 Connection Established" 后开始透传
                    self.toClient(Data("HTTP/1.1 200 Connection Established\r\n\r\n".utf8))
                    self.beginPiping(up, initialClient: self.leftoverClient.isEmpty ? nil : self.leftoverClient)
                } else {
                    // HTTP absolute-form 改写成 origin-form（去掉 http://host:port 前缀）
                    var lines = originalHead.components(separatedBy: "\r\n")
                    if let i = lines.firstIndex(where: { $0.hasPrefix(method + " ") }) {
                        let comps = lines[i].split(separator: " ").map(String.init)
                        if comps.count >= 3 { lines[i] = "\(comps[0]) \(rewrittenPath) \(comps[2])" }
                    }
                    // 去掉代理相关头（直连不需要）
                    lines = lines.filter { !$0.lowercased().hasPrefix("proxy-authorization:") && !$0.lowercased().hasPrefix("proxy-connection:") }
                    var payload = Data(lines.joined(separator: "\r\n").utf8)
                    payload.append(leftover)
                    up.send(content: payload, completion: .contentProcessed { [weak self] err in
                        guard let self = self else { return }
                        if let err = err { self.fail("loopback 发送失败: \(err.localizedDescription)"); return }
                        self.beginPiping(up, initialClient: nil)
                    })
                }
            case .failed(let e): self?.fail("loopback 连接失败: \(e.localizedDescription)")
            case .waiting(let e): self?.fail("loopback 不可达: \(e.localizedDescription)")
            default: break
            }
        }
        up.start(queue: relay.lq)
    }

    // MARK: 上游 HTTP(S) 代理

    private func connectViaHttpProxy(host: String, port: Int, isConnect: Bool, originalHead: String, leftover: Data) {
        let up = NWConnection(host: NWEndpoint.Host(relay.upstream.host), port: NWEndpoint.Port(rawValue: UInt16(relay.upstream.port))!, using: relay.upstreamParameters())
        upstreamConn = up
        VeilLog.debug("[relay] 连接上游 \(relay.upstream.host):\(relay.upstream.port) (connect=\(isConnect))")
        up.stateUpdateHandler = { [weak self] st in
            switch st {
            case .ready:
                VeilLog.debug("[relay] 上游已就绪，发送请求头 \(originalHead.count)B")
                self?.sendUpstreamHead(isConnect: isConnect, host: host, port: port, originalHead: originalHead, leftover: leftover, conn: up)
            case .failed(let e): self?.fail("上游代理连接失败: \(e.localizedDescription)")
            case .waiting(let e): self?.fail("上游代理不可达: \(e.localizedDescription)")
            default: break
            }
        }
        up.start(queue: relay.lq)
    }

    private func sendUpstreamHead(isConnect: Bool, host: String, port: Int, originalHead: String, leftover: Data, conn: NWConnection) {
        var out: Data
        if isConnect {
            var h = "CONNECT \(host):\(port) HTTP/1.1\r\nHost: \(host):\(port)\r\n"
            if let a = relay.authHeader { h += a + "\r\n" }
            h += "Proxy-Connection: keep-alive\r\n\r\n"
            out = Data(h.utf8)
            expectConnectResponse = true
        } else {
            var lines = originalHead.components(separatedBy: "\r\n")
            // 去掉已有的 Proxy-Authorization，加入我们的
            lines = lines.filter { !$0.lowercased().hasPrefix("proxy-authorization:") }
            if let a = relay.authHeader, let idx = lines.firstIndex(where: { $0.isEmpty }) {
                lines.insert(a, at: idx)
            }
            out = Data(lines.joined(separator: "\r\n").utf8)
            expectConnectResponse = false
        }
        if !leftover.isEmpty && !expectConnectResponse { out.append(leftover) }
        pendingToUpstream = Data()
        conn.send(content: out, completion: .contentProcessed { [weak self] err in
            guard let self = self else { return }
            if let err = err { self.fail("发送上游失败: \(err.localizedDescription)"); return }
            if self.expectConnectResponse { self.readUpstreamConnectResponse(conn) }
            else { self.beginPiping(conn, initialClient: self.leftoverClient.isEmpty ? nil : self.leftoverClient) }
        })
    }

    private func readUpstreamConnectResponse(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 32 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let error = error { self.fail("上游响应错误: \(error.localizedDescription)"); return }
            if let d = data { self.upstreamHeadBuf.append(d) }
            if self.upstreamHeadBuf.range(of: Data("\r\n\r\n".utf8)) != nil {
                let text = String(data: self.upstreamHeadBuf, encoding: .utf8) ?? ""
                guard text.contains(" 200") else {
                    self.toClient(Data("HTTP/1.1 502 Bad Gateway\r\n\r\n".utf8))
                    self.fail("上游代理拒绝: \(text.components(separatedBy: "\r\n").first ?? "")")
                    return
                }
                self.upstreamHeadBuf = Data()
                self.toClient(Data("HTTP/1.1 200 Connection Established\r\n\r\n".utf8))
                self.beginPiping(conn, initialClient: nil)
                return
            }
            if isComplete { self.fail("上游提前关闭"); return }
            self.readUpstreamConnectResponse(conn)
        }
    }

    // MARK: 上游 SOCKS5 代理

    private func connectViaSocks5(host: String, port: Int, isConnect: Bool, originalHead: String, rewrittenPath: String, method: String, leftover: Data) {
        let up = NWConnection(host: NWEndpoint.Host(relay.upstream.host), port: NWEndpoint.Port(rawValue: UInt16(relay.upstream.port))!, using: NWParameters.tcp)
        upstreamConn = up
        up.stateUpdateHandler = { [weak self] st in
            switch st {
            case .ready:
                guard let self = self else { return }
                let hasAuth = self.relay.upstream.hasAuth || !self.relay.upstream.password.isEmpty
                let greeting: [UInt8] = hasAuth ? [0x05, 0x02, 0x02, 0x00] : [0x05, 0x01, 0x00]
                up.send(content: Data(greeting), completion: .contentProcessed { err in
                    if err != nil { self.fail("socks5 greeting 失败"); return }
                    self.socksReadChoice(up, host: host, port: port, hasAuth: hasAuth, isConnect: isConnect,
                                         originalHead: originalHead, rewrittenPath: rewrittenPath, method: method, leftover: leftover)
                })
            case .failed(let e): self?.fail("SOCKS5 连接失败: \(e.localizedDescription)")
            default: break
            }
        }
        up.start(queue: relay.lq)
    }

    private func socksReadChoice(_ up: NWConnection, host: String, port: Int, hasAuth: Bool, isConnect: Bool,
                                 originalHead: String, rewrittenPath: String, method: String, leftover: Data) {
        socksReceive(up, count: 2) { [weak self] bytes in
            guard let self = self else { return }
            guard bytes.count >= 2, bytes[0] == 0x05 else { self.fail("SOCKS5 握手失败"); return }
            if bytes[1] == 0x02 && hasAuth {
                let u = Array(self.relay.upstream.username.utf8), p = Array(self.relay.upstream.password.utf8)
                var req: [UInt8] = [0x01, UInt8(min(255, u.count))]
                req.append(contentsOf: u)
                req.append(UInt8(min(255, p.count)))
                req.append(contentsOf: p)
                up.send(content: Data(req), completion: .contentProcessed { e in
                    if e != nil { self.fail("SOCKS5 认证发送失败"); return }
                    self.socksReceive(up, count: 2) { resp in
                        guard resp.count >= 2, resp[0] == 0x01, resp[1] == 0x00 else { self.fail("SOCKS5 认证被拒绝"); return }
                        self.socksConnect(up, host: host, port: port, isConnect: isConnect, originalHead: originalHead,
                                          rewrittenPath: rewrittenPath, method: method, leftover: leftover)
                    }
                })
            } else if bytes[1] == 0x00 {
                socksConnect(up, host: host, port: port, isConnect: isConnect, originalHead: originalHead,
                             rewrittenPath: rewrittenPath, method: method, leftover: leftover)
            } else {
                fail("SOCKS5 不支持的认证方式 \(bytes[1])")
            }
        }
    }

    private func socksConnect(_ up: NWConnection, host: String, port: Int, isConnect: Bool, originalHead: String,
                              rewrittenPath: String, method: String, leftover: Data) {
        var req: [UInt8] = [0x05, 0x01, 0x00, 0x03]
        let hb = Array(host.utf8)
        req.append(UInt8(min(255, hb.count)))
        req.append(contentsOf: hb)
        req.append(UInt8((port >> 8) & 0xFF)); req.append(UInt8(port & 0xFF))
        up.send(content: Data(req), completion: .contentProcessed { [weak self] err in
            guard let self = self else { return }
            if err != nil { self.fail("SOCKS5 CONNECT 发送失败"); return }
            self.socksReceive(up, count: 4) { head in
                guard head.count >= 4, head[0] == 0x05, head[1] == 0x00 else {
                    self.fail("SOCKS5 目标不可达 code=\(head.count > 1 ? head[1] : 255)"); return
                }
                let atyp = head[3]
                let extra: Int = atyp == 0x01 ? 4 : (atyp == 0x04 ? 16 : 0)
                if atyp == 0x03 {
                    // 域名长度前缀，已在前 4 字节里？ -> 需再读 1 字节长度 + 域名 + 2
                    self.socksReceive(up, count: 1) { lb in
                        let n = lb.first.map(Int.init) ?? 0
                        self.socksReceive(up, count: n + 2) { _ in self.socksReady(up, isConnect: isConnect, originalHead: originalHead, rewrittenPath: rewrittenPath, method: method, leftover: leftover) }
                    }
                } else if extra > 0 {
                    self.socksReceive(up, count: extra + 2) { _ in self.socksReady(up, isConnect: isConnect, originalHead: originalHead, rewrittenPath: rewrittenPath, method: method, leftover: leftover) }
                } else {
                    self.socksReady(up, isConnect: isConnect, originalHead: originalHead, rewrittenPath: rewrittenPath, method: method, leftover: leftover)
                }
            }
        })
    }

    private func socksReady(_ up: NWConnection, isConnect: Bool, originalHead: String, rewrittenPath: String, method: String, leftover: Data) {
        if isConnect {
            toClient(Data("HTTP/1.1 200 Connection Established\r\n\r\n".utf8))
            beginPiping(up, initialClient: nil)
        } else {
            // 把 absolute-form 改写为 origin-form 后转发
            var lines = originalHead.components(separatedBy: "\r\n")
            if let i = lines.firstIndex(where: { $0.hasPrefix(method + " ") }) {
                let comps = lines[i].split(separator: " ").map(String.init)
                if comps.count >= 3 { lines[i] = "\(comps[0]) \(rewrittenPath) \(comps[2])" }
            }
            lines = lines.filter { !$0.lowercased().hasPrefix("proxy-authorization:") && !$0.lowercased().hasPrefix("proxy-connection:") }
            var payload = Data(lines.joined(separator: "\r\n").utf8)
            payload.append(leftover)
            pendingToUpstream = Data()
            up.send(content: payload, completion: .contentProcessed { [weak self] err in
                if err != nil { self?.finish(); return }
                self?.beginPiping(up, initialClient: nil)
            })
        }
    }

    private func socksReceive(_ up: NWConnection, count: Int, _ done: @escaping ([UInt8]) -> Void) {
        var acc = Data()
        func step() {
            up.receive(minimumIncompleteLength: 1, maximumLength: max(1, count - acc.count) + 8) { [weak self] data, _, isComplete, error in
                guard let self = self else { return }
                if error != nil { self.fail("SOCKS5 读取失败"); return }
                if let d = data { acc.append(d) }
                if acc.count >= count || isComplete {
                    let rest = acc.count > count ? acc.subdata(in: count..<acc.count) : Data()
                    if !rest.isEmpty { self.pendingToUpstream.append(rest) }
                    done(Array(acc.prefix(count)))
                    return
                }
                step()
            }
        }
        step()
    }

    // MARK: 双向管道

    private func beginPiping(_ up: NWConnection, initialClient: Data?) {
        phase = 1
        VeilLog.debug("[relay] 进入管道模式")
        up.stateUpdateHandler = { [weak self] st in
            if case .failed(_) = st { self?.finish() }
        }
        if !pendingToUpstream.isEmpty {
            let d = pendingToUpstream; pendingToUpstream = Data()
            up.send(content: d, completion: .contentProcessed { _ in })
        }
        if let d = initialClient, !d.isEmpty { up.send(content: d, completion: .contentProcessed { _ in }) }
        pumpUpstream(up)
        pumpClientBody()
    }

    private func pumpUpstream(_ up: NWConnection) {
        up.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if error != nil || isComplete { VeilLog.debug("[relay] 上游结束 err=\(error.map{"\($0)"} ?? "nil") complete=\(isComplete)"); self.finish(); return }
            if let d = data, !d.isEmpty { VeilLog.debug("[relay] 上游→客户端 \(d.count)B: \(String(data: d.prefix(60), encoding: .utf8)?.split(separator: "\n").first.map(String.init) ?? "?")"); self.toClient(d) }
            self.pumpUpstream(up)
        }
    }

    private func fail(_ msg: String) {
        relay.note(error: msg)
        VeilLog.warn("[relay] \(msg)")
        finish()
    }

    private var finished = false
    private func finish() {
        guard !finished else { return }
        finished = true
        client.cancel()
        upstreamConn?.cancel()
        upstreamConn = nil
        retain = nil
        relay.release(self)
    }
}

