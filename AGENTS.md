# Veil — Agent 开发指南

> **模板版本**：2026-09-11 · 基于 db-aiops AGENTS.md 提炼。
> 复制到新项目 → 重命名为 `AGENTS.md` → 替换 `占位符` → 提交到 git。

---

> ⚠️ 以下章节为最小可用集合，不要省略：
> - 代码修改安全规则
> - 打包命名规范
> - 回退标准流程
> - 备份与回退历史快照
> - 项目特定约定（至少包含"关键约定"）

---

## 任务会话交接（强制 — 任何 Codex agent 接到新任务时的第一动作）

> **为什么**：开发过程中长任务可能跨多个会话（数天 / 数周 / 数月）。
> 多个会话接力干活时，Obsidian 中的任务计划是**唯一上下文交接通道**。
> 不先检查 Obsidian = 重新造轮子 / 重复已完成工作 / 丢失关键决策。

### 步骤 0：每次会话开始必做

```bash
# 检查 Obsidian 中本项目是否有未完成的任务计划
# 把 nlviews 替换为项目短名后再执行
TASK_DIR=~/Documents/Obisidian/LocalProject/Project/nlviews 任务
ls -lt "$TASK_DIR" 2>/dev/null | head
cat "$TASK_DIR/_README.md" 2>/dev/null   # 索引文件（如已建立）
```

### 步骤 1：根据检查结果决定本次会话动作

| Obsidian 检查结果 | 本次会话动作 |
|------------------|------------|
| 有未完成的任务计划（§1.1 有 🟡 / ⛔） | **继续未完成的任务**。打开最新任务文件，读 §1 "任务交接状态" 中的"最近一次会话信息"和"下一步"，从断点继续 |
| 有未完成任务，但本次用户给了新任务 | **优先完成未完成项**；或先和用户确认优先级（避免任务切碎丢失上下文） |
| 无任务计划，但用户给了新任务 | **先创建任务计划**到 Obsidian（见下文"新任务创建流程"），再开始改代码 |
| 无任务计划也无新任务 | 等待用户输入 |

### 新任务创建流程

1. **复制模板**到 Obsidian 任务目录（占位符替换后再执行）：

   ```bash
   TASK_DIR=~/Documents/Obisidian/LocalProject/Project/nlviews 任务
   mkdir -p "$TASK_DIR"
   # 优先用项目内的 DEVELOPMENT_PLAN.md（允许项目定制）；
   # 首次 bootstrap 后会生成在项目根目录。
   cp ./DEVELOPMENT_PLAN.md \
      "$TASK_DIR/20260912_nlviews.md"
   ```

2. **至少填写**以下章节（其它章节可后续补）：

   - §0 TL;DR（5 个维度表格 + 一句话文字版）
   - §1.1 进度总览（哪怕只有 Phase 1）
   - §1.2 "最近一次会话信息"（本次会话基本信息）
   - §3 业务现象（用户报的 bug / 需求）
   - §5 实施步骤（拆 Phase）

3. **在 `_README.md` 索引追加一行**：

   ```markdown
   | 2026-09-12 | ✅ 项目初始化 | [链接](20260912_nlviews.md) |
   ```

4. **再开始改代码** —— 没有任务计划的"边写边想"是禁止工作模式。

### 已有任务更新流程（每次会话结束前必做）

1. 更新任务的 §1.1 进度总览（✅ / 🟡 / ⛔ / ⏳）
2. 更新 §1.2 最近一次会话信息（日期、完成项、下一步、阻塞、备份位置）
3. 关键决策 → 追加到 §1.3
4. 解决的问题 → 从 §1.4 移到任务文件末尾的"变更日志"
5. 任务完全完成时：
   - 在 §1.1 标"✅ 完成"
   - 写一段总结到变更日志
   - 把任务文件从 `_active/` 移到 `_archive/`（如有归档约定），或直接在 `_README.md` 索引里把状态改为 ✅

### Obsidian 目录约定

```
~/Documents/Obisidian/LocalProject/Project/
├── nlviews 修复记录.md          ← 已有，单文件，修复日志
└── nlviews 任务/                ← 强制约定（本规则）
    ├── _README.md                       ← 索引：所有任务当前状态
    └── 20260912_nlviews.md       ← 单个任务，从项目根目录的 DEVELOPMENT_PLAN.md 复制
```

> ⚠️ **即使是"小到 30 分钟"的临时任务，也要走这个流程** ——
> 你不知道它会不会变成跨周长任务。没有任务计划就动手写代码 = 赌博。

---

## 项目结构

<!-- TODO: 按实际目录填写后删除本注释 -->

```
nlviews/
├── app/Sources/main.swift              # 主入口文件
├── ...                       # 业务目录
└── ...
```

---

## 代码修改安全规则（强制）

> 任何 Agent 在本项目修改代码时必须遵守。这是从 db-aiops 历次教训中固化的规则。

1. **禁止删除文件** —— 不论是用户列出的、项目里原有、还是其它会话新增的文件，都不能以任何方式删除。任何"清理"工作必须以"先备份原文件，再修改内容"实现。
2. **修改代码前必须先备份** —— 任何对源码的修改之前，先把被改动的文件（或整个项目目录）做一份快照备份。
3. **备份路径禁用 `/tmp`** —— `/tmp` 在 macOS / Linux 系统重启、磁盘清理时可能被清除；项目级备份必须放在：
   - 长期存档：`~/Documents/Codex/nlviews-backups/<YYYYMMDD_HHMMSS-staged-task>/`
   - 每次回退/修复/部署前，建一个 `YYYYMMDD_HHMMSS-<short-name>/` 子目录
4. **撤回/回退优先用 `dist/*.tar.gz` 而不是 `git checkout HEAD`** —— 因为 git HEAD 之前的 uncommitted changes 可能属于其它会话的工作；盲目 `git checkout HEAD` 会一并回退别人代码。正确步骤见后文。
5. **修改后必须本地校验**：
   - Python：`python3 -m py_compile $(find . -name '*.py' -not -path './venv/*' -not -path './.venv/*')` 不报错
   - TypeScript / Node：`npx tsc --noEmit` 或 `npm run build`
   - Go：`go build ./...` 或 `go vet ./...`
   - Rust：`cargo check`
   - 其它语言：使用对应语法检查
   - 关键模块 `import` / `require` 通过
   - 修改的代码涉及 emoji / icon / 文本时，本地渲染分支模拟一次（mock 框架验证代码路径不会抛 NameError / UnboundLocalError）
6. **部署前 MD5 一致**：计算本地修改文件的 MD5，与服务端 `/Applications/Veil.app` 对照，不一致则禁止推送。
7. **部署后服务端健康验证**：同步后必须重启服务进程，并确认：
   - `ps -ef | grep 'app/Sources/main.swift'` 有活跃进程
   - `curl -s http://127.0.0.1:54345/<health-path>` 返回 `ok`
   - 日志路径无 ERROR/Traceback
8. **不能 `git rm` 或 `rm` 已 tracked 文件** —— 即使某些文件在 git 中显示 D 状态，回退时用 `git checkout HEAD -- <file>` 恢复，不要删除。
9. **服务进程 PATH 问题**：部署脚本里如用 `nohup xxx run` 但 PATH 不全，应用全路径启动：
   ```bash
   cd /Applications/Veil.app && nohup <full-runner-path> run app/Sources/main.swift --port 54345 > logs/app.log 2>&1 &
   ```
10. **完成代码变更后要更新文档 / 关系图谱**（如项目维护 graph、docs/ 等）。

---

## 打包命名规范（强制）

`dist/` 下所有代码包统一命名：

```
nlviews_20260912_0141.tar.gz      例: nlviews_20260825_2017.tar.gz
```

- 日期时间**精确到分钟**；
- 同一分钟已存在同名包（罕见）时降级为秒级 `nlviews_YYYYMMDD_HHMMSS.tar.gz`，绝不覆盖已有包；
- 打包脚本与 `scripts/deploy.sh` 均按此规则自动生成，禁止手工另造格式（如 `-update-` / `-fix-` 等历史杂散前缀一律废弃）；
- 禁止删除历史包（含错误包）；确需标记废弃时在 CHANGELOG 注明，保留文件本身。

---

## 回退标准流程（推荐）

```bash
# 1. 先看 git reflog 和 git status --short，确认问题边界
git reflog | head
git status --short

# 2. 找最近一次部署包（比 git HEAD 时间略早，但通常保留其它会话工作）
ls -lt dist/nlviews_*.tar.gz | head

# 3. 解压那个 tar 到临时目录
mkdir -p /tmp/dist-extract
tar -xzf dist/nlviews_<YYYYMMDD_HHMM>.tar.gz -C /tmp/dist-extract/

# 4. 对每个修改文件对比 backup-vs-HEAD，区分：
#    - 是你自己做的（可以单独回退）
#    - 是其它会话的工作（回退会让别人被打回原形）

# 5. 用 rsync 从 tar 中恢复被 git checkout 误删的他人代码：
rsync -av /tmp/dist-extract/ /Applications/Veil.app/     --exclude=新保留文件 --exclude=venv等
```

---

## 备份与回退历史快照

所有回退/修复动作的关键状态已备份到 `~/Documents/Codex/nlviews-backups/`，每次"修改代码"前都建一个子目录 `YYYYMMDD_HHMMSS-<staged-task>`。需要从任一历史状态恢复，运行：

```bash
SNAP=~/Documents/Codex/nlviews-backups/<YYYYMMDD_HHMMSS-staged-task>
# 查看备份内容
ls "$SNAP"
# 恢复单个文件
cp "$SNAP/AGENTS.md" ./AGENTS.md
```

---

## 项目特定约定

<!-- TODO: 按项目实际情况填写后删除本注释 -->
<!-- 本节由 bootstrap-project-docs skill 按 PROJECT_KIND 注入命名提示,栈无关 -->
<!-- 切勿在子项里硬写单一语言示例(如 st.rerun / @st.dialog) —— 那是上一代模板残留 -->

### 关键约定

> 本节是项目级「风格宪法」,**所有 Codex agent 改代码前必读**。
> 至少填 3-5 条;每条聚焦「不遵守会出 bug / 风格冲突」的具体点。
> 命名细则参考下方由 bootstrap 自动注入的「macos-app 命名约定」提示块(每次 bootstrap 按项目类型重写)。

<!-- BEGIN: 自动注入区 —— 由 bootstrap-project-docs skill 按 PROJECT_KIND 替换,不要手填 -->
**Swift / Apple 栈**:
- 类型 / 类 / 协议:PascalCase(`VeilProfile`、`BrowserSession`、`NSCopyable`)
- 方法 / 属性 / 变量:camelCase(`openWindow`、`debugPort`、`userAgent`)
- 常量:`static let`(实例)/ `enum Constants`(命名空间),camelCase 而非 C 风格全大写
- 枚举 case:camelCase(`case .northAmerica`,**不要** `.NorthAmerica`)
- 协议名描述能力(`Equatable` / `Codable` / `Bridgeable`),不描述类型
- 文件名:类型用类型名(`BrowserSession.swift`),扩展按职责(`BrowserSession+CDP.swift`)
- 入口:`main.swift`(顶层脚本) / `AppDelegate.swift`(macOS app) / `@main struct`(SwiftPM CLI)
- 命名细则遵循 [Apple API Design Guidelines](https://www.swift.org/documentation/api-design-guidelines/)
<!-- END: 自动注入区 -->

1. **入口/路由/页面命名规范** — 例:view 用 `render_X()`、handler 用 `handle_X()`、route 用 `<verb>-<noun>`。**禁止**在调用方混用同义词(如同时存在 `add / fetch / save / find`)。
2. **变更后刷新机制** — UI / 缓存数据变更后必须显式触发刷新;具体方式按你的栈(`router.refresh()` / `invalidateQueries()` / `@Published` / `NSNotification` / signal / `redirect()`)。
3. **数据模型 / 实体方法名规范** — CRUD 统一用 `create / get / update / delete / list / get_stats`,**禁止**混用 `add / fetch / save / find` 等同义词。
4. **返回值约定** — `create()` 返回新建对象?`(id, instance)`?仅 `id`?统一一种并在所有调用处保持一致。
5. **编辑 / 对话框规范** — 模态编辑用标准对话框组件(MUI `<Dialog>` / shadcn `<Dialog>` / SwiftUI `.sheet` / 抽屉 / 独立窗口);**禁止**行内编辑后立即保存。
6. **全局状态 / Key 前缀** — 命名空间隔离(如 `add_<entity>` / `edit_<entity>` / `del_<entity>`),避免模块间冲突。
7. **日志统一接口** — 走项目封装的 logger(`<module>.get_logger()` / `os_log` / `Logger(category:)`);**禁止**直接 `print` / `console.log` / `NSLog`。

### 日志系统

- 文件日志:`/Users/alphaseven/Library/Application Support/Veil/logs/app.log`(轮转策略 / 保留周期)
- DB 日志:表名(保留周期,如不适用写 N/A)
- 定时清理:cron / APScheduler / systemd-timer / launchd / N/A
- WEB / GUI 查看入口:路径或菜单项(如不适用写 N/A)
- 结构化字段:trace_id / user_id / session_id 是否写入?(如不适用写 N/A)

### 回归测试

> 跨语言工具速查(按你的栈选):
> - **Swift / macOS**:XCTest / Swift Testing / swift-snapshot-testing
> - **Node / TS**:Jest / Vitest / node:test / Playwright
> - **Python**:pytest / unittest / Playwright
> - **Go / Rust**:`go test` / `cargo test`
> - **Web E2E**:Playwright / Cypress / Puppeteer
> - **桌面 GUI**:XCTest UI / XCUITest / WinAppDriver

- 工具:
- 覆盖范围:核心入口、主流程、关键 CRUD
- 测试脚本位置:
- 触发方式:手动 / CI / pre-deploy hook

### 图标 / 样式系统(如有前端 / GUI)

- 风格:lucide / Tabler / SF Symbols / Material Symbols / 自研 / N/A
- 文件位置:`<path>`(是否 vendored / 离线打包?)
- 别名表:单一真相源位置(避免同一个 icon 有多个文件名)
- 离线部署要求:CDN vs 本地 bundled

### 部署与服务

- 部署目标:`/Applications/Veil.app`
- 启动命令:
  ```bash
  # macOS app / iOS app:open 即可
  open /Applications/Veil.app
  # SwiftPM CLI / 后端服务:
  cd /Applications/Veil.app && nohup <full-runner-path> run app/Sources/main.swift --port 54345 > logs/app.log 2>&1 &
  ```
- 健康检查:`curl http://127.0.0.1:54345/health`(若项目无 HTTP 服务,N/A)
- 制品格式:.app / .pkg / .dmg / 单二进制 / Docker 镜像 / wheel / npm 包 / cargo crate / ...
- 回滚到上一版本:见「回退标准流程」

### 第三方依赖

> **新增外部依赖前必须先在本节追加,再开始改代码。**(避免未声明的隐式依赖)

- 数据库:MySQL / PG / SQLite / Realm / Core Data / N/A
- 缓存:Redis / Memcached / N/A
- LLM / AI:<provider> / N/A
- 浏览器内核 / 运行时:本机 Chrome / WKWebView / electron / WebView2 / N/A
- 其它:

---

## 占位符清单

| 占位符 | 含义 | 示例 |
|--------|------|------|
| `nlviews` | 项目短名（小写、连字符） | `db-aiops` |
| `Veil` | 项目显示名 | `db-aiops 数据库运维平台` |
| `/Applications/Veil.app` | 部署目标路径 | `/data/db-aiops` |
| `app/Sources/main.swift` | 主入口文件名 | `app.py` |
| `54345` | 服务端口 | `8501` |
| `<health-path>` | 健康检查 URL 路径 | `/_stcore/health` |
| `<full-runner-path>` | 启动器全路径 | `venv/bin/streamlit` |

---

## 变更记录

| 日期 | 版本 | 变更说明 |
|------|------|----------|
| 2026-09-12 | 0.2.0 | 新增「任务会话交接（强制）」章节，强制 Codex agent 动手前先检查 Obsidian 任务列表 |
| 2026-09-11 | 0.1.0 | 初版模板，从 db-aiops AGENTS.md 提炼并泛化 |
