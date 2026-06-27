# electron-hiprint 精准重构 Task 清单

日期：2026-06-25

目标：在保持现有行为和公开契约稳定的前提下，先修复失真的验证护栏，再按最小可回滚步骤清理死代码、重复路径、超大模块和遗留抽象。

当前约束：

- 当前工作区已有未提交改动，涉及 `.github/workflows/installers.yml`、`.github/workflows/release.yml`、`package.json`、`src/app-window.js`、`src/renderer/app/windows/console/AppShell.vue`、`src/renderer/app/windows/console/main.ts`、`tools/build-package.js`。
- 任何重构实施前，必须先确认这些改动属于当前基线，或将其单独提交/隔离。
- 当前渲染层真源是 console SPA：`console.html` + `src/preload/console.js` + console routes。旧 `index/set/printLog/softwareLog` 独立窗口已不是运行时真源。

## Phase 0：冻结基线

- [x] **确认当前 dirty worktree 边界**
  - 当前行为：已有未提交改动，包含 CI、打包脚本、console 启动和 Element Plus 加载调整。
  - 结构改进：先把当前工作树状态作为重构前基线记录，避免后续清理覆盖未完成修改。
  - 验证：`git status --short --branch`、`git diff --stat`。
  - 完成证据：已新增 `docs/refactor/refactor-baseline-2026-06-25.md`，记录当前 7 个既有未提交改动与 `docs/refactor/` 新增目录。
  - 风险：若不先冻结基线，后续 task 无法区分“重构引入”还是“已有改动”。

- [x] **记录 console SPA 架构真源**
  - 当前行为：`vite.config.ts` 只登记 `console` 和 `render` 入口；托盘日志/设置页面经 `showConsole(route)` 跳转。
  - 结构改进：补一份短 parity 文档，明确旧窗口到新 route 的映射。
  - 验证：`rg "WINDOW_ENTRIES|showConsole|console.html" vite.config.ts main.js src`。
  - 完成证据：已新增 `docs/refactor/console-spa-parity.md`；`rg "WINDOW_ENTRIES|showConsole|console.html" vite.config.ts main.js src` 通过并指向 `vite.config.ts`、`main.js`、`src/app-window.js`。
  - 风险：只改代码不改文档，会继续产生指向旧窗口的测试和 handoff。

## Phase 1：先修验证护栏

- [x] **修复 build workflow 假绿检查**
  - 当前行为：`tools/repro/build/build-pipeline-check.js` 使用 `includes("build-w")`，`build-w-64` 会误命中；当前 `package.json` 已无 `build-w`，检查仍返回 0 risks。
  - 结构改进：改为结构化读取 `package.json` scripts 和 workflow matrix 条目，精确比较目标集合。
  - 验证：`node tools/repro/build/build-pipeline-check.js`。
  - 完成证据：`tools/repro/build/build-pipeline-check.js` 已改为精确比较 package build targets、installer matrix scripts、release matrix scripts/artifacts；`node --check tools/repro/build/build-pipeline-check.js` 与 `node tools/repro/build/build-pipeline-check.js` 通过，`observed: 0`。
  - 风险：如果 win32 构建移除是有意迁移，应把它拆成单独发布策略任务；不要在普通重构里顺手改变发布矩阵。

- [x] **更新 tray/log window contract check**
  - 当前行为：`tools/repro/runtime/tray-log-window-contract-check.js` 仍读取已删除的 `src/printLog.js`、`src/softwareLog.js`。
  - 结构改进：改为检查 `main.js` tray 入口调用 `showConsole("/print-log")` / `showConsole("/software-log")`，并检查 `src/app-window.js` 使用 `attachLoadingView` 加载 `console.html`。
  - 验证：`node tools/repro/runtime/tray-log-window-contract-check.js`。
  - 完成证据：脚本已迁移到 console SPA 契约，检查 tray `showConsole("/software-log")` / `showConsole("/print-log")`、console routes、preload bridge、IPC 注册和 loading-view lifecycle；`node tools/repro/runtime/tray-log-window-contract-check.js` 通过，`observed: 0`。
  - 风险：不要把 repo-only smoke 当作安装态可见窗口验收；spinner 问题仍需要 visible-window 验证。

- [x] **更新 loading-view 生命周期 smoke**
  - 当前行为：`tools/repro/runtime/loading-view-lifecycle-check.js` 仍测试旧 `index.html`、`set.html`、`printLog.html`、`softwareLog.html` 与旧 preload。
  - 结构改进：改为测试 `console.html#/status`、`#/settings/basic`、`#/print-log`、`#/software-log`，统一使用 `src/preload/console.js`。
  - 验证：`npx electron tools/repro/runtime/loading-view-lifecycle-check.js`。
  - 完成证据：脚本已改为加载 `console.html#/status`、`#/settings/basic`、`#/print-log`、`#/software-log` 并统一使用 `src/preload/console.js`；`npx electron tools/repro/runtime/loading-view-lifecycle-check.js` 通过，四个 route 均 `overlayDestroyed: true`、`failed: false`。
  - 风险：该 smoke 只能证明受控窗口 overlay 能移除，不能替代安装态托盘入口验证。

- [x] **更新 log window performance / visible capture 脚本**
  - 当前行为：`log-window-performance-check.js` 和 `log-window-visible-capture.js` 仍面向旧 `softwareLog.html` / `printLog.html`。
  - 结构改进：改为 console route 导航，并断言 hash、可见文本、loading overlay 移除结果。
  - 验证：
    - `npx electron tools/repro/runtime/log-window-performance-check.js`
    - `npx electron tools/repro/runtime/log-window-visible-capture.js`
  - 完成证据：两个脚本均已迁移到 `console.html#/software-log` 与 `console.html#/print-log`，统一使用 `src/preload/console.js`。`log-window-performance-check.js` 通过，输出 `failed: false`；`log-window-visible-capture.js` 通过并生成 `.investigations/verify-softwareLog.png`、`.investigations/verify-printLog.png`，两页均 route/hash、bridge、overlay 和关键文本正常。
  - 风险：如果脚本只检查 DOM 挂载，不检查 overlay/截图，仍无法覆盖历史 spinner 类问题。

- [x] **更新 security/static guards 的旧窗口引用**
  - 当前行为：`static-risk-check.js`、`security-hardening-check.js` 仍检查 `src/set.js`、`src/printLog.js`。
  - 结构改进：把 SQL guard、openDirectory guard、sandbox/contextIsolation 检查迁移到 `src/console-ipc.js`、`src/preload/console.js`、`src/app-window.js` 和 console routes。
  - 验证：
    - `node tools/repro/security/static-risk-check.js`
    - `node tools/repro/security/security-hardening-check.js`
  - 安全边界：SQL 构造、目录打开、preload 暴露面、sandbox 配置。
  - 完成证据：两个脚本已迁移到 `src/console-ipc.js`、`src/app-window.js`、`src/online-update.js` 等当前真源；`node tools/repro/security/static-risk-check.js` 通过，`observed: 0`；`node tools/repro/security/security-hardening-check.js` 通过，`observed: 0`、`passed: 6`。

- [x] **更新 packaged-file / updater / connection checks**
  - 当前行为：`packaged-file-url-check.js`、`github-online-upgrade-check.js`、`connection-status-check.js` 仍有旧入口文件引用。
  - 结构改进：把必须存在的文件集合改为 `console.html`、`render.html`、`src/preload/console.js`、`src/preload/render.js`、当前 assets/chunk 规则。
  - 验证：
    - `node tools/repro/runtime/packaged-file-url-check.js`
    - `node tools/repro/updater/github-online-upgrade-check.js`
    - `node tools/repro/runtime/connection-status-check.js`
  - 风险：涉及打包/升级路径，不能只做字符串替换；要保留 release/upgrade 不变量。
  - 完成证据：三个脚本已迁移到 `src/app-window.js`、`src/console-ipc.js`、`src/preload/console.js`、`StatusView.vue`、`SettingsView.vue` 和当前 `console/render` 入口；三条验证命令均通过，`observed: 0`。

## Phase 2：删除低风险遗留路径

- [x] **删除 `setContentSize` 残留**
  - 当前行为：SettingsView 已删除动态尺寸逻辑，但 `src/preload/console.js` 仍允许发送 `setContentSize`，部分 repro 仍注册空监听。
  - 结构改进：确认无真实调用后，删除 preload allowlist 里的 `setContentSize`，删除无意义测试桩，保留必要兼容注释或迁移说明。
  - 验证：`rg '"setContentSize"|ipcMain\.on\("setContentSize"|removeAllListeners\("setContentSize"|ipc\.send\(''setContentSize''' src tools` 无旧 IPC 命中；`rg "setContentSize" src tools` 仅剩 `src/render.js` 与 `tools/repro/runtime/render-window-esm-smoke.js` 的 BrowserWindow 原生 API 用法；`npm run typecheck` 通过；`npx electron tools/repro/runtime/set-window-render-smoke.js` 通过，`failed:false`。
  - 风险：如果外部插件依赖该 IPC，则删除是 API 变更；当前证据显示它是窗口内部旧行为残留。

- [x] **修正文档和注释中的旧窗口真源**
  - 当前行为：`src/software-log-store.js` 注释仍提 `src/softwareLog.js`；handoff 和 superpowers docs 仍含旧文件路径。
  - 结构改进：源码注释改指向 `src/console-ipc.js` / console SPA；历史 handoff/spec/plan 顶部补“历史上下文/当前真源”说明；仍执行的 repro/contract 脚本迁移到 `console.html` route 与 `src/preload/console.js`。
  - 验证：`rg "softwareLog\\.html|printLog\\.html|set\\.html|index\\.html|src/preload/softwareLog\\.js|src/preload/printLog\\.js|src/preload/set\\.js|src/preload/index\\.js|src/softwareLog\\.js|src/printLog\\.js|src/set\\.js" tools src` 无命中；`rg "src/(set|printLog|softwareLog)\\.js|preload/(set|printLog|softwareLog|index)\\.js|\\b(index|set|printLog|softwareLog)\\.html" docs` 仅剩历史 handoff、migration plan/spec 和 `console-spa-parity.md`；`node tools/repro/runtime/software-log-sqlite-contract-check.js`、`npx electron tools/repro/runtime/index-window-render-smoke.js`、`npx electron tools/repro/runtime/softwarelog-window-render-smoke.js`、`npx electron tools/repro/runtime/log-window-domready-timing.js`、`npx electron tools/repro/runtime/app-protocol-smoke.js`、`node tools/repro/security/asset-protocol-traversal-check.js`、`HIPRINT_CAPTURE_TARGETS=printLog,softwareLog npx electron tools/repro/runtime/capture-windows.js` 均通过。
  - 风险：历史 handoff 可保留，但必须明确是历史上下文而非当前入口。

## Phase 3：拆分 `tools/utils.js`

- [x] **提取 IPP URL / SSRF 校验边界**
  - 当前行为：`tools/utils.js` 内联 `normalizeHost`、`isBlockedIPv4`、`isBlockedIPv6`、`getIppTargetError`、`getHttpUrlTargetError`。
  - 结构改进：已提取到 `tools/network-target-guard.js`；`tools/utils.js` 保留 `allowedIppHosts` store 读取和原有 re-export，调用方公共 API 稳定。
  - 验证：`node tools/repro/security/network-target-guard-check.js` 通过，16 条 guard case 全部通过；`node tools/repro/security/static-risk-check.js` 通过，`observed: 0`；`node tools/repro/security/security-hardening-check.js` 通过，`observed: 0`。`tools/repro/security/ipp-ssrf-repro.js` 是需要运行中 Socket.IO 服务的外部 parity gate，保留给服务启动后的集成验证。
  - 安全边界：SSRF、内网地址阻断、协议 allowlist。

- [x] **提取文件导出任务处理**
  - 当前行为：共享导出目录配置、文件名清理、扩展名校验、checksum、冲突策略、临时文件 rename 全在 `tools/utils.js`。
  - 结构改进：已提取 `tools/file-export.js`，`tools/utils.js` 只保留 store 配置读取、`getExportCapability` 公共 wrapper 与 socket 事件绑定。
  - 验证：`node tools/repro/security/file-export-module-check.js` 通过，覆盖成功写入、路径片段拒绝、危险扩展拒绝、checksum mismatch、rename 冲突策略、disabled 配置和 capability 不泄露 raw path；`node tools/repro/runtime/utils-export-surface-check.js` 通过，`observed: 0`；`node tools/repro/security/static-risk-check.js` 与 `node tools/repro/security/security-hardening-check.js` 均通过，`observed: 0`。`node tools/repro/security/transit-coordination-risk-check.js` 已运行但仍复现 6 个跨仓库既有 transit 风险，应拆为单独安全迁移，不作为本次文件导出模块抽取的行为保持 gate。
  - 安全边界：路径穿越、扩展名 allowlist、文件大小、hash 校验、临时文件清理。

- [x] **合并本地 socket 与中转 socket 的重复 handler**
  - 当前行为：`initServeEvent` 与 `initClientEvent` 重复实现 IPP、render、file.export、getPrintStatus。
  - 结构改进：已在 `tools/utils.js` 内抽 `bindIppHandlers`、`bindPrintTaskHandler`、`bindRenderTaskHandlers`、`bindFileExportHandler`、`bindPrintStatusHandler`、`bindClientInfoHandlers`；参数化 `label`、`clientType` 和中转 `replyId` 包装差异，保留事件名与 callback payload。
  - 验证：`node tools/repro/runtime/socket-handler-contract-check.js` 通过，`observed: 0`；`node tools/repro/security/network-target-guard-check.js`、`node tools/repro/security/static-risk-check.js`、`node tools/repro/security/security-hardening-check.js`、`node tools/repro/runtime/utils-export-surface-check.js`、`npm run typecheck` 均通过。`tools/repro/security/socket-runtime-repro.js` 与 `tools/repro/security/ipp-ssrf-repro.js` 需要正在运行的应用 Socket.IO 服务，保留为启动服务后的集成验收 gate，本轮未启动真实服务。
  - 风险：Socket.IO 事件名和 callback payload 是公开契约，不能改名或合并返回结构。

- [x] **提取连接状态与客户端信息发布**
  - 当前行为：连接数、transit 错误、`emitClientInfo`、`emitConnectionStatus` 和 UI 推送交织在 socket 逻辑内。
  - 结构改进：已提取 `tools/client-status.js`；`tools/utils.js` 保留原导出 `getConnectionStatus`、`emitConnectionStatus` 和 `emitClientInfo` wrapper，运行时调用方式不变。
  - 验证：`node tools/repro/runtime/connection-status-check.js` 通过，`observed: 0`；`node tools/repro/runtime/socket-handler-contract-check.js` 通过，`observed: 0`；`npm run typecheck`、`node tools/repro/security/static-risk-check.js`、`node tools/repro/security/security-hardening-check.js`、`node tools/repro/security/file-export-module-check.js`、`node tools/repro/security/network-target-guard-check.js` 均通过。
  - 风险：状态字段影响 console 状态页和外部插件端。

## Phase 4：清理打印/渲染重复逻辑

- [x] **抽取打印日志写入 helper**
  - 当前行为：`src/print.js` 和 `src/render.js` 都手写 `INSERT INTO print_logs`，字段和错误处理重复。
  - 结构改进：已提取 `src/print-log-writer.js`，统一 `print_logs` SQL、字段顺序、`rePrintAble ?? 1` 和错误日志；`src/print.js` 传 `omitPdfBlob: true` 保留 `pdf_blob` 脱敏，`src/render.js` 保留原完整 data 记录。
  - 验证：`node tools/repro/runtime/print-log-writer-contract-check.js` 通过，`observed: 0`；`node tools/repro/runtime/software-log-sqlite-contract-check.js` 通过，`failed: false`；`npx electron tools/repro/runtime/printlog-window-render-smoke.js` 通过，`failed:false`。
  - 数据边界：`print_logs` schema、rePrintAble 默认值、errorMessage 语义。

- [x] **抽取 runner task 完成逻辑**
  - 当前行为：`PRINT_RUNNER_DONE` / `RENDER_RUNNER_DONE` 的 done/delete/UI busy 推送散落在多个 success/catch/finally 分支。
  - 结构改进：已提取 `src/runner-task.js` 的 `completeRunnerTask`、`completePrintTask`、`completeRenderTask`；print 路径仍在完成后推送 `printTask` busy 状态，render 路径仍只完成 runner done/delete。
  - 验证：`node tools/repro/runtime/runner-task-check.js` 通过，`observed: 0`；`node tools/repro/runtime/print-log-writer-contract-check.js`、`npm run typecheck` 均通过。真实打印失败/PDF 生成失败/HTML 打印成功仍需要打印运行时 smoke 或人工设备场景验证，本轮未启动真实打印设备。
  - 风险：这是队列完整性边界，不能用 broad catch 掩盖遗漏。

- [x] **统一打印机 readiness 获取**
  - 当前行为：`print.js` 与 `render.js` 都读取 printer list、defaultPrinter，并调用 `getPrinterReadiness`。
  - 结构改进：已提取 `src/printer-readiness-resolver.js`，统一读取 printer list、显式 printer / store 默认打印机回退和 `getPrinterReadiness` 调用；socket 选择和后续 emit 逻辑未移动。
  - 验证：`node tools/repro/runtime/printer-status-check.js` 通过，`cases:10`；`node tools/repro/runtime/runner-task-check.js`、`node tools/repro/runtime/print-log-writer-contract-check.js`、`npm run typecheck` 均通过。
  - 风险：默认打印机回退和 Windows 状态码语义必须保持。

## Phase 5：整理 console Vue 视图

- [x] **拆分 SettingsView 配置 schema**
  - 当前行为：`SettingsView.vue` 同时包含默认值、inflate/serialize、tab schema、表单配置、模板和 CSS。
  - 结构改进：已抽 `src/renderer/app/windows/console/views/settings-form-model.ts`，承载默认值、tab schema、inflate/serialize 与导出扩展名默认文本；`SettingsView.vue` 保留模板、事件和提交行为。
  - 验证：`npm run typecheck` 通过；`npx electron tools/repro/runtime/set-window-render-smoke.js` 通过，`failed:false`，基础/中转/高级三路由均正常。
  - 风险：设置持久化 schema 和 `exportDirectory` 嵌套结构不能变。

- [x] **拆分 PrintLogView 分页/排序逻辑**
  - 当前行为：分页、排序、过滤条件、清空确认、reprint 和大段 CSS 在一个文件内。
  - 结构改进：已抽 `src/renderer/app/windows/console/views/print-log-table-model.ts`，承载时间格式化、`request-logs` payload 构造、排序三态、分页序列、页码 clamp 和 payload 归一化；`PrintLogView.vue` 保留 bridge、响应式状态、清空确认、reprint 和模板。
  - 验证：`node tools/repro/runtime/print-log-table-model-check.js` 通过，`failed:false`；`npm run typecheck` 通过；`npx electron tools/repro/runtime/printlog-window-render-smoke.js` 通过，`failed:false`；`npx electron tools/repro/runtime/printlog-scroll-layout-check.js` 通过，`failed:false`。
  - 风险：`sort.order` 的 `ascending/descending` 契约不能变。

- [x] **拆分 SoftwareLogView 日志过滤/高亮**
  - 当前行为：HTML escape、regex highlight、level folding 和 UI 状态混在视图内。
  - 结构改进：已抽 `src/renderer/app/windows/console/views/software-log-view-model.ts`，承载 HTML escape、regex escape、level folding、已转义文本高亮、footer 来源/计数格式；`SoftwareLogView.vue` 保留 bridge、日期加载、刷新、清空确认和模板。
  - 验证：`node tools/repro/security/software-log-view-model-check.js` 通过，`failed:false`；`npm run typecheck` 通过；`npx electron tools/repro/runtime/softwarelog-window-render-smoke.js` 通过，`failed:false`。
  - 安全边界：日志内容 escape/highlight，不能引入 XSS 回退。

## 必须拆成独立迁移的事项

以下事项是本轮行为保持重构必须排除的迁移 backlog；保留未勾选状态，表示需要独立方案、兼容策略和验收门禁后再执行。

- [ ] **win32 构建/发布移除**
  - 这是发布支持范围变更，不是行为保持重构。
  - 需要独立说明：为什么移除、影响用户、release workflow 如何验收。

- [ ] **依赖升级或替换**
  - Electron、Vite、Vue、Element Plus、`ipp`、sqlite/native package 等升级必须单独做迁移。
  - `ipp` 当前仍是直接运行时依赖，且 `tools/utils.js` 正在使用，不能当死依赖删除。

- [ ] **Socket.IO / preload / IPC 公开契约调整**
  - 事件名、bridge 名、payload、replyId 结构都属于外部契约。
  - 如需改变，必须先写兼容策略和迁移验收。

- [ ] **Transit 凭据/授权模型迁移**
  - `node tools/repro/security/transit-coordination-risk-check.js` 当前复现 6 个跨仓库风险：浏览器可取 transit token、插件暴露直接 host/token API、共享 token 控制打印和 file.export 等特权事件、默认/弱 token、transit token 日志、Socket.IO 临时 id 被用作设备 id。
  - 这是跨 `electron-hiprint`、`node-hiprint-transit`、`vue-admin-main`、`vue-plugin-hiprint-v2`、Android 客户端的安全架构迁移，不能混入本轮小步行为保持重构。

## 推荐执行顺序

1. Phase 0：冻结当前 dirty worktree 和 console SPA 真源。
2. Phase 1：修所有旧窗口引用的验证脚本，并修 build check 假绿。
3. Phase 2：删除 `setContentSize` 等低风险残留。
4. Phase 3：按安全边界拆 `tools/utils.js`。
5. Phase 4：抽 print/render 重复 helper。
6. Phase 5：整理 Vue 视图。

每个 task 完成标准：

- 行为说明清楚。
- 修改范围只覆盖该 task 的归属边界。
- 至少一个针对性验证通过。
- 没有新增 suppression、宽泛 catch、跳过测试、类型弱化或静默错误。
- 若触碰 SQL、路径、网络、Socket、preload、release workflow，必须把安全/发布不变量写入验证说明。
