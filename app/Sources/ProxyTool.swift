import Foundation

public enum ProxyTool {
    static let providers: [(String, String)] = [
        ("ip-api", "http://ip-api.com/json/?fields=66846719&lang=en"),
        ("ipapi.co", "https://ipapi.co/json/"),
        ("ipwho.is", "https://ipwho.is/"),
    ]

    /// 通过代理访问 IP 信息接口，返回出口 IP / 国家 / 时区 / 延迟
    public static func check(_ px: ProxyConfig, timeout: TimeInterval = 15) async -> ProxyCheckResult {
        var r = ProxyCheckResult()
        guard px.isUsable else { r.error = "代理配置无效"; return r }

        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = timeout
        cfg.timeoutIntervalForResource = timeout
        cfg.httpShouldUsePipelining = false
        var dict: [AnyHashable: Any] = [:]
        if px.type == "socks5" {
            dict[kCFNetworkProxiesSOCKSEnable as AnyHashable] = 1
            dict[kCFNetworkProxiesSOCKSProxy as AnyHashable] = px.host
            dict[kCFNetworkProxiesSOCKSPort as AnyHashable] = px.port
            if px.hasAuth {
                dict[kCFProxyUsernameKey as AnyHashable] = px.username
                dict[kCFProxyPasswordKey as AnyHashable] = px.password
            }
        } else {
            let scheme = px.type == "https" ? "HTTPS" : "HTTP"
            dict[kCFProxyTypeKey as AnyHashable] = kCFProxyTypeHTTP
            dict["\(scheme)Enable" as AnyHashable] = 1
            dict["\(scheme)Proxy" as AnyHashable] = px.host
            dict["\(scheme)Port" as AnyHashable] = px.port
            if px.hasAuth {
                dict[kCFProxyUsernameKey as AnyHashable] = px.username
                dict[kCFProxyPasswordKey as AnyHashable] = px.password
            }
        }
        cfg.connectionProxyDictionary = dict
        let session = URLSession(configuration: cfg)
        defer { session.invalidateAndCancel() }

        var lastErr = ""
        let start = Date()
        for (name, urlStr) in providers {
            guard let url = URL(string: urlStr) else { continue }
            do {
                var req = URLRequest(url: url)
                req.timeoutInterval = timeout
                req.setValue("Veil/\(LocalAPI.version)", forHTTPHeaderField: "User-Agent")
                let (data, resp) = try await session.data(for: req)
                let ms = Int(Date().timeIntervalSince(start) * 1000)
                if let http = resp as? HTTPURLResponse, http.statusCode != 200 {
                    lastErr = "\(name) HTTP \(http.statusCode)"
                    continue
                }
                guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { lastErr = "\(name) 解析失败"; continue }
                let ip = (o["query"] as? String) ?? (o["ip"] as? String) ?? ""
                guard !ip.isEmpty else { lastErr = "\(name) 无 IP 字段"; continue }
                r.ok = true
                r.ip = ip
                r.country = (o["country"] as? String) ?? (o["country_name"] as? String) ?? ""
                r.countryCode = (o["countryCode"] as? String) ?? (o["country_code"] as? String) ?? ""
                r.region = (o["regionName"] as? String) ?? (o["region"] as? String) ?? ""
                r.city = (o["city"] as? String) ?? ""
                r.timezone = (o["timezone"] as? String) ?? ((o["timezone"] as? [String: Any])?["id"] as? String) ?? ""
                r.latencyMs = ms
                r.checkedAt = Date()
                r.error = ""
                VeilLog.info("[proxy] \(px.label) -> \(r.ip) (\(r.countryCode) \(r.city)) \(ms)ms via \(name)")
                return r
            } catch {
                lastErr = "\(name): \(error.localizedDescription)"
                VeilLog.warn("[proxy] \(lastErr)")
            }
        }
        r.ok = false
        r.error = lastErr.isEmpty ? "所有 IP 信息源均不可达" : lastErr
        r.checkedAt = Date()
        return r
    }

    /// 解析代理字符串，如 http://user:pass@host:port
    public static func parse(_ s: String) -> ProxyConfig {
        var px = ProxyConfig()
        var str = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !str.isEmpty else { return px }
        if let r = str.range(of: "://") {
            px.type = String(str[str.startIndex..<r.lowerBound]).lowercased()
            str = String(str[r.upperBound...])
        } else { px.type = "http" }
        if px.type == "socks" { px.type = "socks5" }
        if let at = str.lastIndex(of: "@") {
            let cred = str[str.startIndex..<at]
            str = String(str[str.index(after: at)...])
            let parts = cred.split(separator: ":", maxSplits: 1).map(String.init)
            px.username = parts.first ?? ""
            px.password = parts.count > 1 ? parts[1] : ""
        }
        let hp = str.split(separator: ":", maxSplits: 1).map(String.init)
        px.host = (hp.first ?? "").replacingOccurrences(of: "/", with: "")
        px.port = hp.count > 1 ? (Int(hp[1].replacingOccurrences(of: "/", with: "")) ?? 0) : 0
        return px
    }
}
