# 日志窗口转圈问题交接

## 当前结论

软件日志 / 打印记录窗口的转圈问题已经至少复发两次，不能再按“单点补丁”处理。

这不是当前 sqlite 数据量导致的慢查询。2026-06-14 的本机验证中，`software_logs` 约 900 多行，软件日志读取通常是 1-4ms；打印记录当时为 0 行。真正需要继续追的是安装态客户端从托盘打开日志窗口时，`loading.html` 对应的 `WebContentsView` 是否按真实窗口生命周期被移除。

## 相关提交

| 提交 | 作用 | 现在看起来的问题 |
| --- | --- | --- |
| `50362a7 Prevent loading overlays from lingering` | 抽出 `src/loading-view.js`，让 index/set/printLog/softwareLog 共享 overlay teardown，并新增 `tools/repro/runtime/loading-view-lifecycle-check.js` | 只验证 repo 内 Electron smoke，不等同于安装态、托盘入口、可见窗口行为 |
| `d19cfa4 Keep log windows visually inspectable` | 修打印记录状态列、截图/视觉 smoke、软件日志长文本横向滚动验证 | 这是视觉验证，不是转圈根因修复 |
| `8e1d120 Stabilize log windows around real SQLite read paths` | 注册 IPC 早于 `loadURL`、补 sqlite 索引、记录 log-window load diagnostics、新增 `log-window-performance-check.js` | 仍没有完成“安装后的客户端通过托盘打开日志窗口”的自动化验证；如果用户仍看到转圈，本提交不能算闭环 |

自动发布结果：`8e1d120` 推送后 GitHub 自增到 `1.0.60`，`Release Build` 成功，Windows x64 安装包为 `hiprint_win_x64-1.0.60.exe`。

## 为什么会第二次出现

前一次修复把“overlay teardown 代码重复、容易漏清理”这个问题集中到了 `src/loading-view.js`，但是验收点停在了隐藏窗口 smoke：

- `npx electron tools/repro/runtime/loading-view-lifecycle-check.js` 可以证明 repo assets 下目标页面触发了 `dom-ready` / `did-finish-load`，并且 overlay 被移除。
- 它不能证明用户安装后的 `hiprint.exe` 中，从托盘菜单点击“软件日志 / 打印记录”时，真实可见窗口也移除了 overlay。
- 它也不能证明用户当前机器运行的是新 release，而不是旧进程、旧安装、single-instance lock 或残留进程。

这次我又犯了类似边界错误：虽然补了 SQL/IPC/loadURL 可观测性，也验证了 release、安装、启动，但没有把“托盘打开两个日志窗口后截图/DOM 检查 overlay 是否还在”做成最终验收。因此如果用户继续看到转圈，应按“未闭环”处理，不要说已经修好。

## 已有证据

本机 sqlite 不是慢点：

```powershell
node -e "const sqlite3=require('sqlite3').verbose(); const p=process.env.APPDATA+'\\electron-hiprint\\database.sqlite'; const db=new sqlite3.Database(p); db.all('SELECT day,count(*) c,sum(length(msg)) chars,max(length(msg)) maxlen FROM software_logs GROUP BY day ORDER BY day DESC LIMIT 7',[],(e,r)=>{console.log(JSON.stringify(r,null,2)); db.close();});"
```

性能诊断脚本在 repo assets 下能区分慢点：

```powershell
npx electron tools/repro/runtime/log-window-performance-check.js
```

最近一次结果显示：

- `softwareRead`: 约 1-4ms
- `softwareLog` 窗口稳定：约 0.4s
- `printLog` 窗口稳定：约 0.3-0.4s
- `printLatest` 查询计划使用 `idx_print_logs_timestamp_id`

安装态 `1.0.60` 已确认：

```powershell
node -e "const asar=require('@electron/asar'); const p=process.env.LOCALAPPDATA+'\\Programs\\hiprint\\resources\\app.asar'; const pkg=JSON.parse(asar.extractFile(p,'package.json').toString()); console.log(pkg.version);"
```

输出为 `1.0.60`。启动日志写入 sqlite，能看到：

- `Connected to database`
- `==> Electron-hiprint 启动 <==`
- `在线升级：当前已是最新版本 1.0.60`

## 下一位接手的复现路径

必须从安装态开始，不要只跑 repo smoke。

1. 确认安装态版本：

```powershell
node -e "const asar=require('@electron/asar'); const p=process.env.LOCALAPPDATA+'\\Programs\\hiprint\\resources\\app.asar'; const pkg=JSON.parse(asar.extractFile(p,'package.json').toString()); console.log(pkg.version);"
```

2. 正常启动客户端，不带调试端口。

```powershell
Start-Process "$env:LOCALAPPDATA\Programs\hiprint\hiprint.exe"
```

3. 通过托盘菜单手动点击：

- 软件日志
- 打印记录

4. 点击后立刻查 sqlite 中的窗口加载打点：

```powershell
node -e "const sqlite3=require('sqlite3').verbose(); const db=new sqlite3.Database(process.env.APPDATA+'\\electron-hiprint\\database.sqlite'); db.all(\"SELECT id, ts, level, msg FROM software_logs WHERE msg LIKE '软件日志窗口：%' OR msg LIKE '打印记录窗口：%' ORDER BY id DESC LIMIT 30\",[],(e,r)=>{console.log(JSON.stringify(r,null,2)); db.close();});"
```

判定方式：

- 如果没有 `软件日志窗口：dom-ready` / `打印记录窗口：dom-ready`：托盘点击没有进入窗口创建路径，或运行的不是含 `8e1d120` 的安装包。
- 如果有 `did-fail-load`：查 `app://bundle/*.html` 协议、`app.asar.unpacked/assets` 是否存在、MIME/协议 handler 是否正常。
- 如果有 `dom-ready` / `did-finish-load`，但用户仍看到 spinner：重点查 `WebContentsView` remove 是否在可见窗口上失败，不能只信 smoke 的 `overlay.isRemoved()`。
- 如果 `dom-ready` 时间很长：查渲染包执行、Element Plus singlefile 冷启动、preload 同步 IPC。

5. 如果需要临时开 DevTools，只用于检查，结束后必须关闭带 `--remote-debugging-port` 的进程，避免 single-instance lock 干扰后续验证。

## 下一步应补的自动化

新增一个安装态验证脚本，而不是继续扩展 repo smoke：

- 下载或使用本地 release exe。
- 安装到 `%LOCALAPPDATA%\Programs\hiprint`。
- 启动安装态 `hiprint.exe`。
- 触发托盘的“软件日志 / 打印记录”入口。
- 截图或通过 Chrome DevTools Protocol 检查当前窗口 URL、DOM、可见像素。
- 断言没有只剩 `loading.html` 的 spinner。
- 查 sqlite 中必须出现 `软件日志窗口：dom-ready/did-finish-load` 和 `打印记录窗口：dom-ready/did-finish-load`。

这个验证没有补上之前，不要再宣称“转圈问题已完全修好”。

## 禁止的方向

- 不要加固定 3s/5s 超时把 loading overlay 强行隐藏。这会掩盖 `app://` 加载失败或 renderer 崩溃。
- 不要把问题重新归因到 `.log` 文件。当前软件日志传输已经写 sqlite；`logs/*.log` 多数是历史残留。
- 不要只跑 `loading-view-lifecycle-check.js` 后结束。它只能证明 repo assets 的隐藏窗口路径，不覆盖用户截图里的安装态可见窗口。

## 推荐给下一位 Agent 的提示词

```text
继续处理 electron-hiprint 的软件日志/打印记录窗口转圈复发。先读 docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-14.md、src/loading-view.js、src/softwareLog.js、src/printLog.js、tools/repro/runtime/loading-view-lifecycle-check.js、tools/repro/runtime/log-window-performance-check.js。不要加 overlay timeout。必须从已安装的 1.0.60 客户端通过托盘打开“软件日志”和“打印记录”验证；如果仍转圈，查 sqlite 中“软件日志窗口：/打印记录窗口：”加载打点，区分托盘没触发、app:// load fail、dom-ready 后 overlay 未移除、renderer 冷启动。最终补一个安装态可见窗口回归脚本，并只在该脚本通过后再声称修复。
```
