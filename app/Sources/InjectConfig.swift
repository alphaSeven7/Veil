import Foundation

/// 把 Profile 编译成注入脚本可消费的 JSON 配置
public enum InjectConfig {

    public static func build(profile: VeilProfile, host: HostInfo) -> [String: Any] {
        let fp = profile.fp
        var cfg: [String: Any] = [:]
        cfg["seed"] = fp.seed
        cfg["timezone"] = fp.timezone

        // navigator
        var nav: [String: Any] = [
            "platform": fp.navPlatform,
            "hardwareConcurrency": fp.hardwareConcurrency,
            "deviceMemory": fp.deviceMemory,
            "maxTouchPoints": fp.maxTouchPoints,
            "vendor": fp.navVendor,
            "language": fp.languages.first ?? fp.locale,
            "languages": fp.languages,
            "vendorSub": "",
            "productSub": "20030107",
            "webdriver": false,
            "userAgent": fp.userAgent,
            "appVersion": String(fp.userAgent.dropFirst("Mozilla/".count)),
        ]
        nav["doNotTrack"] = fp.doNotTrack ? "1" : NSNull()
        cfg["navigator"] = nav

        // screen
        let availH = max(1, fp.screenHeight - fp.availTopOffset)
        let landscape = fp.screenWidth >= fp.screenHeight
        cfg["screen"] = [
            "width": fp.screenWidth,
            "height": fp.screenHeight,
            "availWidth": fp.screenWidth,
            "availHeight": availH,
            "availLeft": 0,
            "availTop": fp.platform == "mac" ? 0 : fp.availTopOffset,
            "colorDepth": fp.colorDepth,
            "pixelDepth": fp.pixelDepth,
            "devicePixelRatio": fp.devicePixelRatio,
            "orientation": ["angle": 0, "type": landscape ? "landscape-primary" : "portrait-primary"],
        ] as [String: Any]

        cfg["canvas"] = ["enabled": fp.canvasNoise, "level": fp.canvasNoiseLevel] as [String: Any]

        cfg["webgl"] = [
            "enabled": true,
            "spoof": fp.webglSpoof,
            "noise": fp.webglNoise,
            "vendor": fp.webglVendor,
            "renderer": fp.webglRenderer,
            "version": fp.webglVersion,
            "params": fp.webglParams,
            "hideExtensions": fp.webglHideExtensions,
            "webgl2": fp.webgl2,
            "webgpu": fp.webgpu,
            "precisionJitter": false,
        ] as [String: Any]

        cfg["audio"] = ["enabled": fp.audioNoise, "level": fp.audioNoiseLevel] as [String: Any]

        cfg["webrtc"] = [
            "mode": fp.webrtcMode,
            "publicIp": fp.webrtcPublicIp,
            "localIps": fp.webrtcLocalIps,
        ] as [String: Any]

        var fonts: [String: Any] = ["mode": fp.fontsMode, "list": fp.fonts]
        if fp.fontsMode == "strict" {
            fonts["substitutes"] = FontMapper.substitutes(target: fp.fonts, real: host.fonts)
        }
        cfg["fonts"] = fonts

        cfg["media"] = [
            "enabled": fp.mediaDevicesSpoof,
            "audioInputs": fp.audioInputs,
            "audioOutputs": fp.audioOutputs,
            "videoInputs": fp.videoInputs,
        ] as [String: Any]

        cfg["battery"] = ["enabled": fp.batterySpoof, "level": fp.batteryLevel, "charging": false] as [String: Any]
        cfg["permissions"] = ["enabled": fp.permissionsSpoof, "geo": fp.geo.enabled] as [String: Any]
        cfg["speech"] = ["enabled": fp.speechVoicesSpoof] as [String: Any]
        cfg["connection"] = ["enabled": fp.connectionSpoof, "effectiveType": fp.effectiveType] as [String: Any]
        cfg["plugins"] = ["enabled": fp.pdfViewer, "count": fp.pluginsCount] as [String: Any]

        var rnd = SeededRandom(seed: fp.seed + ":storage")
        let quotaGB = rnd.range(24, 220)
        let usageMB = rnd.range(1, 900)
        cfg["storage"] = ["quota": quotaGB * 1024 * 1024 * 1024, "usage": usageMB * 1024 * 1024] as [String: Any]

        cfg["automation"] = fp.automationScripts(profile)
        return cfg
    }

    /// 生成最终注入源码
    public static func source(profile: VeilProfile, host: HostInfo, template: String) -> String {
        let cfg = build(profile: profile, host: host)
        let json = String(data: (try? JSONSerialization.data(withJSONObject: cfg, options: [.sortedKeys])) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
        return template.replacingOccurrences(of: "__VEIL_CFG_JSON__", with: json)
    }
}

extension Fingerprint {
    func automationScripts(_ p: VeilProfile) -> [String] { p.automation.scripts.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
}

/// 字体替换映射（strict 模式）
public enum FontMapper {
    static let mono = ["consolas","courier new","courier","menlo","monaco","lucida console","dejavu sans mono",
                       "liberation mono","nimbus mono l","andale mono","sf mono","pt mono","ubuntu mono","free mono",
                       "droid sans mono","roboto mono","source code pro","iosevka","hack","fira code","cascadia mono",
                       "cascadia code","jetbrains mono","inconsolata","fantasque sans mono","victor mono","ibm plex mono"]
    static let serif = ["times new roman","times","georgia","cambria","garamond","palatino","palatino linotype",
                        "book antiqua","baskerville","constantia","charter","hoefler text","iowan old style",
                        "dejavu serif","liberation serif","nimbus roman no9 l","p052","noto serif","free serif",
                        "droid serif","bookman old style","century","utopia","utopia std","rockwell","slab",
                        "american typewriter","big caslon","didot","bodoni 72","cochin","songti sc","simsun",
                        "st song","mingliu-extb","microsoft yahei","ms mincho","yu mincho","batang"]
    static func cls(_ f: String) -> String {
        let l = f.lowercased()
        if mono.contains(l) || l.contains("mono") || l.contains("consol") || l.contains("courier") || l.contains("menlo") { return "mono" }
        if serif.contains(l) || l.contains("serif") || l.contains("times") || l.contains("georgia") || l.contains("garamond") || l.contains("mincho") || l.contains("song") { return "serif" }
        return "sans"
    }
    /// 目标字体表 + 真实字体表 -> { 需要覆盖的字体名: 用来替代的本地字体名 }
    public static func substitutes(target: [String], real: [String]) -> [String: String] {
        guard !target.isEmpty, !real.isEmpty else { return [:] }
        let tset = Set(target.map { $0.lowercased() })
        var byClass: [String: [String]] = ["sans": [], "serif": [], "mono": []]
        for r in real where !tset.contains(r.lowercased()) { byClass[cls(r), default: []].append(r) }
        // 允许列表里真实存在的字体，可作为替代来源
        var poolByClass: [String: [String]] = ["sans": [], "serif": [], "mono": []]
        for r in real where tset.contains(r.lowercased()) { poolByClass[cls(r), default: []].append(r) }
        if poolByClass["sans"]!.isEmpty { poolByClass["sans"] = ["Helvetica", "Arial", "DejaVu Sans"] }
        if poolByClass["serif"]!.isEmpty { poolByClass["serif"] = ["Times", "Times New Roman"] }
        if poolByClass["mono"]!.isEmpty { poolByClass["mono"] = ["Menlo", "Courier New"] }

        var out: [String: String] = [:]
        var i = 0
        // 1) 真实存在但不在目标列表 -> 用同类的目标字体覆盖（隐藏真机字体）
        for r in real where !tset.contains(r.lowercased()) {
            let c = cls(r)
            let pool = poolByClass[c]!
            out[r] = pool[i % pool.count]
            i += 1
        }
        // 2) 目标列表里真实不存在 -> 用同类的真实字体伪装成存在
        var j = 0
        for t in target where !Set(real.map { $0.lowercased() }).contains(t.lowercased()) {
            let c = cls(t)
            let pool = byClass[c]!.isEmpty ? poolByClass[c]! : byClass[c]!
            out[t] = pool[j % pool.count]
            j += 1
        }
        return out
    }
}
