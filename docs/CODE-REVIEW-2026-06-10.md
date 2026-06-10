# electron-hiprint 全面审查报告

- 日期：2026-06-10
- 范围：安全 / Bug 与质量 / 冗余与死代码 / UI 审计与重构
- 方法：3 个并行只读审查 agent（安全、Bug/质量、冗余）+ 人工 UI 审计 + SVG 重构稿
- 当前分支：master（版本 1.0.29，下次自动发包为 1.0.30）

> ⚠️ 说明：以下为 agent 审查产出的**待核实清单**。按「调查优先」纪律，进入修复阶段前每条需对照真实代码二次确认（标注「已交叉印证」的为两个 agent 独立命中、置信度高）。本报告仅为审查结论，**未改动任何代码**。

---

## 修复记录（2026-06-10 安全加固批次）

已落地的高危/安全修复(均经真实代码核实 + 回归诊断 observed=0)：

| 项 | 处置 | 文件 |
|---|---|---|
| C-1 `store-get` 任意 key | 收紧为 3 key 白名单(`mainTitle`/`pluginVersion`/`rePrint`)，杜绝 token 泄露 | `main.js` |
| C-2 printLog SQL 注入 ✅交叉印证 | 新增纯守卫 `buildSafeLogQuery`(条件白名单 + 占位符校验 + 分页强制整数) | `src/log-query-guard.js`(新)、`src/printLog.js` |
| C-3 url_pdf SSRF | 下载前协议/字面量主机校验 + DNS 重绑定二次校验解析后 IP | `tools/utils.js`、`src/pdf-print.js` |
| C-4 unixPrintOptions 命令注入 | `lp` 选项 token 白名单净化 | `src/pdf-print.js` |
| H-1 token 明文日志 | 认证失败日志移除 `providedToken` | `tools/utils.js` |
| H-2 openDirectory 任意文件执行 | `shell.openPath` 前校验为真实目录 | `src/set.js` |
| H-6 下载健壮性(附带) | 校验 HTTP 200 + 写盘错误清理临时文件 | `src/pdf-print.js` |

回归诊断：`tools/repro/security/log-query-guard-check.js`(7 断言)、`tools/repro/security/security-hardening-check.js`(6 守卫)。

**待决策(行为变更，未静默改动)：**
- H-3 收紧 `render.html`/`print.html` 的 CSP `connect-src`/`img-src` — 会影响打印模板加载远程图片，需确认是否允许远程素材。
- H-4 手写 `sanitizeNode` 换 DOMPurify — 新增依赖，改动较大。
- H-6 `highestAvailable` → `asInvoker` — 涉及提权行为变更，与近期打包配置相关，需确认是否有提权需求。
- 可靠性 CRITICAL(render 队列 `socket.id` 死锁、`MAIN_WINDOW` 判空、`showMessageBox` 双注册)属独立批次，非本次安全范围。

---

## 0. 总览

| 维度 | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|---|
| 安全审计 | 4 | 6 | 6 | 4 |
| Bug / 质量 | 2 | 6 | 7 | 5 |
| 冗余 / 死代码 | 死代码 3 项 · 待核实删除 4 项 · 可合并 8 项 · 残留 debug 1 项 | | | |

**最高优先（建议发 1.0.30 前处理）：**

1. **printLog SQL 注入**（`src/printLog.js` `condition` 数组拼接）— ✅ 已交叉印证（安全 C-2 + Bug CRITICAL-3）
2. **`hiprint:store-get` 任意 key 读取**，泄露 `token`/`transitToken`（`main.js:256`）— 安全 C-1
3. **`url_pdf` 类型 SSRF**（`src/pdf-print.js` 未校验 URL）— 安全 C-3
4. **render runner 因 `socket.id` 空指针死锁**（`src/render.js` 错误日志路径）— Bug CRITICAL-1
5. **`MAIN_WINDOW` 关闭后 in-flight 打印回调空指针崩溃**（`src/print.js` 多处 `MAIN_WINDOW.webContents.send`）— Bug HIGH-1

---

## 1. 安全审计

### CRITICAL

- **C-1 `hiprint:store-get` 通用 IPC 暴露整个持久化存储**
  `main.js:256-257` — `event.returnValue = store.get(key)` 接受任意 key，渲染进程可读 `token`、`transitToken`。`hiprint:settings-snapshot`（line 263）本是为此加的白名单，但通用 handler 未移除。
  修复：删除通用 handler 或限制为非敏感 key 白名单。

- **C-2 `fetchPrintLogs` SQL 注入（condition 数组）** ✅交叉印证
  `src/printLog.js:105-107` — `query += " WHERE " + condition.join(" AND ")`，condition 字符串来自渲染进程，未校验。`LIMIT/OFFSET` 也直接由 `page.pageSize` 插值。
  修复：condition 改为服务端按白名单参数化构造，`pageSize/currentPage` 强制转正整数。

- **C-3 `url_pdf` 任意 HTTP(S) URL 无 SSRF 防护**
  `src/pdf-print.js:66-91` — 任一已认证 socket 客户端可发 `type:"url_pdf", pdf_path:"http://169.254.169.254/..."` 触发内网/云元数据请求。`tools/utils.js:486` 已有 `getIppTargetError` SSRF 守卫但未用于此路径。
  修复：复用现有 `isBlockedIPv4/isBlockedIPv6` 守卫拦截 loopback/RFC1918/link-local。

- **C-4 `unixPrintOptions` 直传 `lp` 命令（命令注入面）**
  `src/pdf-print.js:50` — 非 Windows 平台把 socket 消息里的 `unixPrintOptions` 数组原样传给 `unix-print` 的 `lp`，含 shell 元字符时存在注入风险。
  修复：按安全 `lp` 选项白名单校验，拒绝含空格/引号/`;`/`&&`/`|`/反引号/`$` 的项。

### HIGH（择要）

- **H-1** `tools/utils.js:859` 认证失败时把攻击者提交的 token 明文写日志 → 暴力破解 oracle。删除 `providedToken` 日志。
- **H-2** `src/set.js:222` `openDirectory` → `shell.openPath(data)` 未校验，Windows 上可执行 `.exe/.bat`。改为先 `statSync(...).isDirectory()`。
- **H-3** `assets/render.html:7` / `print.html:13` CSP 的 `connect-src`/`img-src` 放开 `http: https:`，渲染窗口处理远程打印内容时可外泄数据。`render.html` 收紧到 `'self'`。
- **H-4** `sanitizeNode` 手写白名单不覆盖 CSS/`<base>`/`<meta refresh>`/SVG `<use>`/`<animate>` 等绕过向量。建议换 DOMPurify。
- **H-5** `printLog.html:359` 由 `Object.keys(searchData)` 拼 SQL 列名，未校验列白名单。
- **H-6** `package.json:90` `requestedExecutionLevel: highestAvailable` 让管理员组用户以管理员令牌运行，放大 XSS/IPC 提权影响面。无明确提权需求应改 `asInvoker`。

### MEDIUM / LOW（摘要）

- M-1 中转连接信任：建立后服务端可不经用户确认下发打印/导出指令，无每任务授权/限流。
- M-2 `setConfig` 直接 `store.set(data)` 整个渲染对象，缺字段级校验。
- M-3 `reprint` 反序列化旧 `data` 重放，绕过 ingest 期校验。
- M-4 `render.html` 用 `pluginVersion` 拼 `<script>/<link>` 路径，未做 semver 校验（路径穿越面）。
- M-5 socket token 认证无限流/锁定。
- M-6 `PRINT_FRAGMENTS_MAPPING` 由客户端 `id` 索引、无上限，可内存耗尽。
- L：三个主窗口 CSP 用 `'unsafe-eval'`（Vue2 模板编译需要）；macOS 未签名；`publish:null` 但保留在线更新代码。

### 已有的良好安全控制（正面）

所有窗口 `contextIsolation+sandbox+nodeIntegration:false`；preload 双向 channel 白名单；`hiprint:settings-snapshot` 固定 key；IPP 的 SSRF 黑名单完善；导出目录 `realpathSync`+`path.relative` 防穿越；在线升级强制 HTTPS+域名锁定+SHA-256；写库全参数化；导出扩展名黑名单拦截可执行文件。

---

## 2. Bug 与质量

### CRITICAL

- **CRITICAL-1 render runner 死锁（`socket.id` 空指针）**
  `src/render.js` 错误日志路径（约 line 355、218、291）无 `socket?.id` 守卫；transit 客户端在任务入队与派发之间断开时 `socket` 为 null，`socket.id` 抛错先于 `RENDER_RUNNER_DONE`，render 队列永久卡死。`src/print.js` 已正确用可选链，render 未对齐。
  修复：全路径改 `socket?.id`。

- **CRITICAL-2 / CRITICAL-3 SQL 注入** 同安全 C-2（已交叉印证）。

### HIGH（择要）

- **HIGH-1** `src/print.js` 多处 `MAIN_WINDOW.webContents.send(...)`（line 105/207/229/281/308/358/425）未判空；`closeType=quit` 关主窗口后 in-flight 任务回调触发 `null` 崩溃。加 `MAIN_WINDOW && !MAIN_WINDOW.isDestroyed()` 守卫。
- **HIGH-2** `showMessageBox` 在 `render.js:474` 与 `set.js:302` **同名 channel 双重注册**，两窗口同开时一次调用弹两个对话框。改用不同 channel 名。
- **HIGH-3** `src/printLog.js:183` `rePrint` 的 `JSON.parse(row.data)` 无 try/catch，`data.id` 未校验正整数。
- **HIGH-4** `src/print.js:431` `checkPrinterStatus` 的 `setInterval` 回调访问 `PRINT_WINDOW.webContents` 未判空/判 destroyed；打印机持续 busy 时 success 永不回调，客户端静默超时。
- **HIGH-5** `tools/utils.js:279` `addressAll` 在 `address.mac` 失败时把 Error 对象当 `mac` 字段（`addressMac` 已修，此处漏修）。
- **HIGH-6** `src/pdf-print.js:67` HTTP 下载 PDF 不校验 `res.statusCode`、无 `file` error handler，非 200/写盘失败时把空/损坏文件送打印且不清理临时文件。

### MEDIUM / LOW（摘要）

- M-1 `startLocalServices` 在 `listen` 成功前置 `localServicesStarted=true` 且无重试/无 UI 告警，端口占用时 UI 仍显示「运行中」但不接受连接。
- M-2 `tools/database.js:50` 迁移靠 `err.message.includes("duplicate column")` 字符串匹配，脆弱；建议 `PRAGMA table_info` 或版本化迁移表。
- M-3 `printByFragments` 不校验 `index<total`，大 index 致稀疏数组 OOM。
- M-5 `tools/code_compress.js:92` UglifyJS 出错返回 `{error}` 时把 `undefined` 写回源文件，永久损坏（有 backup 但需手动 restore）。
- M-6 `src/printLog.js:141` 硬编码 `+8` 小时时区，非 UTC+8 用户时间错误。
- M-7 `src/render.js:183` 用固定 `setTimeout(50ms)` 等滚动完成，慢硬件下多页截图位置错误。
- L：`helper.js` quit 时未清理 `RENDER_WINDOW/PRINT_LOG_WINDOW`；`clearPrintLogs` 无回调吞错；`rename.js`/`start.js` 构建脚本健壮性小问题。

---

## 3. 冗余与死代码

### 可安全删除（死代码）

- **`havePrinter`** 已赋值从未读取 — `src/print.js:64`（line 84 赋值）+ `src/render.js:322`（line 349 赋值），共 4 行。全仓库无 `if (havePrinter)` 分支。
- **`randomStr`** 函数定义后从未调用 — `src/pdf-print.js:21-25`，已被 `uuidv7()` 取代。
- **注释掉的 `openDevTools`** — `src/print.js:41-43`，其余四窗口为活跃调用，此处为残留注释。

### 谨慎核实后删除

- `getPluginDir` / `setCurrentPluginVersion` 从 `src/plugin-sync.js` 导出但仅模块内调用 → 可从 `module.exports` 移除（函数保留为私有）。
- `availableVersions`：`resolveBuiltinPluginVersion` 计算并返回但 `main.js:428` 调用方丢弃 → 可省去一次 `getCompatiblePluginVersions` 调用。
- `fileExist` 方法定义未调用 — `tools/code_compress.js:130-135`。
- `PLUGIN_PACKAGE_REGISTRY_PATH` 单次使用的中间常量（`src/plugin-package.js:7`），可内联。低优先。

### 可合并 / 重构

- **`loadingView` 三处近乎一致的拷贝** — `main.js:440` + `src/set.js:72` + `src/printLog.js:62`，仅父窗口变量不同。建议抽到 `src/helper.js` 的 `createLoadingView(parentWindow, windowOptions)`。
- **`ENABLE_STATUS` 在 `print.js` 定义两次**（line 69 + 451），且 `render.js:printFun`（325-350）以 if/else 形式重复同一逻辑。建议提到模块级常量并统一打印机状态校验。
- **`showMessageBox` 双重注册** — `set.js:302` + `render.js:474` 注册同名 channel，两 handler 均硬编码 `SET_WINDOW` 为父窗口。✅ 与 Bug HIGH-2 交叉印证。建议合并到单一 handler，按 `event.sender` 选父窗口。
- `formatArgvs` 在 `code_compress.js` 与 `rename.js` 重复（构建工具，低优先）。
- `getDefaultPluginVersion`（`tools/utils.js:92`）重复 `plugin-sync.js` 的插件目录解析逻辑。低优先。
- `DEFAULT_EXPORT_ALLOWED_EXTENSIONS`（26 项）在 `tools/utils.js:324` 常量与 `:187` schema 默认值各写一份，需保持同步 → schema 改为引用常量。
- `tools/code_compress.js` 手写递归 `mkdir` 可换 `fs.mkdirSync(p,{recursive:true})`。

### 残留 debug

- **`src/set.js:281` `console.log(data)`** 在中转测试生产路径，输出服务器拓扑（连接数/内存）到日志，且带 TODO 注释。应删除或转结构化日志。

### 确认「非死代码」（避免误删）

- `bwip-js`/`nzh`/`jsbarcode`/`jquery` 由 `assets/render.html` 运行时加载。
- `online-update.js`（纯网络/加密/下载层）vs `online-upgrade-runner.js`（Electron 对话框/托盘编排层）职责清晰、无重叠。
- `plugin-package.js`（纯路径，无 Electron）vs `plugin-sync.js`（运行时解析，需 Electron app）vs `sync-builtin-plugin.js`（构建期 npm 拉取）三层分离、无重叠。

---

## 4. UI 审计与重构

### 现状问题（共 4 个用户可见窗口）

- **主窗口 `index.html`（500×300）**：50px 巨标题挤占空间、blob 色块背景陈旧、状态语义模糊；齿轮设置图标 hover 才显示，发现性差；全部「标签：值」平铺无层级。
- **设置 `set.html`**：字段平铺无分组；下划线 tab 视觉弱；占位说明与正式值难分辨。
- **打印日志 `printLog.html`**：成功/失败纯文字无视觉区分；表头与数据对比弱；筛选与表格同层。
- **加载 `loading.html`**：Ant 风四点动画，可保留或统一为新视觉。

### 重构方向（已出 SVG 稿，见 `docs/ui-redesign/`）

统一设计系统：系统字体栈、语义色板（蓝主色 / 绿连接 / 琥珀打印中 / 红错误）、12px 圆角卡片、状态药丸与圆点、等宽字体呈现地址/ID。**数据字段一一对应，零新增/删除**，仅重排层级与视觉语言；主窗口尺寸保持 500×300 不变。

- `01-main-window.svg/png` — 主窗口 Before/After
- `02-settings.svg/png` — 设置 Before/After
- `03-print-log.svg/png` — 打印日志 Before/After

**状态：待用户审查设计方向，确认后再落地实现。**
