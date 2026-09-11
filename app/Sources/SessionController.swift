import Foundation

public final class BrowserSession {
    public let profileId: String
    public private(set) var pid: Int32 = 0
    public private(set) var debugPort: UInt16 = 0
    public private(set) var browserWs: String = ""
    public private(set) var relay: ProxyRelay?
    public private(set) var client: CDPClient?
    public private(set) var process: Process?
    public private(set) var startedAt = Date()
    public private(set) var attachedPages: [String: String] = [:]   // sessionId -> targetId
    public private(set) var lastError: String = ""
    public private(set) var setupCount = 0
    public private(set) var closed = false
    /// 由外部注入的窗口关闭回调
    public var onClosed: ((String) -> Void)?

    private let profile: VeilProfile
    private let injectSource: String
    private var settingUp = Set<String>()
    private var knownTargets = Set<String>()
    private var cookiesApplied = false
    private var homepageApplied = false
    private var firstPageSession: String?

    init(profile: VeilProfile, injectSource: String) {
        self.profileId = profile.id
        self.profile = profile
        self.injectSource = injectSource
    }

    public var proxyInfo: String { profile.proxy.label }

    // MARK: - 打开

    public static func open(profile: VeilProfile, windowIndex: Int, host: HostInfo) async throws -> BrowserSession {
        let session = BrowserSession(profile: profile,
                                     injectSource: InjectScript.source(for: profile, host: host))
        try await session.launch(windowIndex: windowIndex)
        return session
    }

    private func launch(windowIndex: Int) async throws {
        // 1. 代理
        var proxyArg: String? = nil
        let px = profile.proxy
        if px.isUsable {
            if px.hasAuth || !px.password.isEmpty {
                let r = ProxyRelay(upstream: px)
                let port = try r.start()
                relay = r
                proxyArg = "http://127.0.0.1:\(port)"
            } else if px.type == "custom" {
                proxyArg = nil
            } else {
                proxyArg = "\(px.type == "socks5" ? "socks5" : px.type)://\(px.host):\(px.port)"
            }
        }

        // 2. 调试端口
        let port = try Net.freeTCPPort()
        debugPort = port

        // 3. 启动浏览器
        let lr = try BrowserLauncher.launch(profile: profile, debugPort: port, proxyServerArg: proxyArg,
                                            windowIndex: windowIndex, initialURL: nil)
        pid = lr.pid
        VeilLog.info("[session:\(profile.seq)] 已启动 pid=\(pid) port=\(port)")

        // 4. 连接 CDP
        let ws = try await BrowserLauncher.browserWsURL(port: port)
        browserWs = ws
        guard let url = URL(string: ws) else { throw LaunchError.cdpTimeout("非法 WebSocket 地址 \(ws)") }
        let c = CDPClient(url: url)
        client = c
        c.onEvent = { [weak self] method, params, sid in self?.handleEvent(method, params, sid) }
        c.onDisconnected = { [weak self] reason in
            guard let self = self else { return }
            VeilLog.warn("[session:\(self.profile.seq)] CDP 断开: \(reason)")
            self.lastError = "CDP 断开: \(reason)"
            // 浏览器可能已退出
            DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { self.checkAlive() }
        }
        try await c.connect()

        // 5. 订阅目标
        _ = try? await c.sendAsync("Target.setDiscoverTargets", ["discover": true])
        _ = try? await c.sendAsync("Target.setAutoAttach",
                                   ["autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true])
        _ = try? await c.sendAsync("Target.setDiscoverTargets", ["discover": true, "filter": [["type": ["page", "iframe", "other", "service_worker"]]]])

        // 6. 附加到既有目标
        try? await Task.sleep(nanoseconds: 250_000_000)
        if let list = try? await c.sendAsync("Target.getTargets"), let infos = list["targetInfos"] as? [[String: Any]] {
            for t in infos where (t["type"] as? String) == "page" {
                let tid = t["targetId"] as? String ?? ""
                let url = t["url"] as? String ?? ""
                if tid.isEmpty || url.hasPrefix("devtools://") { continue }
                if knownTargets.contains(tid) { continue }
                knownTargets.insert(tid)
                Task { await self.attachExisting(targetId: tid) }
            }
        }

        // 7. Cookie 注入
        if !profile.automation.cookies.isEmpty {
            await applyCookies()
        }
    }

    private func attachExisting(targetId: String) async {
        guard let c = client else { return }
        do {
            let r = try await c.sendAsync("Target.attachToTarget", ["targetId": targetId, "flatten": true])
            if let sid = r["sessionId"] as? String {
                await setup(sessionId: sid, targetId: targetId, waitingForDebugger: false)
            }
        } catch {
            VeilLog.warn("[session:\(profile.seq)] 附加既有目标失败 \(targetId): \(error)")
        }
    }

    // MARK: - CDP 事件

    private func handleEvent(_ method: String, _ params: [String: Any], _ sessionId: String?) {
        switch method {
        case "Target.attachedToTarget":
            guard let info = params["targetInfo"] as? [String: Any],
                  let sid = params["sessionId"] as? String,
                  let tid = info["targetId"] as? String else { return }
            let type = info["type"] as? String ?? ""
            let url = info["url"] as? String ?? ""
            knownTargets.insert(tid)
            if type == "page" && !url.hasPrefix("devtools://") && !url.hasPrefix("chrome-extension://") {
                Task { await self.setup(sessionId: sid, targetId: tid, waitingForDebugger: true) }
            } else if type == "iframe" {
                Task { await self.setup(sessionId: sid, targetId: tid, waitingForDebugger: true, isOOPIF: true) }
            } else {
                Task { await self.resume(sid) }
            }
        case "Target.detachedFromTarget":
            if let sid = params["sessionId"] as? String { attachedPages.removeValue(forKey: sid) }
        case "Target.targetDestroyed":
            break
        case "Inspector.targetReloadedAfterCrash":
            break
        default:
            break
        }
    }

    private func resume(_ sid: String) async {
        guard let c = client else { return }
        _ = try? await c.sendAsync("Runtime.runIfWaitingForDebugger", [:], sessionId: sid)
    }

    // MARK: - 为单个 target 安装指纹

    private func setup(sessionId sid: String, targetId: String, waitingForDebugger: Bool, isOOPIF: Bool = false) async {
        guard !closed, let c = client else { return }
        if settingUp.contains(sid) { if waitingForDebugger { await resume(sid) }; return }
        settingUp.insert(sid)
        defer { settingUp.remove(sid) }
        attachedPages[sid] = targetId

        let fp = profile.fp
        func s(_ m: String, _ p: [String: Any] = [:]) async { _ = try? await c.sendAsync(m, p, sessionId: sid, timeout: 8) }

        // 递归覆盖子 frame（OOPIF）与新窗口
        await s("Target.setAutoAttach", ["autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true])
        await s("Page.enable")
        await s("DOM.enable")

        // 注入脚本（必须在任何页面脚本之前）
        await s("Page.addScriptToEvaluateOnNewDocument", ["source": injectSource, "runImmediately": true])

        // UA + Client Hints
        var uaParams: [String: Any] = ["userAgent": fp.userAgent, "acceptLanguage": fp.acceptLanguage]
        if fp.platform == "windows" { uaParams["platform"] = "Windows" }
        else if fp.platform == "mac" { uaParams["platform"] = "MacIntel" }
        else if fp.platform == "linux" { uaParams["platform"] = "Linux x86_64" }
        let md = fp.uaMetadata
        uaParams["userAgentMetadata"] = [
            "brands": md.brands.map { ["brand": $0.brand, "version": $0.version] },
            "fullVersionList": md.fullVersionList.map { ["brand": $0.brand, "version": $0.version] },
            "fullVersion": md.fullVersion,
            "platform": md.platform,
            "platformVersion": md.platformVersion,
            "architecture": md.architecture,
            "model": md.model,
            "mobile": md.mobile,
            "bitness": md.bitness,
            "wow64": md.wow64,
        ]
        await s("Emulation.setUserAgentOverride", uaParams)

        // 时区 / 语言 / 地理位置
        await s("Emulation.setTimezoneOverride", ["timezoneId": fp.timezone])
        await s("Emulation.setLocaleOverride", ["locale": fp.languages.joined(separator: ",")])
        if fp.geo.enabled {
            await s("Emulation.setGeolocationOverride",
                    ["latitude": fp.geo.latitude, "longitude": fp.geo.longitude, "accuracy": 20])
        }
        if fp.forceViewport {
            await s("Emulation.setDeviceMetricsOverride", [
                "width": fp.windowWidth, "height": fp.windowHeight,
                "deviceScaleFactor": fp.devicePixelRatio, "mobile": fp.maxTouchPoints > 0,
                "screenWidth": fp.screenWidth, "screenHeight": fp.screenHeight,
            ])
        }
        if fp.maxTouchPoints > 0 {
            await s("Emulation.setTouchEmulationEnabled", ["enabled": true, "maxTouchPoints": fp.maxTouchPoints])
        }
        if fp.connectionSpoof {
            // 让 Chrome 认为自己在线，避免 offline 事件干扰
            await s("Network.emulateNetworkConditions", ["offline": false, "latency": 0, "downloadThroughput": -1, "uploadThroughput": -1])
        }

        // 自动化脚本（页面级额外 JS）
        for src in profile.automation.scripts where !src.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            await s("Page.addScriptToEvaluateOnNewDocument", ["source": src, "runImmediately": true])
        }

        setupCount += 1
        if firstPageSession == nil && !isOOPIF { firstPageSession = sid }

        // 首次打开时应用首页
        if !isOOPIF && !homepageApplied && !profile.launch.homepage.isEmpty {
            homepageApplied = true
            await s("Page.navigate", ["url": resolvedURL(profile.launch.homepage)])
            for t in profile.launch.extraTabs {
                _ = try? await c.sendAsync("Target.createTarget", ["url": resolvedURL(t)])
            }
        } else if !isOOPIF && !profile.launch.extraTabs.isEmpty && !homepageApplied {
            homepageApplied = true
            for t in profile.launch.extraTabs {
                _ = try? await c.sendAsync("Target.createTarget", ["url": resolvedURL(t)])
            }
        }

        if waitingForDebugger { await resume(sid) }
        VeilLog.debug("[session:\(profile.seq)] 已注入 target=\(targetId.prefix(8)) sid=\(sid.prefix(8))")
    }

    private func resolvedURL(_ u: String) -> String {
        if u == "veil://detect" || u == "about:detect" {
            return "http://127.0.0.1:\(Store.shared.settings().apiPort)/__veil/detect.html?profile=\(profile.id)&seq=\(profile.seq)"
        }
        if u.hasPrefix("veil://") {
            return "http://127.0.0.1:\(Store.shared.settings().apiPort)/__veil/" + u.dropFirst("veil://".count)
        }
        if u.hasPrefix("http://") || u.hasPrefix("https://") || u.hasPrefix("file://") || u.hasPrefix("chrome") || u.hasPrefix("about:") { return u }
        return "https://" + u
    }

    // MARK: - Cookie

    public func applyCookies(_ cookies: [CookieEntry]? = nil) async {
        guard let c = client else { return }
        let list = cookies ?? profile.automation.cookies
        guard !list.isEmpty else { return }
        var arr: [[String: Any]] = []
        for ck in list {
            var o: [String: Any] = ["name": ck.name, "value": ck.value, "path": ck.path.isEmpty ? "/" : ck.path]
            if ck.domain.hasPrefix("http") { o["url"] = ck.domain } else { o["domain"] = ck.domain }
            if ck.expires > 0 { o["expires"] = ck.expires }
            o["httpOnly"] = ck.httpOnly
            o["secure"] = ck.secure
            switch ck.sameSite.lowercased() {
            case "strict": o["sameSite"] = "Strict"
            case "lax": o["sameSite"] = "Lax"
            case "none": o["sameSite"] = "None"
            default: break
            }
            arr.append(o)
        }
        do {
            _ = try await c.sendAsync("Storage.setCookies", ["cookies": arr])
            cookiesApplied = true
            VeilLog.info("[session:\(profile.seq)] 已写入 \(arr.count) 条 Cookie")
        } catch {
            // 回退：逐个页面写入
            if let sid = firstPageSession {
                for ck in arr { _ = try? await c.sendAsync("Network.setCookie", ck, sessionId: sid) }
                cookiesApplied = true
            } else {
                lastError = "Cookie 写入失败: \(error)"
            }
        }
    }

    public func cookies() async -> [[String: Any]] {
        guard let c = client, let sid = firstPageSession else { return [] }
        let r = try? await c.sendAsync("Network.getCookies", [:], sessionId: sid)
        return (r?["cookies"] as? [[String: Any]]) ?? []
    }

    // MARK: - 运行时操作

    public func openURL(_ url: String) async -> Bool {
        guard let c = client else { return false }
        let u = resolvedURL(url)
        if let sid = firstPageSession {
            _ = try? await c.sendAsync("Page.navigate", ["url": u], sessionId: sid)
            return true
        }
        let r = try? await c.sendAsync("Target.createTarget", ["url": u])
        return r?["targetId"] != nil
    }

    public func tabs() async -> [[String: Any]] {
        guard debugPort != 0, let u = URL(string: "http://127.0.0.1:\(debugPort)/json/list") else { return [] }
        guard let (d, _) = try? await URLSession.shared.data(from: u),
              let a = try? JSONSerialization.jsonObject(with: d) as? [[String: Any]] else { return [] }
        return a.filter { ($0["type"] as? String) == "page" }
    }

    public func evaluate(_ expr: String, onSession sid: String? = nil) async -> Any? {
        guard let c = client else { return nil }
        let target = sid ?? firstPageSession
        let r = try? await c.sendAsync("Runtime.evaluate", ["expression": expr, "returnByValue": true, "awaitPromise": true],
                                       sessionId: target)
        guard let res = r?["result"] as? [String: Any] else { return r }
        return res["value"]
    }

    public func isAlive() -> Bool {
        if closed { return false }
        if pid > 0 && kill(pid, 0) != 0 { return false }
        return true
    }

    private func checkAlive() {
        guard !closed else { return }
        if pid > 0 && kill(pid, 0) != 0 {
            VeilLog.info("[session:\(profile.seq)] 浏览器进程已退出")
            finish()
        }
    }

    // MARK: - 关闭

    public func close(killBrowser: Bool = true) {
        guard !closed else { return }
        if killBrowser && pid > 0 {
            // 优雅关闭：先尝试通过 CDP 关窗
            if let c = client, c.isConnected {
                let sem = DispatchSemaphore(value: 0)
                Task { _ = try? await c.sendAsync("Browser.close", [:], timeout: 3); sem.signal() }
                _ = sem.wait(timeout: .now() + 3)
            }
            if kill(pid, 0) == 0 {
                kill(pid, SIGTERM)
                Thread.sleep(forTimeInterval: 0.4)
                if kill(pid, 0) == 0 { kill(pid, SIGKILL) }
            }
            // 兜底：清理残留子进程
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
            p.arguments = ["-f", "--user-data-dir=\(Paths.userDataDir(profileId).path)"]
            p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
            try? p.run(); p.waitUntilExit()
        }
        finish()
    }

    private func finish() {
        guard !closed else { return }
        closed = true
        client?.close()
        client = nil
        relay?.stop()
        relay = nil
        attachedPages.removeAll()
        Store.shared.updateRuntime(profileId, nil)
        SessionManager.shared.remove(profileId)
        onClosed?(profileId)
        VeilLog.info("[session:\(profile.seq)] 会话已结束")
    }

    public func runtimeState() -> RuntimeState {
        var r = RuntimeState()
        r.pid = pid
        r.debugPort = Int(debugPort)
        r.browserWs = browserWs
        r.startedAt = startedAt
        r.dataDir = Paths.userDataDir(profileId).path
        return r
    }
}

// MARK: - 会话管理器

public final class SessionManager {
    public static let shared = SessionManager()
    private var sessions: [String: BrowserSession] = [:]
    private let q = DispatchQueue(label: "veil.sessions")
    private var windowCounter = 0

    public func get(_ id: String) -> BrowserSession? { q.sync { sessions[id] } }
    public func all() -> [BrowserSession] { q.sync { Array(sessions.values) } }
    public func ids() -> [String] { q.sync { Array(sessions.keys) } }
    public var count: Int { q.sync { sessions.count } }

    func nextWindowIndex() -> Int { q.sync { let i = windowCounter; windowCounter += 1; return i } }

    func put(_ s: BrowserSession) { q.async { self.sessions[s.profileId] = s } }
    func remove(_ id: String) { q.async { self.sessions.removeValue(forKey: id) } }

    @discardableResult
    public func openProfile(_ id: String) async throws -> BrowserSession {
        if let ex = get(id), ex.isAlive() { return ex }
        guard let profile = Store.shared.profile(id) else { throw NSError(domain: "veil", code: 404, userInfo: [NSLocalizedDescriptionKey: "窗口不存在: \(id)"]) }
        let idx = nextWindowIndex()
        let s = try await BrowserSession.open(profile: profile, windowIndex: idx, host: Host.shared.host)
        Store.shared.updateRuntime(id, s.runtimeState())
        put(s)
        s.onClosed = { [weak self] pid in self?.remove(pid) }
        return s
    }

    public func closeProfile(_ id: String) {
        q.sync { sessions[id] }?.close()
    }
    public func closeAll() {
        for s in all() { s.close() }
    }

    /// 应用重启后重连仍在运行的窗口
    public func reattach() async {
        let profiles = Store.shared.profiles().filter { $0.runtime != nil }
        guard !profiles.isEmpty else { return }
        for p in profiles {
            guard let rt = p.runtime else { continue }
            if rt.pid <= 0 || kill(rt.pid, 0) != 0 { Store.shared.updateRuntime(p.id, nil); continue }
            if !Net.isPortOpen(UInt16(rt.debugPort), timeoutMs: 400) { Store.shared.updateRuntime(p.id, nil); continue }
            // 重新接管
            if let s = try? await reattachOne(p, rt: rt) { put(s) }
        }
    }

    private func reattachOne(_ p: VeilProfile, rt: RuntimeState) async throws -> BrowserSession {
        let ws = try await BrowserLauncher.browserWsURL(port: UInt16(rt.debugPort), timeoutMs: 4000)
        let session = BrowserSession(profile: p, injectSource: InjectScript.source(for: p, host: Host.shared.host))
        try await session.adopt(pid: rt.pid, port: UInt16(rt.debugPort), ws: ws)
        VeilLog.info("[session:\(p.seq)] 已重新接管运行中的窗口 pid=\(rt.pid)")
        session.onClosed = { [weak self] id in self?.remove(id) }
        return session
    }
}

extension BrowserSession {
    func adopt(pid: Int32, port: UInt16, ws: String) async throws {
        self.pid = pid
        self.debugPort = port
        self.browserWs = ws
        guard let url = URL(string: ws) else { throw LaunchError.cdpTimeout("非法 ws") }
        let c = CDPClient(url: url)
        client = c
        c.onEvent = { [weak self] m, p, sid in self?.handleEvent(m, p, sid) }
        c.onDisconnected = { [weak self] r in self?.lastError = "CDP 断开: \(r)"; DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { self?.checkAlive() } }
        try await c.connect()
        _ = try? await c.sendAsync("Target.setDiscoverTargets", ["discover": true])
        _ = try? await c.sendAsync("Target.setAutoAttach", ["autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true])
        try? await Task.sleep(nanoseconds: 250_000_000)
        if let list = try? await c.sendAsync("Target.getTargets"), let infos = list["targetInfos"] as? [[String: Any]] {
            for t in infos where (t["type"] as? String) == "page" {
                guard let tid = t["targetId"] as? String, !knownTargets.contains(tid) else { continue }
                let u = t["url"] as? String ?? ""
                if u.hasPrefix("devtools://") { continue }
                knownTargets.insert(tid)
                await attachExisting(targetId: tid)
            }
        }
    }
}
