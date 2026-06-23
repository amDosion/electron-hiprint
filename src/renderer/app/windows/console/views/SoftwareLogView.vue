<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { requireBridge } from '@/shared/bridge'
import ConfirmDialog from '@/shared/ConfirmDialog.vue'

// 软件日志是一个轻量日志查看器：日期下拉 + 级别下拉 + 搜索框 + 两个图标按钮。
// 这些都是原生控件等价物，故本窗口刻意不引入 element-plus —— 否则仅 el-select 一个组件
// 就会拖进 Popper/Tooltip/FocusTrap/Tag 整套浮层机器（实测 ~244KB JS），渲染进程要
// compile+execute 这套机器才触发 dom-ready，造成托盘打开白屏近 1s。改用原生 <select>/
// <input>/<button> + 内联 SVG 后，包体只剩 Vue+应用（见
// .investigations/2026-06-17-log-window-dom-ready-full-element-plus.md 第 11 节）。

// Electron preload 桥接（src/preload/console.js，合并桥）。缺失即在窗口初始化期抛错（说明未经正确 preload 加载）。
const ipc = requireBridge(window.hiprintSoftwareLog, 'hiprintSoftwareLog', 'preload/console.js')

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
const clearConfirmVisible = ref(false)

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

  // 高亮作用在"已 HTML 转义"的文本上，故正则须用"转义后的关键字"构建，
  // 否则含 < > & " ' 的关键字（如 <info>）虽通过筛选却高亮不到（基准不一致）。
  // 筛选仍用原始 msg（下方 indexOf），保持"哪些行显示"这一行为完全不变。
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

function clearLogs(): void {
  clearConfirmVisible.value = true
}

// 清空全部软件日志（DELETE FROM software_logs），与「打印记录·清空」语义一致。
// 清空后重新列出日期并刷新视图（日期列表多半为空 → 视图回到「暂无日志记录」）。
async function confirmClear(): Promise<void> {
  clearConfirmVisible.value = false
  try {
    await ipc.clear()
  } catch {
    // 清空失败静默忽略：不阻断 UI，下次刷新会反映真实状态。
  }
  currentDate.value = ''
  await refresh()
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
  <div class="cv-software-log">
    <div class="topbar">
      <span class="brand">
        <span class="brand-logo"><i></i><i></i><i></i></span>
        软件日志
      </span>

      <select class="sl-ctrl sl-date" v-model="currentDate" @change="loadDate(currentDate)">
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
      <button class="sl-icon-btn sl-danger" type="button" title="清空软件日志" @click="clearLogs">
        <svg class="sl-ic" viewBox="0 0 1024 1024" aria-hidden="true">
          <path
            fill="currentColor"
            d="M160 256H96a32 32 0 0 1 0-64h256V95.936a32 32 0 0 1 32-32h256a32 32 0 0 1 32 32V192h256a32 32 0 1 1 0 64h-64v608a32 32 0 0 1-32 32H224a32 32 0 0 1-32-32V256zm448-64v-64H416v64h192zM224 896h576V256H224v640zm192-128a32 32 0 0 1-32-32V416a32 32 0 0 1 64 0v320a32 32 0 0 1-32 32zm192 0a32 32 0 0 1-32-32V416a32 32 0 0 1 64 0v320a32 32 0 0 1-32 32z"
          />
        </svg>
      </button>
    </div>

    <ConfirmDialog
      :visible="clearConfirmVisible"
      message="确定要清空全部软件日志吗？"
      @confirm="confirmClear"
      @cancel="clearConfirmVisible = false"
    />

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
  </div>
</template>

<style>
/* ============================================================
   软件日志视图 · 命名空间 .cv-software-log（SPA 路由视图，无全局规则）
   ============================================================ */
.cv-software-log {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ---------------- 顶栏 ---------------- */
.cv-software-log .topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  height: 52px;
  background: var(--sl-card);
  border-bottom: 1px solid var(--sl-border);
  flex: 0 0 auto;
}

.cv-software-log .brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 15px;
  color: var(--sl-text);
  margin-right: 4px;
}

.cv-software-log .brand-logo {
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

.cv-software-log .brand-logo i {
  display: block;
  height: 1.6px;
  border-radius: 1px;
  background: #ffffff;
}
.cv-software-log .brand-logo i:nth-child(1) {
  width: 100%;
}
.cv-software-log .brand-logo i:nth-child(2) {
  width: 100%;
}
.cv-software-log .brand-logo i:nth-child(3) {
  width: 60%;
}

.cv-software-log .topbar .spacer {
  flex: 1 1 auto;
}

/* ---- 原生控件统一外观（替代 element-plus el-select / el-input / el-button） ---- */
.cv-software-log .sl-ctrl {
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

.cv-software-log .sl-ctrl:hover {
  box-shadow: 0 0 0 1px #c5cbd8 inset;
}

.cv-software-log .sl-ctrl:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--sl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.cv-software-log .sl-date {
  width: 150px;
}
.cv-software-log .sl-level {
  width: 120px;
}

.cv-software-log .sl-search {
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

.cv-software-log .sl-search:hover {
  box-shadow: 0 0 0 1px #c5cbd8 inset;
}

.cv-software-log .sl-search:focus-within {
  box-shadow: 0 0 0 1px var(--sl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.cv-software-log .sl-search-ic {
  flex: 0 0 auto;
  color: var(--sl-text-3);
}

.cv-software-log .sl-search input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--sl-text);
  font-family: var(--sl-font);
  font-size: 13px;
}

.cv-software-log .sl-search input::placeholder {
  color: var(--sl-text-3);
}

.cv-software-log .sl-search-clear {
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

.cv-software-log .sl-search-clear:hover {
  background: var(--sl-text-3);
}

.cv-software-log .sl-icon-btn {
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

.cv-software-log .sl-icon-btn:hover,
.cv-software-log .sl-icon-btn:focus {
  outline: none;
  border-color: var(--sl-brand);
  color: var(--sl-brand);
  background: var(--sl-brand-soft);
}

.cv-software-log .sl-icon-btn.sl-danger:hover,
.cv-software-log .sl-icon-btn.sl-danger:focus {
  border-color: var(--sl-error);
  color: var(--sl-error);
  background: var(--sl-error-soft);
}

.cv-software-log .sl-ic {
  width: 15px;
  height: 15px;
}

/* ---------------- console 区 ---------------- */
.cv-software-log .console-wrap {
  flex: 1 1 auto;
  min-height: 0;
  padding: 16px 16px 0;
  box-sizing: border-box;
}

.cv-software-log .console {
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

.cv-software-log .log-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 3px 16px;
  white-space: pre-wrap;
  word-break: break-word;
}

.cv-software-log .log-row:hover {
  background: var(--sl-brand-soft);
}

.cv-software-log .log-ts {
  flex: 0 0 auto;
  color: var(--sl-text-3);
  min-width: 158px;
}

.cv-software-log .log-level {
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

.cv-software-log .log-level.level-info {
  background: var(--sl-info-soft);
  color: var(--sl-info);
}
.cv-software-log .log-level.level-warn {
  background: var(--sl-warn-soft);
  color: var(--sl-warn);
}
.cv-software-log .log-level.level-verbose {
  background: var(--sl-info-soft);
  color: var(--sl-info);
}
.cv-software-log .log-level.level-error {
  background: var(--sl-error-soft);
  color: var(--sl-error);
}
.cv-software-log .log-level.level-debug,
.cv-software-log .log-level.level-silly {
  background: var(--sl-debug-soft);
  color: var(--sl-debug);
}

.cv-software-log .log-msg {
  flex: 1 1 auto;
  color: var(--sl-text);
}

.cv-software-log .row-warn .log-msg {
  color: var(--sl-warn-text);
}
.cv-software-log .row-error .log-msg {
  color: var(--sl-error);
}
.cv-software-log .row-debug .log-msg,
.cv-software-log .row-silly .log-msg {
  color: var(--sl-debug-text);
}

.cv-software-log .log-msg .hl {
  background: var(--sl-highlight);
  border-radius: 2px;
  padding: 0 1px;
}

.cv-software-log .empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--sl-text-3);
  font-family: var(--sl-font);
  font-size: 13px;
}

/* ---------------- 底栏 ---------------- */
.cv-software-log .footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 18px 12px;
  font-family: var(--sl-mono);
  font-size: 11px;
  color: var(--sl-text-3);
}

.cv-software-log .footer .truncated {
  color: var(--sl-warn);
}
</style>
