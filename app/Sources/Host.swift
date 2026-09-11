import Foundation
import AppKit

/// 宿主机器指纹探针：读取本机 Chrome 的真实 UA-CH / GPU / 字体 / 硬件信息
public final class Host {
    public static let shared = Host()
    public private(set) var host: HostInfo = HostInfo()
    private var probing = false
    private var waiters: [(HostInfo) -> Void] = []
    private let q = DispatchQueue(label: "veil.host")

    private init() { loadCache() }

    public func loadCache() {
        if let d = try? Data(contentsOf: Paths.hostFile), let h = J.decode(HostInfo.self, from: d) {
            host = h
            VeilLog.info("[host] 使用缓存探针结果 (chrome \(h.chromeMajor), \(h.fonts.count) 字体, \(h.probedAt.map { "\($0)" } ?? "nil"))")
        } else {
            host = HostInfo()
            host.chromePath = Paths.defaultBrowserPath(preferred: "") ?? ""
        }
    }

    public func saveCache() { try? J.prettyEncoder.encode(host).write(to: Paths.hostFile, options: .atomic) }

    /// 确保探针结果可用；后台异步执行，回调返回最新结果
    public func ensureProbed(_ completion: ((HostInfo) -> Void)? = nil) {
        q.async {
            if self.host.isValid { completion?(self.host); return }
            self.waiters.append { h in completion?(h) }
            if self.probing { return }
            self.probing = true
            Task {
                let h = (try? await self.probe()) ?? self.host
                self.q.async {
                    self.probing = false
                    let ws = self.waiters; self.waiters.removeAll()
                    ws.forEach { $0(h) }
                }
            }
        }
    }

    public func probeAsync() async -> HostInfo {
        (try? await probe()) ?? host
    }

    // MARK: - 探针实现

    public func probe() async throws -> HostInfo {
        let browserPath = Paths.defaultBrowserPath(preferred: Store.shared.settings().defaultBrowserPath)
        guard let browserPath = browserPath else { throw LaunchError.noBrowser("probe") }

        // 1. 临时 HTTP 服务（安全上下文，才能读取 navigator.userAgentData）
        let server = HTTPServer(handler: { _ in HTTPResponse.html("<!doctype html><meta charset=utf-8><title>Veil Probe</title><body>") })
        let httpPort = try server.start(port: 0)

        // 2. 临时 Chrome（headless=new：不可见、无 Dock 图标、使用真实 GPU）
        let dbgPort = try Net.freeTCPPort()
        let tmpDir = Paths.supportRoot.appendingPathComponent(".probe", isDirectory: true)
        try? FileManager.default.removeItem(at: tmpDir)
        try? FileManager.default.createDirectory(at: tmpDir, withIntermediateDirectories: true)

        let p = Process()
        p.executableURL = URL(fileURLWithPath: browserPath)
        p.arguments = [
            "--headless=new",
            "--user-data-dir=\(tmpDir.path)",
            "--remote-debugging-port=\(dbgPort)",
            "--remote-allow-origins=*",
            "--no-first-run", "--no-default-browser-check",
            "--disable-extensions", "--mute-audio", "--no-service-autorun",
            "--use-mock-keychain", "--password-store=basic",
            "--disable-blink-features=AutomationControlled",
            "--hide-scrollbars",
            "http://127.0.0.1:\(httpPort)/probe",
        ]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try p.run()
        defer {
            if p.isRunning { p.terminate(); Thread.sleep(forTimeInterval: 0.3); if p.isRunning { kill(p.processIdentifier, SIGKILL) } }
            let pk = Process(); pk.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
            pk.arguments = ["-f", "--user-data-dir=\(tmpDir.path)"]
            pk.standardOutput = FileHandle.nullDevice; pk.standardError = FileHandle.nullDevice
            try? pk.run(); pk.waitUntilExit()
            server.stop()
            try? FileManager.default.removeItem(at: tmpDir)
        }

        let ws = try await BrowserLauncher.browserWsURL(port: dbgPort, timeoutMs: 20000)
        guard let url = URL(string: ws) else { throw LaunchError.cdpTimeout("probe ws") }
        let c = CDPClient(url: url)
        try await c.connect()
        defer { c.close() }

        // 等待页面就绪
        var pageSid: String?
        for _ in 0..<40 {
            if let r = try? await c.sendAsync("Target.getTargets"),
               let infos = r["targetInfos"] as? [[String: Any]],
               let t = infos.first(where: { ($0["type"] as? String) == "page" && (($0["url"] as? String)?.contains("127.0.0.1") ?? false) }) {
                if let sid = (try? await c.sendAsync("Target.attachToTarget", ["targetId": t["targetId"] as Any, "flatten": true]))?["sessionId"] as? String {
                    pageSid = sid
                    break
                }
            }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        guard let sid = pageSid else { throw LaunchError.cdpTimeout("probe 页面目标") }
        _ = try? await c.sendAsync("Runtime.enable", [:], sessionId: sid)
        _ = try? await c.sendAsync("Page.enable", [:], sessionId: sid)

        let expr = Self.probeExpression()
        guard let r = try? await c.sendAsync("Runtime.evaluate",
                                            ["expression": expr, "awaitPromise": true, "returnByValue": true, "timeout": 25000],
                                            sessionId: sid, timeout: 30),
              let res = r["result"] as? [String: Any],
              let s = res["value"] as? String,
              let raw = (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Any] else {
            throw LaunchError.cdpTimeout("探针脚本无返回")
        }

        var h = HostInfo()
        h.probedAt = Date()
        h.chromePath = browserPath
        h.ua = (raw["ua"] as? String ?? "").replacingOccurrences(of: "HeadlessChrome", with: "Chrome")
        h.navPlatform = raw["navPlatform"] as? String ?? "MacIntel"
        h.hardwareConcurrency = raw["hardwareConcurrency"] as? Int ?? 8
        h.deviceMemory = raw["deviceMemory"] as? Int ?? 8
        h.timezone = raw["timezone"] as? String ?? "Asia/Shanghai"
        h.languages = (raw["languages"] as? [String]) ?? ["zh-CN"]
        h.maxTouchPoints = raw["maxTouchPoints"] as? Int ?? 0
        h.pluginsCount = raw["pluginsCount"] as? Int ?? 5
        h.platform = raw["platform"] as? String ?? "macOS"
        h.platformVersion = raw["platformVersion"] as? String ?? ""
        h.architecture = raw["architecture"] as? String ?? ""
        h.bitness = raw["bitness"] as? String ?? ""
        h.model = raw["model"] as? String ?? ""
        h.wow64 = raw["wow64"] as? Bool ?? false
        h.brands = decodeBrands(raw["brands"])
        h.fullVersionList = decodeBrands(raw["fullVersionList"])
        if let fv = h.fullVersionList.first(where: { $0.brand == "Chromium" })?.version, !fv.isEmpty {
            h.chromeFullVersion = fv
        }
        h.chromeMajor = Int(h.chromeFullVersion.split(separator: ".").first.map(String.init) ?? "0") ?? 0
        if let g = h.brands.first(where: { $0.brand.hasPrefix("Not") }) { h.greaseBrand = g.brand; h.greaseVersion = g.version }
        h.webglVendor = raw["webglVendor"] as? String ?? ""
        h.webglRenderer = raw["webglRenderer"] as? String ?? ""
        h.webglUnmaskedVendor = raw["webglUnmaskedVendor"] as? String ?? ""
        h.webglUnmaskedRenderer = raw["webglUnmaskedRenderer"] as? String ?? ""
        h.webglParams = (raw["webglParams"] as? [String: String]) ?? [:]
        h.fonts = (raw["fonts"] as? [String]) ?? []

        // 真实屏幕信息（headless 下 screen 为 800x600，改由 AppKit 取真值）
        if let s = NSScreen.main ?? NSScreen.screens.first {
            let f = s.frame
            let vf = s.visibleFrame
            h.screenWidth = Int(f.width)
            h.screenHeight = Int(f.height)
            h.availWidth = Int(vf.width)
            h.availHeight = Int(vf.height)
            h.colorDepth = 24
            h.devicePixelRatio = s.backingScaleFactor
        }

        self.host = h
        saveCache()
        VeilLog.info("[host] 探针完成: Chrome \(h.chromeMajor) (\(h.chromeFullVersion)), GPU=\(h.webglUnmaskedRenderer.prefix(60)), 字体 \(h.fonts.count) 个, 时区 \(h.timezone)")
        return h
    }

    private func decodeBrands(_ any: Any?) -> [UABrand] {
        guard let arr = any as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let b = d["brand"] as? String else { return nil }
            return UABrand(brand: b, version: d["version"] as? String ?? "")
        }
    }

    // MARK: - 探针脚本

    static func probeExpression() -> String {
        var candidates = FontDB.windows + FontDB.mac + FontDB.linux
        candidates.append(contentsOf: ["Segoe UI Variable","Roboto","Open Sans","Lato","Montserrat","Source Sans Pro",
                                       "Noto Sans SC","Noto Sans TC","Noto Sans JP","Noto Sans KR","PingFang SC",
                                       "Microsoft JhengHei","Yu Gothic UI","Meiryo","Malgun Gothic","SimHei","KaiTi",
                                       "FangSong","STXihei","华文细黑","微软雅黑","宋体","黑体","楷体","仿宋",
                                       "メイリオ","ＭＳ Ｐゴシック","ＭＳ ゴシック","맑은 고딕","굴림","돋움"])
        candidates = Array(Set(candidates)).sorted()
        let candJSON = (try? JSONSerialization.data(withJSONObject: candidates)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"

        return """
        (async () => {
          const out = {};
          await new Promise(res => {
            if (document.readyState === 'complete') return res();
            const t = setTimeout(res, 4000);
            document.addEventListener('readystatechange', () => { if (document.readyState === 'complete') { clearTimeout(t); res(); } });
          });
          await new Promise(r => requestAnimationFrame(() => r()));
          const CANDIDATES = \(candJSON);
          try {
            const ua = await navigator.userAgentData.getHighEntropyValues(
              ["fullVersionList","platform","platformVersion","architecture","bitness","model","wow64","uaFullVersion"]);
            out.brands = navigator.userAgentData.brands;
            out.fullVersionList = ua.fullVersionList;
            out.platform = ua.platform;
            out.platformVersion = ua.platformVersion;
            out.architecture = ua.architecture;
            out.bitness = ua.bitness;
            out.model = ua.model;
            out.wow64 = ua.wow64;
          } catch (e) { out.uaError = String(e); }
          out.ua = navigator.userAgent;
          out.navPlatform = navigator.platform;
          out.hardwareConcurrency = navigator.hardwareConcurrency;
          out.deviceMemory = navigator.deviceMemory;
          out.maxTouchPoints = navigator.maxTouchPoints;
          out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          out.languages = Array.from(navigator.languages || []);
          out.pluginsCount = navigator.plugins ? navigator.plugins.length : 0;
          out.screenWidth = screen.width; out.screenHeight = screen.height;
          out.availWidth = screen.availWidth; out.availHeight = screen.availHeight;
          out.colorDepth = screen.colorDepth; out.devicePixelRatio = window.devicePixelRatio;
          try {
            const cv = document.createElement('canvas');
            cv.width = 8; cv.height = 8;
            const gl = cv.getContext('webgl') || cv.getContext('experimental-webgl');
            if (gl) {
              out.webglVendor = gl.getParameter(gl.VENDOR);
              out.webglRenderer = gl.getParameter(gl.RENDERER);
              const d = gl.getExtension('WEBGL_debug_renderer_info');
              if (d) {
                out.webglUnmaskedVendor = gl.getParameter(d.UNMASKED_VENDOR_WEBGL);
                out.webglUnmaskedRenderer = gl.getParameter(d.UNMASKED_RENDERER_WEBGL);
              }
              const names = ["MAX_TEXTURE_SIZE","MAX_RENDERBUFFER_SIZE","MAX_VIEWPORT_DIMS","MAX_TEXTURE_IMAGE_UNITS",
                "MAX_VERTEX_ATTRIBS","MAX_VARYING_VECTORS","MAX_VERTEX_UNIFORM_VECTORS","MAX_FRAGMENT_UNIFORM_VECTORS",
                "MAX_COMBINED_TEXTURE_IMAGE_UNITS","ALIASED_LINE_WIDTH_RANGE","ALIASED_POINT_SIZE_RANGE",
                "MAX_CUBE_MAP_TEXTURE_SIZE","MAX_SAMPLES","VERSION","SHADING_LANGUAGE_VERSION"];
              out.webglParams = {};
              for (const n of names) {
                try {
                  const v = gl.getParameter(gl[n]);
                  out.webglParams[n] = (v && (v instanceof Float32Array || v instanceof Int32Array || Array.isArray(v)))
                    ? Array.from(v).join(',') : String(v);
                } catch (e) {}
              }
            }
          } catch (e) { out.webglError = String(e); }
          try {
            const bases = ['monospace', 'sans-serif', 'serif'];
            const s = document.createElement('span');
            s.style.cssText = 'position:absolute;left:-99999px;top:0;font-size:72px;white-space:nowrap;visibility:hidden';
            s.textContent = 'mmmmmmmmmmlli1IlL0OoO0WwHhBbRrKk';
            document.body.appendChild(s);
            const bw = {};
            for (const b of bases) { s.style.fontFamily = b; bw[b] = s.offsetWidth + '|' + s.offsetHeight; }
            const found = [];
            for (const f of CANDIDATES) {
              const ff = '"' + f.replace(/"/g, '') + '"';
              let hit = false;
              for (const b of bases) {
                s.style.fontFamily = ff + ',' + b;
                if ((s.offsetWidth + '|' + s.offsetHeight) !== bw[b]) { hit = true; break; }
              }
              if (hit) found.push(f);
            }
            s.remove();
            out.fonts = found;
          } catch (e) { out.fontError = String(e); }
          return JSON.stringify(out);
        })()
        """
    }
}
