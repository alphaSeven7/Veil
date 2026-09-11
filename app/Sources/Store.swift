import Foundation
import CryptoKit

/// 数据仓库：profiles.json 单文件 + 可选 AES-GCM 主密码加密
public final class Store {
    public static let shared = Store()

    private let queue = DispatchQueue(label: "veil.store", qos: .userInitiated)
    private var cache = VeilStoreFile()
    private var masterKey: SymmetricKey?
    private var loaded = false
    /// 主密码已设置但尚未解锁
    public private(set) var lockedByPassword = false

    private init() {}

    // MARK: 加密

    /// PBKDF2-HMAC-SHA256（用 CryptoKit 实现，避免依赖 CommonCrypto 模块）
    private func deriveKey(password: String, salt: Data, iterations: Int = 120_000) -> SymmetricKey {
        let pw = SymmetricKey(data: Data(password.utf8))
        var dk = [UInt8]()
        var block: UInt32 = 1
        while dk.count < 32 {
            var be = [UInt8](repeating: 0, count: 4)
            be[0] = UInt8((block >> 24) & 0xFF); be[1] = UInt8((block >> 16) & 0xFF)
            be[2] = UInt8((block >> 8) & 0xFF);  be[3] = UInt8(block & 0xFF)
            var u = Array(HMAC<SHA256>.authenticationCode(for: salt + Data(be), using: pw))
            var t = u
            for _ in 1..<iterations {
                u = Array(HMAC<SHA256>.authenticationCode(for: Data(u), using: pw))
                for i in 0..<t.count { t[i] ^= u[i] }
            }
            dk.append(contentsOf: t)
            block += 1
        }
        return SymmetricKey(data: Data(dk.prefix(32)))
    }

    @discardableResult
    public func setPassword(_ password: String?) -> Bool {
        queue.sync {
            if let p = password, !p.isEmpty {
                let salt = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
                masterKey = deriveKey(password: p, salt: salt)
                cache.settings.masterPasswordEnabled = true
                try? salt.write(to: Paths.supportRoot.appendingPathComponent("vault.salt"))
                saveLocked()
                VeilLog.info("[store] 已启用主密码加密 (AES-256-GCM)")
            } else {
                masterKey = nil
                cache.settings.masterPasswordEnabled = false
                try? FileManager.default.removeItem(at: Paths.supportRoot.appendingPathComponent("vault.salt"))
                saveLocked()
                VeilLog.info("[store] 已关闭主密码加密")
            }
            return true
        }
    }

    public func unlock(password: String) -> Bool {
        queue.sync {
            guard let salt = try? Data(contentsOf: Paths.supportRoot.appendingPathComponent("vault.salt")) else { return false }
            let key = deriveKey(password: password, salt: salt)
            let data = (try? Data(contentsOf: Paths.storeFile)) ?? Data()
            guard data.count > 28 else { return false }
            let sealed = try? AES.GCM.SealedBox(combined: data)
            guard let sb = sealed, let plain = try? AES.GCM.open(sb, using: key) else { return false }
            guard let f = J.decode(VeilStoreFile.self, from: plain) else { return false }
            masterKey = key
            cache = f
            loaded = true
            lockedByPassword = false
            return true
        }
    }

    // MARK: 加载 / 保存

    private func saveLocked() {
        let data: Data
        if let key = masterKey {
            let plain = J.encode(cache)
            let nonce = AES.GCM.Nonce()
            guard let sealed = try? AES.GCM.seal(plain, using: key, nonce: nonce) else { return }
            data = sealed.combined ?? Data()
        } else {
            data = (try? J.prettyEncoder.encode(cache)) ?? J.encode(cache)
        }
        let tmp = Paths.storeFile.deletingLastPathComponent().appendingPathComponent(".vault.tmp")
        try? data.write(to: tmp, options: .atomic)
        try? FileManager.default.replaceItemAt(Paths.storeFile, withItemAt: tmp)
    }

    public func load() {
        queue.sync {
            guard !loaded else { return }
            loaded = true
            guard FileManager.default.fileExists(atPath: Paths.storeFile.path) else { bootstrap(); return }
            let data = (try? Data(contentsOf: Paths.storeFile)) ?? Data()
            if data.isEmpty { bootstrap(); return }
            if let f = J.decode(VeilStoreFile.self, from: data) {
                cache = f
                return
            }
            // 可能是加密文件
            if FileManager.default.fileExists(atPath: Paths.supportRoot.appendingPathComponent("vault.salt").path) {
                lockedByPassword = true
                cache = VeilStoreFile()
                return
            }
            bootstrap()
        }
    }

    private func bootstrap() {
        cache = VeilStoreFile()
        let g = ProfileGroup(); var g2 = g
        g2.name = "默认分组"; g2.color = "#7c8cff"; g2.id = "default"
        cache.groups = [g2]
        _ = g
        // 首个示例窗口
        var p = VeilProfile()
        p.seq = 1
        p.name = "示例窗口 #1"
        p.groupId = "default"
        p.remark = "自动创建的示例环境，可直接打开测试指纹隔离效果"
        p.fp = FingerprintGen.random(platform: "windows")
        FingerprintGen.makeConsistent(&p.fp)
        cache.profiles = [p]
        saveLocked()
    }

    private func persist() { cache.profiles.sort { $0.seq != $1.seq ? $0.seq < $1.seq : $0.name < $1.name }; saveLocked() }

    public var requiresUnlock: Bool { queue.sync { lockedByPassword } }

    // MARK: Profile CRUD

    public func profiles() -> [VeilProfile] { queue.sync { cache.profiles } }
    public func profile(_ id: String) -> VeilProfile? { queue.sync { cache.profiles.first { $0.id == id } } }

    @discardableResult
    public func saveProfile(_ p: VeilProfile) -> VeilProfile {
        queue.sync {
            var np = p
            np.updatedAt = Date()
            FingerprintGen.makeConsistent(&np.fp)
            if np.name.isEmpty { np.name = "窗口 \(np.seq)" }
            if let i = cache.profiles.firstIndex(where: { $0.id == np.id }) {
                cache.profiles[i] = np
            } else {
                if np.seq == 0 { np.seq = nextSeqLocked() }
                np.createdAt = Date()
                cache.profiles.append(np)
            }
            persist()
            return np
        }
    }

    public func newProfile(platform: String = "windows", countryCode: String? = nil, groupId: String = "default", name: String? = nil) -> VeilProfile {
        queue.sync {
            var p = VeilProfile()
            p.seq = nextSeqLocked()
            p.groupId = groupId.isEmpty ? (cache.groups.first?.id ?? "default") : groupId
            p.fp = FingerprintGen.random(platform: platform, countryCode: countryCode, host: Host.shared.host)
            FingerprintGen.makeConsistent(&p.fp)
            p.name = name ?? "\(platformLabel(platform)) 窗口 \(p.seq)"
            cache.profiles.append(p)
            persist()
            return p
        }
    }

    public func deleteProfiles(_ ids: [String], deleteData: Bool) -> Int {
        queue.sync {
            let before = cache.profiles.count
            cache.profiles.removeAll { ids.contains($0.id) }
            persist()
            if deleteData {
                for id in ids {
                    try? FileManager.default.removeItem(at: Paths.profileDir(id))
                }
            }
            return before - cache.profiles.count
        }
    }

    public func duplicateProfile(_ id: String, count: Int = 1, copyCache: Bool = false) -> [VeilProfile] {
        queue.sync {
            guard let src = cache.profiles.first(where: { $0.id == id }) else { return [] }
            var out: [VeilProfile] = []
            for i in 0..<max(1, count) {
                var p = src
                p.id = UUID().uuidString
                p.seq = nextSeqLocked()
                p.name = "\(src.name) 副本\(count > 1 ? " \(i+1)" : "")"
                p.runtime = nil
                p.createdAt = Date(); p.updatedAt = Date(); p.lastOpenedAt = nil; p.openCount = 0
                // 新窗口 => 新噪声种子（除非要求完全克隆指纹）
                p.fp.seed = FingerprintGen.newSeed()
                cache.profiles.append(p)
                out.append(p)
                if copyCache {
                    let srcDir = Paths.userDataDir(src.id)
                    let dstDir = Paths.userDataDir(p.id)
                    try? FileManager.default.copyItem(at: srcDir, to: dstDir)
                }
            }
            persist()
            return out
        }
    }

    public func updateRuntime(_ id: String, _ state: RuntimeState?) {
        queue.sync {
            guard let i = cache.profiles.firstIndex(where: { $0.id == id }) else { return }
            cache.profiles[i].runtime = state
            if state != nil {
                cache.profiles[i].lastOpenedAt = Date()
                cache.profiles[i].openCount += 1
            }
            saveLocked()
        }
    }
    public func markOpened(_ id: String) {
        queue.sync {
            guard let i = cache.profiles.firstIndex(where: { $0.id == id }) else { return }
            cache.profiles[i].lastOpenedAt = Date()
            cache.profiles[i].openCount += 1
            saveLocked()
        }
    }
    public func setEnabled(_ ids: [String], _ enabled: Bool) {
        queue.sync {
            for i in cache.profiles.indices where ids.contains(cache.profiles[i].id) { cache.profiles[i].enabled = enabled }
            persist()
        }
    }

    private func nextSeqLocked() -> Int { (cache.profiles.map { $0.seq }.max() ?? 0) + 1 }

    // MARK: 分组

    public func groups() -> [ProfileGroup] { queue.sync { cache.groups } }
    public func saveGroup(_ g: ProfileGroup) {
        queue.sync {
            if let i = cache.groups.firstIndex(where: { $0.id == g.id }) { cache.groups[i] = g }
            else { cache.groups.append(g) }
            saveLocked()
        }
    }
    public func deleteGroup(_ id: String) {
        queue.sync {
            cache.groups.removeAll { $0.id == id }
            for i in cache.profiles.indices where cache.profiles[i].groupId == id { cache.profiles[i].groupId = "" }
            persist()
        }
    }

    // MARK: 模板

    public func templates() -> [FingerprintTemplate] { queue.sync { cache.templates } }
    public func saveTemplate(_ t: FingerprintTemplate) {
        queue.sync {
            if let i = cache.templates.firstIndex(where: { $0.id == t.id }) { cache.templates[i] = t }
            else { cache.templates.append(t) }
            saveLocked()
        }
    }
    public func deleteTemplate(_ id: String) { queue.sync { cache.templates.removeAll { $0.id == id }; saveLocked() } }

    // MARK: 设置

    public func settings() -> AppSettings { queue.sync { cache.settings } }
    public func saveSettings(_ s: AppSettings) { queue.sync { cache.settings = s; saveLocked() } }

    // MARK: 导入导出

    public func exportJSON(ids: [String]? = nil) -> Data {
        queue.sync {
            var f = VeilStoreFile()
            f.profiles = ids == nil ? cache.profiles : cache.profiles.filter { ids!.contains($0.id) }
            let gids = Set(f.profiles.map { $0.groupId })
            f.groups = cache.groups.filter { gids.contains($0.id) }
            f.version = cache.version
            return (try? J.prettyEncoder.encode(f)) ?? J.encode(f)
        }
    }

    @discardableResult
    public func importJSON(_ data: Data, remapIds: Bool = true) -> Int {
        queue.sync {
            guard let f = J.decode(VeilStoreFile.self, from: data) else { return 0 }
            var n = 0
            for g in f.groups where !cache.groups.contains(where: { $0.id == g.id }) { cache.groups.append(g) }
            for var p in f.profiles {
                if remapIds || cache.profiles.contains(where: { $0.id == p.id }) {
                    p.id = UUID().uuidString
                    p.runtime = nil
                }
                p.seq = nextSeqLocked()
                cache.profiles.append(p)
                n += 1
            }
            persist()
            return n
        }
    }
}

public func platformLabel(_ p: String) -> String {
    switch p {
    case "windows": return "Windows"
    case "mac": return "macOS"
    case "linux": return "Linux"
    case "android": return "Android"
    default: return p
    }
}
