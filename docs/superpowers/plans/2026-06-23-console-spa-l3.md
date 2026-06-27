# 控制台单页化（L3）Implementation Plan

> 当前状态说明：本文件是 console SPA 迁移实施计划，文中的旧 `index/set/printLog/softwareLog` 文件路径用于描述迁移前来源和历史步骤。当前运行时真源见 `docs/refactor/console-spa-parity.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 index/set/printLog/softwareLog 四个独立 BrowserWindow 合并为一个常驻单页"控制台"窗口（左侧栏 + Vue Router 4 视图），消除按需开窗的渲染进程冷启动；render 离屏打印窗口不动。

**Architecture:** 单 `BrowserWindow` 加载 `console.html`，一个 Vue app（全量 element-plus）挂 `AppShell`（左侧栏）+ `<router-view>`，4 个路由视图由原 4 个 `App.vue` 迁移而来。一个合并 preload 暴露 4 个 IPC 桥。主进程新增 `src/app-window.js`（窗口所有者：创建/预热/显示导航/关闭即隐藏）与 `src/console-ipc.js`（4 窗口 IPC 常驻注册，目标统一为控制台窗口）。socket 服务生命周期从"主窗口销毁"解耦到"app 退出"。

**Tech Stack:** Electron, Vue 3 + TS, Vue Router (hash), element-plus, Vite 多入口, 自定义 `app://` 协议。

## Global Constraints

- 渲染窗口必须 `sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`，经 `app://` 协议加载（不可 file://）。
- 控制台窗口全局唯一；socket 服务存活 ⇔ app 存活（与窗口可见性无关）；IPC handler 进程内单实例常驻，不随窗口开关注册/移除。
- 不加固定 timeout 掩盖 overlay；overlay 仅控制台首帧用，dom-ready 即移除。
- render 打印链路、socket 协议、SQLite schema、打印业务逻辑：不改。
- CSS 视图样式一律命名空间化（视图根类前缀），不用 `scoped`（日志高亮作用于 v-html）。`:root`/`html,body`/`#app` 全局基底仅 `tokens.css` 定义一次。
- 验证完成标准必须包含**安装态**（启动 `%LOCALAPPDATA%\Programs\hiprint\hiprint.exe`），repo smoke 仅辅助。参见 `docs/HANDOFF-LOG-WINDOW-SPINNER-2026-06-22.md`。

---

## File Structure

**新增（渲染层）**
- `src/renderer/console.html` — 统一入口 HTML
- `src/renderer/app/windows/console/main.ts` — createApp + EP + router + mount
- `src/renderer/app/windows/console/router.ts` — 4 路由（hash）
- `src/renderer/app/windows/console/AppShell.vue` — 左侧栏布局壳 + router-view
- `src/renderer/app/windows/console/tokens.css` — 全局 tokens + html/body/#app 基底
- `src/renderer/app/windows/console/views/StatusView.vue` — 迁移自 index/App.vue
- `src/renderer/app/windows/console/views/SettingsView.vue` — 迁移自 set/App.vue
- `src/renderer/app/windows/console/views/PrintLogView.vue` — 迁移自 printLog/App.vue
- `src/renderer/app/windows/console/views/SoftwareLogView.vue` — 迁移自 softwareLog/App.vue

**新增（主进程）**
- `src/preload/console.js` — 合并 4 桥
- `src/app-window.js` — 控制台窗口所有者（创建/预热/显示导航/生命周期）
- `src/console-ipc.js` — 4 窗口 IPC 常驻注册（业务函数搬入）

**修改**
- `vite.config.ts` — WINDOW_ENTRIES 缩为 `console` + `render`
- `tools/build-renderer.js` — 构建 console + render
- `main.js` — 接线：预热控制台、托盘改路由、server 生命周期解耦

**删除（迁移完成后）**
- `src/renderer/{index,set,printLog,softwareLog}.html`
- `src/renderer/app/windows/{index,set,printLog,softwareLog}/`
- `src/preload/{index,set,printLog,softwareLog}.js`
- `src/set.js`、`src/printLog.js`、`src/softwareLog.js`（业务函数已搬到 console-ipc.js）

---

## Task 1: 合并 preload（console.js）

**Files:**
- Create: `src/preload/console.js`
- Reference: `src/preload/{index,set,printLog,softwareLog}.js`

**Interfaces:**
- Produces: 渲染端 `window.hiprintIndex` / `window.hiprintSet` / `window.hiprintPrintLog` / `window.hiprintSoftwareLog`，四份桥语义与原文件逐字一致。

- [ ] **Step 1: 创建 console.js，按原四文件逐字搬入四个 expose 块**

```js
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// ---- hiprintIndex（原 preload/index.js）----
const indexSend = new Set(["getMachineId","getAddress","getConnectionStatus","openSetting","notification"]);
const indexOn = new Set(["machineId","address","connectionStatus","serverConnection","printTask","clientConnection"]);
contextBridge.exposeInMainWorld("hiprintIndex", {
  title: ipcRenderer.sendSync("hiprint:store-get", "mainTitle") || "Electron-hiprint",
  version: ipcRenderer.sendSync("hiprint:app-version"),
  send(channel, data) { if (indexSend.has(channel)) ipcRenderer.send(channel, data); },
  on(channel, callback) { if (indexOn.has(channel) && typeof callback === "function") ipcRenderer.on(channel, callback); },
  writeText(text) { ipcRenderer.send("hiprint:clipboard-write", String(text || "")); },
});

// ---- hiprintSet（原 preload/set.js）----
const setSend = new Set(["setConfig","setContentSize","showOpenDialog","openDirectory","testTransit","closeSetWindow","getPrintersList"]);
const setOn = new Set(["getPrintersList","openDialog","testTransitResult"]);
contextBridge.exposeInMainWorld("hiprintSet", {
  store: ipcRenderer.sendSync("hiprint:settings-snapshot"),
  send(channel, data) { if (setSend.has(channel)) ipcRenderer.send(channel, data); },
  on(channel, callback) { if (setOn.has(channel) && typeof callback === "function") ipcRenderer.on(channel, callback); },
  once(channel, callback) { if (setOn.has(channel) && typeof callback === "function") ipcRenderer.once(channel, callback); },
  removeAllListeners(channel) { if (setOn.has(channel)) ipcRenderer.removeAllListeners(channel); },
});

// ---- hiprintPrintLog（原 preload/printLog.js）----
const printLogSend = new Set(["request-logs","clear-logs","reprint"]);
contextBridge.exposeInMainWorld("hiprintPrintLog", {
  rePrintAble: ipcRenderer.sendSync("hiprint:store-get", "rePrint"),
  send(channel, data) { if (printLogSend.has(channel)) ipcRenderer.send(channel, data); },
  onPrintLogs(callback) { if (typeof callback === "function") ipcRenderer.on("print-logs", callback); },
});

// ---- hiprintSoftwareLog（原 preload/softwareLog.js）----
contextBridge.exposeInMainWorld("hiprintSoftwareLog", {
  listDates: () => ipcRenderer.invoke("software-log:list-dates"),
  read: (date) => ipcRenderer.invoke("software-log:read", date),
  openFolder: () => ipcRenderer.send("software-log:open-folder"),
  clear: () => ipcRenderer.invoke("software-log:clear"),
});

// ---- 控制台路由导航（主进程 → 渲染端 router.push）----
contextBridge.exposeInMainWorld("hiprintConsole", {
  onNavigate(callback) { if (typeof callback === "function") ipcRenderer.on("console:navigate", (_e, route) => callback(route)); },
});
```

- [ ] **Step 2: 静态校验四桥齐全**

Run: `node -e "const s=require('fs').readFileSync('src/preload/console.js','utf8');['hiprintIndex','hiprintSet','hiprintPrintLog','hiprintSoftwareLog','hiprintConsole'].forEach(n=>{if(!s.includes('exposeInMainWorld(\"'+n+'\"')) throw new Error('missing '+n)});console.log('OK all bridges present')"`
Expected: `OK all bridges present`

- [ ] **Step 3: Commit**

```bash
git add src/preload/console.js
git commit -m "feat(console): merged preload exposing 4 IPC bridges + navigate channel"
```

---

## Task 2: 控制台入口骨架（HTML + main.ts + router + AppShell + tokens）

**Files:**
- Create: `src/renderer/console.html`, `src/renderer/app/windows/console/main.ts`, `.../console/router.ts`, `.../console/AppShell.vue`, `.../console/tokens.css`
- Modify: `vite.config.ts`（WINDOW_ENTRIES 增 console）

**Interfaces:**
- Produces: 路由名 `/status` `/settings` `/print-log` `/software-log`；router 默认重定向 `/` → `/status`；AppShell 监听 `window.hiprintConsole.onNavigate` 做 `router.push`。
- Consumes: Task 1 的 `window.hiprintConsole`。

- [ ] **Step 1: console.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>hiPrint 控制台</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./app/windows/console/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: router.ts（4 路由占位组件先用空 div，视图任务逐个替换）**

```ts
import { createRouter, createWebHashHistory } from 'vue-router'

const Placeholder = { template: '<div style="padding:24px;color:#9aa3b2">加载中…</div>' }

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/status' },
    { path: '/status', name: 'status', component: Placeholder },
    { path: '/settings', name: 'settings', component: Placeholder },
    { path: '/print-log', name: 'printLog', component: Placeholder },
    { path: '/software-log', name: 'softwareLog', component: Placeholder },
  ],
})
```

- [ ] **Step 3: tokens.css（合并各视图 :root 变量，去重；接管 html/body/#app）**

把 index/App.vue、softwareLog/App.vue 等 `<style>` 顶部的 `:root{...}` 变量块合并到此文件（变量前缀 `--c-*` 与 `--sl-*` 不冲突，原样保留；同名取一份）。再加基底：

```css
/* tokens.css 末尾基底 —— 全局唯一，视图不得再定义 html/body/#app */
html, body { margin: 0; padding: 0; height: 100%; }
body { background: var(--c-page); color: var(--c-text); font-family: var(--font-base); -webkit-font-smoothing: antialiased; user-select: none; }
#app { height: 100vh; }
```

- [ ] **Step 4: AppShell.vue（左侧栏 + router-view + 导航订阅）**

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Monitor, Setting, Document, Tickets } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const NAV = [
  { name: 'status', path: '/status', label: '连接状态', icon: Monitor },
  { name: 'settings', path: '/settings', label: '设置', icon: Setting },
  { name: 'printLog', path: '/print-log', label: '打印记录', icon: Tickets },
  { name: 'softwareLog', path: '/software-log', label: '软件日志', icon: Document },
]
onMounted(() => {
  // 主进程托盘点击 → 切到对应路由
  window.hiprintConsole?.onNavigate((r: string) => { if (r) router.push(r) })
})
</script>

<template>
  <div class="shell">
    <nav class="shell-side">
      <div class="shell-brand"><span class="shell-logo"></span>hiPrint</div>
      <button
        v-for="item in NAV" :key="item.name" class="shell-nav"
        :class="{ active: route.name === item.name }"
        @click="router.push(item.path)"
      >
        <el-icon class="shell-nav-ic"><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </button>
    </nav>
    <main class="shell-main"><router-view /></main>
  </div>
</template>

<style>
.shell { display: flex; height: 100vh; }
.shell-side { flex: 0 0 188px; background: var(--c-card); border-right: 1px solid var(--c-border); display: flex; flex-direction: column; gap: 4px; padding: 14px 10px; box-sizing: border-box; }
.shell-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; color: var(--c-text); padding: 6px 10px 14px; }
.shell-logo { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg,#4f7bff,#3358e0); }
.shell-nav { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--c-text-2); font-size: 13.5px; font-family: var(--font-base); cursor: pointer; text-align: left; transition: background .15s, color .15s; }
.shell-nav:hover { background: var(--c-brand-soft); color: var(--c-brand); }
.shell-nav.active { background: var(--c-brand-soft); color: var(--c-brand); font-weight: 600; }
.shell-nav-ic { font-size: 17px; }
.shell-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
</style>
```

- [ ] **Step 5: main.ts（全量 EP，沿用 set/main.ts 注册方式 + router）**

```ts
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import './tokens.css'
import { router } from './router'
import AppShell from './AppShell.vue'

const app = createApp(AppShell)
app.use(ElementPlus, { locale: zhCn })
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component as never)
}
app.use(router)
app.mount('#app')
```

- [ ] **Step 6: vite.config.ts 增 console 入口**

在 `WINDOW_ENTRIES` 增加：`console: resolve(rendererRoot, "console.html"),`（保留 render；index/set/printLog/softwareLog 暂留，Task 10 再删）。

- [ ] **Step 7: 构建验证**

Run: `cross-env VITE_WINDOW=console npx vite build`（Windows PowerShell: `$env:VITE_WINDOW="console"; npx vite build`）
Expected: 产出 `assets/console.html` 与 `assets/assets/console-*.js`，无报错。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/console.html src/renderer/app/windows/console vite.config.ts
git commit -m "feat(console): SPA shell with sidebar nav + hash router skeleton"
```

---

## Task 3-6 通用迁移规则（视图）

每个视图从原 `App.vue` 复制到 `console/views/<Name>.vue`，并施加：
1. 删除 `<style>` 中的 `:root{...}`、`html,body{...}`、`#app{...}` 三类全局规则（已由 tokens.css 接管）。
2. 模板最外层根元素加视图类（见各任务），`<style>` 内所有顶层选择器前缀该类（如 `.topbar` → `.cv-software-log .topbar`）。保留作用于 v-html 的选择器（如 `.hl`），同样前缀根类。
3. 视图根元素改为填充内容区：`height:100%`（或 `flex:1; min-height:0`），不再 `100vh`。
4. import 路径 `@/shared/...` 不变（alias 仍指向 app）。

---

## Task 3: 迁移 SoftwareLogView（最简，无 EP 依赖）

**Files:**
- Create: `src/renderer/app/windows/console/views/SoftwareLogView.vue`
- Reference: `src/renderer/app/windows/softwareLog/App.vue`
- Modify: `console/router.ts`

**Interfaces:**
- Consumes: `window.hiprintSoftwareLog`（Task 1）。

- [ ] **Step 1:** 复制 softwareLog/App.vue → SoftwareLogView.vue。模板根 `<div class="topbar">` 等顶层元素包进一个新根 `<div class="cv-software-log"> … </div>`（含 topbar、ConfirmDialog、console-wrap、footer）。
- [ ] **Step 2:** 按通用规则删全局 style（`:root`/`html,body`/`#app`），其余选择器前缀 `.cv-software-log `。`.cv-software-log{ display:flex; flex-direction:column; height:100%; }`。
- [ ] **Step 3:** router.ts 把 `softwareLog` 路由 component 改为 `() => import('./views/SoftwareLogView.vue')`。
- [ ] **Step 4: 构建验证** `$env:VITE_WINDOW="console"; npx vite build` → 无报错。
- [ ] **Step 5: Commit** `git commit -m "feat(console): migrate SoftwareLogView into SPA route"`

---

## Task 4: 迁移 PrintLogView

**Files:**
- Create: `console/views/PrintLogView.vue`; Reference: `printLog/App.vue`; Modify: `router.ts`

**Interfaces:** Consumes `window.hiprintPrintLog`。

- [ ] **Step 1:** 复制 printLog/App.vue → PrintLogView.vue，根元素包 `<div class="cv-print-log">`。
- [ ] **Step 2:** 通用 style 规则，前缀 `.cv-print-log `；`.cv-print-log{ display:flex; flex-direction:column; height:100%; }`。el-table/el-pagination 由全量 EP 全局解析，无需改 import。
- [ ] **Step 3:** router.ts `printLog` 路由 → `() => import('./views/PrintLogView.vue')`。
- [ ] **Step 4: 构建验证** 同上。
- [ ] **Step 5: Commit** `git commit -m "feat(console): migrate PrintLogView into SPA route"`

---

## Task 5: 迁移 StatusView（连接状态，去开新窗）

**Files:**
- Create: `console/views/StatusView.vue`; Reference: `index/App.vue`; Modify: `router.ts`

**Interfaces:** Consumes `window.hiprintIndex`。

- [ ] **Step 1:** 复制 index/App.vue → StatusView.vue，根 `<div class="box">` 改为 `<div class="cv-status">`（合并原 .box/.container 职责）。
- [ ] **Step 2:** 通用 style 规则，前缀 `.cv-status `；`.cv-status{ height:100%; display:flex; flex-direction:column; overflow:hidden; }`。删除原 `body{...}` 全局规则（user-select 已移到 tokens.css）。
- [ ] **Step 3:** 顶栏"设置"图标点击 `openSetting()` 改为同窗导航：`import { useRouter } from 'vue-router'`，`const router = useRouter()`，`@click="router.push('/settings')"`。保留 `ipc.send('openSetting')` 删除（不再开独立设置窗）。
- [ ] **Step 4:** router.ts `status` 路由 → `() => import('./views/StatusView.vue')`。
- [ ] **Step 5: 构建验证** 同上。
- [ ] **Step 6: Commit** `git commit -m "feat(console): migrate StatusView; in-app nav to settings"`

---

## Task 6: 迁移 SettingsView（去 setContentSize / 重绑关闭）

**Files:**
- Create: `console/views/SettingsView.vue`; Reference: `set/App.vue`; Modify: `router.ts`

**Interfaces:** Consumes `window.hiprintSet`。

- [ ] **Step 1:** 复制 set/App.vue → SettingsView.vue，根元素包 `<div class="cv-settings">`。
- [ ] **Step 2:** 通用 style 规则，前缀 `.cv-settings `；`.cv-settings{ height:100%; overflow:auto; }`。
- [ ] **Step 3:** 删除 `setContentSize` 相关：移除 `onMounted`/`onBeforeUnmount` 中调用 `ipc.send('setContentSize', …)` 的逻辑与 `document.querySelector('#app')` 量高代码（统一窗口不再按内容改尺寸）。
- [ ] **Step 4:** `closeSetWindow` 调用（如"取消"按钮 `ipc.send('closeSetWindow')`）改为 `router.back()`（`useRouter`）。保存成功仍走主进程 relaunch（不变）。
- [ ] **Step 5:** router.ts `settings` 路由 → `() => import('./views/SettingsView.vue')`。
- [ ] **Step 6: 构建验证** 同上。
- [ ] **Step 7: Commit** `git commit -m "feat(console): migrate SettingsView; drop window-resize coupling"`

---

## Task 7: 主进程控制台窗口所有者（app-window.js）

**Files:**
- Create: `src/app-window.js`
- Reference: `src/softwareLog.js`（loadURL/诊断打点形态）、`src/loading-view.js`

**Interfaces:**
- Produces: `module.exports = { getAppWindow, showConsole, prewarmConsole, destroyConsole }`。
  - `getAppWindow(): BrowserWindow | null`
  - `showConsole(route?: string): Promise<void>` — 无窗则建+预加载；有窗则 show；随后 `webContents.send('console:navigate', route)`。
  - `prewarmConsole(): Promise<void>` — 后台建隐藏窗口预热，不 show。
  - `destroyConsole(): void` — 置真销毁标志并 destroy（退出/重启用）。
- Consumes: `getAssetUrl`（asset-url）、`attachLoadingView`（loading-view）、`preload/console.js`。

- [ ] **Step 1: 写 app-window.js**

```js
"use strict";
const { app, BrowserWindow } = require("electron");
const path = require("path");
const { getAssetUrl } = require("./asset-url");
const { attachLoadingView } = require("./loading-view");

let appWindow = null;
let reallyClose = false;

function buildWindow() {
  const windowOptions = {
    width: 1080, height: 640, minWidth: 1040, minHeight: 560,
    show: false,
    title: "hiPrint 控制台",
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, "preload/console.js"),
    },
  };
  const win = new BrowserWindow(windowOptions);
  attachConsoleDiagnostics(win, Date.now());
  attachLoadingView(win, windowOptions, getAssetUrl("loading.html"));
  // 关闭 = 隐藏复用；仅 destroyConsole() 置标志后真正销毁
  win.on("close", (event) => {
    if (!reallyClose) { event.preventDefault(); win.hide(); }
  });
  win.on("closed", () => { appWindow = null; });
  win.loadURL(getAssetUrl("console.html")).catch((e) =>
    console.error(`控制台窗口：loadURL 失败 ${e && e.message ? e.message : e}`));
  if (!app.isPackaged) win.webContents.openDevTools();
  return win;
}

function ensureWindow() {
  if (!appWindow || appWindow.isDestroyed()) appWindow = buildWindow();
  return appWindow;
}

async function prewarmConsole() { ensureWindow(); }

async function showConsole(route) {
  const win = ensureWindow();
  if (!win.isVisible()) win.show();
  win.focus();
  const target = route || "/status";
  // 渲染端就绪后再发导航，避免早于 router 挂载
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => win.webContents.send("console:navigate", target));
  } else {
    win.webContents.send("console:navigate", target);
  }
}

function destroyConsole() {
  reallyClose = true;
  if (appWindow && !appWindow.isDestroyed()) appWindow.destroy();
  appWindow = null;
}

function getAppWindow() { return appWindow; }

function attachConsoleDiagnostics(win, openedAt) {
  const elapsed = () => Date.now() - openedAt;
  win.webContents.once("dom-ready", () => console.log(`控制台窗口：dom-ready ${elapsed()}ms`));
  win.webContents.once("did-finish-load", () => console.log(`控制台窗口：did-finish-load ${elapsed()}ms`));
  win.webContents.once("did-fail-load", (_e, code, desc, url) =>
    console.error(`控制台窗口：did-fail-load ${elapsed()}ms ${code} ${desc || ""} ${url || ""}`));
  win.webContents.once("render-process-gone", (_e, d) =>
    console.error(`控制台窗口：render-process-gone ${elapsed()}ms ${d.reason}`));
}

module.exports = { getAppWindow, showConsole, prewarmConsole, destroyConsole };
```

- [ ] **Step 2: 语法验证** `node -e "require('./src/app-window.js'); console.log('app-window loads')"`（Electron API 在 require 时不执行，仅校验语法）。Expected: `app-window loads`（若因 electron 模块缺失报错，改用 `node --check src/app-window.js` 仅做语法检查，Expected: 无输出=通过）。
- [ ] **Step 3: Commit** `git commit -m "feat(console): app-window owner with prewarm + hide-on-close reuse"`

---

## Task 8: IPC 常驻注册（console-ipc.js）

**Files:**
- Create: `src/console-ipc.js`
- Reference: `src/set.js`、`src/printLog.js`、`src/softwareLog.js`（搬业务函数）

**Interfaces:**
- Produces: `module.exports = { registerConsoleIpc }`。`registerConsoleIpc()` 一次性注册全部 4 窗口 IPC handler，目标窗口统一取 `getAppWindow()`。
- Consumes: `getAppWindow`（app-window）、`software-log-store`、`tools/database`、`log-query-guard`、`helper`、`tools/utils.store`。

- [ ] **Step 1:** 新建 console-ipc.js，把以下搬入并改造（逐一保留原逻辑，仅把 `SET_WINDOW`/`PRINT_LOG_WINDOW`/`SOFTWARE_LOG_WINDOW` 替换为 `getAppWindow()`，`event.sender`/`event.reply` 不变）：
  - set 业务：`setConfig`(relaunch 不变)、`showOpenDialog`、`openDirectory`、`testTransit`、`getPrintersList`、`closeSetWindow`(改为 no-op 或移除，渲染端已用 router.back)、`setContentSize`(移除)。`dialog.showMessageBox(getAppWindow(), …)`。
  - printLog 业务：`fetchPrintLogs`(request-logs)、`clearPrintLogs`(clear-logs)、`rePrint`(reprint，仍发 `PRINT_WINDOW`)。
  - softwareLog 业务：`software-log:list-dates/read/clear`(invoke handler)、`software-log:open-folder`。
  - index 侧（原在 main.js 的 getMachineId/getAddress/getConnectionStatus/openSetting/clipboard-write）：openSetting 不再开窗，改为 `showConsole('/settings')`；其余保留，推送目标 `getAppWindow().webContents`。
- [ ] **Step 2:** `registerConsoleIpc()` 用 `ipcMain.handle`/`ipcMain.on` 一次注册；**注册前先 removeHandler/removeListener 幂等**，避免热重载重复注册。
- [ ] **Step 3: 语法验证** `node --check src/console-ipc.js`。Expected: 无输出。
- [ ] **Step 4: Commit** `git commit -m "feat(console): resident IPC registration retargeted to app window"`

---

## Task 9: main.js 接线（预热 / 托盘 / server 生命周期解耦）

**Files:**
- Modify: `main.js`

- [ ] **Step 1:** 顶部 require：增 `const { showConsole, prewarmConsole, destroyConsole } = require("./src/app-window");` `const { registerConsoleIpc } = require("./src/console-ipc");`；移除 `printLogSetup`/`softwareLogSetup`/`setSetup` 的 require（Task 10 删文件）。
- [ ] **Step 2:** app ready 流程：保留主窗口（若主窗口仍作连接状态承载则改为不再单独建——本计划合并后**不再建独立 MAIN_WINDOW**；连接状态是控制台 /status 视图）。在原 `createWindow()` 位置改为 `registerConsoleIpc()` + `await prewarmConsole()`。启动可见性：若非 `--openAsHidden`，`showConsole('/status')`；否则仅预热不 show。
- [ ] **Step 3:** socket server 生命周期解耦：删除原 `MAIN_WINDOW.on('closed', () => server.close())`；改为 `app.on('before-quit', () => { try { server.close(); } catch {} })`。
- [ ] **Step 4:** 托盘菜单 4 项改路由：`显示主窗口`→`showConsole('/status')`；`设置`→`showConsole('/settings')`；`软件日志`→`showConsole('/software-log')`；`打印记录`→`showConsole('/print-log')`。删除对 `SOFTWARE_LOG_WINDOW`/`PRINT_LOG_WINDOW`/`openSetWindow` 的判空开窗逻辑。
- [ ] **Step 5:** 退出/重启路径（重启软件、relaunch、quit）调用 `destroyConsole()` 后再 `app.exit()/relaunch()`。`window-all-closed` 行为：托盘常驻应用，保持原"不退出"语义。
- [ ] **Step 6:** 连接状态推送目标：原 `MAIN_WINDOW.webContents.send(...)` 全改 `getAppWindow()?.webContents.send(...)`（socket 状态/printTask 等）。grep `MAIN_WINDOW` 确保无遗留引用。
- [ ] **Step 7: 启动冒烟** `npx electron .`（dev）→ 托盘点击各项切换路由，连接状态实时刷新，关窗后再点秒开。Expected: 控制台四视图可见、无 spinner 滞留、切换无新开窗。
- [ ] **Step 8: Commit** `git commit -m "feat(console): wire prewarm/tray-routing; decouple socket server from window"`

---

## Task 10: 构建入口缩减 + 删除旧窗口/preload/模块

**Files:**
- Modify: `vite.config.ts`, `tools/build-renderer.js`
- Delete: 旧 html/windows/preload/src 窗口模块

- [ ] **Step 1:** `vite.config.ts` `WINDOW_ENTRIES` 改为仅 `console` + `render`，删除 index/set/printLog/softwareLog 四项。
- [ ] **Step 2:** `tools/build-renderer.js` 逐窗口构建列表改为 `["console","render"]`（参照原逐窗口循环）。
- [ ] **Step 3:** 删除文件：`src/renderer/{index,set,printLog,softwareLog}.html`、`src/renderer/app/windows/{index,set,printLog,softwareLog}/`、`src/preload/{index,set,printLog,softwareLog}.js`、`src/set.js`、`src/printLog.js`、`src/softwareLog.js`。
- [ ] **Step 4:** grep 残留引用 `require("./src/set")|./src/printLog|./src/softwareLog|preload/index.js|preload/set.js`，清理。
- [ ] **Step 5: 全量构建** `npx node tools/build-renderer.js`（或既有构建命令）。Expected: 仅产出 console + render 两套，无对已删入口的引用报错。
- [ ] **Step 6: Commit** `git commit -m "refactor(console): collapse renderer entries to console+render; remove legacy windows"`

---

## Task 11: 验证（repro 计时改造 + 安装态清单）

**Files:**
- Modify: `tools/repro/runtime/log-window-domready-timing.js`（加 console 入口、断言路由切换不新开窗）

- [ ] **Step 1:** timing 探针增加 console 目标：开 console.html，记录 cold/warm dom-ready；`webContents.send('console:navigate','/software-log')` 后用 `executeJavaScript` 断言 `location.hash === '#/software-log'` 且未产生新 `BrowserWindow.getAllWindows().length` 增量。
- [ ] **Step 2:** Run: `npx electron tools/repro/runtime/log-window-domready-timing.js`。Expected: `TIMING_RESULT` 含 console cold/warm，`failed:false`。
- [ ] **Step 3: 安装态验证（必须，完成标准）** 按下列清单：
  - 打新版本 exe（或在线升级后），托盘打开控制台。
  - 切换 连接状态/设置/打印记录/软件日志 四视图，截图或 DOM/text 断言各视图可见、无 loading spinner。
  - 关闭控制台 → 再次托盘打开，dom-ready 显著低于首开（命中常驻），目标 < 300ms。
  - SQLite 有 `控制台窗口：dom-ready/did-finish-load` 日志；无 `did-fail-load`/`render-process-gone`/preload 缺桥。
  - 回归：设置保存→relaunch 正常；打印记录分页/重打；软件日志清空/筛选/高亮；连接状态实时刷新；render 打印不受影响。
- [ ] **Step 4: Commit** `git commit -m "test(console): console dom-ready timing + no-new-window route assertion"`

---

## Self-Review 结论
- Spec 覆盖：合并范围/导航/路由/生命周期/预热/托盘/尺寸/CSS 隔离/preload 合并/IPC 常驻/server 解耦/构建缩减/render 不动/测试——均有对应任务。
- 类型一致：`getAppWindow`/`showConsole`/`prewarmConsole`/`destroyConsole`/`registerConsoleIpc`、路由名 `/status /settings /print-log /software-log`、桥名四个，全计划一致。
- 无 placeholder：搬运任务给出机械规则与具体改点；核心新文件给完整代码。
- 风险点已在 Task 9/10 用 grep 残留 + dev 冒烟 + 安装态清单兜住。
