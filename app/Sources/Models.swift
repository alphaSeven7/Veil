import Foundation

// MARK: - 代理

public struct ProxyConfig: Codable, Equatable {
    /// none | http | https | socks5 | custom(系统代理)
    public var type: String = "none"
    public var host: String = ""
    public var port: Int = 0
    public var username: String = ""
    public var password: String = ""
    /// 是否随指纹自动切换出口国家（仅提示用途）
    public var checkResult: ProxyCheckResult?

    public var isUsable: Bool {
        switch type {
        case "custom": return true
        case "none", "": return false
        default: return !host.isEmpty && port > 0
        }
    }
    public var hasAuth: Bool { !username.isEmpty }
    public var label: String {
        switch type {
        case "none", "": return "不使用代理"
        case "custom": return "跟随系统代理"
        default: return "\(type.uppercased()) \(host):\(port)"
        }
    }
    public init() {}
}

public struct ProxyCheckResult: Codable, Equatable {
    public var ok: Bool = false
    public var ip: String = ""
    public var country: String = ""
    public var countryCode: String = ""
    public var region: String = ""
    public var city: String = ""
    public var timezone: String = ""
    public var latencyMs: Int = 0
    public var checkedAt: Date = Date()
    public var error: String = ""
    public init() {}
}

// MARK: - UA Client Hints

public struct UABrand: Codable, Equatable {
    public var brand: String = ""
    public var version: String = ""
}

public struct UAMetadata: Codable, Equatable {
    public var brands: [UABrand] = []
    public var fullVersionList: [UABrand] = []
    public var fullVersion: String = ""
    public var platform: String = "Windows"
    public var platformVersion: String = "15.0.0"
    public var architecture: String = "x86"
    public var model: String = ""
    public var mobile: Bool = false
    public var bitness: String = "64"
    public var wow64: Bool = false
    public init() {}
}

// MARK: - 地理位置

public struct GeoLocation: Codable, Equatable {
    public var enabled: Bool = false
    public var latitude: Double = 0
    public var longitude: Double = 0
    public init() {}
}

// MARK: - 指纹

public struct Fingerprint: Codable, Equatable {
    /// random(每次打开随机, 基于种子) | custom(完全手动) | real(使用真实机器指纹)
    public var mode: String = "random"
    /// 噪声种子：同一种子 => 同一台"虚拟机器"
    public var seed: String = ""

    // 基础
    public var platform: String = "windows"          // windows | mac | linux | android
    public var userAgent: String = ""
    public var uaMetadata: UAMetadata = UAMetadata()
    public var acceptLanguage: String = "en-US,en;q=0.9"
    public var languages: [String] = ["en-US", "en"]
    public var timezone: String = "America/New_York"
    public var geo: GeoLocation = GeoLocation()
    public var locale: String = "en-US"

    // 屏幕 / 窗口
    public var screenWidth: Int = 1920
    public var screenHeight: Int = 1080
    public var availTopOffset: Int = 40              // 任务栏占用
    public var colorDepth: Int = 24
    public var pixelDepth: Int = 24
    public var devicePixelRatio: Double = 1
    public var windowWidth: Int = 1440
    public var windowHeight: Int = 860
    public var forceViewport: Bool = false           // 使用 CDP 强制视口/DPR

    // 硬件
    public var hardwareConcurrency: Int = 8
    public var deviceMemory: Int = 8
    public var maxTouchPoints: Int = 0
    public var navVendor: String = "Google Inc."
    public var navPlatform: String = "Win32"
    public var batterySpoof: Bool = true
    public var batteryLevel: Double = 0.86

    // Canvas
    public var canvasNoise: Bool = true
    public var canvasNoiseLevel: Double = 0.02       // 0 ~ 0.1

    // WebGL
    public var webglNoise: Bool = true
    public var webglSpoof: Bool = true
    public var webglVendor: String = "Google Inc. (NVIDIA)"
    public var webglRenderer: String = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)"
    public var webglVersion: String = "WebGL 1.0 (OpenGL ES 2.0 Chromium)"
    public var webgl2: Bool = true
    public var webglParams: [String: String] = [:]   // MAX_TEXTURE_SIZE 等
    public var webglHideExtensions: [String] = []
    public var webgpu: String = "auto"               // auto | hide

    // Audio
    public var audioNoise: Bool = true
    public var audioNoiseLevel: Double = 0.0001

    // WebRTC
    public var webrtcMode: String = "disabled"       // disabled | real | proxy | custom
    public var webrtcPublicIp: String = ""
    public var webrtcLocalIps: [String] = []

    // 字体
    public var fontsMode: String = "preset"          // preset | system | custom
    public var fonts: [String] = []

    // 媒体设备
    public var mediaDevicesSpoof: Bool = true
    public var audioInputs: Int = 1
    public var audioOutputs: Int = 2
    public var videoInputs: Int = 1

    // 其它
    public var doNotTrack: Bool = false
    public var pdfViewer: Bool = true
    public var pluginsCount: Int = 5
    public var permissionsSpoof: Bool = true
    public var speechVoicesSpoof: Bool = true
    public var hideWebdriver: Bool = true
    public var connectionSpoof: Bool = true          // navigator.connection
    public var effectiveType: String = "4g"

    public init() { self.seed = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() }
}

// MARK: - 启动配置

public struct LaunchConfig: Codable, Equatable {
    public var browserPath: String = ""              // 空 = 自动探测
    public var homepage: String = ""                 // 空 = 新标签页
    public var extraTabs: [String] = []
    public var extraArgs: [String] = []
    public var windowPositionMode: String = "cascade" // cascade | fixed | auto
    public var windowPositionX: Int = 0
    public var windowPositionY: Int = 0
    public var useMockKeychain: Bool = true
    public var hideDebugInfobar: Bool = true
    public var incognito: Bool = false
    public var keepRunningAfterQuit: Bool = true
    public init() {}
}

// MARK: - 自动化

public struct CookieEntry: Codable, Equatable {
    public var name: String = ""
    public var value: String = ""
    public var domain: String = ""
    public var path: String = "/"
    public var expires: Double = -1
    public var httpOnly: Bool = false
    public var secure: Bool = false
    public var sameSite: String = "unspecified"
    public init() {}
}

public struct AutomationConfig: Codable, Equatable {
    public var scripts: [String] = []        // 打开后在每个页面执行的 JS
    public var cookies: [CookieEntry] = []
    public var delayMs: Int = 0              // 启动后等待
    public init() {}
}

// MARK: - 运行状态

public struct RuntimeState: Codable, Equatable {
    public var pid: Int32 = 0
    public var debugPort: Int = 0
    public var browserWs: String = ""
    public var startedAt: Date = Date()
    public var dataDir: String = ""
    public init() {}
}

// MARK: - 窗口 / Profile

public struct VeilProfile: Codable, Equatable, Identifiable {
    public var id: String = UUID().uuidString
    public var seq: Int = 0
    public var name: String = ""
    public var groupId: String = ""
    public var remark: String = ""
    public var tags: [String] = []
    public var enabled: Bool = true
    public var fp: Fingerprint = Fingerprint()
    public var proxy: ProxyConfig = ProxyConfig()
    public var launch: LaunchConfig = LaunchConfig()
    public var automation: AutomationConfig = AutomationConfig()
    public var runtime: RuntimeState?
    public var createdAt: Date = Date()
    public var updatedAt: Date = Date()
    public var lastOpenedAt: Date?
    public var openCount: Int = 0

    public init() {}
}

public struct ProfileGroup: Codable, Equatable, Identifiable {
    public var id: String = UUID().uuidString
    public var name: String = ""
    public var color: String = "#7c8cff"
    public var remark: String = ""
    public var sortIndex: Int = 0
    public var createdAt: Date = Date()
    public init() {}
}

public struct FingerprintTemplate: Codable, Equatable, Identifiable {
    public var id: String = UUID().uuidString
    public var name: String = ""
    public var fp: Fingerprint = Fingerprint()
    public var createdAt: Date = Date()
    public init() {}
}

public struct AppSettings: Codable, Equatable {
    public var apiEnabled: Bool = true
    public var apiPort: Int = 54345
    public var apiToken: String = ""
    public var keepInMenuBar: Bool = true
    public var autoAttachOnLaunch: Bool = true
    public var defaultBrowserPath: String = ""
    public var detectHomePage: String = "veil://detect"
    public var masterPasswordEnabled: Bool = false
    public var cascadeOffset: Int = 28
    public var autoCheckProxyOnOpen: Bool = false
    public var locale: String = "zh-CN"
    public var theme: String = "dark"
    public init() {}
}

public struct VeilStoreFile: Codable {
    public var version: Int = 1
    public var profiles: [VeilProfile] = []
    public var groups: [ProfileGroup] = []
    public var templates: [FingerprintTemplate] = []
    public var settings: AppSettings = AppSettings()
    public init() {}
}
