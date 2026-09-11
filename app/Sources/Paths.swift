import Foundation

public enum Paths {
    public static let appName = "Veil"

    public static var supportRoot: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let d = base.appendingPathComponent(appName, isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    public static var profilesRoot: URL {
        let d = supportRoot.appendingPathComponent("profiles", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    public static var logsRoot: URL {
        let d = supportRoot.appendingPathComponent("logs", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    public static var storeFile: URL { supportRoot.appendingPathComponent("vault.json") }
    public static var hostFile: URL { supportRoot.appendingPathComponent("host.json") }
    public static var sessionFile: URL { supportRoot.appendingPathComponent("sessions.json") }

    public static func profileDir(_ id: String) -> URL {
        let d = profilesRoot.appendingPathComponent(id, isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    public static func userDataDir(_ id: String) -> URL {
        let d = profileDir(id).appendingPathComponent("data", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    public static func extensionDir(_ id: String) -> URL {
        let d = profileDir(id).appendingPathComponent("ext", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }
    public static func logFile(_ id: String) -> URL {
        logsRoot.appendingPathComponent("\(id).log")
    }

    public static var bundleWebRoot: URL? {
        if let u = Bundle.main.resourceURL?.appendingPathComponent("Web", isDirectory: true),
           FileManager.default.fileExists(atPath: u.appendingPathComponent("index.html").path) { return u }
        let dev = URL(fileURLWithPath: #file).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Web", isDirectory: true)
        if FileManager.default.fileExists(atPath: dev.appendingPathComponent("index.html").path) { return dev }
        return nil
    }

    /// 常见 Chromium 内核浏览器
    public static let knownBrowsers: [(name: String, paths: [String])] = [
        ("Google Chrome", ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]),
        ("Chrome Beta", ["/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta"]),
        ("Chrome Canary", ["/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"]),
        ("Chromium", ["/Applications/Chromium.app/Contents/MacOS/Chromium"]),
        ("Microsoft Edge", ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]),
        ("Brave", ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]),
        ("Vivaldi", ["/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"]),
        ("Arc", ["/Applications/Arc.app/Contents/MacOS/Arc"]),
        ("Opera", ["/Applications/Opera.app/Contents/MacOS/Opera"]),
        ("Chrome (Homebrew)", ["/opt/homebrew/bin/chromium", "/usr/local/bin/chromium"]),
    ]

    public static func detectBrowsers() -> [(name: String, path: String, version: String)] {
        var out: [(String,String,String)] = []
        let fm = FileManager.default
        for b in knownBrowsers {
            for p in b.paths where fm.fileExists(atPath: p) {
                out.append((b.name, p, browserVersion(at: p) ?? ""))
            }
        }
        return out
    }

    public static func browserVersion(at path: String) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = ["--version"]
        let pipe = Pipe()
        p.standardOutput = pipe; p.standardError = FileHandle.nullDevice
        do { try p.run(); p.waitUntilExit() } catch { return nil }
        let s = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return s
    }

    public static func defaultBrowserPath(preferred: String) -> String? {
        if !preferred.isEmpty && FileManager.default.fileExists(atPath: preferred) { return preferred }
        let found = detectBrowsers()
        if let chrome = found.first(where: { $0.name == "Google Chrome" }) { return chrome.path }
        return found.first?.path
    }
}
