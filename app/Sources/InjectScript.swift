import Foundation

/// 注入脚本模板加载与编译
public enum InjectScript {
    private static var cached: String?
    private static var cachedPath: String?

    public static var template: String {
        if let c = cached { return c }
        for url in candidateURLs() {
            if let s = try? String(contentsOf: url, encoding: .utf8) {
                cached = s; cachedPath = url.path
                VeilLog.info("[inject] 模板加载自 \(url.path) (\(s.count) 字节)")
                return s
            }
        }
        VeilLog.error("[inject] 未找到 inject.js 模板")
        return "(function(){})();"
    }

    static func candidateURLs() -> [URL] {
        var out: [URL] = []
        if let root = Paths.bundleWebRoot { out.append(root.appendingPathComponent("inject.js")) }
        if let r = Bundle.main.resourceURL { out.append(r.appendingPathComponent("Web/inject.js")) }
        let dev = URL(fileURLWithPath: #file).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Web/inject.js")
        out.append(dev)
        return out
    }

    public static func source(for profile: VeilProfile, host: HostInfo) -> String {
        InjectConfig.source(profile: profile, host: host, template: template)
    }

    public static func invalidate() { cached = nil; cachedPath = nil }
    public static var loadedFrom: String { cachedPath ?? "(未加载)" }
}
