import Foundation
import os.log

public enum VeilLog {
    private static let log = OSLog(subsystem: "com.veil.browser", category: "core")
    private static let fmt: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"; return f
    }()
    private static let q = DispatchQueue(label: "veil.log")
    public static var mirrorToConsole = true

    private static func write(_ level: String, _ msg: String) {
        let line = "[\(fmt.string(from: Date()))] [\(level)] \(msg)"
        q.async {
            if mirrorToConsole { NSLog("%@", line) }
            let url = Paths.logsRoot.appendingPathComponent("veil.log")
            if let d = (line + "\n").data(using: .utf8) {
                if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(d); try? h.close() }
                else { try? d.write(to: url) }
            }
        }
    }
    public static func info(_ m: String) { write("INFO", m) }
    public static func warn(_ m: String) { write("WARN", m) }
    public static func error(_ m: String) { write("ERROR", m) }
    public static func debug(_ m: String) { write("DEBUG", m) }

    public static func tail(_ n: Int = 400) -> String {
        let url = Paths.logsRoot.appendingPathComponent("veil.log")
        guard let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return s.split(separator: "\n").suffix(n).joined(separator: "\n")
    }
}
