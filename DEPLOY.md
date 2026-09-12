# Veil — 部署流程规范

> **模板版本**：2026-09-11 · 基于 db-aiops DEPLOY.md 提炼。
> 复制到新项目 → 重命名为 `DEPLOY.md` → 替换 `占位符` → 提交到 git。
>
> 本文件是 AGENTS.md「代码修改安全规则」中部署相关章节的**流程细化**，
> 重点回答"一次部署要怎么走完"。安全底线见 AGENTS.md。

---

## 如何使用本模板

1. 复制本文件 → `<新项目根目录>/DEPLOY.md`
2. 全局替换占位符（详见末尾"占位符清单"）
3. 把"打包/同步/重启/校验"的具体命令按项目实际工具链填写
4. **删除本节**（How to use 仅对模板本身有意义）
5. 提交 `DEPLOY.md` 到 git，与 `AGENTS.md` 同级

> ⚠️ 以下章节为最小可用集合，不要省略：
> - 核心原则
> - 一、开发流程（含 1.1 / 1.2 / 1.3）
> - 二、修改规范（含 2.1 / 2.2 / 2.3）
> - 五、变更记录（CHANGELOG.md 写入约定）
> - 六、测试执行规范

---

## 会话开始检查（强制 — 每次部署前必读）

> **为什么**：任何部署动作都应该归属于某个长任务计划（多会话接力场景），
> 否则后续会话无法回溯"为什么这次部署改了这些文件"。详见 `AGENTS.md` §任务会话交接。

### 部署前的 4 项确认

```bash
# 1. 检查 Obsidian 中本项目是否有进行中的任务
TASK_DIR=~/Documents/Obisidian/LocalProject/Project/nlviews 任务
LATEST=$(ls -t "$TASK_DIR"/*.md 2>/dev/null | grep -v _README | head -1)
echo "最新任务: $LATEST"
```

- [ ] **Obsidian 任务已建立**：本次部署是某个 `20260912_nlviews.md` 任务的延续；若是新任务，先去 `AGENTS.md` §新任务创建流程建立任务计划，**不能直接部署**
- [ ] **任务状态已更新**：任务 §1.2 "最近一次会话信息" 包含本次部署（完成项 / 备份位置 / 下一步）
- [ ] **CHANGELOG 已更新**：自动部署段 `### YYYYMMDD_HHMMSS - 自动部署` 由 `deploy.sh` 自动追加；若是手动修改，需要在任务 §附录 C 变更日志记一笔
- [ ] **任务 §1.4 "已知未解决问题" 已同步**：部署引入的新风险已追加

### 部署后立即补做（会话结束前）

- [ ] 更新任务 §1.1 进度总览（Phase / 任务项的 ✅ / 🟡）
- [ ] 追加本次部署的具体变更到任务 §附录 C 变更日志
- [ ] 若 Phase 完成 → 标 ✅，更新 §1.2 "下一步"
- [ ] 若整个任务完成 → 写总结到变更日志，在 `_README.md` 索引里把状态改为 ✅

---

## 核心原则

**本地代码是唯一真相源（Single Source of Truth）**

所有代码修改必须在本地完成，然后通过部署脚本同步到测试服务器。任何在服务器上的临时修改都必须立即同步回本地。

---

## 一、开发流程

### 1.1 日常开发

```bash
# 1. 确保本地代码是最新
cd /Users/alphaseven/Documents/Codex/nlviews
git status --short                  # git status / svn status / ...

# 2. 在本地修改代码
# 编辑相关源文件

# 3. 本地语法验证
swiftc -parse -sdk $(xcrun --show-sdk-path) app/Sources/main.swift  # 或 ./build.sh 完整编译            # py_compile / tsc --noEmit / go build / ...

# 4. 提交到版本控制
git add -A && git commit -m "type(scope): 变更说明"
```

### 1.2 部署到测试服务器

```bash
# 方式一：一键部署（推荐）
./build.sh        # 本地编译并打包 .app + .pkg                  # ./scripts/deploy.sh / make deploy / ...

# 方式二：仅打包（手动上传）
./build.sh        # 本地编译并打包 .app + .pkg --pack-only      # 或项目自定义的 flag
```

### 1.3 部署后验证

```bash
# 检查服务状态
curl -s -o /dev/null -w "%{http_code}" http://localhost:54345/health

# 查看运行日志
ssh alphaseven@localhost "tail -f /Users/alphaseven/Library/Application Support/Veil/logs/app.log"
```

---

## 二、修改规范

### 2.1 修改前检查清单

- [ ] 先在Obsidian长任务清单中写要接下来要做的事，“开始时间: yyyymmdd hh24:mi” "开始修改/编写内容: "  "完成进度：x%"。 每完成一条必须马上记录。避免会话随时中断后新会话无法接续。
- [ ] 本地和服务器代码是否一致（`echo '(macOS app — 无远程同步；分发靠导出 .pkg 给用户双击安装)'`）
- [ ] 确认要修改的文件清单
- [ ] 记录当前基线版本（dist/*.tar.gz 最近一份 / git tag）

### 2.2 修改后检查清单

- [ ] 本地修改已提交版本控制
- [ ] 已执行部署脚本同步到服务器
- [ ] 已在 `CHANGELOG.md` 追加记录变更（见 §五）
- [ ] 服务验证通过（HTTP 200 / 业务健康检查）
- [ ] 对相关功能做了回归测试（见 §三）

### 2.3 紧急热修复

```bash
# 只有在服务器无法正常运行时才允许直接在服务器上修改
# 修复后必须立即执行：
echo '(macOS app — 无远程同步；分发靠导出 .pkg 给用户双击安装)'              # 检查差异
# 将差异同步回本地并提交版本控制
```

> ⚠️ **强烈不推荐直接改服务器** —— 一旦其它 Agent/会话不知道你在改什么，
> 后续 `git pull` / 部署时会造成冲突甚至覆盖你的修复。
> 如果必须这样，必须在修改后**立刻**走"差异同步回本地 → 提交 → 部署一次同步给所有会话"。

---

## 三、回归测试规范

每次代码修改后必须执行回归测试：

1. **已有测试用例** → 调用对应的回归测试 skill / 跑自动化测试套件
2. **无测试用例** → 用浏览器 / 客户端 / 手动操作验证
3. **验证标准**：
   - 页面 / 入口加载正常（无报错）
   - 所有按钮可点击，功能正常
   - 增删改查操作正常
   - 与修改前行为一致

> 详见 §六「测试执行规范」——"只检查 HTTP 200 就声称验证通过"是禁止行为。

---

## 四、同步检查

部署前后执行同步检查，确保本地和服务器代码一致：

```bash
echo '(macOS app — 无远程同步；分发靠导出 .pkg 给用户双击安装)'              # ./scripts/sync_check.sh / 自研脚本 / rsync --checksum
```

检查范围（按需勾选）：
- [ ] 源文件（`.py` / `.ts` / `.go` / `.rs` / ...）
- [ ] 配置文件（`config.json` / `settings.yaml` / ...）
- [ ] 启动脚本 / systemd unit
- [ ] 静态资源（`static/vendor/` / `assets/` / ...）—— 仅在显式 vendor 时

> ⚠️ **凭据类文件通常不同步**（如 `config.json` 含真实 API key）——
> 本地用占位符，服务端用真实值，必须在部署脚本里显式跳过，详见 AGENTS.md 规则 6。

---

## 五、变更记录

每次修改后必须更新 `CHANGELOG.md`，格式：

```markdown
## [1.0.0] - YYYY-MM-DD

### 新增
- 功能说明

### 修复
- BUG 说明

### 变更
- 变更说明

### 文件修改清单
- path/to/file.pkg - 修改说明
```

补充约定：
- **历史同步**：当从外部笔记（Obsidian / 飞书 / 其它）批量导入历史修复时，
  在 CHANGELOG 顶部插入"历史同步"段并标注来源 + 同步日期 + 备份路径。
- **自动部署段**：每次自动部署由 `scripts/deploy.sh` 在文件末尾追加一段 `### YYYYMMDD_HHMMSS - 自动部署`，
  列出本次推送的文件清单（已存在，不需手写）。
- **禁止删除历史条目**：废弃的包 / 旧版本条目保留，只在条目里注明"已废弃"，并在 CHANGELOG 顶部加交叉引用。

---

## 六、测试执行规范（重要）

### 6.1 测试必须对应具体修改

每项代码修改必须有对应的功能验证，禁止用"页面能打开"代替功能测试。

| 修改类型 | 必须测试的内容 | 测试方法 |
|---------|--------------|---------|
| 数据库 / 数据访问 | 添加/编辑/删除/查询、测试连接、状态显示 | 浏览器 / 客户端完整增删改查 |
| 用户 / 权限 | 添加用户、修改密码、新密码登录 | 浏览器 / 客户端完整登入登出 |
| 配置 / 凭据 | 切换供应商、各 API key 独立、配置回滚 | 浏览器切换配置并提交 |
| 导航 / 菜单 | 展开/收起、点击跳转、二级菜单显示 | 浏览器点击每个菜单项 |
| 业务主流程 | 创建任务、选择数据源、选择模板、查看结果 | 完整操作流程 |
| 异步 / 后台任务 | 启动、进度查看、停止、结果回查 | 完整任务生命周期 |
| 页面布局 | 所有控件位置、大小、间距 | 浏览器截图对比 |

### 6.2 禁止行为清单

- ❌ 只检查 HTTP 200 就声称验证通过
- ❌ 只打开页面看没有报错就声称功能正常
- ❌ 用 curl 调用 API 代替浏览器 / 客户端操作
- ❌ 不测试修改的具体功能，只测试无关功能
- ❌ 测试未完成就推送到远端

### 6.3 测试通过标准

每条修改必须满足以下条件才算测试通过：

1. **功能正确**：修改的功能按预期工作（例如：改密码后能用新密码登录）
2. **无回归**：修改后原有相关功能未受影响
3. **操作完整**：模拟真实用户完整操作流程，非局部点击
4. **结果可查**：测试过程中产生可展示的证据（截图 / 日志 / DB 行数）

### 6.4 测试流程

```bash
# 步骤1：确认本次修改的文件清单
git diff --name-only HEAD                    # git diff --name-only HEAD / ...

# 步骤2：针对每个修改文件，列出受影响的功能
# 例如：models/user.py → 用户登录/密码修改功能

# 步骤3：用浏览器 / 客户端逐项测试
# 步骤4：记录测试结果
# 步骤5：全部通过后才可推送到远端 / 部署到生产
```

---

## 占位符清单

| 占位符 | 含义 | 示例 |
|--------|------|------|
| `nlviews` | 项目短名（小写、连字符，用于 Obsidian 任务目录） | `db-aiops` |
| `Veil` | 项目显示名 | `db-aiops 数据库运维平台` |
| `/Users/alphaseven/Documents/Codex/nlviews` | 本地项目路径 | `/Users/alphaseven/Documents/Codex/db-aiops` |
| `localhost` | 部署目标服务器 IP | `192.168.114.131` |
| `alphaseven` | 部署目标服务器 SSH 用户 | `root` |
| `/Applications/Veil.app` | 服务端部署路径 | `/data/db-aiops` |
| `54345` | 服务端口 | `8501` |
| `/health` | 健康检查 URL 路径 | `/_stcore/health` |
| `/Users/alphaseven/Library/Application Support/Veil/logs/app.log` | 服务端日志路径 | `/data/db-aiops/logs/app.log` |
| `git status --short` | 查看本地工作区状态 | `git status --short` |
| `git add -A` | 把变更加入暂存 | `git add -A` |
| `git commit` | 提交 | `git commit` |
| `git diff --name-only HEAD` | 查看变更文件 | `git diff --name-only HEAD` |
| `swiftc -parse -sdk $(xcrun --show-sdk-path) app/Sources/main.swift  # 或 ./build.sh 完整编译` | 语法检查 | `python3 -m py_compile $(find . -name '*.py' -not -path './venv/*')` |
| `./build.sh        # 本地编译并打包 .app + .pkg` | 一键部署 | `./scripts/deploy.sh` |
| `echo '(macOS app — 无远程同步；分发靠导出 .pkg 给用户双击安装)'` | 本地-服务端同步检查 | `./scripts/sync_check.sh` |

---

## 变更记录

| 日期 | 版本 | 变更说明 |
|------|------|----------|
| 2026-09-12 | 0.2.0 | 新增「会话开始检查（强制）」章节 + 占位符清单加 `nlviews` |
| 2026-09-11 | 0.1.0 | 初版模板，从 db-aiops DEPLOY.md 提炼并泛化 |
