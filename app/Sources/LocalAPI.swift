import Foundation

/// 本地 HTTP API：兼容比特浏览器（BitBrowser）的 127.0.0.1:54345 接口协议，
/// 同时承载指纹自检页等静态资源。
public final class LocalAPI {
    public static let shared = LocalAPI()
    static let staticExts: Set<String> = ["html","htm","css","js","mjs","json","svg","png","jpg","jpeg","gif","ico","webp","woff","woff2","ttf","map","txt","icns"]
    public private(set) var server: HTTPServer?
    public private(set) var boundPort: UInt16 = 0
    public static let version = "1.0.0"

    private init() {}

    public func start() {
        let s = Store.shared.settings()
        guard s.apiEnabled else { VeilLog.info("[api] 本地 API 已关闭"); return }
        let srv = HTTPServer(handler: { [weak self] req in await self?.route(req) ?? HTTPResponse(status: 503) })
        do {
            let port = try srv.start(port: UInt16(exactly: s.apiPort) ?? 0)
            boundPort = port
            server = srv
            if port != UInt16(s.apiPort) {
                VeilLog.warn("[api] 端口 \(s.apiPort) 被占用，实际监听 \(port)")
            }
        } catch {
            VeilLog.error("[api] 启动失败: \(error)")
        }
    }

    public func restart() {
        server?.stop(); server = nil; boundPort = 0
        start()
    }

    // MARK: - 路由

    func route(_ req: HTTPRequest) async -> HTTPResponse {
        let path = req.path
        // CORS 预检
        if req.method == "OPTIONS" {
            return HTTPResponse(status: 204, headers: [
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Veil-Token",
                "Access-Control-Max-Age": "86400",
            ])
        }

        // 静态资源
        if path.hasPrefix("/__veil/") {
            let sub = String(path.dropFirst("/__veil/".count))
            if sub == "expect" { return await expectResponse(req) }
            if sub == "probe" { return HTTPResponse.html("<!doctype html><meta charset=utf-8><title>Veil Probe</title><body>Veil probe context") }
            if sub == "bridge" { return await bridgeCall(req) }
            return StaticFiles.serve(sub, query: req.query)
        }
        if path == "/" || path == "/index.html" { return StaticFiles.serve("index.html", query: req.query) }
        if path == "/detect" || path == "/detect.html" { return StaticFiles.serve("detect.html", query: req.query) }

        // 静态资源（浏览器直连模式）
        let ext = (path as NSString).pathExtension.lowercased()
        if Self.staticExts.contains(ext) {
            return StaticFiles.serve(String(path.dropFirst()), query: req.query)
        }

        // API
        if path == "/health" || path == "/api/health" {
            return ok(["status": "OK", "version": LocalAPI.version, "profiles": Store.shared.profiles().count,
                       "running": SessionManager.shared.count])
        }

        guard authorized(req) else {
            return HTTPResponse(status: 401, headers: ["Content-Type": "application/json; charset=utf-8"],
                                body: Data(#"{"success":false,"msg":"token 校验失败","code":401}"#.utf8))
        }

        let body = req.json ?? [:]
        switch path {
        // ---- 窗口 ----
        case "/browser/open", "/api/browser/open":            return await apiOpen(body)
        case "/browser/close", "/api/browser/close":          return apiClose(body)
        case "/browser/list", "/api/browser/list":            return apiList(body)
        case "/browser/detail", "/api/browser/detail":        return apiDetail(body)
        case "/browser/add", "/api/browser/add":              return apiAdd(body)
        case "/browser/update", "/api/browser/update":        return apiUpdate(body)
        case "/browser/delete", "/api/browser/delete":        return apiDelete(body)
        case "/browser/enable", "/api/browser/enable":        return apiEnable(body, true)
        case "/browser/disable", "/api/browser/disable":      return apiEnable(body, false)
        case "/browser/local-active", "/api/browser/active":  return apiActive()
        case "/browser/pids", "/api/browser/pids":            return apiPids()
        case "/browser/navigate", "/api/browser/navigate":    return await apiNavigate(body)
        case "/browser/tabs", "/api/browser/tabs":            return await apiTabs(body)
        case "/browser/evaluate", "/api/browser/evaluate":  return await apiEvaluate(body)
        // ---- 分组 ----
        case "/group/list", "/api/group/list":                return apiGroupList()
        case "/group/add", "/api/group/add":                  return apiGroupSave(body, isNew: true)
        case "/group/update", "/api/group/update":            return apiGroupSave(body, isNew: false)
        case "/group/delete", "/api/group/delete":            return apiGroupDelete(body)
        // ---- 代理 ----
        case "/proxy/check", "/api/proxy/check":              return await apiProxyCheck(body)
        // ---- Cookie ----
        case "/cookie/list", "/api/cookie/list":              return await apiCookieList(body)
        case "/cookie/import", "/api/cookie/import":          return apiCookieImport(body)
        case "/cookie/clear", "/api/cookie/clear":            return apiCookieClear(body)
        // ---- 指纹 / 宿主 ----
        case "/fingerprint/random", "/api/fingerprint/random":return apiRandomFP(body)
        case "/host/probe", "/api/host/probe":                return await apiHostProbe()
        case "/host/info", "/api/host/info":                  return ok(J.any(from: Host.shared.host))
        // ---- 模板 ----
        case "/template/list", "/api/template/list":          return ok(["list": Store.shared.templates().map { J.any(from: $0) }])
        default:
            return HTTPResponse(status: 404, headers: ["Content-Type": "application/json; charset=utf-8"],
                                body: Data(#"{"success":false,"msg":"未知接口 \#(path)","code":404}"#.utf8))
        }
    }

    private func authorized(_ req: HTTPRequest) -> Bool {
        let token = Store.shared.settings().apiToken
        guard !token.isEmpty else { return true }
        if let h = req.header("authorization"), h.lowercased().hasPrefix("bearer ") {
            return h.dropFirst(7) == token
        }
        if let t = req.header("x-veil-token") { return t == token }
        if let t = (req.json?["token"] as? String) { return t == token }
        if let t = req.query["token"] { return t == token }
        return false
    }

    // MARK: - 帮助

    private func ok(_ data: Any, _ msg: String = "") -> HTTPResponse {
        HTTPResponse.json(["success": true, "msg": msg, "code": 0, "data": data])
    }
    private func fail(_ msg: String, _ code: Int = -1) -> HTTPResponse {
        HTTPResponse.json(["success": false, "msg": msg, "code": code, "data": NSNull()])
    }

    private func resolveIds(_ body: [String: Any]) -> [String] {
        var ids: [String] = []
        if let s = body["id"] as? String, !s.isEmpty { ids.append(s) }
        if let arr = body["ids"] as? [String] { ids.append(contentsOf: arr) }
        if let arr = body["ids"] as? [Int] {
            for sq in arr { if let p = Store.shared.profiles().first(where: { $0.seq == sq }) { ids.append(p.id) } }
        }
        if ids.isEmpty, let sq = body["seq"] as? Int {
            if let p = Store.shared.profiles().first(where: { $0.seq == sq }) { ids.append(p.id) }
        }
        if ids.isEmpty, let sq = body["seq"] as? String, let n = Int(sq) {
            if let p = Store.shared.profiles().first(where: { $0.seq == n }) { ids.append(p.id) }
        }
        return Array(Set(ids))
    }

    // MARK: - 窗口接口

    private func apiOpen(_ body: [String: Any]) async -> HTTPResponse {
        let ids = resolveIds(body)
        guard !ids.isEmpty else { return fail("缺少 id / seq / ids") }
        var list: [[String: Any]] = []
        var lastErr = ""
        for id in ids {
            do {
                let s = try await SessionManager.shared.openProfile(id)
                var d: [String: Any] = [
                    "ws": URL(string: s.browserWs)?.path ?? "",
                    "wsUrl": s.browserWs,
                    "http": "http://127.0.0.1:\(s.debugPort)",
                    "debugPort": s.debugPort,
                    "pid": s.pid,
                    "path": Paths.userDataDir(id).path,
                    "driver": "",
                    "id": id,
                ]
                if let p = Store.shared.profile(id) { d["seq"] = p.seq; d["name"] = p.name }
                list.append(d)
            } catch {
                lastErr = "\(error)"
                VeilLog.error("[api] open \(id) 失败: \(error)")
            }
        }
        guard !list.isEmpty else { return fail(lastErr.isEmpty ? "打开失败" : lastErr) }
        if list.count == 1 { return ok(list[0]) }
        return ok(["list": list])
    }

    private func apiClose(_ body: [String: Any]) -> HTTPResponse {
        let ids = resolveIds(body)
        guard !ids.isEmpty else { return fail("缺少 id") }
        for id in ids { SessionManager.shared.closeProfile(id) }
        return ok(["closed": ids])
    }

    private func apiList(_ body: [String: Any]) -> HTTPResponse {
        let page = max(0, body["page"] as? Int ?? 0)
        let pageSize = max(1, min(500, body["pageSize"] as? Int ?? 50))
        let name = (body["name"] as? String) ?? ""
        let groupId = (body["groupId"] as? String) ?? ""
        var all = Store.shared.profiles()
        if !name.isEmpty { all = all.filter { $0.name.localizedCaseInsensitiveContains(name) || $0.remark.localizedCaseInsensitiveContains(name) } }
        if !groupId.isEmpty { all = all.filter { $0.groupId == groupId } }
        let total = all.count
        let start = min(page * pageSize, total)
        let end = min(start + pageSize, total)
        let slice = Array(all[start..<end])
        let groups = Store.shared.groups()
        let list: [[String: Any]] = slice.map { p in
            var d = bitBrowserProfileDict(p)
            d["groupName"] = groups.first { $0.id == p.groupId }?.name ?? ""
            return d
        }
        return ok(["list": list, "page": page, "pageSize": pageSize, "total": total])
    }

    private func apiDetail(_ body: [String: Any]) -> HTTPResponse {
        let ids = resolveIds(body)
        guard let id = ids.first, let p = Store.shared.profile(id) else { return fail("窗口不存在") }
        var d = bitBrowserProfileDict(p)
        d["veil"] = J.any(from: p)
        return ok(d)
    }

    private func apiAdd(_ body: [String: Any]) -> HTTPResponse {
        var p = VeilProfile()
        p.name = (body["name"] as? String) ?? ""
        p.remark = (body["remark"] as? String) ?? ""
        p.groupId = (body["groupId"] as? String) ?? (Store.shared.groups().first?.id ?? "default")
        p.seq = (body["seq"] as? Int) ?? 0
        if let fpAny = body["fingerprint"] ?? body["veil"] {
            if let fp = J.recode(Fingerprint.self, from: fpAny) { p.fp = fp }
        }
        let platform = (body["platform"] as? String) ?? (body["browserType"] as? String) ?? "windows"
        if !(body["fingerprint"] != nil || body["veil"] != nil) {
            p.fp = FingerprintGen.random(platform: platform, countryCode: body["country"] as? String, host: Host.shared.host)
        }
        p.fp.platform = platform
        if let proxyAny = body["proxy"], let px = J.recode(ProxyConfig.self, from: proxyAny) { p.proxy = px }
        else if let pt = body["proxyType"] as? String, pt != "noproxy", pt != "none" {
            p.proxy.type = pt
            p.proxy.host = (body["proxyHost"] as? String) ?? ""
            p.proxy.port = (body["proxyPort"] as? Int) ?? 0
            p.proxy.username = (body["userName"] as? String) ?? ""
            p.proxy.password = (body["password"] as? String) ?? ""
        }
        let saved = Store.shared.saveProfile(p)
        return ok(["id": saved.id, "seq": saved.seq])
    }

    private func apiUpdate(_ body: [String: Any]) -> HTTPResponse {
        let ids = resolveIds(body)
        guard let id = ids.first, var p = Store.shared.profile(id) else { return fail("窗口不存在") }
        if let v = body["name"] as? String { p.name = v }
        if let v = body["remark"] as? String { p.remark = v }
        if let v = body["groupId"] as? String { p.groupId = v }
        if let v = body["seq"] as? Int, v > 0 { p.seq = v }
        if let v = body["fingerprint"] ?? body["veil"], let fp = J.recode(Fingerprint.self, from: v) { p.fp = fp }
        if let v = body["proxy"], let px = J.recode(ProxyConfig.self, from: v) { p.proxy = px }
        if let v = body["launch"], let lc = J.recode(LaunchConfig.self, from: v) { p.launch = lc }
        if let v = body["automation"], let ac = J.recode(AutomationConfig.self, from: v) { p.automation = ac }
        let saved = Store.shared.saveProfile(p)
        return ok(["id": saved.id])
    }

    private func apiDelete(_ body: [String: Any]) -> HTTPResponse {
        let ids = resolveIds(body)
        guard !ids.isEmpty else { return fail("缺少 ids") }
        for id in ids { SessionManager.shared.closeProfile(id) }
        let delData = (body["deleteCache"] as? Bool) ?? (body["deleteData"] as? Bool) ?? true
        let n = Store.shared.deleteProfiles(ids, deleteData: delData)
        return ok(["deleted": n])
    }

    private func apiEnable(_ body: [String: Any], _ en: Bool) -> HTTPResponse {
        let ids = resolveIds(body)
        Store.shared.setEnabled(ids, en)
        return ok(["updated": ids.count])
    }

    private func apiActive() -> HTTPResponse {
        let list = SessionManager.shared.all().compactMap { s -> [String: Any]? in
            guard let p = Store.shared.profile(s.profileId) else { return nil }
            return ["id": s.profileId, "seq": p.seq, "name": p.name, "pid": s.pid,
                    "debugPort": s.debugPort, "http": "http://127.0.0.1:\(s.debugPort)",
                    "ws": URL(string: s.browserWs)?.path ?? "", "startedAt": Int(s.startedAt.timeIntervalSince1970 * 1000),
                    "pages": s.attachedPages.count]
        }
        return ok(["list": list, "total": list.count])
    }

    private func apiPids() -> HTTPResponse {
        let d = Dictionary(uniqueKeysWithValues: SessionManager.shared.all().map { ($0.profileId, Int($0.pid)) })
        return ok(d)
    }

    private func apiNavigate(_ body: [String: Any]) async -> HTTPResponse {
        let ids = resolveIds(body)
        guard let id = ids.first, let s = SessionManager.shared.get(id), let url = body["url"] as? String else { return fail("缺少 id / url") }
        let okFlag = await s.openURL(url)
        return okFlag ? ok(["navigated": url]) : fail("导航失败")
    }

    private func apiTabs(_ body: [String: Any]) async -> HTTPResponse {
        let ids = resolveIds(body)
        guard let id = ids.first, let s = SessionManager.shared.get(id) else { return fail("窗口未运行") }
        let tabs = await s.tabs()
        return ok(["list": tabs.map { ["id": $0["id"] ?? "", "title": $0["title"] ?? "", "url": $0["url"] ?? ""] }])
    }

    private func apiEvaluate(_ body: [String: Any]) async -> HTTPResponse {
        let ids = resolveIds(body)
        guard let id = ids.first, let s = SessionManager.shared.get(id), let expr = body["expression"] as? String else { return fail("缺少 id / expression") }
        let v = await s.evaluate(expr)
        return ok(["result": v ?? NSNull()])
    }

    // MARK: - 分组

    private func apiGroupList() -> HTTPResponse {
        let list = Store.shared.groups().map { g -> [String: Any] in
            ["id": g.id, "groupId": g.id, "groupName": g.name, "name": g.name, "color": g.color, "remark": g.remark,
             "profileCount": Store.shared.profiles().filter { $0.groupId == g.id }.count]
        }
        return ok(["list": list, "total": list.count])
    }
    private func apiGroupSave(_ body: [String: Any], isNew: Bool) -> HTTPResponse {
        var g: ProfileGroup
        if !isNew, let id = body["groupId"] as? String ?? body["id"] as? String, let ex = Store.shared.groups().first(where: { $0.id == id }) { g = ex }
        else { g = ProfileGroup() }
        if let v = body["groupName"] as? String ?? body["name"] as? String { g.name = v }
        if let v = body["color"] as? String { g.color = v }
        if let v = body["remark"] as? String { g.remark = v }
        guard !g.name.isEmpty else { return fail("分组名称不能为空") }
        Store.shared.saveGroup(g)
        return ok(["id": g.id, "groupId": g.id])
    }
    private func apiGroupDelete(_ body: [String: Any]) -> HTTPResponse {
        guard let id = body["groupId"] as? String ?? body["id"] as? String else { return fail("缺少 groupId") }
        Store.shared.deleteGroup(id)
        return ok(["deleted": id])
    }

    // MARK: - 代理 / Cookie / 指纹

    private func apiProxyCheck(_ body: [String: Any]) async -> HTTPResponse {
        var px = ProxyConfig()
        let proxyAny: Any = body["proxy"] ?? body
        if let v = J.recode(ProxyConfig.self, from: proxyAny) { px = v }
        if px.host.isEmpty {
            px.type = (body["proxyType"] as? String) ?? px.type
            px.host = (body["proxyHost"] as? String) ?? px.host
            px.port = (body["proxyPort"] as? Int) ?? px.port
            px.username = (body["userName"] as? String) ?? px.username
            px.password = (body["password"] as? String) ?? px.password
        }
        guard px.isUsable else { return fail("代理配置无效") }
        let r = await ProxyTool.check(px)
        return ok(J.any(from: r))
    }

    private func apiCookieList(_ body: [String: Any]) async -> HTTPResponse {
        let ids = resolveIds(body)
        guard let id = ids.first, let p = Store.shared.profile(id) else { return fail("窗口不存在") }
        if let s = SessionManager.shared.get(id) {
            let live = await s.cookies()
            return ok(["list": live, "source": "live"])
        }
        return ok(["list": p.automation.cookies.map { J.any(from: $0) }, "source": "stored"])
    }

    private func apiCookieImport(_ body: [String: Any]) -> HTTPResponse {
        let ids = resolveIds(body)
        guard let id = ids.first, var p = Store.shared.profile(id) else { return fail("窗口不存在") }
        var items: [[String: Any]] = []
        if let arr = body["cookies"] as? [[String: Any]] { items = arr }
        else if let txt = body["text"] as? String { items = CookieTool.parseText(txt) }
        else if let arr = body["list"] as? [[String: Any]] { items = arr }
        guard !items.isEmpty else { return fail("没有可导入的 Cookie") }
        var list: [CookieEntry] = []
        for it in items {
            if let e = J.recode(CookieEntry.self, from: it) { list.append(e); continue }
            var e = CookieEntry()
            e.name = (it["name"] as? String) ?? ""
            e.value = (it["value"] as? String) ?? ""
            e.domain = (it["domain"] as? String) ?? (it["hostOnly"] as? String) ?? ""
            e.path = (it["path"] as? String) ?? "/"
            if let ex = it["expirationDate"] as? Double { e.expires = ex }
            else if let ex = it["expires"] as? Double { e.expires = ex }
            e.httpOnly = (it["httpOnly"] as? Bool) ?? false
            e.secure = (it["secure"] as? Bool) ?? false
            if let ss = it["sameSite"] as? String { e.sameSite = ss }
            if !e.name.isEmpty { list.append(e) }
        }
        let append = (body["append"] as? Bool) ?? false
        p.automation.cookies = append ? (p.automation.cookies + list) : list
        Store.shared.saveProfile(p)
        return ok(["imported": list.count])
    }

    private func apiCookieClear(_ body: [String: Any]) -> HTTPResponse {
        let ids = resolveIds(body)
        guard let id = ids.first, var p = Store.shared.profile(id) else { return fail("窗口不存在") }
        p.automation.cookies = []
        Store.shared.saveProfile(p)
        return ok(["cleared": id])
    }

    private func apiRandomFP(_ body: [String: Any]) -> HTTPResponse {
        let platform = (body["platform"] as? String) ?? "windows"
        let cc = body["country"] as? String ?? body["countryCode"] as? String
        var fp = FingerprintGen.random(platform: platform, countryCode: cc, host: Host.shared.host)
        FingerprintGen.makeConsistent(&fp)
        return ok(J.any(from: fp))
    }

    private func apiHostProbe() async -> HTTPResponse {
        do { let h = try await Host.shared.probe(); return ok(J.any(from: h)) }
        catch { return fail("探针失败: \(error)") }
    }

    /// 浏览器直连时使用的桥接通道（与 WKWebView 桥等价）
    private func bridgeCall(_ req: HTTPRequest) async -> HTTPResponse {
        guard req.method == "POST" else { return fail("仅支持 POST") }
        guard let body = req.json, let method = body["method"] as? String else { return fail("缺少 method") }
        let params = (body["params"] as? [String: Any]) ?? [:]
        let r = await Bridge.shared?.handlePublic(method, params: params)
        switch r ?? .err("桥接不可用") {
        case .ok(let v): return HTTPResponse.json(v ?? NSNull())
        case .err(let m): return HTTPResponse.json(["__error": m])
        }
    }

    private func expectResponse(_ req: HTTPRequest) async -> HTTPResponse {
        guard let id = req.query["profile"], let p = Store.shared.profile(id) else { return ok([:]) }
        let fp = p.fp
        return ok([
            "id": p.id, "seq": p.seq, "name": p.name,
            "userAgent": fp.userAgent,
            "platform": fp.navPlatform,
            "languages": fp.languages,
            "timezone": fp.timezone,
            "screen": [fp.screenWidth, fp.screenHeight, fp.colorDepth],
            "availTopOffset": fp.availTopOffset,
            "fontsMode": fp.fontsMode,
            "devicePixelRatio": fp.devicePixelRatio,
            "hardwareConcurrency": fp.hardwareConcurrency,
            "deviceMemory": fp.deviceMemory,
            "webglVendor": fp.webglVendor,
            "webglRenderer": fp.webglRenderer,
            "webrtcMode": fp.webrtcMode,
            "maxTouchPoints": fp.maxTouchPoints,
            "doNotTrack": fp.doNotTrack,
            "canvasNoise": fp.canvasNoise,
            "audioNoise": fp.audioNoise,
            "fontCount": fp.fonts.count,
            "proxy": p.proxy.label,
        ])
    }
}

/// BitBrowser 兼容的窗口字段映射
func bitBrowserProfileDict(_ p: VeilProfile) -> [String: Any] {
    var d: [String: Any] = [
        "id": p.id,
        "seq": p.seq,
        "name": p.name,
        "remark": p.remark,
        "groupId": p.groupId,
        "userName": "",
        "password": "",
        "platform": p.fp.platform,
        "browserType": p.fp.platform,
        "proxyType": p.proxy.type == "none" || p.proxy.type.isEmpty ? "noproxy" : p.proxy.type,
        "proxyHost": p.proxy.host,
        "proxyPort": p.proxy.port,
        "proxyUserName": p.proxy.username,
        "proxyPassword": p.proxy.password,
        "country": p.fp.timezone,
        "enabled": p.enabled,
        "createdTime": ISO8601DateFormatter().string(from: p.createdAt),
        "lastOpenTime": p.lastOpenedAt.map { ISO8601DateFormatter().string(from: $0) } ?? "",
        "openCount": p.openCount,
        "status": (p.runtime != nil && SessionManager.shared.get(p.id) != nil) ? "running" : "stopped",
    ]
    if let r = p.runtime { d["pid"] = r.pid; d["debugPort"] = r.debugPort }
    return d
}
