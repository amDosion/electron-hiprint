<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { Search, Refresh, FolderOpened } from '@element-plus/icons-vue'
import { requireBridge } from '@/shared/bridge'

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
const file = ref('')
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

const footerFile = computed(() => (file.value ? '…/logs/' + file.value : ''))

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
    file.value = ''
    truncated.value = false
    return
  }
  try {
    const res = await ipc.read(date)
    const safe = res || ({} as HiprintSoftwareLogPayload)
    lines.value = Array.isArray(safe.lines) ? safe.lines : []
    file.value = safe.file || date + '.log'
    truncated.value = !!safe.truncated
    nextTick(scrollToBottom)
  } catch {
    lines.value = []
    file.value = ''
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

    <el-select
      class="sl-date"
      size="small"
      v-model="currentDate"
      placeholder="选择日期"
      no-data-text="暂无日志"
      @change="handleDateChange"
    >
      <el-option v-for="d in dates" :key="d" :label="d" :value="d" />
    </el-select>

    <el-select class="sl-level" size="small" v-model="levelFilter" placeholder="全部级别">
      <el-option label="全部级别" value="" />
      <el-option label="INFO" value="info" />
      <el-option label="WARN" value="warn" />
      <el-option label="ERROR" value="error" />
      <el-option label="DEBUG" value="debug" />
    </el-select>

    <el-input class="sl-search" size="small" v-model="keyword" placeholder="搜索关键字" clearable>
      <template #prefix><el-icon><Search /></el-icon></template>
    </el-input>

    <span class="spacer"></span>

    <el-button class="sl-icon-btn" size="small" title="刷新" @click="refresh">
      <el-icon><Refresh /></el-icon>
    </el-button>
    <el-button class="sl-icon-btn" size="small" title="打开文件夹" @click="openFolder">
      <el-icon><FolderOpened /></el-icon>
    </el-button>
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
        {{ currentDate ? '没有匹配的日志记录' : '暂无日志文件' }}
      </div>
    </div>
  </div>

  <div class="footer">
    <span>{{ footerFile }}</span>
    <span>
      {{ footerCount }}
      <span v-if="truncated" class="truncated">· 已截断（仅显示末尾部分）</span>
    </span>
  </div>
</template>

<style>
/* ============================================================
   软件日志 · in-app 查看器（浅色主题，对齐 04-software-log.svg）
   顶栏品牌 + 日期下拉 + 级别筛选 + 关键字搜索高亮 + 刷新 + 打开文件夹；
   下方按级别着色的 console 列表；底部当前文件名 + 行数。
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

.topbar .el-select,
.topbar .el-input {
  width: auto;
}

.topbar .sl-date.el-select {
  width: 150px;
}
.topbar .sl-level.el-select {
  width: 120px;
}
.topbar .sl-search.el-input {
  width: 200px;
}

/* element-plus 2.x：输入框边框/背景在 .el-input__wrapper（inset box-shadow），不是 __inner */
.topbar .el-input__wrapper {
  background-color: var(--sl-page);
  border-radius: var(--sl-radius-ctrl);
  box-shadow: 0 0 0 1px var(--sl-border) inset;
}

.topbar .el-input__inner {
  color: var(--sl-text);
}

.topbar .el-input__inner::placeholder {
  color: var(--sl-text-3);
}

.topbar .el-input__wrapper.is-focus {
  box-shadow: 0 0 0 1px var(--sl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.sl-icon-btn.el-button {
  padding: 7px;
  border-radius: var(--sl-radius-ctrl);
  border: 1px solid var(--sl-border);
  background: var(--sl-card);
  color: var(--sl-text-2);
}

.sl-icon-btn.el-button:hover,
.sl-icon-btn.el-button:focus {
  border-color: var(--sl-brand);
  color: var(--sl-brand);
  background: var(--sl-brand-soft);
}

.sl-icon-btn.el-button .el-icon {
  font-size: 15px;
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
