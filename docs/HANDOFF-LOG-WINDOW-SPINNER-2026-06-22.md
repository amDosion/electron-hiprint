# 日志窗口转圈问题交接

## 交接状态

状态：未修复，不能关单。

本轮只能确认：问题不是一个已经被验证闭环的简单 UI bug。之前确实提交过 loading overlay 修复，但验收只覆盖了 repo 内 Electron / mock IPC / 受控窗口，没有覆盖用户真正运行的安装态客户端、托盘入口、可见窗口和 SQLite 中的 overlay teardown 证据。

2026-06-22 本轮同步 `1.0.82` 自动版本提交后，重新核对到的基线状态：

- 仓库基线：`fe57050 chore(release): client 1.0.82 (code change, patch)`
- 仓库 `package.json`：`1.0.82`
- 本机安装态 `%LOCALAPPDATA%\Programs\hiprint\resources\app.asar`：`1.0.80`
- 本机 SQLite：`software_logs` 199 行 / 8138 字符 / 单条最长 140 字符；`print_logs` 4 行

这个版本差异本身就是风险点：如果用户截图来自安装态 `1.0.80`，而我们只验证仓库 `1.0.82` 或 repo 内 Electron，就会再次得出错误结论。下一位接手前必须先对齐“截图来自哪个 exe、哪个 app.asar 版本、哪个进程实例”。

## 当前情况

软件日志 / 打印记录窗口又出现只显示 `loading.html` 四点转圈的问题。这已经是第二次复发，下一轮不能再按单点 UI 补丁处理，必须按未闭环的根因问题处理。

用户截图里有两个 `electron-hiprint` 窗口，窗口内容都停在加载动画。这个现象只说明两种可能之一：

- 目标页面没有真正渲染完成。
- 目标页面已经触发了生命周期事件，但覆盖在上层的 `WebContentsView` loading overlay 没有从真实可见窗口移除。

## 为什么之前改过还会回来

之前确实有过相关提交，但验证边界不完整。第二次复发的直接原因不是 `src/loading-view.js` 没被抽出来，而是抽出来以后没有把“安装态真实可见窗口不再停留在 loading overlay”做成必须通过的回归门禁。

换句话说，之前的修复解决了“受控窗口里 overlay 能被移除”这个较小问题；用户现在看到的是“安装后的客户端通过托盘打开日志窗口时仍然转圈”这个更大的问题。两者不是同一个验收边界。

| 提交 | 做了什么 | 为什么还不够 |
| --- | --- | --- |
| `50362a7 Prevent loading overlays from lingering` | 抽出 `src/loading-view.js`，让各窗口共享 overlay teardown，并新增 `tools/repro/runtime/loading-view-lifecycle-check.js`。 | 这个 smoke 用的是 repo assets + 隐藏测试窗口，不能证明安装后的客户端、托盘入口、真实可见窗口都正常。 |
| `8e1d120 Stabilize log windows around real SQLite read paths` | 把 IPC 注册提前到 `loadURL` 前，补窗口加载打点和 SQLite/read-path 检查。 | 这增强了可观测性，但没有断言真实可见窗口上 overlay 已经消失。 |
| `c9e40a5 fix: app:// 大文档改 net.fetch 流式伺服，消除日志窗口加载卡顿` | 把 `app://` 文档服务改成 `net.fetch`，并补了可见窗口截图 repro。 | 截图脚本仍然跑 repo 内 Electron + mock IPC，不是用户安装态的托盘入口。 |
| `d19cfa4 Keep log windows visually inspectable` | 改打印记录布局和视觉 smoke。 | 这是布局/视觉覆盖，不是安装态转圈根因闭环。 |
| `288fd96 chore(docs): remove stale AI-analysis and handoff docs` | 删除了上一份 spinner 交接文档。 | 旧文档里关于“缺少安装态验证”的警告也被删掉了，后续很容易重复同一个边界错误。 |

核心错误是：`loading-view-lifecycle-check.js` 通过，只能证明 `attachLoadingView()` 在受控测试窗口里能移除 overlay；它不能证明用户机器上的 `%LOCALAPPDATA%\Programs\hiprint\hiprint.exe` 通过托盘打开“软件日志 / 打印记录”时，真实可见窗口上的 overlay 也被移除了。

## 当前证据

上一轮调查时，仓库和安装态都曾核对为 `1.0.80`：

```powershell
node -e "const asar=require('@electron/asar'); const p=process.env.LOCALAPPDATA+'\\Programs\\hiprint\\resources\\app.asar'; const pkg=JSON.parse(asar.extractFile(p,'package.json').toString()); console.log(JSON.stringify({version:pkg.version,path:p},null,2));"
```

输出：

```json
{
  "version": "1.0.80",
  "path": "C:\\Users\\12180\\AppData\\Local\\Programs\\hiprint\\resources\\app.asar"
}
```

本轮重新核对时，仓库已到 `1.0.82`，但本机安装态仍是 `1.0.80`。这说明下一轮复现必须先确认正在操作的 exe 和 app.asar，不允许只看仓库源码。

本轮 SQLite 体量仍然不支持“日志太大导致一直转圈”这个判断：

```json
[
  { "table_name": "software_logs", "rows": 199, "chars": 8138, "max_msg": 140 },
  { "table_name": "print_logs", "rows": 4, "chars": 0, "max_msg": 0 }
]
```

安装态客户端在 2026-06-22 13:06 左右有这些窗口加载打点：

```text
2026-06-22 13:06:21 app:// 提供 softwareLog.html 17ms status=200
2026-06-22 13:06:24 软件日志窗口：dom-ready 2735ms
2026-06-22 13:06:24 软件日志窗口：did-finish-load 2738ms
2026-06-22 13:06:25 app:// 提供 printLog.html 15ms status=200
2026-06-22 13:06:27 打印记录窗口：dom-ready 1585ms
2026-06-22 13:06:27 打印记录窗口：did-finish-load 1588ms
```

这说明目标页面加载过，但仍不能证明 overlay 从可见窗口移除了。现在代码只记录目标页面的生命周期事件，没有记录 loading `WebContentsView` 的实际移除结果。

本次已跑过的 repo 级验证：

```powershell
npx electron tools/repro/runtime/loading-view-lifecycle-check.js
```

结果摘要：`index`、`set`、`printLog`、`softwareLog` 都有 `dom-ready` / `did-finish-load`，且 `overlayDestroyed: true`。

```powershell
npx electron tools/repro/runtime/log-window-visible-capture.js
```

结果摘要：

- `softwareLog`: `dom-ready:336ms`, `did-finish-load:340ms`, `overlayRemoved:true`
- `printLog`: `dom-ready:143ms`, `did-finish-load:143ms`, `overlayRemoved:true`
- 截图输出到 `.investigations/verify-softwareLog.png` 和 `.investigations/verify-printLog.png`

```powershell
node tools/repro/runtime/tray-log-window-contract-check.js
```

结果摘要：`observed: 0`, `risks: []`。

这些验证都有价值，但都不能作为最终修复证明。它们没有启动 `%LOCALAPPDATA%\Programs\hiprint\hiprint.exe`，没有走真实托盘入口，也没有检查安装态真实可见窗口。

## 当前代码边界

overlay 的拥有者是 `src/loading-view.js`。

当前行为：

- 创建一个 `WebContentsView` 加载 `loading.html`。
- 在目标窗口 `dom-ready`、`did-finish-load`、`did-fail-load`、窗口 `closed`、loading 页面加载失败时移除。
- 返回 `{ view, remove, isRemoved }`。

当前可观测性缺口：

- 没有记录移除原因。
- 没有记录 `removeChildView()` 是否成功。
- 没有窗口标签，所以安装态 SQLite 日志里无法区分是 `softwareLog` 还是 `printLog` 的 overlay teardown。
- 没有在安装态真实可见窗口上截图或 DOM/text 断言。

不要通过固定 3s/5s timeout 强行隐藏 overlay。timeout 会掩盖真正的 `app://` 加载失败、renderer 崩溃、preload 缺失或同步 IPC 卡死。

## 最可能的问题类别

现在更像是验证和可观测性边界没闭合，具体可能落在以下分支：

1. 用户截图来自旧进程或旧安装路径，而 repo 测试跑的是新代码。
2. 目标页面已经触发 `dom-ready` / `did-finish-load`，但 loading `WebContentsView` 在安装态可见窗口里仍停在最上层。
3. 安装态托盘入口与 repo smoke 路径不同，受 app 生命周期、single-instance、残留进程或窗口全局变量影响。
4. 目标渲染进程只是冷启动很慢，用户看到长时间 spinner，但目前没有可见状态断言去区分“慢”和“卡死”。

当前 SQLite 行数和文本体量不支持把主因归到日志太大。

## 下一步必须做什么

先不要改 UI，也不要加固定 timeout。第一步必须补证据：当前安装态进程到底有没有执行 overlay teardown。

1. 给 overlay teardown 加明确日志。

   建议扩展 `attachLoadingView()`，传入窗口标签和触发原因，例如：

   ```js
   attachLoadingView(win, opts, url, { label: "softwareLog" });
   ```

   需要记录到 SQLite-backed 软件日志：

   - overlay remove requested
   - cause: `dom-ready` / `did-finish-load` / `did-fail-load` / `closed` / loading-page failure
   - 是否已经移除过
   - `removeChildView()` 和 `destroy()` 是否成功
   - target URL 与 loading URL

2. 补安装态验证路径。

   下一轮不能只跑 `npx electron ...`。必须从安装后的 exe 开始：

   ```powershell
   $exe = "$env:LOCALAPPDATA\Programs\hiprint\hiprint.exe"
   Start-Process $exe
   ```

   然后通过生产路径打开软件日志和打印记录。如果真实托盘自动化不稳定，可以加一个只用于测试的诊断开关，例如 `HIPRINT_E2E_OPEN_LOG_WINDOWS=1`，在 app ready 后调用同一套 `softwareLogSetup()` / `printLogSetup()` 入口。这个开关不能改变普通用户行为。

3. 断言可见内容，而不只是生命周期事件。

   安装态 smoke 至少要证明：

   - 截图或 DOM/text 中出现 `软件日志` 和 `打印记录` 内容，而不是只有 spinner。
   - SQLite 中两个窗口都有 `dom-ready` / `did-finish-load`。
   - SQLite 中两个窗口都有 overlay removed 日志。
   - 没有 `did-fail-load` 或 `render-process-gone`。

4. 验证前清理旧进程。

   测试前先枚举所有 `hiprint.exe` 进程，确认只有预期安装路径的实例在跑。残留进程会让 single-instance 路径误导验证结论。

5. 等本地安装态 smoke 稳定后，再接入 GitHub workflow。

   workflow 应该在 Windows 上安装构建产物并运行同一套 installed-artifact smoke。repo-only Electron 脚本不能防止这类问题复发。

## 复现和诊断命令

确认安装态版本：

```powershell
node -e "const asar=require('@electron/asar'); const p=process.env.LOCALAPPDATA+'\\Programs\\hiprint\\resources\\app.asar'; const pkg=JSON.parse(asar.extractFile(p,'package.json').toString()); console.log(pkg.version);"
```

查看近期安装态窗口打点：

```powershell
node -e @'
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.env.APPDATA + '\\electron-hiprint\\database.sqlite');
db.all("SELECT id, ts, level, msg FROM software_logs WHERE msg LIKE '软件日志窗口：%' OR msg LIKE '打印记录窗口：%' OR msg LIKE 'app:// 提供 %' OR msg LIKE '%overlay%' ORDER BY id DESC LIMIT 80", [], (e, r) => {
  if (e) throw e;
  console.log(JSON.stringify(r, null, 2));
  db.close();
});
'@
```

现有 repo 级检查：

```powershell
npx electron tools/repro/runtime/loading-view-lifecycle-check.js
npx electron tools/repro/runtime/log-window-visible-capture.js
node tools/repro/runtime/tray-log-window-contract-check.js
```

注意：这些检查只能作为辅助证据，不能单独关闭这个 bug。

## 完成标准

必须全部满足，才能说这个问题修好了：

- 先清理/枚举旧进程，并确认当前截图、当前 exe、当前 app.asar 版本一致。
- 验证对象是安装态 `%LOCALAPPDATA%\Programs\hiprint\hiprint.exe`，不是只验证 repo 内 Electron。
- 通过生产托盘路径打开软件日志和打印记录后，窗口显示真实内容。
- 截图或 DOM/text 断言证明可见窗口没有停在 `loading.html`。
- SQLite 日志包含两个窗口的页面生命周期和 overlay teardown 记录。
- CI 或 release workflow 有 Windows installed-artifact smoke，覆盖同一条路径或等价的测试专用生产入口。

不满足这些条件时，任何 “`loading-view-lifecycle-check.js` passed” 或 “repo 截图 smoke passed” 都只能算辅助证据，不能说已经修好。

## 给下一位 Agent 的提示词

```text
继续处理 electron-hiprint 的软件日志/打印记录窗口转圈复发。先读 docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md、src/loading-view.js、src/softwareLog.js、src/printLog.js、tools/repro/runtime/loading-view-lifecycle-check.js、tools/repro/runtime/log-window-visible-capture.js。这个问题已经复发两次，不能加固定 timeout。上一轮修复只证明 repo 级 overlay teardown，没有证明安装态托盘入口。请先给 src/loading-view.js 增加带窗口标签的 overlay teardown 日志，然后补安装态 smoke：启动 %LOCALAPPDATA%\Programs\hiprint\hiprint.exe，通过生产路径或测试专用生产入口打开软件日志/打印记录，截图或检查 DOM/text，断言可见内容和 SQLite overlay removed 日志。repo 级 smoke 不能作为最终完成标准。
```
