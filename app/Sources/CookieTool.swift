import Foundation

public enum CookieTool {
    /// 支持 JSON(Chrome/EditThisCookie 导出)、Netscape cookies.txt、document.cookie 字符串
    public static func parseText(_ text: String) -> [[String: Any]] {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return [] }
        // 1) JSON
        if t.hasPrefix("[") || t.hasPrefix("{") {
            if let d = t.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) {
                if let arr = o as? [[String: Any]] { return arr }
                if let one = o as? [String: Any] {
                    if let arr = one["cookies"] as? [[String: Any]] { return arr }
                    return [one]
                }
            }
        }
        // 2) Netscape cookies.txt
        if t.contains("\t") {
            var out: [[String: Any]] = []
            for line in t.components(separatedBy: .newlines) {
                let l = line.trimmingCharacters(in: .whitespaces)
                if l.isEmpty || l.hasPrefix("#") { continue }
                let f = l.components(separatedBy: "\t")
                guard f.count >= 7 else { continue }
                out.append([
                    "domain": f[0], "includeSubdomains": f[1] == "TRUE", "path": f[2],
                    "secure": f[3] == "TRUE", "expires": Double(f[4]) ?? -1,
                    "name": f[5], "value": f[6],
                ])
            }
            if !out.isEmpty { return out }
        }
        // 3) document.cookie 风格
        var out: [[String: Any]] = []
        for pair in t.components(separatedBy: ";") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard kv.count == 2 else { continue }
            let n = kv[0].trimmingCharacters(in: .whitespaces)
            guard !n.isEmpty else { continue }
            out.append(["name": n, "value": kv[1].trimmingCharacters(in: .whitespaces), "domain": "", "path": "/"])
        }
        return out
    }

    public static func toJSONText(_ cookies: [CookieEntry]) -> String {
        let arr: [[String: Any]] = cookies.map { c in
            var d: [String: Any] = ["name": c.name, "value": c.value, "domain": c.domain, "path": c.path,
                                    "httpOnly": c.httpOnly, "secure": c.secure, "sameSite": c.sameSite]
            if c.expires > 0 { d["expirationDate"] = c.expires }
            return d
        }
        guard let data = try? JSONSerialization.data(withJSONObject: arr, options: [.prettyPrinted, .sortedKeys]),
              let s = String(data: data, encoding: .utf8) else { return "[]" }
        return s
    }

    public static func toNetscape(_ cookies: [CookieEntry]) -> String {
        var lines = ["# Netscape HTTP Cookie File (exported by Veil)"]
        for c in cookies {
            let inc = c.domain.hasPrefix(".") ? "TRUE" : "FALSE"
            lines.append([c.domain, inc, c.path, c.secure ? "TRUE" : "FALSE",
                          c.expires > 0 ? String(Int(c.expires)) : "0", c.name, c.value].joined(separator: "\t"))
        }
        return lines.joined(separator: "\n")
    }

    public static func normalize(_ raw: [[String: Any]], defaultDomain: String = "") -> [CookieEntry] {
        var out: [CookieEntry] = []
        for it in raw {
            var e = CookieEntry()
            e.name = (it["name"] as? String) ?? ""
            e.value = (it["value"] as? String) ?? ""
            e.domain = (it["domain"] as? String) ?? defaultDomain
            if e.domain.isEmpty, let host = it["hostOnly"] as? String { e.domain = host }
            if e.domain.isEmpty, let url = it["url"] as? String, let h = URL(string: url)?.host { e.domain = h }
            e.path = (it["path"] as? String) ?? "/"
            if let v = it["expirationDate"] as? Double { e.expires = v }
            else if let v = it["expires"] as? Double { e.expires = v }
            else if let v = it["expires"] as? Int { e.expires = Double(v) }
            e.httpOnly = (it["httpOnly"] as? Bool) ?? false
            e.secure = (it["secure"] as? Bool) ?? false
            if let ss = it["sameSite"] as? String { e.sameSite = ss.lowercased() }
            if !e.name.isEmpty { out.append(e) }
        }
        return out
    }
}
