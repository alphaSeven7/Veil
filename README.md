# Veil · 指纹浏览器（macOS）

一个 macOS 原生的**反检测指纹浏览器控制台**，功能对标比特浏览器（BitBrowser / AdsPower 一类），但以「本机已安装的 Chrome / Chromium / Edge / Brave」为内核，通过 **Chrome DevTools Protocol（CDP）** 完成指纹注入，因此无需自带几百 MB 的 Chromium 构建。

- 原生 Swift / AppKit + WKWebView 界面（单二进制，无 Electron、无 Node 运行时依赖）
- 每个「窗口」= 一个完全隔离的浏览器环境（独立 `--user-data-dir`）+ 一整套可复现的伪造指纹
- 内置本地 HTTP API，**接口协议兼容比特浏览器**（默认 `127.0.0.1:54345`），可直接对接 Selenium / Playwright / Puppeteer / RPA
- 产物：`Veil.app` + 可双击安装的 `Veil-<版本>.pkg`

---

## 1. 快速开始

```bash
# 一键构建（.app + .pkg）
./build.sh

# 直接运行（不安装）
open dist/stage/Veil.app

# 或安装
open dist/Veil-1.0.0.pkg
```

构建产物：

| 产物 | 路径 |
|---|---|
| 应用 | `dist/stage/Veil.app` |
| 安装包 | `dist/Veil-1.0.0.pkg` |
| 数据目录 | `~/Library/Application Support/Veil/` |

> **Gatekeeper**：本仓库默认做 ad-hoc 自签名（未经 Apple 公证）。首次打开若被拦截：
> 访达 → 应用程序 → **右键 Veil → 打开**；或执行
> `xattr -dr com.apple.quarantine /Applications/Veil.app`。
> pkg 安装脚本会自动清除隔离属性。

### 环境变量（构建选项）

| 变量 | 默认 | 说明 |
|---|---|---|
| `VEIL_VERSION` | `1.0.0` | 版本号 |
| `VEIL_ARCHS` | `native` | `native` / `x86_64` / `arm64` / `universal`（universal 会 lipo 合并双架构） |
| `VEIL_SIGN_IDENTITY` | `-` | 签名身份；有开发者证书时填 `Developer ID Application: ...` |
| `VEIL_PKG` | `1` | 设为 `0` 跳过 pkg 打包 |

---

## 2. 工作原理

### 2.1 为什么走 CDP 而不是扩展

Chrome **137 起，品牌版 Chrome 移除了 `--load-extension` 命令行开关**（官方推荐改用企业策略 `ExtensionInstallForcelist`，需要写系统级配置）。因此 Veil 全程使用 CDP：

| 能力 | 使用的 CDP 域 |
|---|---|
| User-Agent + Client Hints（sec-ch-ua*）+ Accept-Language | `Emulation.setUserAgentOverride`（含 `userAgentMetadata`） |
| 时区 | `Emulation.setTimezoneOverride` |
| 语言 / `Intl` | `Emulation.setLocaleOverride` |
| 地理位置 | `Emulation.setGeolocationOverride` |
| 视口 / DPR（可选强制） | `Emulation.setDeviceMetricsOverride` |
| 触控 | `Emulation.setTouchEmulationEnabled` |
| Canvas / WebGL / 音频 / 字体 / WebRTC / 媒体设备 / 电池 / 插件 / 存储配额 / 自动化痕迹 | `Page.addScriptToEvaluateOnNewDocument`（`runImmediately: true`，主世界） |
| Cookie 预置 | `Storage.setCookies`（在加载任何页面之前） |

Veil 为每个运行中的窗口维持一个**常驻 CDP 会话**，并通过 `Target.setAutoAttach(autoAttach, waitForDebuggerOnStart, flatten)` **递归**覆盖后续新开的标签页与跨进程 iframe（OOPIF），保证每个新文档在**任何页面脚本执行之前**就已注入。

### 2.2 指纹种子（可复现）

每个窗口有一个 `seed`。同一 seed 生成的 Canvas 噪声、WebGL readPixels 噪声、音频噪声、媒体设备 ID、存储配额等**每次读取都稳定一致**——不会出现「同一页面两次读取结果不同」这种自相矛盾的强特征。复制窗口会得到新 seed（即一台新的「虚拟机器」）。

### 2.3 宿主探针（关键设计）

GREASE 品牌串（`sec-ch-ua` 里的 `Not?A_Brand` 之类）**随 Chrome 大版本轮换且无法可靠硬编码**；TLS/JA3 指纹又由真实二进制决定。Veil 的解法是：

1. 首次启动时以 `--headless=new` 静默启动一次本机 Chrome（不显示窗口、不占 Dock），
   在 `127.0.0.1` 的临时安全上下文页面里读取**真实**的 UA-CH、GREASE 品牌串、GPU 字符串、WebGL 参数、本机字体列表；
2. 缓存到 `host.json`；
3. 生成随机指纹时**默认把 UA 大版本贴近本机 Chrome**（降低版本错配），并复用真实 GREASE 串；
4. 同时支撑「真实机器」指纹模式与字体严格替换所需的真实字体表。

### 2.4 代理自动认证

Chrome 的 `--proxy-server` **不支持账号密码**。Veil 内置一个本地中继（`Network.framework` 实现）：

```
Chrome ──http://127.0.0.1:<随机端口>──▶ Veil 中继 ──(自动注入凭据)──▶ 上游 HTTP/HTTPS/SOCKS5 代理
```

支持 HTTP / HTTPS（TLS 到代理）/ SOCKS5（含用户名密码握手），对页面完全透明。无凭据的代理则直接透传给 Chrome。

### 2.5 本地 API（兼容比特浏览器）

默认监听 `127.0.0.1:54345`（与比特浏览器同端口；若被占用会自动改用随机端口并在界面提示）。

```bash
curl -s http://127.0.0.1:54345/health
curl -s -X POST http://127.0.0.1:54345/browser/open  -d '{"seq":1}'
curl -s -X POST http://127.0.0.1:54345/browser/list   -d '{"page":0,"pageSize":50}'
curl -s -X POST http://127.0.0.1:54345/browser/close  -d '{"seq":1}'
```

`/browser/open` 返回的 `http` / `wsUrl` 可直接喂给自动化工具：

```python
import requests
from playwright.sync_api import sync_playwright

d = requests.post("http://127.0.0.1:54345/browser/open", json={"seq": 1}).json()["data"]
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(d["http"])
    page = browser.contexts[0].pages[0]
    page.goto("https://browserleaks.com/javascript")
    print(page.evaluate("navigator.userAgent"))
    browser.close()          # 只断开连接，窗口保持运行
```

完整接口列表见应用内「本地 API」页（含每个接口的 curl 示例与「试运行」按钮）。

---

## 3. 功能清单

**窗口管理**
- 新建 / 批量新建（1–200）/ 复制（可选连同缓存）/ 删除（可选保留数据）/ 启用停用
- 分组、标签、搜索、多列排序、勾选批量操作（打开/关闭/移组/启停/检测代理/导出/清缓存/删除）
- 每窗口独立 `--user-data-dir`；清除缓存 = 全新环境
- 导入 / 导出 JSON（可只导出选中项）

**指纹（30+ 项）**
- 基础：UA、UA-CH（brands / fullVersionList / platform / platformVersion / architecture / bitness / model / wow64）、语言、Accept-Language、时区、`Intl`、地理位置（经纬度联动城市库 80+ 城市）
- 屏幕：分辨率、可用区域、色深 / 像素深度、DPR、`screen.orientation`、窗口尺寸、可选 CDP 强制视口
- 硬件：`hardwareConcurrency`、`deviceMemory`、`maxTouchPoints`、`navigator.platform/vendor`、电池 API、`navigator.connection`
- Canvas：`toDataURL / toBlob / getImageData / OffscreenCanvas.convertToBlob` 确定性微扰（±2 LSB，肉眼不可见）
- WebGL / WebGL2：UNMASKED_VENDOR / UNMASKED_RENDERER、`getParameter` 参数覆写、`getSupportedExtensions` 裁剪、`readPixels` 噪声、可选隐藏 WebGPU
- 音频：`AudioBuffer.getChannelData`、`AnalyserNode.*`、`OfflineAudioContext.startRendering` 噪声
- WebRTC：禁用 / 仅公网 / 自定义 IP 映射（SDP 改写 + `--force-webrtc-ip-handling-policy` 双重保险）
- 字体：预设列表拦截 `document.fonts.check`；严格模式注入 `@font-face` 做度量替换
- 媒体设备：`enumerateDevices` 数量与 deviceId 伪造；摄像头为 0 时 `getUserMedia` 拒绝
- 其它：plugins / mimeTypes（PDF Viewer 五件套）、`storage.estimate()` 配额、Permissions 与 Notification 一致性、语音合成列表过滤、`navigator.webdriver=false`、清理 `cdc_` / `$cdc_` / selenium / puppeteer 残留、`Function.prototype.toString` 与 getter 的原生化伪装

**代理**
- HTTP / HTTPS / SOCKS5 / 系统代理 / 直连；账号密码自动认证（本地中继）
- 一键检测出口 IP / 国家 / 城市 / 时区 / 延迟（多数据源回退）
- 「用出口 IP 的时区/语言覆盖指纹」一键对齐

**自动化**
- 每窗口「打开后执行的 JS」（注入到每个新文档）
- Cookie 导入（Chrome/EditThisCookie JSON、Netscape cookies.txt、document.cookie 字符串）/ 导出 / 读取运行中窗口的实时 Cookie
- 启动页、多标签、额外命令行参数、窗口位置策略（级联/固定/系统）、隐身模式

**检测与诊断**
- 内置自检页 `veil://detect`（在目标窗口内打开，与配置期望值逐项比对并给出一致性得分）
- 应用内「指纹探针」：通过 CDP 在运行窗口中执行 35+ 项检测并对比
- 一致性检查器：编辑时实时提示 UA/平台/显卡/字体/时区/语言/窗口尺寸之间的矛盾
- 运行日志（`~/Library/Application Support/Veil/logs/`）

**安全**
- 可选主密码：配置以 AES-256-GCM 加密，密钥由 PBKDF2-HMAC-SHA256（120k 迭代）本地派生
- 所有本地端口只绑定 `127.0.0.1`；可选 API 访问令牌

---

## 4. 已知边界（诚实说明）

Veil 不修改 Chromium 内核，以下项目**无法**通过注入解决，请在选型前知悉：

1. **TLS / JA3 / HTTP2 指纹**由真实浏览器二进制决定。因此 Veil 默认让伪造 UA 贴近本机 Chrome 版本，使二者一致而非互相矛盾。
2. **字体度量**：预设模式只能拦截 `document.fonts.check()`；基于 canvas 度量的字体枚举仍会命中本机真实安装的字体。需要更强隔离请用「严格模式」（会留下 `document.fonts` 中的 FontFace 痕迹）。
3. **CDP 依赖**：注入依赖 `--remote-debugging-port`（仅绑定回环）。Veil 退出后**新开**的标签页不会继续注入；建议保持 Veil 运行（菜单栏常驻），或开启「启动时自动接管仍在运行的窗口」。
4. **媒体编解码**：`MediaSource.isTypeSupported()` / `canPlayType()` 反映真实系统支持，未伪装。
5. **本机其它同权限进程**可以连接 CDP 端口与本地 API 端口——这是 CDP 方案的固有特性。

---

## 5. 目录结构

```
nlviews/
├── build.sh                 # 一键构建 .app + .pkg
├── app/
│   ├── Info.plist
│   ├── Sources/             # Swift 源码（24 个文件）
│   │   ├── main.swift / AppDelegate.swift     # 应用外壳、菜单、菜单栏
│   │   ├── Bridge.swift                       # WKWebView <-> Swift 桥（~50 个方法）
│   │   ├── Models.swift / Store.swift         # 数据模型 / 持久化（可选 AES-GCM）
│   │   ├── FingerprintData.swift              # 城市/显卡/字体/分辨率数据库
│   │   ├── FingerprintGen.swift               # 种子化随机指纹生成器
│   │   ├── InjectConfig.swift                 # 指纹 -> 注入配置编译
│   │   ├── Host.swift                         # 宿主探针（headless 读真值）
│   │   ├── CDPClient.swift                    # WebSocket CDP 客户端（多 session）
│   │   ├── SessionController.swift            # 每窗口会话：自动附加 + 全量注入
│   │   ├── BrowserLauncher.swift              # 启动参数构造与进程管理
│   │   ├── ProxyRelay.swift                   # 代理自动认证中继
│   │   ├── ProxyTool.swift / CookieTool.swift # 代理检测 / Cookie 解析
│   │   ├── HTTPServer.swift / LocalAPI.swift  # 本地 HTTP 服务 + 比特浏览器兼容 API
│   │   └── StaticFiles.swift / APIDocs.swift  # 静态资源 / API 文档
│   ├── Web/                 # 界面（WKWebView 加载，也可经本地 API 在浏览器打开）
│   │   ├── index.html / app.css / app.js
│   │   ├── inject.js        # 注入脚本模板（主世界）
│   │   └── detect.html      # 窗口内指纹自检页
│   └── Resources/AppIcon.icns
├── pkg/                     # 安装包资源（welcome/license/conclusion/背景/脚本）
├── tools/make_icon.py       # 图标生成（PIL）
└── dist/                    # 构建产物
```

---

## 6. 开发 / 调试

```bash
# 只编译（快）
swiftc -sdk "$(xcrun --show-sdk-path)" -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit -framework Network -framework CryptoKit \
  -framework Security -framework UniformTypeIdentifiers \
  -o /tmp/veil $(find app/Sources -name '*.swift')

# 在普通浏览器里调试界面（走 HTTP 桥接通道，无需 WKWebView）
open dist/stage/Veil.app        # 先启动应用
open "http://127.0.0.1:54345/"  # 同一套 UI，桥接走 /__veil/bridge
```

界面在浏览器直连模式下与 app 内完全等价（`Bridge.handlePublic` 复用同一套方法分发），便于用 DevTools 调试与截图。

---

## 7. 许可与合规

Veil 用于**合法**的环境隔离、兼容性测试、风控对抗性自查与隐私保护研究。
请勿用于违反目标站点服务条款、欺诈、身份冒用或任何违法活动；后果由使用者自负。
Veil 不收集、不上传任何数据，全部信息保存在本机。
