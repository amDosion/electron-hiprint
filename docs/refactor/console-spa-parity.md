# Console SPA Parity

日期：2026-06-25

目的：记录当前 console SPA 架构真源，作为修复旧多窗口验证脚本和后续行为保持重构的 parity 清单。

## 当前真源

当前渲染入口由 `vite.config.ts` 的 `WINDOW_ENTRIES` 定义：

| 入口 | HTML | preload | 用途 |
| --- | --- | --- | --- |
| `console` | `src/renderer/console.html` | `src/preload/console.js` | 控制台 SPA，承载状态、设置、打印记录、软件日志 |
| `render` | `src/renderer/render.html` | `src/preload/render.js` | 打印渲染窗口 |

旧的 `index`、`set`、`printLog`、`softwareLog` 独立窗口已经不是当前运行时入口。

## 旧窗口到当前路由映射

| 旧入口 | 当前入口 | 当前路由 | 当前 bridge |
| --- | --- | --- | --- |
| `index.html` / `src/preload/index.js` | `console.html` | `#/status` | `window.hiprintIndex` |
| `set.html` / `src/preload/set.js` | `console.html` | `#/settings/basic`、`#/settings/transit`、`#/settings/advanced` | `window.hiprintSet` |
| `printLog.html` / `src/preload/printLog.js` | `console.html` | `#/print-log` | `window.hiprintPrintLog` |
| `softwareLog.html` / `src/preload/softwareLog.js` | `console.html` | `#/software-log` | `window.hiprintSoftwareLog` |

## 主进程路径

- 托盘“软件日志”入口应调用 `showConsole("/software-log")`。
- 托盘“打印记录”入口应调用 `showConsole("/print-log")`。
- 控制台窗口由 `src/app-window.js` 创建，加载 `getAssetUrl("console.html")`。
- loading overlay 由 `src/loading-view.js` 的 `attachLoadingView` 统一管理。
- console IPC 由 `src/console-ipc.js` 常驻注册。

## 验证脚本迁移规则

旧脚本如果仍读取以下路径，应迁移到当前真源：

- `src/set.js`
- `src/printLog.js`
- `src/softwareLog.js`
- `src/preload/index.js`
- `src/preload/set.js`
- `src/preload/printLog.js`
- `src/preload/softwareLog.js`
- `assets/index.html`
- `assets/set.html`
- `assets/printLog.html`
- `assets/softwareLog.html`

迁移后，runtime smoke 应优先加载：

```text
app://bundle/console.html#/status
app://bundle/console.html#/settings/basic
app://bundle/console.html#/print-log
app://bundle/console.html#/software-log
```

并统一使用：

```text
src/preload/console.js
```

## 不变量

- Bridge 名称保持兼容：`hiprintIndex`、`hiprintSet`、`hiprintPrintLog`、`hiprintSoftwareLog`、`hiprintConsole`。
- IPC channel 名称保持兼容，除非单独执行公开 API 迁移。
- `print_logs` 和 `software_logs` 的 sqlite schema 不因视图合并而变化。
- `app://bundle` 协议仍负责加载 `console.html` 及其 chunk。
- repo-only smoke 不能替代安装态托盘入口和可见窗口验证。
