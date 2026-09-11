import Foundation

// MARK: - 可复现随机数 (SplitMix64 + xoshiro256**)

public struct SeededRandom {
    private var s: [UInt64] = [0,0,0,0]
    public init(seed: String) {
        var h = UInt64(0x9E3779B97F4A7C15)
        var z = h
        for b in seed.utf8 { z = z &* 0x100000001B3 ^ UInt64(b); z = z ^ (z >> 29); z = z &* 0xBF58476D1CE4E5B9 }
        var sm = z == 0 ? 0x2545F4914F6CDD1D : z
        for i in 0..<4 {
            sm &+= 0x9E3779B97F4A7C15
            var x = sm
            x = (x ^ (x >> 30)) &* 0xBF58476D1CE4E5B9
            x = (x ^ (x >> 27)) &* 0x94D049BB133111EB
            s[i] = x ^ (x >> 31)
            if s[i] == 0 { s[i] = 0x12345678 ^ UInt64(i) }
        }
        _ = h
    }
    public mutating func next() -> UInt64 {
        let result = (s[0] &+ s[3]) ^ ((s[0] << 23) | (s[0] >> 41))
        let t = s[1] << 17
        s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t
        s[3] = (s[3] << 45) | (s[3] >> 19)
        return result
    }
    public mutating func int(_ n: Int) -> Int { n <= 0 ? 0 : Int(next() % UInt64(n)) }
    public mutating func range(_ a: Int, _ b: Int) -> Int { a + int(max(1, b - a + 1)) }
    public mutating func double() -> Double { Double(next() >> 11) / Double(1 << 53) }
    public mutating func pick<T>(_ arr: [T]) -> T { arr.isEmpty ? arr[0] : arr[int(arr.count)] }
    public mutating func weightedPick<T>(_ items: [(T, Int)]) -> T {
        let total = items.reduce(0) { $0 + $1.1 }
        guard total > 0 else { return items[0].0 }
        var r = int(total)
        for it in items { r -= it.1; if r < 0 { return it.0 } }
        return items.last!.0
    }
    public mutating func chance(_ p: Double) -> Bool { double() < p }
    public mutating func shuffle<T>(_ arr: [T]) -> [T] {
        var a = arr
        for i in stride(from: a.count - 1, to: 0, by: -1) {
            let j = int(i + 1)
            a.swapAt(i, j)
        }
        return a
    }
    public mutating func hex(_ bytes: Int) -> String {
        (0..<bytes).map { _ in String(format:"%02x", int(256)) }.joined()
    }
}

// MARK: - 宿主探测结果（真实机器指纹）

public struct HostInfo: Codable {
    public var probedAt: Date?
    public var chromePath: String = ""
    public var chromeMajor: Int = 152
    public var chromeFullVersion: String = "152.0.7977.83"
    public var brands: [UABrand] = []
    public var fullVersionList: [UABrand] = []
    public var greaseBrand: String = ""
    public var greaseVersion: String = ""
    public var platform: String = ""        // macOS / Windows / Linux
    public var platformVersion: String = ""
    public var architecture: String = ""
    public var bitness: String = ""
    public var model: String = ""
    public var wow64: Bool = false
    public var ua: String = ""
    public var navPlatform: String = ""
    public var screenWidth: Int = 0
    public var screenHeight: Int = 0
    public var availWidth: Int = 0
    public var availHeight: Int = 0
    public var colorDepth: Int = 24
    public var devicePixelRatio: Double = 1
    public var hardwareConcurrency: Int = 8
    public var deviceMemory: Int = 8
    public var timezone: String = ""
    public var languages: [String] = []
    public var webglVendor: String = ""
    public var webglRenderer: String = ""
    public var webglUnmaskedVendor: String = ""
    public var webglUnmaskedRenderer: String = ""
    public var fonts: [String] = []
    public var maxTouchPoints: Int = 0
    public var webglParams: [String: String] = [:]
    public var pluginsCount: Int = 5
    public var isValid: Bool { probedAt != nil }
    public init() {}
}

// MARK: - GREASE 品牌（用于非本机 Chrome 版本的近似回退）

public enum GreaseBrand {
    static let list = ["Not.A/Brand","Not?A_Brand","Not-A.Brand","Not A(Brand","Not;A=Brand",
                       "Not/A)Brand","Not=A?Brand","Not:A-Brand","Not(A:Brand","Not_A Brand"]
    static let versions = ["8","99","24"]
    public static func brand(forMajor major: Int) -> (String, String) {
        let i = (major / 2) % list.count
        let v = versions[(major / 2) % versions.count]
        return (list[i], v)
    }
}

// MARK: - 生成器

public enum FingerprintGen {

    public static func navPlatform(_ p: String) -> String {
        switch p {
        case "windows": return "Win32"
        case "mac": return "MacIntel"
        case "linux": return "Linux x86_64"
        case "android": return "Linux armv8l"
        default: return "Win32"
        }
    }

    public static func uaString(platform: String, major: Int) -> String {
        switch platform {
        case "mac":
            return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/\(major).0.0.0 Safari/537.36"
        case "linux":
            return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/\(major).0.0.0 Safari/537.36"
        case "android":
            return "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/\(major).0.0.0 Mobile Safari/537.36"
        default:
            return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/\(major).0.0.0 Safari/537.36"
        }
    }

    /// 构建 Client Hints 元数据
    public static func buildUAMetadata(platform: String, major: Int, fullVersion: String,
                                       grease: (String,String), host: HostInfo?) -> UAMetadata {
        var m = UAMetadata()
        let (gb, gv) = grease
        let brands = [UABrand(brand:"Chromium",version:"\(major)"),
                      UABrand(brand:gb,version:gv),
                      UABrand(brand:"Google Chrome",version:"\(major)")]
        let full = [UABrand(brand:"Chromium",version:fullVersion),
                    UABrand(brand:gb,version:"\(gv).0.0.0"),
                    UABrand(brand:"Google Chrome",version:fullVersion)]
        // Chromium 对品牌顺序做随机化，但集合固定；这里保持 Chromium/Google Chrome/GREASE 的稳定顺序
        m.brands = brands
        m.fullVersionList = full
        m.fullVersion = fullVersion
        switch platform {
        case "mac":
            m.platform = "macOS"
            m.platformVersion = macPlatformVersion(fullVersion: fullVersion, host: host)
            m.architecture = "arm"; m.bitness = ""; m.model = ""
        case "linux":
            m.platform = "Linux"; m.platformVersion = ""; m.architecture = "x86"; m.bitness = "64"; m.model = ""
        case "android":
            m.platform = "Android"; m.platformVersion = "13.0.0"; m.architecture = ""; m.bitness = ""; m.model = "SM-S918B"; m.mobile = true
        default:
            m.platform = "Windows"; m.model = ""
            m.platformVersion = windowsPlatformVersion(fullVersion: fullVersion)
            m.architecture = "x86"; m.bitness = "64"
        }
        m.wow64 = false
        m.mobile = (platform == "android")
        return m
    }

    static func macPlatformVersion(fullVersion: String, host: HostInfo?) -> String {
        if let h = host, h.isValid, h.platform.lowercased().contains("mac"), !h.platformVersion.isEmpty {
            return h.platformVersion
        }
        return ["15.7.7","15.5.0","14.7.2","14.6.1","13.7.4","15.1.1"].first ?? "15.7.7"
    }

    /// Windows: 10 -> "1.0.0"; 11 22H2 -> "13.0.0"; 11 24H2+ -> "15.0.0"
    static func windowsPlatformVersion(fullVersion: String) -> String {
        // Chrome 149+ 对应 Win11 24H2 时代
        if let major = Int(fullVersion.split(separator: ".").first.map(String.init) ?? ""), major >= 137 {
            return "15.0.0"
        }
        return "13.0.0"
    }

    /// 生成完整随机指纹
    public static func random(platform: String = "windows",
                              countryCode: String? = nil,
                              seed: String = UUID().uuidString,
                              chromeMajor: Int? = nil,
                              host: HostInfo? = nil) -> Fingerprint {
        var rng = SeededRandom(seed: seed)
        var fp = Fingerprint()
        fp.mode = "random"
        fp.seed = seed.replacingOccurrences(of: "-", with: "").lowercased()
        fp.platform = platform

        // 版本：优先贴合本机已安装的 Chrome 大版本（降低 TLS/构建号不一致风险）
        let installed = chromeMajor ?? host?.chromeMajor ?? 152
        let major = max(110, installed - rng.int(3))
        let minorBuild = rng.range(6000, 8200)
        let patch = rng.range(20, 200)
        let fullVersion = "\(major).0.\(minorBuild).\(patch)"
        if let h = host, h.isValid, h.chromeMajor == major, !h.chromeFullVersion.isEmpty {
            fp.uaMetadata = buildUAMetadata(platform: platform, major: major,
                                            fullVersion: h.chromeFullVersion,
                                            grease: (h.greaseBrand.isEmpty ? GreaseBrand.brand(forMajor: major).0 : h.greaseBrand,
                                                     h.greaseVersion.isEmpty ? GreaseBrand.brand(forMajor: major).1 : h.greaseVersion),
                                            host: host)
            fp.userAgent = uaString(platform: platform, major: major)
                .replacingOccurrences(of: "\(major).0.0.0", with: "\(major).0.0.0")
        } else {
            fp.userAgent = uaString(platform: platform, major: major)
            fp.uaMetadata = buildUAMetadata(platform: platform, major: major, fullVersion: fullVersion,
                                            grease: GreaseBrand.brand(forMajor: major), host: host)
        }

        // 地理 / 语言 / 时区
        let pool = countryCode.flatMap { c in let a = GeoDB.byCountry(c); return a.isEmpty ? nil : a } ?? GeoDB.cities
        let city = rng.pick(pool)
        fp.timezone = city.timezone
        fp.locale = city.locale
        fp.languages = city.languages
        fp.acceptLanguage = acceptLangHeader(city.languages)
        fp.geo.enabled = rng.chance(0.75)
        fp.geo.latitude = city.lat + rng.double() * 0.06 - 0.03
        fp.geo.longitude = city.lon + rng.double() * 0.06 - 0.03

        // 屏幕
        let screens = ScreenDB.forPlatform(platform)
        let s = rng.weightedPick(screens.map { scr in (scr, scr.2) })
        fp.screenWidth = s.0; fp.screenHeight = s.1
        fp.colorDepth = rng.chance(0.94) ? 24 : 30
        fp.pixelDepth = fp.colorDepth
        fp.devicePixelRatio = s.3 ? (rng.chance(0.6) ? 2 : 1.5) : 1
        fp.availTopOffset = platform == "mac" ? rng.pick([0, 25, 37]) : rng.pick([40, 48, 30, 0])
        let maxWinW = max(1024, fp.screenWidth - 40)
        let maxWinH = max(700, fp.screenHeight - fp.availTopOffset - 40)
        fp.windowWidth = min(maxWinW, rng.pick([1440, 1512, 1600, 1280, 1366, 1536, maxWinW]))
        fp.windowHeight = min(maxWinH, rng.pick([860, 900, 800, 720, 768, maxWinH]))

        // 硬件
        fp.hardwareConcurrency = rng.weightedPick([(4,18),(6,14),(8,32),(12,14),(16,14),(2,3),(20,3),(24,2)])
        fp.deviceMemory = rng.weightedPick([(4,20),(8,52),(16,20),(2,4),(32,4)])
        fp.maxTouchPoints = 0
        fp.navPlatform = navPlatform(platform)
        fp.navVendor = "Google Inc."
        fp.batterySpoof = true
        fp.batteryLevel = Double(rng.range(18, 99)) / 100.0

        // WebGL
        let gpus = GpuDB.forPlatform(platform)
        let gpu = rng.pick(gpus)
        fp.webglVendor = gpu.vendor
        fp.webglRenderer = gpu.renderer
        fp.webglSpoof = true
        fp.webglNoise = true
        fp.webgl2 = true
        fp.webglVersion = platform == "mac"
            ? "WebGL 1.0 (OpenGL ES 2.0 Chromium)"
            : "WebGL 1.0 (OpenGL ES 2.0 Chromium)"
        fp.webglParams = [
            "MAX_TEXTURE_SIZE": rng.pick(["16384","8192","32768"]),
            "MAX_RENDERBUFFER_SIZE": rng.pick(["16384","8192","32768"]),
            "MAX_VIEWPORT_DIMS": rng.pick(["32768,32768","16384,16384","8192,8192"]),
            "MAX_TEXTURE_IMAGE_UNITS": rng.pick(["16","32"]),
            "MAX_VERTEX_ATTRIBS": rng.pick(["16","32"]),
            "MAX_VARYING_VECTORS": rng.pick(["30","15","60"]),
            "MAX_VERTEX_UNIFORM_VECTORS": rng.pick(["4096","1024","2048"]),
            "MAX_FRAGMENT_UNIFORM_VECTORS": rng.pick(["4096","1024","2048"]),
            "MAX_COMBINED_TEXTURE_IMAGE_UNITS": rng.pick(["80","32","96"]),
            "ALIASED_LINE_WIDTH_RANGE": rng.pick(["1,1","1,7.375"]),
            "SHADING_LANGUAGE_VERSION": platform == "mac" ? "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)" : "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
        ]

        // 噪声等级
        fp.canvasNoise = true
        fp.canvasNoiseLevel = 0.012 + rng.double() * 0.028
        fp.audioNoise = true
        fp.audioNoiseLevel = 0.00004 + rng.double() * 0.00016

        // WebRTC
        fp.webrtcMode = rng.chance(0.35) ? "disabled" : (proxyAwareDefault())
        fp.webrtcPublicIp = ""
        fp.webrtcLocalIps = []

        // 字体
        fp.fontsMode = "preset"
        fp.fonts = FontDB.forPlatform(platform)

        // 媒体设备
        fp.mediaDevicesSpoof = true
        fp.audioInputs = rng.range(1, 2)
        fp.audioOutputs = rng.range(1, 3)
        fp.videoInputs = rng.chance(0.65) ? 1 : 0

        // 其它
        fp.doNotTrack = rng.chance(0.06)
        fp.pdfViewer = true
        fp.pluginsCount = 5
        fp.permissionsSpoof = true
        fp.speechVoicesSpoof = true
        fp.hideWebdriver = true
        fp.connectionSpoof = true
        fp.effectiveType = rng.chance(0.85) ? "4g" : "3g"
        return fp
    }

    static func proxyAwareDefault() -> String { "proxy" }

    public static func acceptLangHeader(_ langs: [String]) -> String {
        var parts: [String] = []
        for (i, l) in langs.enumerated() {
            if i == 0 { parts.append(l) }
            else { parts.append("\(l);q=\(String(format: "%.1f", max(0.1, 0.9 - Double(i - 1) * 0.1)))") }
        }
        return parts.joined(separator: ",")
    }

    /// 用真实机器信息生成指纹（mode = real）
    public static func realMachine(host: HostInfo) -> Fingerprint {
        var fp = Fingerprint()
        fp.mode = "real"
        fp.userAgent = host.ua
        fp.navPlatform = host.navPlatform
        fp.hardwareConcurrency = host.hardwareConcurrency
        fp.deviceMemory = host.deviceMemory
        fp.screenWidth = host.screenWidth
        fp.screenHeight = host.screenHeight
        fp.availTopOffset = max(0, host.screenHeight - host.availHeight)
        fp.colorDepth = host.colorDepth
        fp.pixelDepth = host.colorDepth
        fp.devicePixelRatio = host.devicePixelRatio
        fp.timezone = host.timezone
        fp.languages = host.languages
        fp.locale = host.languages.first ?? "en-US"
        fp.acceptLanguage = acceptLangHeader(host.languages)
        fp.webglVendor = host.webglUnmaskedVendor.isEmpty ? host.webglVendor : host.webglUnmaskedVendor
        fp.webglRenderer = host.webglUnmaskedRenderer.isEmpty ? host.webglRenderer : host.webglUnmaskedRenderer
        fp.webglSpoof = false
        fp.canvasNoise = false
        fp.audioNoise = false
        fp.webglNoise = false
        fp.fontsMode = "system"
        fp.fonts = host.fonts
        fp.maxTouchPoints = host.maxTouchPoints
        fp.pluginsCount = host.pluginsCount
        fp.webglParams = host.webglParams
        let lower = host.platform.lowercased()
        fp.platform = lower.contains("mac") ? "mac" : (lower.contains("linux") ? "linux" : "windows")
        fp.uaMetadata = UAMetadata()
        fp.uaMetadata.brands = host.brands
        fp.uaMetadata.fullVersionList = host.fullVersionList
        fp.uaMetadata.fullVersion = host.chromeFullVersion
        fp.uaMetadata.platform = host.platform
        fp.uaMetadata.platformVersion = host.platformVersion
        fp.uaMetadata.architecture = host.architecture
        fp.uaMetadata.bitness = host.bitness
        fp.uaMetadata.model = host.model
        fp.uaMetadata.wow64 = host.wow64
        fp.geo.enabled = false
        fp.webrtcMode = "real"
        fp.mediaDevicesSpoof = false
        fp.batterySpoof = false
        fp.connectionSpoof = false
        fp.permissionsSpoof = false
        fp.speechVoicesSpoof = false
        fp.windowWidth = min(max(1024, host.availWidth - 60), 1600)
        fp.windowHeight = min(max(700, host.availHeight - 60), 950)
        return fp
    }

    /// 保证平台相关字段自洽（用户手改平台后调用）
    public static func makeConsistent(_ fp: inout Fingerprint) {
        fp.navPlatform = navPlatform(fp.platform)
        if fp.userAgent.isEmpty {
            let major = fp.uaMetadata.fullVersion.isEmpty ? 152 : Int(fp.uaMetadata.fullVersion.split(separator: ".").first.map(String.init) ?? "152") ?? 152
            fp.userAgent = uaString(platform: fp.platform, major: major)
        }
        if fp.webglRenderer.isEmpty || fp.webglVendor.isEmpty {
            let g = GpuDB.forPlatform(fp.platform).first!
            fp.webglVendor = g.vendor; fp.webglRenderer = g.renderer
        }
        if fp.fontsMode == "preset" && fp.fonts.isEmpty { fp.fonts = FontDB.forPlatform(fp.platform) }
        if fp.languages.isEmpty { fp.languages = ["en-US","en"] }
        if fp.acceptLanguage.isEmpty { fp.acceptLanguage = acceptLangHeader(fp.languages) }
        if fp.seed.isEmpty { fp.seed = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() }
        if fp.windowWidth > fp.screenWidth { fp.windowWidth = fp.screenWidth - 40 }
        if fp.windowHeight > fp.screenHeight { fp.windowHeight = fp.screenHeight - 100 }
    }

    public static func newSeed() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}
