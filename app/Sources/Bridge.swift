import Foundation
import AppKit
import WebKit
import UniformTypeIdentifiers

/// WKWebView <-> Swift 桥接
public final class Bridge: NSObject, WKScriptMessageHandler {
    public weak var webView: WKWebView?
    public static var shared: Bridge?

    public override init() { super.init(); Bridge.shared = self }

    public func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "veil",
              let body = message.body as? [String: Any],
              let mid = body["id"] as? Int,
              let method = body["method"] as? String else { return }
        let params = (body["params"] as? [String: Any]) ?? [:]
        Task { @MainActor in
            let start = Date()
            let result = await handle(method, params: params)
            let ms = Int(Date().timeIntervalSince(start) * 1000)
            if ms > 250 { VeilLog.debug("[bridge] \(method) 用时 \(ms)ms") }
            respond(id: mid, result: result)
        }
    }

    private func respond(id: Int, result: BridgeResult) {
        guard let wv = webView else { return }
        var json: String
        switch result {
        case .ok(let v): json = sanitize(J.anyToJSONString(v))
        case .err(let m): json = sanitize(J.anyToJSONString(["__error": m]))
        }
        let js = "window.__veilResolve&&window.__veilResolve(\(id),\(json));"
        wv.evaluateJavaScript(js) { _, err in
            if let err = err { VeilLog.warn("[bridge] 回调失败 #\(id): \(err.localizedDescription)") }
        }
    }

    private func sanitize(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{2028}", with: "\\u2028")
         .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    public enum BridgeResult {
        case ok(Any?)
        case err(String)
        var value: Any? { switch self { case .ok(let v): return v; case .err(let m): return ["__error": m] } }
    }

    // MARK: - 方法分发

    /// 供 HTTP 桥接通道调用（非 WebView 环境）
    @MainActor
    public func handlePublic(_ method: String, params: [String: Any]) async -> BridgeResult {
        return await handle(method, params: params)
    }

    @MainActor
    func handle(_ method: String, params: [String: Any]) async -> BridgeResult {
        do {
            switch method {
            case "env":                     return .ok(env())
            case "ping":                    return .ok(["pong": true, "version": LocalAPI.version])
            case "listProfiles":            return .ok(listProfiles(params))
            case "getProfile":              return .ok(getProfile(params))
            case "saveProfile":             return saveProfile(params)
            case "newProfile":              return .ok(newProfile(params))
            case "deleteProfiles":          return deleteProfiles(params)
            case "duplicateProfiles":       return .ok(duplicateProfiles(params))
            case "setEnabled":              return setEnabled(params)
            case "openProfiles":            return .ok(await openProfiles(params))
            case "closeProfiles":           return .ok(closeProfiles(params))
            case "running":                 return .ok(runningList())
            case "groups":                  return .ok(["list": J.anyArray(from: Store.shared.groups())])
            case "saveGroup":               return saveGroup(params)
            case "deleteGroup":             return deleteGroup(params)
            case "templates":               return .ok(["list": J.anyArray(from: Store.shared.templates())])
            case "saveTemplate":            return saveTemplate(params)
            case "deleteTemplate":          return deleteTemplate(params)
            case "randomFingerprint":       return .ok(randomFingerprint(params))
            case "realFingerprint":         return .ok(realFingerprint())
            case "checkProxy":              return .ok(await checkProxy(params))
            case "parseProxy":              return .ok(J.any(from: ProxyTool.parse(params["text"] as? String ?? "")))
            case "probeHost":               return .ok(J.any(from: await Host.shared.probeAsync()))
            case "settings":                return .ok(J.any(from: Store.shared.settings()))
            case "saveSettings":            return saveSettings(params)
            case "exportProfiles":          return exportProfiles(params)
            case "importProfiles":          return importProfiles(params)
            case "cookieImport":            return cookieImport(params)
            case "cookieExport":            return cookieExport(params)
            case "cookieLive":              return .ok(await cookieLive(params))
            case "detect":                  return .ok(await detect(params))
            case "navigate":                return .ok(await navigate(params))
            case "tabs":                    return .ok(await tabs(params))
            case "evaluate":                return .ok(await evaluate(params))
            case "logs":                    return .ok(["text": VeilLog.tail(params["tail"] as? Int ?? 500)])
            case "reveal":                  return reveal(params)
            case "pickBrowser":             return .ok(await pickBrowser())
            case "saveFile":                return .ok(await saveFile(params))
            case "openFile":                return .ok(await openFile(params))
            case "openExternal":            return openExternal(params)
            case "apiInfo":                 return .ok(apiInfo())
            case "geoCities":               return .ok(["list": GeoDB.cities.map { ["city": $0.city, "country": $0.country, "cc": $0.cc, "timezone": $0.timezone, "locale": $0.locale, "languages": $0.languages, "lat": $0.lat, "lon": $0.lon] as [String: Any] }])
            case "fontLists":               return .ok(["windows": FontDB.windows, "mac": FontDB.mac, "linux": FontDB.linux])
            case "gpuLists":                return .ok(["windows": GpuDB.windows.map { ["vendor": $0.vendor, "renderer": $0.renderer] },
                                                        "mac": GpuDB.mac.map { ["vendor": $0.vendor, "renderer": $0.renderer] },
                                                        "linux": GpuDB.linux.map { ["vendor": $0.vendor, "renderer": $0.renderer] }])
            case "profileStats":            return .ok(profileStats())
            case "clearProfileData":        return clearProfileData(params)
            case "setMasterPassword":       return await setMasterPassword(params)
            case "unlock":                  return await unlock(params)
            case "quit":                    NSApp.terminate(nil); return .ok(["ok": true])
            default:                        return .err("未知方法: \(method)")
            }
        } catch {
            VeilLog.error("[bridge] \(method) 异常: \(error)")
            return .err("\(error)")
        }
    }

    // MARK: - 实现

    private func env() -> [String: Any] {
        let s = Store.shared.settings()
        return [
            "version": LocalAPI.version,
            "apiPort": Int(LocalAPI.shared.boundPort),
            "apiEnabled": s.apiEnabled,
            "supportDir": Paths.supportRoot.path,
            "webRoot": Paths.bundleWebRoot?.path ?? "",
            "injectFrom": InjectScript.loadedFrom,
            "browsers": Paths.detectBrowsers().map { ["name": $0.name, "path": $0.path, "version": $0.version] as [String: Any] },
            "host": J.any(from: Host.shared.host),
            "hostProbed": Host.shared.host.isValid,
            "running": SessionManager.shared.count,
            "profiles": Store.shared.profiles().count,
            "macOS": ProcessInfo.processInfo.operatingSystemVersionString,
            "arch": ProcessInfo.processInfo.machineArchitecture,
            "locked": Store.shared.requiresUnlock,
        ]
    }

    private func profileStats() -> [String: Any] {
        let ps = Store.shared.profiles()
        var byPlatform: [String: Int] = [:]
        var byCountry: [String: Int] = [:]
        for p in ps {
            byPlatform[p.fp.platform, default: 0] += 1
            let cc = GeoDB.byTimezone(p.fp.timezone)?.cc ?? "其他"
            byCountry[cc, default: 0] += 1
        }
        return [
            "total": ps.count,
            "running": SessionManager.shared.count,
            "enabled": ps.filter { $0.enabled }.count,
            "withProxy": ps.filter { $0.proxy.isUsable }.count,
            "groups": Store.shared.groups().count,
            "templates": Store.shared.templates().count,
            "byPlatform": byPlatform,
            "byCountry": byCountry,
            "totalOpens": ps.reduce(0) { $0 + $1.openCount },
            "diskUsageMB": Int(Paths.profilesRoot.diskUsageBytes / 1024 / 1024),
        ]
    }

    private func listProfiles(_ params: [String: Any]) -> [String: Any] {
        var all = Store.shared.profiles()
        let q = (params["query"] as? String ?? "").trimmingCharacters(in: .whitespaces)
        let gid = params["groupId"] as? String ?? ""
        let platform = params["platform"] as? String ?? ""
        let runningOnly = (params["runningOnly"] as? Bool) ?? false
        if !q.isEmpty {
            all = all.filter {
                $0.name.localizedCaseInsensitiveContains(q) || $0.remark.localizedCaseInsensitiveContains(q)
                || String($0.seq) == q || $0.proxy.host.localizedCaseInsensitiveContains(q)
                || $0.tags.contains { $0.localizedCaseInsensitiveContains(q) }
            }
        }
        if gid == "__none__" { all = all.filter { $0.groupId.isEmpty } }
        else if !gid.isEmpty && gid != "__all__" { all = all.filter { $0.groupId == gid } }
        if !platform.isEmpty && platform != "all" { all = all.filter { $0.fp.platform == platform } }
        if runningOnly { all = all.filter { SessionManager.shared.get($0.id) != nil } }
        let runningIds = Set(SessionManager.shared.ids())
        let groups = Store.shared.groups()
        let list: [[String: Any]] = all.map { p in
            var d = bitBrowserProfileDict(p)
            d["veil"] = J.any(from: p)
            d["groupName"] = groups.first { $0.id == p.groupId }?.name ?? ""
            d["groupColor"] = groups.first { $0.id == p.groupId }?.color ?? "#666"
            d["running"] = runningIds.contains(p.id)
            d["proxyChecked"] = p.proxy.checkResult.map { J.any(from: $0) } ?? NSNull()
            d["countryName"] = GeoDB.byTimezone(p.fp.timezone).map { "\($0.city), \($0.country)" } ?? p.fp.timezone
            return d
        }
        return ["list": list, "total": list.count,
                "groups": J.anyArray(from: groups),
                "runningIds": Array(runningIds)]
    }

    private func getProfile(_ params: [String: Any]) -> Any? {
        guard let id = params["id"] as? String, let p = Store.shared.profile(id) else { return NSNull() }
        return J.any(from: p)
    }

    private func saveProfile(_ params: [String: Any]) -> BridgeResult {
        guard let raw = params["profile"] else { return .err("缺少 profile") }
        var p: VeilProfile
        if let existing = J.recode(VeilProfile.self, from: raw) { p = existing }
        else { return .err("profile 结构无法解析") }
        let saved = Store.shared.saveProfile(p)
        return .ok(J.any(from: saved))
    }

    private func newProfile(_ params: [String: Any]) -> Any {
        let platform = (params["platform"] as? String) ?? "windows"
        let cc = params["country"] as? String
        let gid = (params["groupId"] as? String) ?? ""
        let count = max(1, min(200, params["count"] as? Int ?? 1))
        var out: [Any] = []
        for i in 0..<count {
            let p = Store.shared.newProfile(platform: platform, countryCode: cc, groupId: gid,
                                            name: count > 1 ? nil : params["name"] as? String)
            out.append(J.any(from: p))
            _ = i
        }
        return ["list": out, "count": out.count]
    }

    private func deleteProfiles(_ params: [String: Any]) -> BridgeResult {
        guard let ids = params["ids"] as? [String], !ids.isEmpty else { return .err("缺少 ids") }
        let delData = (params["deleteData"] as? Bool) ?? true
        for id in ids { SessionManager.shared.closeProfile(id) }
        let n = Store.shared.deleteProfiles(ids, deleteData: delData)
        return .ok(["deleted": n])
    }

    private func duplicateProfiles(_ params: [String: Any]) -> Any {
        guard let id = params["id"] as? String else { return ["list": []] }
        let count = max(1, min(200, params["count"] as? Int ?? 1))
        let copyCache = (params["copyCache"] as? Bool) ?? false
        let out = Store.shared.duplicateProfile(id, count: count, copyCache: copyCache)
        return ["list": J.anyArray(from: out), "count": out.count]
    }

    private func setEnabled(_ params: [String: Any]) -> BridgeResult {
        guard let ids = params["ids"] as? [String] else { return .err("缺少 ids") }
        Store.shared.setEnabled(ids, (params["enabled"] as? Bool) ?? true)
        return .ok(["updated": ids.count])
    }

    private func openProfiles(_ params: [String: Any]) async -> [[String: Any]] {
        guard let ids = params["ids"] as? [String], !ids.isEmpty else { return [] }
        var out: [[String: Any]] = []
        let concurrent = max(1, min(8, params["concurrency"] as? Int ?? 2))
        var index = 0
        while index < ids.count {
            let batch = Array(ids[index..<min(index + concurrent, ids.count)])
            index += batch.count
            let results: [[String: Any]] = await withTaskGroup(of: [String: Any].self) { group in
                for id in batch {
                    group.addTask {
                        do {
                            let s = try await SessionManager.shared.openProfile(id)
                            // 代理校验（可选）
                            if Store.shared.settings().autoCheckProxyOnOpen, let p = Store.shared.profile(id), p.proxy.isUsable {
                                let r = await ProxyTool.check(p.proxy)
                                var np = p; np.proxy.checkResult = r; Store.shared.saveProfile(np)
                            }
                            return ["id": id, "ok": true, "pid": s.pid, "debugPort": Int(s.debugPort),
                                    "ws": s.browserWs, "http": "http://127.0.0.1:\(s.debugPort)",
                                    "pages": s.attachedPages.count, "setupCount": s.setupCount]
                        } catch {
                            VeilLog.error("[open] \(id) 失败: \(error)")
                            return ["id": id, "ok": false, "msg": "\(error)"]
                        }
                    }
                }
                var acc: [[String: Any]] = []
                for await r in group { acc.append(r) }
                return acc
            }
            out.append(contentsOf: results)
        }
        // 保持与请求顺序一致
        let order = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0) })
        out.sort { (order[$0["id"] as? String ?? ""] ?? 0) < (order[$1["id"] as? String ?? ""] ?? 0) }
        return out
    }

    private func closeProfiles(_ params: [String: Any]) -> Any {
        let ids = (params["ids"] as? [String]) ?? SessionManager.shared.ids()
        for id in ids { SessionManager.shared.closeProfile(id) }
        return ["closed": ids.count]
    }

    private func runningList() -> Any {
        let list = SessionManager.shared.all().compactMap { s -> [String: Any]? in
            guard let p = Store.shared.profile(s.profileId) else { return nil }
            return ["id": s.profileId, "seq": p.seq, "name": p.name, "pid": s.pid,
                    "debugPort": Int(s.debugPort), "http": "http://127.0.0.1:\(s.debugPort)",
                    "ws": s.browserWs, "alive": s.isAlive(), "pages": s.attachedPages.count,
                    "setupCount": s.setupCount, "proxy": s.proxyInfo,
                    "uptime": Int(Date().timeIntervalSince(s.startedAt)),
                    "lastError": s.lastError,
                    "startedAt": Int(s.startedAt.timeIntervalSince1970 * 1000)]
        }
        return ["list": list, "total": list.count]
    }

    private func saveGroup(_ params: [String: Any]) -> BridgeResult {
        guard let g = J.recode(ProfileGroup.self, from: params["group"]) else { return .err("分组结构无效") }
        Store.shared.saveGroup(g)
        return .ok(J.any(from: g))
    }
    private func deleteGroup(_ params: [String: Any]) -> BridgeResult {
        guard let id = params["id"] as? String else { return .err("缺少 id") }
        Store.shared.deleteGroup(id)
        return .ok(["deleted": id])
    }

    private func saveTemplate(_ params: [String: Any]) -> BridgeResult {
        guard let t = J.recode(FingerprintTemplate.self, from: params["template"]) else { return .err("模板结构无效") }
        Store.shared.saveTemplate(t)
        return .ok(J.any(from: t))
    }
    private func deleteTemplate(_ params: [String: Any]) -> BridgeResult {
        guard let id = params["id"] as? String else { return .err("缺少 id") }
        Store.shared.deleteTemplate(id)
        return .ok(["deleted": id])
    }

    private func randomFingerprint(_ params: [String: Any]) -> Any {
        let platform = (params["platform"] as? String) ?? "windows"
        let cc = params["country"] as? String
        let seed = (params["seed"] as? String) ?? FingerprintGen.newSeed()
        var fp = FingerprintGen.random(platform: platform, countryCode: cc, seed: seed, host: Host.shared.host)
        FingerprintGen.makeConsistent(&fp)
        return J.any(from: fp)
    }
    private func realFingerprint() -> Any {
        var fp = FingerprintGen.realMachine(host: Host.shared.host)
        FingerprintGen.makeConsistent(&fp)
        return J.any(from: fp)
    }

    private func checkProxy(_ params: [String: Any]) async -> Any {
        var px: ProxyConfig
        if let p = params["proxy"], let v = J.recode(ProxyConfig.self, from: p) { px = v }
        else { return ["ok": false, "error": "代理配置无效"] }
        if px.type == "custom" { return ["ok": true, "ip": "系统代理", "note": "跟随系统代理，无法单独检测"] }
        guard px.isUsable else { return ["ok": false, "error": "请填写完整的代理主机与端口"] }
        let r = await ProxyTool.check(px)
        // 回写到窗口
        if let id = params["profileId"] as? String, var p = Store.shared.profile(id) {
            p.proxy.checkResult = r
            Store.shared.saveProfile(p)
        }
        return J.any(from: r)
    }

    private func saveSettings(_ params: [String: Any]) -> BridgeResult {
        guard let s = J.recode(AppSettings.self, from: params["settings"]) else { return .err("设置结构无效") }
        let old = Store.shared.settings()
        Store.shared.saveSettings(s)
        if old.apiPort != s.apiPort || old.apiEnabled != s.apiEnabled {
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) { LocalAPI.shared.restart() }
        }
        return .ok(J.any(from: s))
    }

    private func exportProfiles(_ params: [String: Any]) -> BridgeResult {
        let ids = params["ids"] as? [String]
        let data = Store.shared.exportJSON(ids: ids)
        let s = String(data: data, encoding: .utf8) ?? "{}"
        return .ok(["json": s, "count": (ids?.count) ?? Store.shared.profiles().count,
                    "filename": "veil-profiles-\(dateStamp()).json"])
    }

    private func importProfiles(_ params: [String: Any]) -> BridgeResult {
        guard let json = params["json"] as? String, !json.isEmpty else { return .err("内容为空") }
        let n = Store.shared.importJSON(Data(json.utf8))
        return n > 0 ? .ok(["imported": n]) : .err("导入失败：文件格式无法识别（需要 Veil 导出的 JSON）")
    }

    private func cookieImport(_ params: [String: Any]) -> BridgeResult {
        guard let id = params["id"] as? String, var p = Store.shared.profile(id) else { return .err("窗口不存在") }
        let text = params["text"] as? String ?? ""
        let raw = CookieTool.parseText(text)
        guard !raw.isEmpty else { return .err("未能解析出 Cookie（支持 JSON / Netscape cookies.txt / document.cookie 字符串）") }
        let domain = params["defaultDomain"] as? String ?? ""
        let list = CookieTool.normalize(raw, defaultDomain: domain)
        let append = (params["append"] as? Bool) ?? false
        p.automation.cookies = append ? (p.automation.cookies + list) : list
        Store.shared.saveProfile(p)
        return .ok(["imported": list.count, "total": p.automation.cookies.count])
    }

    private func cookieExport(_ params: [String: Any]) -> BridgeResult {
        guard let id = params["id"] as? String, let p = Store.shared.profile(id) else { return .err("窗口不存在") }
        let fmt = (params["format"] as? String) ?? "json"
        let text = fmt == "netscape" ? CookieTool.toNetscape(p.automation.cookies) : CookieTool.toJSONText(p.automation.cookies)
        return .ok(["text": text, "count": p.automation.cookies.count,
                    "filename": "veil-cookies-\(p.seq)-\(dateStamp()).\(fmt == "netscape" ? "txt" : "json")"])
    }

    private func cookieLive(_ params: [String: Any]) async -> Any {
        guard let id = params["id"] as? String, let s = SessionManager.shared.get(id) else { return ["list": [], "msg": "窗口未运行"] }
        let c = await s.cookies()
        return ["list": c, "count": c.count]
    }

    private func detect(_ params: [String: Any]) async -> Any {
        guard let id = params["id"] as? String else { return ["ok": false] }
        guard let s = SessionManager.shared.get(id) else { return ["ok": false, "msg": "窗口未运行，请先打开"] }
        let url = "veil://detect"
        let ok = await s.openURL(url)
        return ["ok": ok, "url": "http://127.0.0.1:\(LocalAPI.shared.boundPort)/__veil/detect.html?profile=\(id)"]
    }

    private func navigate(_ params: [String: Any]) async -> Any {
        guard let id = params["id"] as? String, let url = params["url"] as? String,
              let s = SessionManager.shared.get(id) else { return ["ok": false, "msg": "窗口未运行"] }
        return ["ok": await s.openURL(url)]
    }

    private func tabs(_ params: [String: Any]) async -> Any {
        guard let id = params["id"] as? String, let s = SessionManager.shared.get(id) else { return ["list": []] }
        let t = await s.tabs()
        return ["list": t.map { ["id": $0["id"] ?? "", "title": $0["title"] ?? "", "url": $0["url"] ?? "", "type": $0["type"] ?? ""] }]
    }

    private func evaluate(_ params: [String: Any]) async -> Any {
        guard let id = params["id"] as? String, let expr = params["expression"] as? String,
              let s = SessionManager.shared.get(id) else { return ["ok": false, "msg": "窗口未运行"] }
        let v = await s.evaluate(expr)
        return ["ok": true, "result": v ?? NSNull()]
    }

    private func reveal(_ params: [String: Any]) -> BridgeResult {
        let path = params["path"] as? String ?? Paths.supportRoot.path
        let url = URL(fileURLWithPath: path)
        NSWorkspace.shared.activateFileViewerSelecting([url])
        return .ok(["revealed": path])
    }

    private func clearProfileData(_ params: [String: Any]) -> BridgeResult {
        guard let ids = params["ids"] as? [String] else { return .err("缺少 ids") }
        for id in ids {
            SessionManager.shared.closeProfile(id)
            try? FileManager.default.removeItem(at: Paths.userDataDir(id))
            _ = Paths.userDataDir(id)
        }
        return .ok(["cleared": ids.count])
    }

    private func openExternal(_ params: [String: Any]) -> BridgeResult {
        guard let s = params["url"] as? String, let u = URL(string: s) else { return .err("非法 URL") }
        NSWorkspace.shared.open(u)
        return .ok(["opened": s])
    }

    private func setMasterPassword(_ params: [String: Any]) async -> BridgeResult {
        let pw = params["password"] as? String ?? ""
        let done = await Task.detached(priority: .userInitiated) { () -> Bool in
            Store.shared.setPassword(pw.isEmpty ? nil : pw)
            return true
        }.value
        return done ? .ok(["encrypted": !pw.isEmpty]) : .err("加密失败")
    }

    private func unlock(_ params: [String: Any]) async -> BridgeResult {
        let pw = params["password"] as? String ?? ""
        let ok = await Task.detached(priority: .userInitiated) { Store.shared.unlock(password: pw) }.value
        return ok ? .ok(["unlocked": true]) : .err("主密码错误")
    }

    private func apiInfo() -> Any {
        let port = Int(LocalAPI.shared.boundPort)
        return [
            "port": port,
            "base": "http://127.0.0.1:\(port)",
            "enabled": Store.shared.settings().apiEnabled,
            "token": Store.shared.settings().apiToken,
            "endpoints": APIDocs.endpoints,
            "snippets": APIDocs.integrationSnippets,
        ]
    }

    // MARK: - 面板

    private func pickBrowser() async -> Any {
        await withCheckedContinuation { (cont: CheckedContinuation<Any, Never>) in
            let panel = NSOpenPanel()
            panel.title = "选择浏览器可执行文件"
            panel.allowsMultipleSelection = false
            panel.canChooseDirectories = false
            panel.canChooseFiles = true
            panel.showsHiddenFiles = true
            panel.directoryURL = URL(fileURLWithPath: "/Applications")
            panel.message = "选择 Chrome / Chromium / Edge / Brave 的可执行文件（例如 Google Chrome.app/Contents/MacOS/Google Chrome）"
            if panel.runModal() == .OK, let url = panel.url {
                cont.resume(returning: ["path": url.path, "version": Paths.browserVersion(at: url.path) ?? ""])
            } else { cont.resume(returning: ["path": ""]) }
        }
    }

    private func saveFile(_ params: [String: Any]) async -> Any {
        await withCheckedContinuation { (cont: CheckedContinuation<Any, Never>) in
            let panel = NSSavePanel()
            panel.nameFieldStringValue = (params["filename"] as? String) ?? "veil-export.json"
            panel.message = params["message"] as? String ?? "选择保存位置"
            panel.canCreateDirectories = true
            if panel.runModal() == .OK, let url = panel.url {
                let text = params["content"] as? String ?? ""
                do { try Data(text.utf8).write(to: url, options: .atomic); cont.resume(returning: ["path": url.path, "ok": true]) }
                catch { cont.resume(returning: ["path": "", "ok": false, "error": "\(error)"]) }
            } else { cont.resume(returning: ["path": "", "ok": false]) }
        }
    }

    private func openFile(_ params: [String: Any]) async -> Any {
        await withCheckedContinuation { (cont: CheckedContinuation<Any, Never>) in
            let panel = NSOpenPanel()
            panel.allowsMultipleSelection = false
            panel.canChooseDirectories = false
            panel.message = params["message"] as? String ?? "选择文件"
            if let types = params["types"] as? [String] {
                let uts = types.compactMap { UTType(filenameExtension: $0) }
                if !uts.isEmpty { panel.allowedContentTypes = uts }
            } else {
                panel.allowedContentTypes = [.json, .plainText, .text]
            }
            if panel.runModal() == .OK, let url = panel.url {
                let s = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
                cont.resume(returning: ["path": url.path, "text": s, "ok": true])
            } else { cont.resume(returning: ["path": "", "text": "", "ok": false]) }
        }
    }
}

private func dateStamp() -> String {
    let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"; return f.string(from: Date())
}

extension URL {
    var diskUsageBytes: UInt64 {
        let fm = FileManager.default
        guard let en = fm.enumerator(at: self, includingPropertiesForKeys: [.totalFileAllocatedSizeKey]) else { return 0 }
        var total: UInt64 = 0
        for case let u as URL in en {
            if let v = try? u.resourceValues(forKeys: [.totalFileAllocatedSizeKey]).totalFileAllocatedSize { total += UInt64(v) }
        }
        return total
    }
}

extension ProcessInfo {
    var machineArchitecture: String {
        #if arch(arm64)
        return "arm64"
        #elseif arch(x86_64)
        return "x86_64"
        #else
        return "unknown"
        #endif
    }
}
