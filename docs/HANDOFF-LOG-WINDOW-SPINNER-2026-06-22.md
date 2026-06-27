# 日志窗口转圈复发交接

> 历史上下文：这份交接写于 console SPA 合并之前，文中的 `src/printLog.js`、`src/softwareLog.js`、`printLog.html`、`softwareLog.html` 等路径是当时入口。当前运行时真源见 `docs/refactor/console-spa-parity.md`：日志页由 `console.html#/print-log` 与 `console.html#/software-log` 承载。

## 交接状态

状态：未修复，不能关单。

这份文档只做交接，不代表问题已经解决。本次没有继续做生产代码修复，因为当前关键问题不是缺一个局部 UI 补丁，而是前一次修复的验收边界没有覆盖用户真实看到的路径。

当前结论：

- “软件日志 / 打印记录”窗口再次停在 `loading.html` 四点转圈，属于同一类问题第二次复发。
- 之前确实有过相关提交，但那次提交证明的是 repo 内受控 Electron 窗口能移除 loading overlay，不等于安装后的客户端通过托盘打开真实可见窗口也正常。
- 最近的 `75b6065 Preserve early startup logs for upgrade smoke` 不是转圈修复，它修的是启动早期日志写入 SQLite 的时序问题，不能拿来当本问题闭环。
- 下一轮必须先补安装态观测和验收，不允许再用 repo-only smoke 作为最终修复证据。

## 当前基线

2026-06-22 17:00 左右重新核对到的状态：

- 当前工作区：`E:\Source_code\electron-hiprint`
- 当前本地分支：`master`
- 当前本地 HEAD：`5e11504 Restore Electron runtime for release smoke`
- 当前远端 HEAD：`f42d8dc chore(release): client 1.0.89 (code change, patch)`
- 本地 `master` 落后 `origin/master` 1 个自动版本提交。
- 本地 `package.json`：`1.0.88`
- 最新 tag：`1.0.89`
- 本机安装态 `%LOCALAPPDATA%\Programs\hiprint\resources\app.asar`：`1.0.80`
- 本机 SQLite：`C:\Users\12180\AppData\Roaming\electron-hiprint\database.sqlite`
- SQLite 当前体量：`software_logs` 208 行 / 8543 字符 / 单条最长 140 字符；`print_logs` 4 行 / `data` 总量 224622 字符 / 单条最长 75078 字符。
- GitHub Release Build `27940866586` / tag `1.0.89` 已通过，Windows x64 的 `验证 packaged 主进程启动日志落库` 和 `验证在线升级安装后可重启` 都为绿色；Release 资产已发布。这个 CI 结果只说明 packaged startup / online-upgrade 链路已闭环，仍不能证明日志窗口 spinner 已修复。

这个版本错位非常重要：如果截图来自安装态 `1.0.80`，而我们只验证本地 `1.0.88`、远端 tag `1.0.89` 或 repo 内 Electron，就会再次误判。下一位接手前必须先确认正在操作的是哪个 exe、哪个 app.asar、哪个进程实例。后续版本变化时也一样：截图和真实用户操作必须对应同一个安装态 exe，而不能用任意 repo HEAD 或远端 tag 替代。

当前工作区有交接文档改动：

- `docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md`：本交接文档。
- `docs/HANDOFF-RELEASE-BUILD-CI-2026-06-22.md`：Release Build 调查交接，可能仍需按最新 1.0.89 成功结果继续整理。

## 为什么之前 commit 过还会复发

之前确实有提交处理过 loading overlay，但完成标准错了。

| 提交 | 做了什么 | 为什么还不够 |
| --- | --- | --- |
| `50362a7 Prevent loading overlays from lingering` | 抽出 `src/loading-view.js`，让 `main.js`、`src/set.js`、`src/printLog.js`、`src/softwareLog.js` 共享 loading overlay teardown；新增 `tools/repro/runtime/loading-view-lifecycle-check.js`。 | 这个 smoke 使用 repo assets、mock IPC、隐藏测试窗口，只能证明受控窗口里的 `attachLoadingView()` 可以移除 overlay，不能证明安装态客户端、托盘入口、真实可见窗口正常。 |
| `8e1d120 Stabilize log windows around real SQLite read paths` | 把日志窗口 IPC 注册提前到 `loadURL` 前，并补了窗口加载打点和 SQLite/read-path 检查。 | 它增强了页面加载和数据路径可观测性，但没有断言 loading `WebContentsView` 在真实可见窗口上已经消失。 |
| `c9e40a5 fix: app:// 大文档改 net.fetch 流式伺服，消除日志窗口加载卡顿` | 改 `app://` 文档服务为 `net.fetch`，并新增可见窗口截图 repro。 | 该截图脚本仍跑 repo 内 Electron + mock IPC，不是用户安装态 exe 的托盘入口。 |
| `288fd96 chore(docs): remove stale AI-analysis and handoff docs` | 删除了旧的 `docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-14.md`。 | 旧交接里“缺少安装态验证”的警告被删除，导致后续容易重复同一个验收边界错误。 |
| `051949a Record why log-window spinner verification was incomplete` | 记录了本问题为什么未闭环。 | 文档提交没有改变运行逻辑，不能当作修复。 |
| `75b6065 Preserve early startup logs for upgrade smoke` | 解决早期启动日志在 SQLite schema ready 前写入失败的问题，并加了 packaged main startup smoke。 | 它属于在线升级 / 启动日志链路，不触碰 `src/loading-view.js` 的 overlay 可见性，也没有安装态托盘打开日志窗口的断言。 |
| `e61386f Keep upgrade smoke independent of npx electron` | 让 release smoke 不再依赖 `npx electron`。 | 仍然是 workflow 执行层修复，不验证软件日志 / 打印记录可见窗口。 |
| `e783292 Restore Electron path metadata for release smoke` | 尝试在 CI 中恢复 Electron `path.txt` 元数据。 | 仍然是 packaged startup smoke 修复方向；`1.0.88` Windows x64 仍失败，且该链路没有覆盖 spinner 可见性。 |
| `5e11504 Restore Electron runtime for release smoke` | 给 release smoke runner 增加 Electron artifact 兜底恢复，`1.0.89` 已通过 packaged startup 和在线升级重启验证。 | 这是 workflow/runtime smoke 修复，证明在线升级链路已恢复；它仍没有打开安装态的软件日志/打印记录窗口，也没有证明 spinner 消失。 |

因此，“之前已经 commit 过”不等于“已经修好”。上一次 commit 覆盖的是共享 helper 和仓库级 smoke，缺少安装态、托盘入口、真实可见窗口、SQLite overlay teardown 这些最终验收证据。

## 这次为什么仍然没有修好

这次需要明确承认：本轮没有完成 spinner 的生产修复，也没有验证安装态可见窗口。

实际推进被在线升级和 SQLite 启动日志问题打断。最近连续提交 `75b6065`、`e61386f`、`e783292`、`5e11504` 的目标都是让 GitHub Release Build 能在 packaged startup / online-upgrade 链路里看到主进程早期启动日志，并验证安装后可重启。这个问题和日志窗口转圈共享 SQLite 观察面，但不共享根因。把这些提交当成 spinner 修复，会再次重复“修了旁路、没验真实窗口”的错误。

截至 tag `1.0.89`，Windows x64 release job 已经通过 `验证 packaged 主进程启动日志落库` 和 `验证在线升级安装后可重启`。这只关闭在线升级 / packaged startup 链路，不能自动证明日志窗口 spinner 已修复。spinner 的完成标准必须是安装态打开软件日志 / 打印记录并证明可见内容替代了 `loading.html`。

当前 spinner 问题还缺两个关键证据：

- `src/loading-view.js` 没有把 overlay remove 的触发原因、窗口标签和 remove/destroy 结果写入 SQLite。
- 没有从安装后的 `%LOCALAPPDATA%\Programs\hiprint\hiprint.exe` 走托盘或等价生产入口打开“软件日志 / 打印记录”，并用截图或 DOM/text 断言证明 spinner 已消失。

## 已确认事实

用户截图里两个 `electron-hiprint` 窗口都停在四点 spinner。这个现象可能是页面没有渲染，也可能是页面已经渲染但被上层 loading `WebContentsView` 覆盖。

当前证据更支持第二种风险必须优先排查：

- 之前 repo 级 smoke 曾证明 `printLog.html` 和 `softwareLog.html` 可以通过 `app://bundle` 加载，preload bridge 也存在。
- 本机 SQLite 里有安装态窗口生命周期日志，说明目标页面至少触发过加载事件。
- SQLite 体量不支持“日志太大导致长期转圈”这个判断：软件日志只有 206 行，打印记录只有 4 行，最大打印 payload 约 75KB。

本机 SQLite 最近相关记录：

```text
2026-06-22 13:06:24 软件日志窗口：dom-ready 2735ms
2026-06-22 13:06:24 软件日志窗口：did-finish-load 2738ms
2026-06-22 13:06:27 打印记录窗口：dom-ready 1585ms
2026-06-22 13:06:27 打印记录窗口：did-finish-load 1588ms
```

这只证明目标页面生命周期触发过，仍不能证明 loading `WebContentsView` 已经从真实可见窗口移除。当前代码没有记录 overlay remove 的原因、结果、窗口标签，也没有安装态截图或 DOM/text 断言。

## 当前代码边界

loading overlay 的拥有者是 `src/loading-view.js`。

当前 `attachLoadingView(targetWindow, windowOptions, loadingUrl)` 行为：

- 创建 `WebContentsView` 加载 `loading.html`。
- 将 loading view 添加到 `targetWindow.contentView`。
- 在目标窗口 `dom-ready`、`did-finish-load`、`did-fail-load`、窗口 `closed`、loading 页面加载失败时调用同一个 `removeLoadingView()`。
- `removeLoadingView()` 执行 `targetWindow.contentView.removeChildView(loadingContentView)`，然后销毁 loading webContents。
- 返回 `{ view, remove, isRemoved }`。

当前缺口：

- `removeLoadingView()` 不接收触发原因。
- 没有窗口标签，例如 `softwareLog` / `printLog` / `set` / `index`。
- 没有记录 `removeChildView()` 和 `destroy()` 的结果。
- 没有把 overlay teardown 写入 SQLite-backed 软件日志。
- 安装态 workflow 没有证明真实窗口内容已经显示。

不要通过固定 3s / 5s timeout 强行隐藏 overlay。那会掩盖真正的 `app://` 加载失败、renderer 崩溃、preload 缺失、同步 IPC 卡死或旧进程误导。

## 系统理解报告

Problem:

- 软件日志和打印记录窗口再次只显示 loading spinner，前一次 overlay 修复没有挡住复发。

System boundary:

- Electron 主进程窗口创建、`app://` asset protocol、`WebContentsView` loading overlay、托盘入口、安装态 exe、SQLite-backed 软件日志。

Primary owner role:

- `frontend` 负责窗口可见行为和 overlay 生命周期。
- `qa` 必须拥有安装态 smoke 和截图 / DOM 断言。
- `ops` 必须拥有 release workflow 中 installed-artifact 验证。
- `reviewer` 需要检查是否仍是 repo-only 验收。
- `security` 当前无新增安全边界，但需确认测试开关不能改变普通用户行为、不能暴露额外 IPC。

Entry points:

- `main.js` 托盘菜单：`softwareLogSetup()` / `printLogSetup()`。
- `src/softwareLog.js`
- `src/printLog.js`
- `src/loading-view.js`

Call flow:

```text
用户托盘点击软件日志/打印记录
-> main.js 托盘 click handler
-> softwareLogSetup() / printLogSetup()
-> BrowserWindow 创建
-> attachLoadingView() 添加 loading WebContentsView
-> loadURL(app://bundle/softwareLog.html 或 printLog.html)
-> 目标 webContents dom-ready / did-finish-load
-> removeLoadingView()
-> 用户应该看到真实页面内容
```

State model and invariants:

- 每个业务窗口最多有一个 loading overlay。
- 目标窗口进入 `dom-ready` 或 `did-finish-load` 后，overlay 必须被移除或留下明确失败日志。
- overlay 移除必须可观测，且能按窗口标签追踪。
- 安装态验证必须确认当前 exe / app.asar / 进程实例一致。

Chosen root-cause direction:

- 当前不是已经证明的页面渲染失败，也不是日志体量过大。
- 更可信的未闭环根因是：overlay 生命周期只在 repo 受控环境被验证，未在安装态托盘入口和真实可见窗口上验证；同时缺少 overlay teardown 日志，导致复发时无法判断 overlay 是否真的移除。

Precision modification scope for next turn:

- 只改 `src/loading-view.js` 及调用它的窗口入口，增加窗口标签、触发原因和 teardown 结果日志。
- 只增加测试专用生产入口或 installed-artifact smoke，不改变普通用户行为。
- 不改日志 UI 样式，不加固定 timeout，不用吞错或静默失败掩盖问题。

## 下一步必须做

1. 先对齐安装态版本和进程。

   ```powershell
   Get-Process hiprint -ErrorAction SilentlyContinue | Select-Object Id,Path,StartTime
   node -e "const asar=require('@electron/asar'); const p=process.env.LOCALAPPDATA+'\\Programs\\hiprint\\resources\\app.asar'; const pkg=JSON.parse(asar.extractFile(p,'package.json').toString()); console.log(JSON.stringify({version:pkg.version,path:p},null,2));"
   ```

2. 给 `attachLoadingView()` 增加可观测性。

   建议接口：

   ```js
   attachLoadingView(win, opts, url, { label: "softwareLog" });
   ```

   必须记录到 SQLite-backed 软件日志：

   - label：`softwareLog` / `printLog` / `set` / `index`
   - cause：`dom-ready` / `did-finish-load` / `did-fail-load` / `closed` / loading page failure
   - alreadyRemoved
   - removeChildView ok/fail
   - destroy ok/fail
   - target URL 和 loading URL

3. 补安装态验证。

   不能只跑：

   ```powershell
   npx electron tools/repro/runtime/loading-view-lifecycle-check.js
   npx electron tools/repro/runtime/log-window-visible-capture.js
   ```

   必须启动安装后的 exe：

   ```powershell
   $exe = "$env:LOCALAPPDATA\Programs\hiprint\hiprint.exe"
   Start-Process $exe
   ```

   然后通过生产路径打开软件日志和打印记录。如果真实托盘自动化不稳定，可以增加只用于测试的诊断开关，例如 `HIPRINT_E2E_OPEN_LOG_WINDOWS=1`，在 app ready 后调用同一套 `softwareLogSetup()` / `printLogSetup()`。这个开关不能改变普通用户行为。

4. 断言真实可见结果。

   安装态 smoke 至少要证明：

   - 软件日志窗口显示“软件日志”页面内容，不是只有 spinner。
   - 打印记录窗口显示“打印记录”页面内容，不是只有 spinner。
   - SQLite 中两个窗口都有页面生命周期日志。
   - SQLite 中两个窗口都有 overlay teardown 日志。
   - 没有 `did-fail-load`、`render-process-gone`、preload bridge missing。

5. 接入 GitHub Release Build。

   只有本地安装态 smoke 稳定后，才能把同一条 installed-artifact smoke 接到 Windows release workflow。repo 内 Electron smoke 只能保留为辅助检查。

## 可复用命令

确认工作区和远端版本：

```powershell
git status --short --branch
git log --oneline --decorate --max-count=8 --all
git tag --sort=-creatordate | Select-Object -First 8
```

确认安装态版本：

```powershell
node -e "const asar=require('@electron/asar'); const p=process.env.LOCALAPPDATA+'\\Programs\\hiprint\\resources\\app.asar'; const pkg=JSON.parse(asar.extractFile(p,'package.json').toString()); console.log(JSON.stringify({version:pkg.version,path:p},null,2));"
```

查询 SQLite 窗口生命周期和 overlay 日志：

```powershell
node -e "const sqlite3=require('sqlite3').verbose(); const db=new sqlite3.Database(process.env.APPDATA+'\\electron-hiprint\\database.sqlite'); db.all(\"SELECT id,ts,level,msg FROM software_logs WHERE msg LIKE '%overlay%' OR msg LIKE '%加载%' OR msg LIKE '%软件日志窗口：%' OR msg LIKE '%打印记录窗口：%' ORDER BY id DESC LIMIT 80\", [], (e,r)=>{ if(e) throw e; console.log(JSON.stringify(r,null,2)); db.close(); });"
```

查询 SQLite 体量：

```powershell
node -e "const sqlite3=require('sqlite3').verbose(); const db=new sqlite3.Database(process.env.APPDATA+'\\electron-hiprint\\database.sqlite'); db.serialize(()=>{ db.get(\"SELECT COUNT(*) rows, COALESCE(SUM(LENGTH(msg)),0) chars, COALESCE(MAX(LENGTH(msg)),0) max_msg FROM software_logs\", [], (e,r)=>console.log(JSON.stringify({table:'software_logs',...r},null,2))); db.get(\"SELECT COUNT(*) rows, COALESCE(SUM(LENGTH(data)),0) chars, COALESCE(MAX(LENGTH(data)),0) max_payload FROM print_logs\", [], (e,r)=>{ console.log(JSON.stringify({table:'print_logs',...r},null,2)); db.close(); }); });"
```

现有 repo 级检查：

```powershell
npx electron tools/repro/runtime/loading-view-lifecycle-check.js
npx electron tools/repro/runtime/log-window-visible-capture.js
node tools/repro/runtime/tray-log-window-contract-check.js
```

注意：这些检查只能作为辅助证据，不能单独关闭这个 bug。

## 完成标准

必须全部满足，才能说转圈问题修好：

- 清理或枚举旧进程，并确认截图、exe、app.asar 版本一致。
- 验证对象是安装态 `%LOCALAPPDATA%\Programs\hiprint\hiprint.exe`，不是只验证 repo 内 Electron。
- 通过托盘路径或等价测试专用生产入口打开软件日志和打印记录。
- 截图或 DOM/text 断言证明两个可见窗口都不是 `loading.html` spinner。
- SQLite 中有两个窗口的 `dom-ready` / `did-finish-load`。
- SQLite 中有两个窗口的 overlay teardown 记录。
- CI / release workflow 有 Windows installed-artifact smoke 覆盖同一路径或等价生产入口。

不满足这些条件时，任何 `loading-view-lifecycle-check.js passed`、`log-window-visible-capture.js produced screenshots`、`tray-log-window-contract-check observed 0` 都只能算辅助证据。

## 给下一位 Agent 的提示词

```text
继续处理 electron-hiprint 的软件日志/打印记录窗口转圈复发。先读 docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md、src/loading-view.js、src/softwareLog.js、src/printLog.js、tools/repro/runtime/loading-view-lifecycle-check.js、tools/repro/runtime/log-window-visible-capture.js。这个问题已经复发两次，不能加固定 timeout，不能只跑 repo-only smoke。上一轮修复只证明共享 helper 在受控 Electron 窗口里能移除 overlay，没有证明安装态托盘入口。请先给 src/loading-view.js 增加带窗口标签、触发原因和 teardown 结果的 SQLite 日志，然后补安装态 smoke：启动 %LOCALAPPDATA%\Programs\hiprint\hiprint.exe，通过真实托盘路径或测试专用生产入口打开软件日志/打印记录，截图或检查 DOM/text，断言可见内容和 SQLite overlay removed 日志。通过后再接入 GitHub Release Build 的 Windows installed-artifact 验证。repo 级 smoke 不能作为最终完成标准。
```
