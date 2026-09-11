import AppKit
import WebKit

// MARK: - 拖动区域
//
// 在 WKWebView 上方叠一层 46px 高的 NSView，命中「标题栏空白处」时调
// window.performDrag 拖动整个窗口；命中「traffic lights / 搜索框 / 右侧按钮」
// 时透传给下层 WKWebView 或 NSWindow chrome。
//
// 为什么需要：macOS WKWebView 不识别 CSS `-webkit-app-region: drag`
// （那是 Electron/Tauri 私有扩展），且原生标题栏被 hidden + 透明，
// 不借助此 overlay 就无处可拖。
private final class DragRegionView: NSView {
    weak var hostWindow: NSWindow?
    /// 局部坐标下需要透传点击的矩形（traffic lights / 搜索框 / 右侧按钮区）。
    /// hitTest 在这些矩形内返回 nil，让事件下穿到 WKWebView 或 NSWindow 自身。
    private var passthroughRects: [NSRect] = []

    /// 根据窗口当前宽度重新计算 passthrough 区域。窗口 resize 后 layout() 自动调用。
    func refreshPassthrough(windowWidth: CGFloat) {
        let bw = max(windowWidth, 800)
        let h = bounds.height          // 46
        let leftInset: CGFloat = 78     // traffic lights + HTML padding-left
        let localW = bw - leftInset    // dragRegion 自身宽度

        // 搜索框：HTML 标题栏里居中 ~430px 宽
        let searchW: CGFloat = 430
        let searchH: CGFloat = 30
        let searchLocalCx = (bw / 2) - leftInset
        let searchRect = NSRect(
            x: searchLocalCx - searchW / 2,
            y: (h - searchH) / 2,
            width: searchW,
            height: searchH
        )

        // 右侧按钮区：stats + probe + logs 总宽 ~200px，HTML padding-right 14
        let rightW: CGFloat = 200
        let rightRect = NSRect(
            x: max(0, localW - rightW),
            y: 0,
            width: rightW,
            height: h
        )

        passthroughRects = [searchRect, rightRect]
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        for r in passthroughRects where r.contains(point) { return nil }
        return self
    }

    override func mouseDown(with event: NSEvent) {
        hostWindow?.performDrag(with: event)
    }

    override func layout() {
        super.layout()
        // 跟随窗口 resize 重新计算 passthrough
        if let win = hostWindow ?? window {
            refreshPassthrough(windowWidth: win.frame.width)
        }
    }

    override func draw(_ dirtyRect: NSRect) { /* 完全透明，不拦截视觉 */ }
}


public final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    public var window: NSWindow!
    public var webView: WKWebView!
    public var bridge: Bridge!
    private var statusItem: NSStatusItem?
    private var statusMenu: NSMenu!
    private var terminating = false

    public func applicationDidFinishLaunching(_ notification: Notification) {
        Store.shared.load()
        if Store.shared.requiresUnlock {
            VeilLog.warn("[app] 数据已加密，需要主密码解锁")
        }

        buildWindow()
        buildMenus()
        if Store.shared.settings().keepInMenuBar { buildStatusItem() }

        // 后台初始化
        Task.detached(priority: .utility) {
            Host.shared.ensureProbed { h in
                VeilLog.info("[app] 宿主探针就绪 chrome=\(h.chromeMajor) fonts=\(h.fonts.count)")
                DispatchQueue.main.async { self.notifyJS("hostReady", J.any(from: h)) }
            }
            await SessionManager.shared.reattach()
            DispatchQueue.main.async { self.notifyJS("reattached", SessionManager.shared.count) }
        }
        LocalAPI.shared.start()

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        VeilLog.info("[app] Veil \(LocalAPI.version) 启动完成，数据目录 \(Paths.supportRoot.path)")
    }

    private func buildWindow() {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let w = min(1480, max(1080, Int(screen.width * 0.82)))
        let h = min(940, max(680, Int(screen.height * 0.86)))
        let rect = NSRect(x: 0, y: 0, width: w, height: h)

        window = NSWindow(contentRect: rect,
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.title = "Veil"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.minSize = NSSize(width: 1000, height: 620)
        window.center()
        window.isReleasedWhenClosed = false
        window.backgroundColor = NSColor(srgbRed: 0.07, green: 0.075, blue: 0.095, alpha: 1)

        let cfg = WKWebViewConfiguration()
        let ucc = WKUserContentController()
        bridge = Bridge()
        ucc.add(bridge, name: "veil")
        cfg.userContentController = ucc
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        if #available(macOS 13.3, *) { cfg.preferences.isElementFullscreenEnabled = true }

        webView = WKWebView(frame: window.contentView!.bounds, configuration: cfg)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        webView.setValue(false, forKey: "drawsBackground")   // 透明背景，避免白闪
        window.contentView?.addSubview(webView)
        bridge.webView = webView

        // 标题栏拖动区域（必须在 webView 之后 addSubview，确保在 z 序顶层）
        // WKWebView 不识别 -webkit-app-region: drag，必须用 native overlay 接管拖动。
        installDragRegion()

        loadUI()
    }

    /// 在 WKWebView 之上覆盖一层 46px native 拖动区。
    /// 命中标题栏空白 → window.performDrag；命中 traffic lights / 搜索框 / 右侧按钮 → 透传。
    private func installDragRegion() {
        guard let cv = window.contentView else { return }
        let tb: CGFloat = 46
        let dragRegion = DragRegionView(frame: NSRect(
            x: 78,                                              // 避开左上 traffic lights
            y: cv.bounds.height - tb,
            width: max(0, cv.bounds.width - 78),
            height: tb
        ))
        dragRegion.autoresizingMask = [.width, .maxYMargin]    // 横向拉伸，始终贴顶
        dragRegion.hostWindow = window
        dragRegion.refreshPassthrough(windowWidth: cv.bounds.width)
        cv.addSubview(dragRegion)
        VeilLog.info("[app] 标题栏拖动区域已挂载 (\(Int(dragRegion.bounds.width))x\(Int(dragRegion.bounds.height)))")
    }

    private func loadUI() {
        guard let root = Paths.bundleWebRoot else {
            showFatal("找不到 Web 资源目录。\n请确认 Veil.app/Contents/Resources/Web/index.html 存在。")
            return
        }
        let index = root.appendingPathComponent("index.html")
        webView.loadFileURL(index, allowingReadAccessTo: root)
        VeilLog.info("[ui] 加载 \(index.path)")
    }

    private func showFatal(_ msg: String) {
        let tv = NSTextView(frame: NSRect(x: 0, y: 0, width: 520, height: 200))
        tv.string = msg
        tv.isEditable = false
        tv.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        let alert = NSAlert()
        alert.messageText = "Veil 启动失败"
        alert.informativeText = msg
        alert.alertStyle = .critical
        alert.runModal()
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        notifyJS("ready", true)
        // i18n: 注入当前 locale，i18n.js init() 在 __veilLocale 缺失时回落到 zh-CN
        let veilLocale = Store.shared.settings().locale
        webView.evaluateJavaScript("window.__veilLocale = \"\(veilLocale)\";") { _, err in
            if let err = err { VeilLog.warn("[i18n] 注入 __veilLocale 失败: \(err.localizedDescription)") }
        }
    }
    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        VeilLog.error("[ui] 加载失败: \(error.localizedDescription)")
    }
    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = navigationAction.request.url, navigationAction.navigationType == .linkActivated {
            if u.scheme == "http" || u.scheme == "https" {
                NSWorkspace.shared.open(u)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    public func notifyJS(_ event: String, _ payload: Any?) {
        let json = J.anyToJSONString(payload ?? NSNull())
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        webView?.evaluateJavaScript("window.__veilEvent&&window.__veilEvent('\(event)',\(json));", completionHandler: nil)
    }

    // MARK: - 菜单

    private func buildMenus() {
        let main = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 Veil", action: #selector(menuAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "设置…", action: #selector(menuJS(_:)), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 Veil", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 Veil", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(withTitle: "Veil", action: nil, keyEquivalent: "").submenu = appMenu

        let fileMenu = NSMenu(title: "文件")
        fileMenu.addItem(item("新建窗口", "n", #selector(menuJS(_:))))
        fileMenu.addItem(item("批量新建窗口…", "N", #selector(menuJS(_:))))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("导入窗口…", "o", #selector(menuJS(_:))))
        fileMenu.addItem(item("导出全部窗口…", "e", #selector(menuJS(_:))))
        fileMenu.addItem(.separator())
        fileMenu.addItem(item("打开数据目录", "d", #selector(menuReveal)))
        main.addItem(withTitle: "文件", action: nil, keyEquivalent: "").submenu = fileMenu

        let winMenu = NSMenu(title: "窗口")
        winMenu.addItem(item("打开选中窗口", "O", #selector(menuJS(_:))))
        winMenu.addItem(item("关闭选中窗口", "W", #selector(menuJS(_:))))
        winMenu.addItem(.separator())
        winMenu.addItem(item("指纹自检页", "t", #selector(menuJS(_:))))
        winMenu.addItem(.separator())
        winMenu.addItem(item("刷新界面", "r", #selector(menuReload)))
        winMenu.addItem(.separator())
        winMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        main.addItem(withTitle: "窗口", action: nil, keyEquivalent: "").submenu = winMenu

        let helpMenu = NSMenu(title: "帮助")
        helpMenu.addItem(item("本地 API 文档", "h", #selector(menuJS(_:))))
        helpMenu.addItem(item("查看运行日志", "l", #selector(menuJS(_:))))
        helpMenu.addItem(.separator())
        helpMenu.addItem(item("重新探测本机指纹", "p", #selector(menuJS(_:))))
        main.addItem(withTitle: "帮助", action: nil, keyEquivalent: "").submenu = helpMenu

        NSApp.mainMenu = main
        for m in main.items { m.submenu?.items.forEach { $0.target = self } }
    }

    private func item(_ title: String, _ key: String, _ action: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    @objc private func menuAbout() {
        NSApp.activate(ignoringOtherApps: true)
        let h = Host.shared.host
        let alert = NSAlert()
        alert.messageText = "Veil 指纹浏览器"
        alert.informativeText = """
        版本 \(LocalAPI.version)

        本机 Chrome：\(h.chromeMajor > 0 ? "\(h.chromeMajor) (\(h.chromeFullVersion))" : "未探测")
        本机 GPU：\(h.webglUnmaskedRenderer.isEmpty ? "未探测" : h.webglUnmaskedRenderer)
        窗口数：\(Store.shared.profiles().count)    运行中：\(SessionManager.shared.count)
        本地 API：http://127.0.0.1:\(LocalAPI.shared.boundPort)
        数据目录：\(Paths.supportRoot.path)
        """
        alert.alertStyle = .informational
        alert.runModal()
    }

    @objc private func menuReveal() { NSWorkspace.shared.activateFileViewerSelecting([Paths.supportRoot]) }
    @objc private func menuReload() { webView?.reload() }

    @objc private func menuJS(_ sender: NSMenuItem) {
        let key = sender.title
        let map: [String: String] = [
            "新建窗口": "new", "批量新建窗口…": "batchNew", "导入窗口…": "import", "导出全部窗口…": "exportAll",
            "打开选中窗口": "openSelected", "关闭选中窗口": "closeSelected", "指纹自检页": "detect",
            "本地 API 文档": "apiDocs", "查看运行日志": "logs", "重新探测本机指纹": "probe", "设置…": "settings",
        ]
        if let k = map[key] { sendMenu(k) }
    }

    public func sendMenu(_ action: String, _ payload: Any? = nil) {
        let json = J.anyToJSONString(payload ?? NSNull())
        webView?.evaluateJavaScript("window.__veilMenu&&window.__veilMenu('\(action)',\(json));", completionHandler: nil)
    }

    // MARK: - 状态栏

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem?.button {
            let cfg = NSImage.SymbolConfiguration(pointSize: 14, weight: .medium)
            b.image = NSImage(systemSymbolName: "theatermasks.fill", accessibilityDescription: "Veil")?.withSymbolConfiguration(cfg)
            b.toolTip = "Veil 指纹浏览器"
        }
        statusMenu = NSMenu()
        statusItem?.menu = statusMenu
        refreshStatusMenu()
    }

    public func refreshStatusMenu() {
        guard let m = statusMenu else { return }
        m.removeAllItems()
        let header = NSMenuItem(title: "Veil · 运行中 \(SessionManager.shared.count) 个窗口", action: nil, keyEquivalent: "")
        header.isEnabled = false
        m.addItem(header)
        m.addItem(.separator())
        let sessions = SessionManager.shared.all().sorted {
            (Store.shared.profile($0.profileId)?.seq ?? 0) < (Store.shared.profile($1.profileId)?.seq ?? 0)
        }
        if sessions.isEmpty {
            let e = NSMenuItem(title: "（无运行中的窗口）", action: nil, keyEquivalent: "")
            e.isEnabled = false
            m.addItem(e)
        } else {
            for s in sessions {
                let p = Store.shared.profile(s.profileId)
                let mi = NSMenuItem(title: "#\(p?.seq ?? 0) \(p?.name ?? s.profileId)  ·  PID \(s.pid)",
                                    action: #selector(menuCloseOne(_:)), keyEquivalent: "")
                mi.target = self
                mi.representedObject = s.profileId
                m.addItem(mi)
            }
            m.addItem(.separator())
            let c = NSMenuItem(title: "关闭全部窗口", action: #selector(menuCloseAll), keyEquivalent: "")
            c.target = self
            m.addItem(c)
        }
        m.addItem(.separator())
        let show = NSMenuItem(title: "显示主窗口", action: #selector(menuShow), keyEquivalent: "")
        show.target = self
        m.addItem(show)
        let api = NSMenuItem(title: "本地 API: 127.0.0.1:\(LocalAPI.shared.boundPort)", action: nil, keyEquivalent: "")
        api.isEnabled = false
        m.addItem(api)
        m.addItem(.separator())
        let q = NSMenuItem(title: "退出 Veil", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        m.addItem(q)
    }

    @objc private func menuCloseOne(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        SessionManager.shared.closeProfile(id)
        refreshStatusMenu()
    }
    @objc private func menuCloseAll() { SessionManager.shared.closeAll(); refreshStatusMenu() }
    @objc private func menuShow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - 生命周期

    public func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        !Store.shared.settings().keepInMenuBar
    }
    public func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }
    public func applicationWillTerminate(_ notification: Notification) {
        guard !terminating else { return }
        terminating = true
        let keep = Store.shared.settings().keepInMenuBar
        if !keep {
            VeilLog.info("[app] 退出：关闭所有运行中的窗口")
            SessionManager.shared.closeAll()
        } else {
            VeilLog.info("[app] 退出：保留 \(SessionManager.shared.count) 个运行中的窗口")
        }
    }
    public func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}
