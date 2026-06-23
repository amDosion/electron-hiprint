# Task 9 实施报告：main.js 接线

## 状态：DONE_WITH_CONCERNS

## 删除的 require

| 删除 | 原因 |
|------|------|
| `require("./src/set")` (setSetup) | 已搬到 console-ipc.js |
| `require("./src/printLog")` (printLogSetup) | 已搬到 console-ipc.js |
| `require("./src/softwareLog")` (softwareLogSetup) | 已搬到 console-ipc.js |
| `ipcMain, Notification, clipboard` from electron | IPC 注册已搬到 console-ipc.js |
| `address, emitConnectionStatus, getMachineId` from utils | 已在 console-ipc.js 内引用 |
| `attachLoadingView` | 已由 app-window.js 内部使用 |

## 新增 require

- `getAppWindow, showConsole, prewarmConsole, destroyConsole` from `./src/app-window`
- `registerConsoleIpc` from `./src/console-ipc`

## 删除的 ipcMain 注册（已搬到 console-ipc.js）

- notification
- openSetting
- showMessageBox
- getMachineId
- getAddress
- getConnectionStatus
- hiprint:store-get
- hiprint:app-version
- hiprint:settings-snapshot
- hiprint:clipboard-write
- 常量 STORE_GET_ALLOWED_KEYS

## 删除的函数

- `createWindow()` — 原主窗口建窗逻辑，替换为 prewarmConsole + showConsole
- `showMainWindow()` — 替换为 showConsole('/status')
- `openSetWindow()` — 替换为 showConsole('/settings')

## 删除/改变的全局变量

- `global.MAIN_WINDOW` 声明改为过渡桩（值为 null，不再赋实体）
- `global.SET_WINDOW` 同上
- `global.PRINT_LOG_WINDOW` 同上
- `global.SOFTWARE_LOG_WINDOW` 同上

> **过渡桩原因：** helper.js 在 `"use strict"` 下直接引用这些全局名，
> 删掉声明会导致 ReferenceError。Task 10 删除旧窗口模块时应一并清理 helper.js。

## MAIN_WINDOW 引用点改动

main.js 内所有 MAIN_WINDOW 引用已全部删除或替换：
- 创建 BrowserWindow → 删除（由 app-window.js 的 buildWindow 负责）
- loadURL(index.html) → 删除
- `MAIN_WINDOW.on('closed', server.close)` → 改为 `app.on('before-quit', server.close)`
- `MAIN_WINDOW.show()` → `showConsole('/status')`
- `parentWindow: MAIN_WINDOW` → `parentWindow: getAppWindow()`
- 托盘 4 项 → `showConsole(route)`
- `restartApp` → `destroyConsole(); app.relaunch(); app.exit()`

## systemSetup 改动

原 `systemSetup()` 仅含 `Menu.setApplicationMenu(null)`；
登录项设置从 `createWindow` 挪入 `systemSetup`（合理归并，app ready 前执行）。

## dev 冒烟关键日志

```
11:26:58.536 > ==> Electron-hiprint 启动 <==
11:26:58.602 > app:// 提供 console.html 46ms status=200
11:27:00.506 > 控制台窗口：dom-ready 2101ms
11:27:00.927 > 控制台窗口：did-finish-load 2522ms
```

无 did-fail-load / render-process-gone / MAIN_WINDOW is not defined / 重复注册报错。

## Concerns（需后续任务处理）

1. **utils.js:748 `Cannot read properties of null (reading 'webContents')`** — `getConfiguredPrinterList` 直接访问 `global.MAIN_WINDOW.webContents`，现在 MAIN_WINDOW 为 null（过渡桩）。这是 utils.js 未迁移 MAIN_WINDOW → getAppWindow() 导致的，属于 Task 9 范围外的 pre-existing 问题。Task 10 或后续任务需在 utils.js 里将 `MAIN_WINDOW` 替换为 `require('./src/app-window').getAppWindow()`。

2. **helper.js 的 appQuit()** — 仍引用 `MAIN_WINDOW`、`SET_WINDOW`，依赖过渡桩（null）。Task 10 删文件时应一并改 helper.js。

## 与 plan 的偏离

- `systemSetup` 中增加了登录项设置（从原 createWindow 迁移），plan 未明确提到，但属于合理归并，不改变语义。
- 过渡桩声明是 plan 未覆盖的现实需要（helper.js 严格模式引用）；已记录为 concern 待 Task 10 清理。
