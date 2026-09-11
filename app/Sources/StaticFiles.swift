import Foundation

public enum StaticFiles {
    static let types: [String: String] = [
        "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8",
        "js": "application/javascript; charset=utf-8", "mjs": "application/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "gif": "image/gif", "ico": "image/x-icon", "webp": "image/webp", "woff": "font/woff",
        "woff2": "font/woff2", "ttf": "font/ttf", "txt": "text/plain; charset=utf-8",
        "map": "application/json; charset=utf-8", "icns": "image/x-icon",
    ]

    public static func serve(_ relativePath: String, query: [String: String] = [:]) -> HTTPResponse {
        guard let root = Paths.bundleWebRoot else {
            return HTTPResponse.text("Web 资源未找到（bundleWebRoot = nil）", status: 500)
        }
        let cleaned = relativePath
            .replacingOccurrences(of: "\\", with: "/")
            .components(separatedBy: "/")
            .filter { !$0.isEmpty && $0 != "." && $0 != ".." }
            .joined(separator: "/")
        guard !cleaned.isEmpty else { return HTTPResponse.text("Not Found", status: 404) }
        let url = root.appendingPathComponent(cleaned)
        // 防目录穿越
        guard url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path) else {
            return HTTPResponse.text("Forbidden", status: 403)
        }
        guard let data = try? Data(contentsOf: url) else {
            return HTTPResponse.text("Not Found: \(cleaned)", status: 404)
        }
        let ext = url.pathExtension.lowercased()
        var headers = ["Content-Type": types[ext] ?? "application/octet-stream",
                       "Cache-Control": "no-cache"]
        // detect.html 注入当前配置
        if ext == "html", cleaned.hasSuffix("detect.html") {
            var html = String(data: data, encoding: .utf8) ?? ""
            let qs = query.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }.joined(separator: "&")
            html = html.replacingOccurrences(of: "__VEIL_QUERY__", with: qs)
            html = html.replacingOccurrences(of: "__VEIL_VERSION__", with: LocalAPI.version)
            return HTTPResponse(status: 200, headers: headers, body: Data(html.utf8))
        }
        if ext == "html" {
            var html = String(data: data, encoding: .utf8) ?? ""
            html = html.replacingOccurrences(of: "__VEIL_VERSION__", with: LocalAPI.version)
            headers["Cache-Control"] = "no-cache"
            return HTTPResponse(status: 200, headers: headers, body: Data(html.utf8))
        }
        return HTTPResponse(status: 200, headers: headers, body: data)
    }
}
