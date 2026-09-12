import Foundation

public struct LaunchResult {
    public var pid: Int32
    public var debugPort: UInt16
    public var args: [String]
    public var browserPath: String
    public var dataDir: String
    public var logPath: String
}

public enum LaunchError: Error, CustomStringConvertible {
    case noBrowser(String)
    case spawnFailed(String)
    case cdpTimeout(String)
    case alreadyRunning(String)
    public var description: String {
        switch self {
        case .noBrowser(let m): return "找不到可用的 Chromium 内核浏览器：\(m)"
        case .spawnFailed(let m): return "启动失败：\(m)"
        case .cdpTimeout(let m): return "等待调试端口超时：\(m)"
        case .alreadyRunning(let m): return m
        }
    }
}

public enum BrowserLauncher {

    public static func buildArgs(profile: VeilProfile, debugPort: UInt16, dataDir: URL,
                                 proxyServerArg: String?, windowIndex: Int,
                                 initialURL: String?) -> [String] {
        var a: [String] = []
        a.append("--user-data-dir=\(dataDir.path)")
        a.append("--profile-directory=Default")
        a.append("--remote-debugging-port=\(debugPort)")
        a.append("--remote-allow-origins=*")
        a.append("--no-first-run")
        a.append("--no-default-browser-check")
        a.append("--disable-session-crashed-bubble")
        a.append("--hide-crash-restore-bubble")
        a.append("--disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions")
        if profile.launch.hideDebugInfobar {
            a.append("--disable-infobars")
            a.append("--test-type")
        }
        if profile.launch.useMockKeychain {
            a.append("--use-mock-keychain")
            a.append("--password-store=basic")
        }
        a.append("--disable-blink-features=AutomationControlled")
        a.append("--disable-hang-monitor")
        a.append("--disable-popup-blocking")
        a.append("--metrics-recording-only")
        a.append("--no-service-autorun")
        a.append("--disable-background-timer-throttling")
        a.append("--disable-backgrounding-occluded-windows")
        a.append("--disable-renderer-backgrounding")
        a.append("--disable-ipc-flooding-protection")

        let fp = profile.fp
        // 语言
        let lang = fp.languages.first ?? fp.locale
        a.append("--lang=\(lang)")

        // 窗口尺寸与位置
        a.append("--window-size=\(fp.windowWidth),\(fp.windowHeight)")
        switch profile.launch.windowPositionMode {
        case "fixed":
            a.append("--window-position=\(profile.launch.windowPositionX),\(profile.launch.windowPositionY)")
        case "cascade":
            let off = Store.shared.settings().cascadeOffset
            let x = 40 + (windowIndex * off) % 480
            let y = 30 + (windowIndex * off) % 320
            a.append("--window-position=\(x),\(y)")
        default: break
        }

        // 代理
        if let p = proxyServerArg {
            a.append("--proxy-server=\(p)")
            // 显式列 loopback + Veil 本地 API 端口，避免依赖 Chrome 的 <-loopback> token（Chrome 152 中对 127.0.0.1 不再生效）
            a.append("--proxy-bypass-list=127.0.0.1,localhost,::1,<-loopback>")
        }

        // WebRTC 策略（配合注入脚本双重保险）
        switch fp.webrtcMode {
        case "disabled": a.append("--force-webrtc-ip-handling-policy=disable_non_proxied_udp")
        case "proxy":    a.append("--force-webrtc-ip-handling-policy=default_public_interface_only")
        default: break
        }

        if fp.mediaDevicesSpoof && fp.videoInputs == 0 {
            a.append("--use-fake-device-for-media-stream")
        }

        if profile.launch.incognito { a.append("--incognito") }

        // 过滤掉可能的空串
        a.append(contentsOf: profile.launch.extraArgs.filter { !$0.isEmpty })
        a = a.filter { !$0.isEmpty }

        if let u = initialURL, !u.isEmpty { a.append(u) }
        return a
    }

    public static func launch(profile: VeilProfile, debugPort: UInt16, proxyServerArg: String?,
                              windowIndex: Int, initialURL: String?) throws -> LaunchResult {
        let settings = Store.shared.settings()
        guard let path = Paths.defaultBrowserPath(preferred: profile.launch.browserPath.isEmpty ? settings.defaultBrowserPath : profile.launch.browserPath) else {
            throw LaunchError.noBrowser("请在「设置」中指定 Chrome / Chromium / Edge / Brave 可执行文件路径")
        }
        let dataDir = Paths.userDataDir(profile.id)
        // 已有同 data-dir 的实例在跑？
        if let st = profile.runtime, st.pid != 0, kill(st.pid, 0) == 0 {
            throw LaunchError.alreadyRunning("该窗口已在运行中 (PID \(st.pid))")
        }
        let args = buildArgs(profile: profile, debugPort: debugPort, dataDir: dataDir,
                             proxyServerArg: proxyServerArg, windowIndex: windowIndex, initialURL: initialURL)
        let logPath = Paths.logFile(profile.id).path
        FileManager.default.createFile(atPath: logPath, contents: nil)
        guard let logHandle = FileHandle(forWritingAtPath: logPath) else { throw LaunchError.spawnFailed("无法写入日志") }
        logHandle.seekToEndOfFile()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        p.standardOutput = logHandle
        p.standardError = logHandle
        p.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory())
        do { try p.run() } catch {
            throw LaunchError.spawnFailed(error.localizedDescription + " (\(path))")
        }
        logHandle.write(Data("[veil] launch \(Date())\n[path] \(path)\n[args] \(args.joined(separator: " "))\n".utf8))
        VeilLog.info("[launch] seq=\(profile.seq) pid=\(p.processIdentifier) port=\(debugPort) dataDir=\(dataDir.lastPathComponent)")
        return LaunchResult(pid: p.processIdentifier, debugPort: debugPort, args: args,
                            browserPath: path, dataDir: dataDir.path, logPath: logPath)
    }

    /// 读取 /json/version 拿到 browser 级 WebSocket 地址
    public static func browserWsURL(port: UInt16, timeoutMs: Int = 20000) async throws -> String {
        guard Net.waitForPort(port, timeoutMs: timeoutMs) else {
            throw LaunchError.cdpTimeout("127.0.0.1:\(port)")
        }
        let deadline = Date().addingTimeInterval(TimeInterval(timeoutMs) / 1000)
        var lastErr = ""
        while Date() < deadline {
            do {
                let url = URL(string: "http://127.0.0.1:\(port)/json/version")!
                let (data, _) = try await URLSession.shared.data(from: url)
                if let o = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let ws = o["webSocketDebuggerUrl"] as? String { return ws }
                lastErr = "响应缺少 webSocketDebuggerUrl"
            } catch { lastErr = error.localizedDescription }
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        throw LaunchError.cdpTimeout(lastErr)
    }
}
