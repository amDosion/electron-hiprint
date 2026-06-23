# L3 重构：四个 UI 窗口合并为单页控制台（消除渲染进程冷启动）

- 日期: 2026-06-23
- 状态: 设计已与用户对齐（方案 A，含主窗口全合并）
- 关联调查: `.investigations/2026-06-23-log-window-domready-installed-vs-repo.md`

## 1. 背景与目标

### 根因（已取证）
软件日志/打印记录窗口 dom-ready 1822ms 的根因不是 bundle 体积（已是 70KB）、不是 app:// 协议（16ms）、不是 SQLite，而是**每次托盘打开都 `new BrowserWindow({sandbox:true})` 冷启动一个全新沙箱渲染进程**（进程创建 + V8/Blink/GPU 初始化 + asar 读取 + 首次 page-in + Defender 扫描），且关窗即销毁，每次重开都命中最坏路径。repo 同代码实测仅 267ms，差异全在安装态运行环境的冷启动。

### 目标
把 4 个面向用户的窗口（index 连接状态 / set 设置 / printLog 打印记录 / softwareLog 软件日志）合并为**一个常驻单页应用（控制台）窗口**，左侧栏导航 + Vue Router 切换路由视图。面板切换变成纯组件挂载（0ms），渲染进程只在应用启动时预热一次、之后常驻复用，**彻底消除按需开窗的冷启动**。render 离屏打印渲染窗口完全不动。

### 成功判据
- 启动后从托盘打开控制台（任一面板）首次可见接近预热值；面板间切换 < 50ms、无 loading overlay。
- 关闭控制台窗口 = 隐藏到托盘，再次打开 < 300ms（命中常驻渲染进程）。
- 必须在**安装态**（非 repo-only）验证，遵循 `docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md` 的安装态验收红线。

## 2. 决策摘要（已确认）

| 决策项 | 选定 |
|---|---|
| 合并范围 | index + set + printLog + softwareLog 四窗合一；render 独立保留 |
| 导航形态 | 左侧垂直侧栏 + 右侧内容区 |
| 路由 | Vue Router（hash 模式，Electron 文件协议友好） |
| 窗口生命周期 | 关闭=隐藏到托盘复用；仅"重启/退出软件"真正销毁 |
| 启动预热 | app ready + 主流程就绪后台预创建隐藏控制台窗口并预加载 |
| 托盘菜单 | 保留"设置/打印记录/软件日志"直达项 → 显示窗口并 `router.push` 到对应路由 |
| 窗口尺寸 | 默认 1080×640、可缩放、最小 1040×560；取代原主窗口 500×300 不可缩放形态 |
| set 动态尺寸 | 移除 `setContentSize`（统一窗口固定布局，设置仅是一个视图） |

## 3. 目标架构

```
托盘点击（显示主窗口/设置/打印记录/软件日志）
  -> main.js 托盘 handler
  -> appWindow.showAndNavigate(route)   // 已预热则 show + router.push；未建则建好再 show
  -> 单个 APP_WINDOW（常驻，sandbox 渲染进程）
     -> 一个 Vue app：AppShell（左侧栏）+ <router-view>
        -> /status        StatusView（原 index/App.vue）
        -> /settings      SettingsView（原 set/App.vue）
        -> /print-log     PrintLogView（原 printLog/App.vue）
        -> /software-log  SoftwareLogView（原 softwareLog/App.vue）
  -> 一个合并 preload 暴露 hiprintIndex/hiprintSet/hiprintPrintLog/hiprintSoftwareLog

render 窗口：完全独立，离屏打印渲染，不在本次范围内。
```

渲染进程数：**控制台（1，常驻）+ render（1，离屏，按打印创建）**。原本最多 5 个独立窗口进程降为 2 类。

## 4. 渲染层改造

### 4.1 目录结构（新增 console 窗口，迁移 4 视图）
```
src/renderer/console.html                       # 新：统一入口（取代 index/set/printLog/softwareLog.html）
src/renderer/app/windows/console/
  main.ts                                        # createApp + router + AppShell.mount('#app')
  AppShell.vue                                   # 左侧栏布局壳 + <router-view>
  router.ts                                      # 4 条路由（hash）
  tokens.css                                     # 合并去重后的全局设计变量 + html/body/#app 基底
  views/
    StatusView.vue                               # 迁移自 windows/index/App.vue
    SettingsView.vue                             # 迁移自 windows/set/App.vue
    PrintLogView.vue                             # 迁移自 windows/printLog/App.vue
    SoftwareLogView.vue                          # 迁移自 windows/softwareLog/App.vue
```
迁移后删除 `windows/{index,set,printLog,softwareLog}/` 及 4 个旧 html。`windows/render/` 保留。

### 4.2 CSS 隔离（核心改造）
现状 4 个 `<style>` 均非 scoped 且各自定义 `:root` / `html,body` / `#app`，合并必冲突。策略：
- **全局基底唯一化**：`html/body/#app` 与设计 tokens 统一由 `tokens.css` 接管一次；4 个视图的 `:root`、`html,body`、`#app` 规则删除。各视图原有 CSS 变量前缀不同（index `--c-*`、softwareLog `--sl-*` 等），合并进 `:root` 不互相覆盖，去重同名即可。
- **视图样式命名空间化**：每个视图根元素加视图类（如 `.cv-software-log`），其余选择器前缀该类，避免跨视图选择器泄漏。**不用 `scoped`**，因为软件日志的 `.hl` 高亮等作用于 `v-html` 注入内容，scoped 的 hash 加不到动态 DOM 上；命名空间根类可保留这些选择器生效。
- `#app` 由 AppShell 占满，视图填充内容区（`flex:1; min-height:0`），不再各自 `height:100vh`。

### 4.3 合并 preload
新建 `src/preload/console.js`，在其中依次 `contextBridge.exposeInMainWorld` 出 `hiprintIndex` / `hiprintSet` / `hiprintPrintLog` / `hiprintSoftwareLog`（四份现有桥逻辑原样搬入，通道名互不冲突，已核对）。加载期的 `sendSync`（store-get/settings-snapshot/app-version/rePrint）一次性全跑，无副作用冲突。各视图仍用 `requireBridge(window.hiprintXxx, ...)`，无需改视图取桥代码。

### 4.4 视图迁移注意
- StatusView：顶栏"设置"图标 `ipc.send('openSetting')` 改为 `router.push('/settings')`（同窗导航，不再开新窗）。
- SettingsView：删除 `setContentSize` 调用（不再改窗口尺寸）；保存成功仍走主进程 relaunch；`closeSetWindow` 改为 `router.back()` 或回 `/status`。
- PrintLogView / SoftwareLogView：逻辑不变，仅去全局 style、加命名空间。

## 5. 主进程改造

### 5.1 新增 `src/app-window.js`（统一窗口所有者）
- `createAppWindow()`：建 1080×640 可缩放 `BrowserWindow`（sandbox + contextIsolation + `preload/console.js`），`attachLoadingView` 仅首帧用，`loadURL(getAssetUrl('console.html'))`。
- `getAppWindow()` / `showAndNavigate(route)`：无窗则建+预加载后 show；有窗则 `show()` + 通过 IPC `console:navigate` 通知渲染端 `router.push(route)`。
- `prewarmAppWindow()`：启动后台预创建隐藏窗口（不 show），预热渲染进程。
- 生命周期：拦截 `close` → `event.preventDefault() + hide()`；仅 `app.quit()`/relaunch 流程置真销毁标志后允许关闭。

### 5.2 IPC 常驻注册
原本随各窗口开关注册/移除的 handler（index 的 getMachineId/getAddress/getConnectionStatus/openSetting/clipboard、set 的 setConfig/showOpenDialog/openDirectory/testTransit/getPrintersList、printLog 的 request-logs/clear-logs/reprint、softwareLog 的 software-log:*）改为应用启动时**一次性常驻注册**（窗口常驻，不再重复 register 导致 "second handler" 报错）。所有 `dialog.showMessageBox(SET_WINDOW,...)`、`getPrintersAsync()`、`webContents.send` 的目标统一改为 `getAppWindow()`。

### 5.3 主窗口 server.close 语义迁移（关键）
原 `MAIN_WINDOW.on('closed', () => { server.close() })` 把 socket 服务生命周期绑在主窗口销毁上。控制台"关闭=隐藏"不再销毁，**server 不能随之关闭**。socket 服务生命周期改绑 `app` 退出（`before-quit`/`will-quit`），与窗口可见性解耦。

### 5.4 托盘改造
托盘"显示主窗口"→ `showAndNavigate('/status')`；"设置"→ `/settings`；"软件日志"→ `/software-log`；"打印记录"→ `/print-log`。删除 `openSetWindow`/`softwareLogSetup`/`printLogSetup` 旧入口对独立窗口的创建。

### 5.5 删除/退役
`src/set.js`、`src/printLog.js`、`src/softwareLog.js` 的"创建独立窗口"职责并入 `app-window.js`；其 IPC 业务函数（setConfig/fetchPrintLogs/softwareLogStore 调用等）抽到常驻 IPC 模块复用。`src/preload/{index,set,printLog,softwareLog}.js` 由 `console.js` 取代。

## 6. 构建改造

`vite.config.ts` 的 `WINDOW_ENTRIES` 从 5 项（index/set/printLog/softwareLog/render）缩为 2 项：`console` + `render`。`tools/build-renderer.js` 逐窗口构建逻辑相应改为构建 `console` 与 `render` 两个入口。统一 console bundle 会包含设置页的全量 element-plus（~1MB）——可接受：单次常驻加载、启动预热，不再重复冷启动；后续可独立优化设置页改按需 EP。

## 7. 数据流与不变量

- 连接状态实时推送（machineId/address/serverConnection/printTask/clientConnection/connectionStatus）：主进程目标窗口由 MAIN_WINDOW 改为常驻 APP_WINDOW；StatusView mounted 时订阅，控制台常驻后订阅只建立一次。
- 打印记录 `print-logs`、设置 `getPrintersList`/`testTransitResult`/`openDialog` 推送：目标改 APP_WINDOW。
- rePrint 仍发往 `PRINT_WINDOW`（打印窗口），不变。
- 不变量：控制台窗口全局唯一；socket 服务存活 ⇔ app 存活（与窗口可见性无关）；IPC handler 进程内单实例常驻。

## 8. 错误处理与边界

- 预热窗口若被系统回收/崩溃（`render-process-gone`）：`showAndNavigate` 检测窗口已销毁则重建，不假设常驻必存活。
- loadURL 失败、preload 缺桥：保留现有 `requireBridge` 抛错与 did-fail-load 诊断日志。
- 不加固定 timeout 掩盖 overlay；overlay 仅控制台首帧加载用，dom-ready 即移除。

## 9. 测试与验证

- repo 级：复用/改造 `tools/repro/runtime/log-window-domready-timing.js` 增加 console 入口冷/热计时；新增"路由切换 0 开窗"断言（切换不产生新 webContents）。
- 安装态（必须）：打新版本 exe，托盘打开控制台 → 切换 4 个面板，截图/DOM 断言各视图可见、无 spinner、SQLite 有生命周期日志；关闭再开 < 300ms。
- 回归：设置保存→relaunch；打印记录分页/重打；软件日志清空/筛选/高亮；连接状态实时刷新；render 打印不受影响。

## 10. 范围与 YAGNI

**做**：四窗合一、路由、合并 preload、窗口预热复用、IPC 常驻化、server 生命周期解耦、构建入口缩减、CSS 隔离。
**不做**：不动 render 打印链路；不重写设置页表单逻辑；不把设置页 element-plus 改按需（独立后续优化）；不改打印业务、socket 协议、SQLite schema。

## 11. 回滚

分阶段提交，每阶段可 `git revert`。最坏情况整体回退到"多窗口按需创建"。新窗口模块与旧窗口模块在切换提交前可并存，便于对比。

## 12. 风险

- 控制台常驻 ≈ 1 个额外渲染进程常驻内存（数十 MB），换秒开，符合用户已确认的 tradeoff。
- CSS 命名空间化遗漏会导致跨视图样式泄漏 → 迁移后需逐视图视觉回归。
- IPC 从"随窗口注册/移除"改"常驻单注册"，需确保不重复注册、app 退出时清理。
- 安装态与 repo 表现差异大，验证必须在安装态完成，不能用 repo timing 充当完成证据。
