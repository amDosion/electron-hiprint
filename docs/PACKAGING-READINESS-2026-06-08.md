# 打包就绪报告 — electron-hiprint（exe 打包前代码检查）

- 日期：2026-06-08
- 范围：会进入 Windows NSIS 安装包（`build-w-64`）的源码（`main.js` / `start.js` / `src/**` / `tools/utils.js` / `tools/database.js` / `build/**`），排除 `node_modules`、`out/`、`tools/repro/**`、`docs/**`
- 方法：从技能/代理清单中选取对 Electron + JS 框架最相关者，按 ultracode 编排一个 4 维并行评审 Workflow（每条发现再对抗式核验），叠加确定性构建就绪取证
  - 选用代理：`code-reviewer`（打包正确性）、`security-reviewer`（preload/renderer 边界）、`silent-failure-hunter`（吞错）、`typescript-reviewer`（JS 质量 + 改名一致性）
  - 29 个子代理，20 条核验后确认发现

---

## 1. 构建就绪基线（确定性取证，全部通过）

| 检查 | 结果 |
|---|---|
| 工具链 | node v24.11 / electron-builder 26.8.1 ✓ |
| 打包 JS 语法（27 文件 `node --check`） | 0 失败 ✓ |
| 打包诊断脚本 build-pipeline-check | `observed: 0` ✓ |
| 打包诊断脚本 main-process-check | `observed: 0` ✓ |
| 打包诊断脚本 packaged-file-url-check | `observed: 0` ✓ |
| 打包诊断脚本 package-upgrade-check | `observed: 0` ✓ |
| Windows exe 引用资源（icon.ico / 256x256.png / installer.nsh / plugin/*） | 齐全 ✓ |
| `file.export` 改名（去 `.v1`） | 全仓库 0 残留，emit/on 两侧一致 ✓ |
| `package.json` JSON 合法性 | ✓ |

> 注：`build/icons/icon.icns` 缺失，仅影响 mac dmg 目标（`build-m*`），与 Windows exe 无关。
> 注：全应用 `console.*` 经 `main.js:66 Object.assign(console, electronLog.functions)` 写入 electron-log 文件——故"仅 console.error"类问题在打包态并非完全无痕，相应严重度已下调。

---

## 2. 本次已修（11 项，最小安全修复）

| # | 严重度 | 文件:行 | 问题 | 修法 |
|---|---|---|---|---|
| 1 | CRITICAL | src/print.js:143 | 外层 `printToPDF` 无 `.catch`，拒绝时 `PRINT_RUNNER_DONE` 永不调用 → 打印队列对后续任务永久死锁，客户端无错误反馈 | 补 `.catch`：回传 `error`、记日志、释放队列槽 |
| 2 | HIGH | src/pdf-print.js:45,54 | `.catch(() => reject())` 丢弃错误对象，上游 `err.message` 抛 TypeError → 客户端收不到打印失败事件 | 透传：`.catch((err) => reject(err))` |
| 3 | HIGH | src/render.js:201 | `getBuffer().then()` 浮空 Promise：失败逃逸 try/catch（客户端挂起），且 finally 先于 emit 执行 → RENDER_WINDOW 被下一任务并发复用 | 改 `await`，纳入 try（失败回 `render-jpeg-error`），emit 完成后才释放 runner |
| 4 | HIGH | tools/utils.js:1139 | `file.export` 监听仅在中转路径(`initClientEvent`)，本地服务端(`initServeEvent`)漏配 → 直连本地服务的插件端触发导出无响应 | 镜像补 `socket.on("file.export")`（additive 兼容，api.md 矩阵新增事件=✅） |
| 5 | MEDIUM | package.json:43 | `files` 仅排除 `tools/repro/**`，5 个仅构建期脚本被打进 asar | 追加排除 build-package / run-electron-builder / sync-builtin-plugin / code_compress / rename |
| 6 | MEDIUM | src/printLog.js:97 | `ORDER BY ${sort.prop}` 直接拼接渲染端 IPC 入参（注入向量） | 列名白名单 + 方向限定 ASC/DESC |
| 7 | MEDIUM | tools/utils.js:266 | `addressMac` 失败 `resolve(err)` → `clientInfo.mac` 被填成序列化错误对象 | `resolve("")` |
| 8 | MEDIUM | src/render.js:186 | 多页截图切片高度公式 `offset - height` 错误 → 末页重复/空白像素 | `Math.min(height, data.height - offset)` |
| 9 | MEDIUM | src/print.js:406 | `checkPrinterStatus` 打印机被拔除后 `printer` 恒 undefined → interval 永久空转（泄漏） | 增加 `MAX_ATTEMPTS=60` 超时清除 |
| 10 | MEDIUM | src/print.js:159 | pdf 类型临时文件写入后从不删除 → `pdfPath/hiprint` 无限堆积占盘 | finally 内 `fs.unlinkSync` 清理 |
| 11 | LOW | tools/utils.js:315 | `getMachineId` 空 catch 无任何日志 | 补 `console.error`（经 electron-log 落盘可排查） |

验证：所有改动文件 `node --check` 通过；25 个打包 JS + 3 个 HTML 内联脚本 0 语法失败；全部打包诊断脚本 `observed:0`（零回归）；`file.export.v1` 代码残留 0（仅文档历史记录）。

---

## 3. 原暂缓 6 项 — 本轮全部完成

第 2 节的 11 项最小修复后，用户明确要求完成原列为"待跟进"的 6 项。均已落地并验证：

| # | 原严重度 | 位置 | 完成内容 |
|---|---|---|---|
| 1 | MEDIUM | main.js + src/{print,render,set,printLog}.js（5 窗口） | 全部 `sandbox: true`；5 个 preload 去除 `electron-store` / `package.json` / `clipboard` 依赖，改走同步 IPC（`hiprint:store-get` / `hiprint:app-version` / `hiprint:settings-snapshot` / `hiprint:clipboard-write`），保留渲染端 `sendSync` 同步契约，HTML 零改动 |
| 2 | MEDIUM | assets/{index,set,printLog}.html（严格 CSP）+ assets/{render,print}.html（宽松但有效 CSP + sanitizeNode 加固） | 5 页全部加 `<meta http-equiv=CSP>`（file:// 页用 meta 注入，`onHeadersReceived` 对 file:// 不可靠）；render/print 的 `sanitizeNode` 新增移除 SVG `<foreignObject>` 与剥离 `javascript:` 协议属性，控制字符先以 `/[\x00-\x20]+/g` 规范化再判定（防 NUL/制表符混淆绕过）|
| 3 | MEDIUM | tools/database.js | 打包态 DB 路径迁到 `app.getPath("userData")/database.sqlite`，含一次性 `copyFileSync` 迁移旧库（仅当旧库存在且新库不存在；保留旧文件作备份；迁移失败不阻断启动）|
| 4 | LOW | src/preload/set.js | 不再全量暴露 `store.store`；经 `hiprint:settings-snapshot` 仅投影 19 个 UI 所需设置字段（electron-store `set(obj)` 为合并语义，投影不丢数据）|
| 5 | LOW | src/set.js + main.js + src/printLog.js | `BrowserView` → `WebContentsView`（`contentView.addChildView` / `removeChildView`）；loadingView 增加 `did-fail-load` 兜底清理，关闭时守卫 `isDestroyed` |
| 6 | LOW | tools/utils.js | `emitClientInfo` 的 `_address.mac().then(...)` 链补 `.catch`（记 `console.error`，经 electron-log 落盘）|

诊断脚本同步修正：`tools/repro/runtime/packaged-file-url-check.js` 的 `RUNTIME-PRELOAD-SANDBOX-BLOCKS-COMMONJS` 启发式原以"`sandbox` 不为 `false`"作代理判据——这只认可"保持 sandbox:false"一种规避，会对本轮"sandbox:true + preload 迁 IPC"的**正解误报**。已改为检测真实条件：解析窗口 preload 路径 → 读取 preload → 仅当其 `require` 了 sandbox 白名单（`electron`/`events`/`timers`/`url`）之外的模块时才告警。负向测试确认其对 `require("electron-store")` 仍会捕获，非空壳。修正后该脚本 `observed:0`。

验证（6 项）：25 个打包 JS（含 `main.js` / `start.js`）`node --check` 全通过；render/print/set 内联脚本语法通过；全部 9 个打包/运行时/安全诊断脚本 `observed:0`（跨仓 `transit-coordination-risk-check` 的 6 条属 vue-admin / node-hiprint-transit 等**其他仓库**的中转安全审计，与本仓打包无关）；两个 HTML 文件经字节级核验已无裸 NUL/控制字节。

---

## 4. 打包命令（Windows exe）

```powershell
# 64 位 Windows NSIS 安装包
npm run build-w-64
# 或带压缩的完整发布流程（compress → build-all → restore）
npm run releases
```

产物输出到 `out/`（`hiprint-<version>.exe`）。

> 当前 `package.json` version 仍为 `1.0.25`，按既有发布流程在打包前确认是否需要 bump。
