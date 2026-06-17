<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { requireBridge } from '@/shared/bridge'

// 软件日志是一个轻量日志查看器：日期下拉 + 级别下拉 + 搜索框 + 两个图标按钮。
// 这些都是原生控件等价物，故本窗口刻意不引入 element-plus —— 否则仅 el-select 一个组件
// 就会拖进 Popper/Tooltip/FocusTrap/Tag 整套浮层机器（实测 ~244KB JS），渲染进程要
// compile+execute 这套机器才触发 dom-ready，造成托盘打开白屏近 1s。改用原生 <select>/
// <input>/<button> + 内联 SVG 后，包体只剩 Vue+应用（见
// .investigations/2026-06-17-log-window-dom-ready-full-element-plus.md 第 11 节）。

// Electron preload 桥接（src/preload/softwareLog.js）。缺失即在窗口初始化期抛错（说明未经正确 preload 加载）。
const ipc = requireBridge(window.hiprintSoftwareLog, 'hiprintSoftwareLog', 'preload/softwareLog.js')

interface DisplayLine {
  ts: string
  level: string
  html: string
}

const dates = ref<string[]>([])
const currentDate = ref('')
const levelFilter = ref('')
const keyword = ref('')
const lines = ref<HiprintSoftwareLogLine[]>([])
const sourceDay = ref('')
const truncated = ref(false)
const consoleEl = ref<HTMLElement | null>(null)

// HTML 转义，避免日志正文中的标签被当作 DOM 注入（v-html 渲染前必须转义）
function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeRegExp(str: string): string {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const filteredLines = computed<DisplayLine[]>(() => {
  const kw = keyword.value.trim()
  const kwLower = kw.toLowerCase()
  const level = levelFilter.value
  // 级别筛选时把 verbose/silly 归入相近大类，保持 UI 简洁
  const levelMatch = (lineLevel: string): boolean => {
    if (!level) return true
    if (level === 'info') return lineLevel === 'info' || lineLevel === 'verbose'
    if (level === 'debug') return lineLevel === 'debug' || lineLevel === 'silly'
    return lineLevel === level
  }

  // 高亮作用在“已 HTML 转义”的文本上，故正则须用“转义后的关键字”构建，
  // 否则含 < > & " ' 的关键字（如 <info>）虽通过筛选却高亮不到（基准不一致）。
  // 筛选仍用原始 msg（下方 indexOf），保持“哪些行显示”这一行为完全不变。
  const re = kw ? new RegExp('(' + escapeRegExp(escapeHtml(kw)) + ')', 'gi') : null

  const result: DisplayLine[] = []
  lines.value.forEach((line) => {
    if (!levelMatch(line.level)) return
    const msg = line.msg || ''
    if (kw && msg.toLowerCase().indexOf(kwLower) === -1) return
    let html = escapeHtml(msg)
    if (re) {
      // 在已转义文本上高亮匹配项
      html = html.replace(re, '<span class="hl">$1</span>')
    }
    result.push({ ts: line.ts, level: line.level, html })
  })
  return result
})

const footerSource = computed(() =>
  sourceDay.value ? 'sqlite/software_logs · ' + sourceDay.value : 'sqlite/software_logs',
)

const footerCount = computed(() => {
  const shown = filteredLines.value.length
  const total = lines.value.length
  if (shown === total) {
    return total.toLocaleString() + ' 行'
  }
  return shown.toLocaleString() + ' / ' + total.toLocaleString() + ' 行'
})

function scrollToBottom(): void {
  const el = consoleEl.value
  if (el) {
    el.scrollTop = el.scrollHeight
  }
}

async function loadDate(date: string): Promise<void> {
  if (!date) {
    lines.value = []
    sourceDay.value = ''
    truncated.value = false
    return
  }
  try {
    const res = await ipc.read(date)
    const safe = res || ({} as HiprintSoftwareLogPayload)
    lines.value = Array.isArray(safe.lines) ? safe.lines : []
    sourceDay.value = safe.file || date
    truncated.value = !!safe.truncated
    nextTick(scrollToBottom)
  } catch {
    lines.value = []
    sourceDay.value = ''
    truncated.value = false
  }
}

function handleDateChange(date: string): void {
  void loadDate(date)
}

async function refresh(): Promise<void> {
  // 重新列出日期，保留当前选中（若仍存在），并重新读取
  try {
    const list = await ipc.listDates()
    dates.value = Array.isArray(list) ? list : []
  } catch {
    dates.value = []
  }
  if (currentDate.value && dates.value.indexOf(currentDate.value) === -1) {
    currentDate.value = dates.value[0] || ''
  } else if (!currentDate.value && dates.value.length) {
    currentDate.value = dates.value[0]
  }
  await loadDate(currentDate.value)
}

function openFolder(): void {
  ipc.openFolder()
}

onMounted(async () => {
  try {
    const list = await ipc.listDates()
    dates.value = Array.isArray(list) ? list : []
    if (dates.value.length) {
      currentDate.value = dates.value[0]
      await loadDate(currentDate.value)
    }
  } catch {
    dates.value = []
  }
})
</script>

<template>
  <div class="topbar">
    <span class="brand">
      <span class="brand-logo"><i></i><i></i><i></i></span>
      软件日志
    </span>

    <select
      class="sl-ctrl sl-date"
      v-model="currentDate"
      @change="handleDateChange(($event.target as HTMLSelectElement).value)"
    >
      <option v-if="!dates.length" value="" disabled>暂无日志</option>
      <option v-for="d in dates" :key="d" :value="d">{{ d }}</option>
    </select>

    <select class="sl-ctrl sl-level" v-model="levelFilter">
      <option value="">全部级别</option>
      <option value="info">INFO</option>
      <option value="warn">WARN</option>
      <option value="error">ERROR</option>
      <option value="debug">DEBUG</option>
    </select>

    <div class="sl-search">
      <svg class="sl-ic sl-search-ic" viewBox="0 0 1024 1024" aria-hidden="true">
        <path
          fill="currentColor"
          d="m795.904 750.72 124.992 124.928a32 32 0 0 1-45.248 45.248L750.656 795.904a416 416 0 1 1 45.248-45.248zM480 832a352 352 0 1 0 0-704 352 352 0 0 0 0 704"
        />
      </svg>
      <input v-model="keyword" type="text" placeholder="搜索关键字" />
      <button v-if="keyword" class="sl-search-clear" type="button" title="清除" @click="keyword = ''">
        &times;
      </button>
    </div>

    <span class="spacer"></span>

    <button class="sl-icon-btn" type="button" title="刷新" @click="refresh">
      <svg class="sl-ic" viewBox="0 0 1024 1024" aria-hidden="true">
        <path
          fill="currentColor"
          d="M771.776 794.88A384 384 0 0 1 128 512h64a320 320 0 0 0 555.712 216.448H654.72a32 32 0 1 1 0-64h149.056a32 32 0 0 1 32 32v148.928a32 32 0 1 1-64 0v-50.56zM276.288 295.616h92.992a32 32 0 0 1 0 64H220.16a32 32 0 0 1-32-32V178.56a32 32 0 0 1 64 0v50.56A384 384 0 0 1 896.128 512h-64a320 320 0 0 0-555.776-216.384z"
        />
      </svg>
    </button>
    <button class="sl-icon-btn" type="button" title="打开数据库目录" @click="openFolder">
      <svg class="sl-ic" viewBox="0 0 1024 1024" aria-hidden="true">
        <path
          fill="currentColor"
          d="M878.08 448H241.92l-96 384h636.16zM832 384v-64H485.76L357.504 192H128v448l57.92-231.744A32 32 0 0 1 216.96 384zm-24.96 512H96a32 32 0 0 1-32-32V160a32 32 0 0 1 32-32h287.872l128.384 128H864a32 32 0 0 1 32 32v96h23.04a32 32 0 0 1 31.04 39.744l-112 448A32 32 0 0 1 807.04 896"
        />
      </svg>
    </button>
  </div>

  <div class="console-wrap">
    <div class="console" ref="consoleEl">
      <template v-if="filteredLines.length">
        <div
          v-for="(line, idx) in filteredLines"
          :key="idx"
          class="log-row"
          :class="'row-' + line.level"
        >
          <span class="log-ts" v-if="line.ts">{{ line.ts }}</span>
          <span class="log-level" :class="'level-' + line.level">{{ line.level }}</span>
          <span class="log-msg" v-html="line.html"></span>
        </div>
      </template>
      <div v-else class="empty">
        {{ currentDate ? '没有匹配的日志记录' : '暂无日志记录' }}
      </div>
    </div>
  </div>

  <div class="footer">
    <span>{{ footerSource }}</span>
    <span>
      {{ footerCount }}
      <span v-if="truncated" class="truncated">· 已截断（仅显示末尾部分）</span>
    </span>
  </div>
</template>

<style>
/* ============================================================
   软件日志 · in-app 查看器（浅色主题，对齐 04-software-log.svg）
   顶栏品牌 + 日期下拉 + 级别筛选 + 关键字搜索高亮 + 刷新 + 打开数据库目录；
   下方按级别着色的 console 列表；底部当前 sqlite 表来源 + 行数。
   ============================================================ */
:root {
  --sl-brand: #3358e0;
  --sl-brand-soft: #eef2ff;
  --sl-brand-grad: linear-gradient(135deg, #4f7bff 0%, #3358e0 100%);
  --sl-info: #3358e0;
  --sl-info-soft: #eef2ff;
  --sl-warn: #b5740f;
  --sl-warn-soft: #fef3e2;
  --sl-warn-text: #8a6d3b;
  --sl-error: #c0392b;
  --sl-error-soft: #fdecec;
  --sl-debug: #8a93a3;
  --sl-debug-soft: #eef0f3;
  --sl-debug-text: #5b6472;
  --sl-text: #1a2233;
  --sl-text-2: #5b6472;
  --sl-text-3: #9aa3b2;
  --sl-border: #e6e9f0;
  --sl-page: #f4f6fa;
  --sl-card: #ffffff;
  --sl-console: #fbfcfe;
  --sl-radius-card: 12px;
  --sl-radius-ctrl: 7px;
  --sl-highlight: #fff2a8;
  --sl-font: 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif;
  --sl-mono: 'Cascadia Mono', 'Consolas', monospace;
  --sl-shadow: 0 1px 3px rgba(26, 34, 51, 0.06), 0 8px 24px rgba(26, 34, 51, 0.05);
}

html,
body {
  margin: 0;
  padding: 0;
  background: var(--sl-page);
  color: var(--sl-text);
  font-family: var(--sl-font);
  -webkit-font-smoothing: antialiased;
}

#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
}

/* ---------------- 顶栏 ---------------- */
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  height: 52px;
  background: var(--sl-card);
  border-bottom: 1px solid var(--sl-border);
  flex: 0 0 auto;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 15px;
  color: var(--sl-text);
  margin-right: 4px;
}

.brand-logo {
  width: 26px;
  height: 26px;
  border-radius: var(--sl-radius-ctrl);
  background: var(--sl-brand-grad);
  display: inline-flex;
  flex-direction: column;
  justify-content: center;
  gap: 2.5px;
  padding: 0 6px;
  box-sizing: border-box;
}

.brand-logo i {
  display: block;
  height: 1.6px;
  border-radius: 1px;
  background: #ffffff;
}
.brand-logo i:nth-child(1) {
  width: 100%;
}
.brand-logo i:nth-child(2) {
  width: 100%;
}
.brand-logo i:nth-child(3) {
  width: 60%;
}

.topbar .spacer {
  flex: 1 1 auto;
}

/* ---- 原生控件统一外观（替代 element-plus el-select / el-input / el-button） ---- */
/* 下拉框：appearance:none 去掉系统箭头，用 data-uri chevron 复刻 el-select 的下拉指示。 */
.sl-ctrl {
  height: 30px;
  box-sizing: border-box;
  padding: 0 28px 0 10px;
  border: none;
  border-radius: var(--sl-radius-ctrl);
  background-color: var(--sl-page);
  box-shadow: 0 0 0 1px var(--sl-border) inset;
  color: var(--sl-text);
  font-family: var(--sl-font);
  font-size: 13px;
  line-height: 30px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'%3E%3Cpath fill='%239aa3b2' d='M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.776a29.12 29.12 0 0 0 0-41.6 30.592 30.592 0 0 0-42.752 0z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 9px center;
  background-size: 12px 12px;
  transition: box-shadow 0.15s ease;
}

.sl-ctrl:hover {
  box-shadow: 0 0 0 1px #c5cbd8 inset;
}

.sl-ctrl:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--sl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.sl-date {
  width: 150px;
}
.sl-level {
  width: 120px;
}

/* 搜索框：包裹层描边 + 内部图标 + 透明 input + 清除按钮，复刻 el-input 带 prefix/clearable 的外观。 */
.sl-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 200px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 8px 0 10px;
  border-radius: var(--sl-radius-ctrl);
  background-color: var(--sl-page);
  box-shadow: 0 0 0 1px var(--sl-border) inset;
  transition: box-shadow 0.15s ease;
}

.sl-search:hover {
  box-shadow: 0 0 0 1px #c5cbd8 inset;
}

.sl-search:focus-within {
  box-shadow: 0 0 0 1px var(--sl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.sl-search-ic {
  flex: 0 0 auto;
  color: var(--sl-text-3);
}

.sl-search input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--sl-text);
  font-family: var(--sl-font);
  font-size: 13px;
}

.sl-search input::placeholder {
  color: var(--sl-text-3);
}

.sl-search-clear {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--sl-border);
  color: var(--sl-card);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.sl-search-clear:hover {
  background: var(--sl-text-3);
}

/* 图标按钮：刷新 / 打开数据库目录。 */
.sl-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: var(--sl-radius-ctrl);
  border: 1px solid var(--sl-border);
  background: var(--sl-card);
  color: var(--sl-text-2);
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.sl-icon-btn:hover,
.sl-icon-btn:focus {
  outline: none;
  border-color: var(--sl-brand);
  color: var(--sl-brand);
  background: var(--sl-brand-soft);
}

/* 内联 SVG 图标尺寸（顶栏图标按钮 + 搜索框前缀图标） */
.sl-ic {
  width: 15px;
  height: 15px;
}

/* ---------------- console 区 ---------------- */
.console-wrap {
  flex: 1 1 auto;
  min-height: 0;
  padding: 16px 16px 0;
  box-sizing: border-box;
}

.console {
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  background: var(--sl-console);
  border: 1px solid #ebeef5;
  border-radius: var(--sl-radius-card);
  box-shadow: var(--sl-shadow);
  padding: 8px 0;
  font-family: var(--sl-mono);
  font-size: 12.5px;
  line-height: 1.5;
}

.log-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 3px 16px;
  white-space: pre-wrap;
  word-break: break-word;
}

.log-row:hover {
  background: var(--sl-brand-soft);
}

.log-ts {
  flex: 0 0 auto;
  color: var(--sl-text-3);
  min-width: 158px;
}

.log-level {
  flex: 0 0 auto;
  display: inline-block;
  min-width: 48px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 1px 8px;
  border-radius: 7px;
  text-transform: uppercase;
}

.log-level.level-info {
  background: var(--sl-info-soft);
  color: var(--sl-info);
}
.log-level.level-warn {
  background: var(--sl-warn-soft);
  color: var(--sl-warn);
}
.log-level.level-verbose {
  background: var(--sl-info-soft);
  color: var(--sl-info);
}
.log-level.level-error {
  background: var(--sl-error-soft);
  color: var(--sl-error);
}
.log-level.level-debug,
.log-level.level-silly {
  background: var(--sl-debug-soft);
  color: var(--sl-debug);
}

.log-msg {
  flex: 1 1 auto;
  color: var(--sl-text);
}

.row-warn .log-msg {
  color: var(--sl-warn-text);
}
.row-error .log-msg {
  color: var(--sl-error);
}
.row-debug .log-msg,
.row-silly .log-msg {
  color: var(--sl-debug-text);
}

.log-msg .hl {
  background: var(--sl-highlight);
  border-radius: 2px;
  padding: 0 1px;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--sl-text-3);
  font-family: var(--sl-font);
  font-size: 13px;
}

/* ---------------- 底栏 ---------------- */
.footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 18px 12px;
  font-family: var(--sl-mono);
  font-size: 11px;
  color: var(--sl-text-3);
}

.footer .truncated {
  color: var(--sl-warn);
}
</style>
