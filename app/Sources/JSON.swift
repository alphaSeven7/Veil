import Foundation

public enum J {
    public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        e.outputFormatting = [.sortedKeys]
        return e
    }()
    public static let prettyEncoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }()
    public static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }()

    public static func encode<T: Encodable>(_ v: T) -> Data { (try? encoder.encode(v)) ?? Data("{}".utf8) }
    public static func encodeString<T: Encodable>(_ v: T) -> String { String(data: encode(v), encoding: .utf8) ?? "{}" }
    public static func decode<T: Decodable>(_ t: T.Type, from data: Data) -> T? { try? decoder.decode(t, from: data) }
    public static func decode<T: Decodable>(_ t: T.Type, fromString s: String) -> T? { decode(t, from: Data(s.utf8)) }

    /// WKScriptMessage 传来的 Any -> Codable
    public static func recode<T: Decodable>(_ t: T.Type, from any: Any?) -> T? {
        guard let any = any else { return nil }
        guard JSONSerialization.isValidJSONObject(any) else { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: any) else { return nil }
        return decode(t, from: data)
    }

    /// Codable -> JS 可注入的字符串字面量
    public static func jsLiteral<T: Encodable>(_ v: T) -> String {
        let s = encodeString(v)
        return s
    }

    public static func anyToJSONString(_ any: Any?) -> String {
        guard let any = any, JSONSerialization.isValidJSONObject(any) else { return "null" }
        guard let d = try? JSONSerialization.data(withJSONObject: any) else { return "null" }
        return String(data: d, encoding: .utf8) ?? "null"
    }
}

/// 转义用于内嵌进 JS 字符串的 JSON
public func jsEscape(_ s: String) -> String {
    var out = ""
    out.reserveCapacity(s.count + 16)
    for ch in s {
        switch ch {
        case "\\": out += "\\\\"
        case "'": out += "\\'"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\u{2028}": out += "\\u2028"
        case "\u{2029}": out += "\\u2029"
        default: out.append(ch)
        }
    }
    return out
}

public extension J {
    /// Codable -> 可 JSON 序列化的 Any（用于返回给 JS / API）
    static func any<T: Encodable>(from v: T) -> Any {
        guard let data = try? encoder.encode(v),
              let o = try? JSONSerialization.jsonObject(with: data) else { return NSNull() }
        return o
    }
    static func anyArray<T: Encodable>(from arr: [T]) -> [Any] { arr.map { any(from: $0) } }
}
