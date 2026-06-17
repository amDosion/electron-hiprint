<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw } from 'vue'
import dayjs from 'dayjs'
import { requireBridge } from '@/shared/bridge'

// 打印记录是一个「分页日志表」（每页 ≤200 行），刻意不引入 element-plus：原生 <table> + 手写分页 +
// 原生 <select> + <input type="datetime-local"> + 内联 SVG 即可覆盖全部交互，避免 el-table /
// el-date-picker / el-pagination 拖进整套虚拟滚动 / 日历 / 浮层机器（实测 ~494KB JS、37 个组件）。
// 改原生后包体只剩 Vue+dayjs+应用，托盘打开无需依赖 V8 code cache 才快（见
// .investigations/2026-06-17-log-window-dom-ready-full-element-plus.md 第 12 节）。
// IPC 契约（request-logs / clear-logs / reprint 负载结构、sort.order 取值 ascending/descending）保持不变。

// Electron preload 桥接（src/preload/printLog.js）。缺失即在窗口初始化期抛错（说明未经正确 preload 加载）。
const ipc = requireBridge(window.hiprintPrintLog, 'hiprintPrintLog', 'preload/printLog.js')

// rePrint 总开关（preload 启动时同步读取，全程不变）
const rePrintAble = ipc.rePrintAble

interface PrintLogRow {
  id?: number | string
  timestamp?: string | number
  clientType?: string
  printer?: string
  templateId?: string
  pageNum?: number | string
  status?: string
  errorMessage?: string
  rePrintAble?: number
  [key: string]: unknown
}

const logs = ref<PrintLogRow[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
// sort.order 取值与原 el-table @sort-change 一致：'ascending' / 'descending' / undefined（后端契约不变）
const sort = ref<{ prop?: string; order?: string }>({ prop: undefined, order: undefined })

const searchData = reactive<{
  startTime: string
  endTime: string
  clientType: string
  status: string
}>({
  startTime: '',
  endTime: '',
  clientType: '',
  status: '',
})

const clearConfirmVisible = ref(false)
const jumpValue = ref('')

function fmtTime(value: unknown): string {
  return dayjs(value as string | number).format('YYYY/MM/DD HH:mm:ss')
}

function indexNo(idx: number): number {
  return (currentPage.value - 1) * pageSize.value + idx + 1
}

function fetchLogs(): void {
  const condition: string[] = []
  const params: unknown[] = []
  // datetime-local 产出 'YYYY-MM-DDTHH:mm:ss'；统一规整为 'YYYY-MM-DD HH:mm:ss' 与后端列格式对齐。
  const start = searchData.startTime ? dayjs(searchData.startTime) : null
  const end = searchData.endTime ? dayjs(searchData.endTime) : null
  if (start?.isValid() && end?.isValid()) {
    condition.push('timestamp >= ? AND timestamp <= ?')
    params.push(start.format('YYYY-MM-DD HH:mm:ss'))
    params.push(end.format('YYYY-MM-DD HH:mm:ss'))
  }
  const rest: Record<string, string> = {
    clientType: searchData.clientType,
    status: searchData.status,
  }
  Object.keys(rest).forEach((key) => {
    if (rest[key]) {
      condition.push(`${key} = ?`)
      params.push(rest[key])
    }
  })
  ipc.send('request-logs', {
    condition,
    params,
    page: { currentPage: currentPage.value, pageSize: pageSize.value },
    sort: { prop: sort.value.prop, order: sort.value.order },
  })
}

// 服务端排序：点击表头在 升序→降序→无序 之间循环（与原 el-table sortable="custom" 行为一致）。
function onSort(prop: string): void {
  if (sort.value.prop !== prop) {
    sort.value = { prop, order: 'ascending' }
  } else if (sort.value.order === 'ascending') {
    sort.value = { prop, order: 'descending' }
  } else {
    sort.value = { prop: undefined, order: undefined }
  }
  currentPage.value = 1
  fetchLogs()
}

function sortClass(prop: string): string {
  if (sort.value.prop !== prop) return ''
  return sort.value.order === 'ascending' ? 'asc' : sort.value.order === 'descending' ? 'desc' : ''
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

function rangeArr(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

// 分页按钮序列（窗口 5、首尾常驻、远端折叠为可点省略号），复刻 el-pagination pager-count=5 的观感。
const pageItems = computed<(number | 'l-dots' | 'r-dots')[]>(() => {
  const pc = pageCount.value
  const cur = currentPage.value
  if (pc <= 7) return rangeArr(1, pc)
  if (cur <= 4) return [1, 2, 3, 4, 5, 'r-dots', pc]
  if (cur >= pc - 3) return [1, 'l-dots', pc - 4, pc - 3, pc - 2, pc - 1, pc]
  return [1, 'l-dots', cur - 1, cur, cur + 1, 'r-dots', pc]
})

function goPage(p: number): void {
  const clamped = Math.min(Math.max(1, p), pageCount.value)
  if (clamped === currentPage.value) return
  currentPage.value = clamped
  fetchLogs()
}

function jumpBy(delta: number): void {
  goPage(currentPage.value + delta)
}

function handleSizeChange(): void {
  if (currentPage.value > pageCount.value) currentPage.value = pageCount.value
  fetchLogs()
}

function handleJump(): void {
  const n = Number(jumpValue.value)
  if (Number.isFinite(n) && n >= 1) goPage(Math.floor(n))
  jumpValue.value = ''
}

function clearLogs(): void {
  clearConfirmVisible.value = true
}

function confirmClear(): void {
  ipc.send('clear-logs')
  logs.value = []
  total.value = 0
  clearConfirmVisible.value = false
}

function handleRePrint(row: PrintLogRow): void {
  // row 来自 :data="logs"（深 ref），是 Vue 响应式 Proxy；直接 send 会触发结构化克隆
  // 抛 "An object could not be cloned"。toRaw 解包回原始纯对象再发，负载结构与主进程 rePrint 契约不变。
  ipc.send('reprint', toRaw(row))
}

onMounted(() => {
  fetchLogs()
  ipc.onPrintLogs((_event, payload) => {
    const data = (payload ?? {}) as { rows?: PrintLogRow[]; total?: number }
    logs.value = Array.isArray(data.rows) ? data.rows : []
    total.value = Number(data.total) || 0
  })
})
</script>

<template>
  <!-- 筛选卡片 -->
  <div class="search-form">
    <div class="search-container">
      <div class="filter-item filter-time">
        <span class="filter-label">时间：</span>
        <input class="pl-ctrl pl-dt" type="datetime-local" step="1" v-model="searchData.startTime" />
        <span class="dt-sep">至</span>
        <input class="pl-ctrl pl-dt" type="datetime-local" step="1" v-model="searchData.endTime" />
      </div>

      <div class="filter-item filter-select">
        <span class="filter-label">连接类型：</span>
        <select class="pl-ctrl pl-select" v-model="searchData.clientType">
          <option value="">请选择</option>
          <option value="local">本地</option>
          <option value="transit">中转</option>
        </select>
      </div>

      <div class="filter-item filter-select">
        <span class="filter-label">状态：</span>
        <select class="pl-ctrl pl-select" v-model="searchData.status">
          <option value="">请选择</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
        </select>
      </div>

      <div class="search-btns">
        <button class="pl-btn pl-btn-primary" type="button" @click="fetchLogs">搜索</button>
        <button class="pl-btn pl-btn-danger" type="button" @click="clearLogs">清空</button>
      </div>
    </div>
  </div>

  <!-- 表格 -->
  <div class="table-wrap">
    <table class="table">
      <colgroup>
        <col style="width: 6%" />
        <col style="width: 15%" />
        <col style="width: 9%" />
        <col style="width: 15%" />
        <col style="width: 11%" />
        <col style="width: 7%" />
        <col style="width: 9%" />
        <col style="width: 17%" />
        <col style="width: 11%" />
      </colgroup>
      <thead>
        <tr>
          <th>序号</th>
          <th class="sortable" :class="sortClass('timestamp')" @click="onSort('timestamp')">
            <span class="th-inner">时间<i class="caret"></i></span>
          </th>
          <th class="sortable" :class="sortClass('clientType')" @click="onSort('clientType')">
            <span class="th-inner">连接类型<i class="caret"></i></span>
          </th>
          <th>打印机</th>
          <th>模板 ID</th>
          <th>页数</th>
          <th class="sortable" :class="sortClass('status')" @click="onSort('status')">
            <span class="th-inner">状态<i class="caret"></i></span>
          </th>
          <th>错误信息</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, idx) in logs" :key="row.id ?? idx">
          <td class="td-center">{{ indexNo(idx) }}</td>
          <td class="td-center">{{ fmtTime(row.timestamp) }}</td>
          <td class="td-center">
            <span class="type-pill" :class="'type-' + row.clientType">
              {{ row.clientType === 'local' ? '本地' : '中转' }}
            </span>
          </td>
          <td class="cell td-ellipsis" :title="String(row.printer ?? '')">{{ row.printer }}</td>
          <td class="cell td-ellipsis" :title="String(row.templateId ?? '')">{{ row.templateId }}</td>
          <td class="td-center">{{ row.pageNum }}页</td>
          <td class="cell td-center">
            <span class="status-pill" :class="'status-' + row.status">
              <span class="pill-dot"></span>{{ row.status === 'success' ? '成功' : '失败' }}
            </span>
          </td>
          <td class="cell td-ellipsis" :title="String(row.errorMessage ?? '')">{{ row.errorMessage }}</td>
          <td class="td-center">
            <button
              class="reprint-btn"
              type="button"
              :disabled="row.rePrintAble === 0 || !rePrintAble"
              @click="handleRePrint(row)"
            >
              重打
            </button>
          </td>
        </tr>
        <tr v-if="!logs.length" class="empty-row">
          <td colspan="9">暂无数据</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- 分页 -->
  <div class="pagination">
    <select class="pl-ctrl pl-page-size" v-model.number="pageSize" @change="handleSizeChange">
      <option :value="20">20 条/页</option>
      <option :value="50">50 条/页</option>
      <option :value="100">100 条/页</option>
      <option :value="200">200 条/页</option>
    </select>
    <button class="pager-btn" type="button" :disabled="currentPage <= 1" @click="goPage(currentPage - 1)">
      ‹
    </button>
    <template v-for="(item, i) in pageItems" :key="i">
      <button
        v-if="typeof item === 'number'"
        class="pager-btn"
        :class="{ active: item === currentPage }"
        type="button"
        @click="goPage(item)"
      >
        {{ item }}
      </button>
      <button
        v-else
        class="pager-btn pager-dots"
        type="button"
        title="快速翻页"
        @click="jumpBy(item === 'l-dots' ? -5 : 5)"
      >
        …
      </button>
    </template>
    <button
      class="pager-btn"
      type="button"
      :disabled="currentPage >= pageCount"
      @click="goPage(currentPage + 1)"
    >
      ›
    </button>
    <span class="pager-jump">
      跳至
      <input type="number" min="1" v-model="jumpValue" @keyup.enter="handleJump" />
      页
    </span>
    <span class="pager-total">共 {{ total }} 条</span>
  </div>

  <!-- 清空确认（替代 ElMessageBox，自包含、不触发阻塞式系统弹窗） -->
  <div v-if="clearConfirmVisible" class="confirm-mask" @click.self="clearConfirmVisible = false">
    <div class="confirm-box">
      <div class="confirm-title">提示</div>
      <div class="confirm-body">确定要清空日志吗？</div>
      <div class="confirm-actions">
        <button class="pl-btn" type="button" @click="clearConfirmVisible = false">取消</button>
        <button class="pl-btn pl-btn-primary" type="button" @click="confirmClear">确定</button>
      </div>
    </div>
  </div>
</template>

<style>
/* ============================================================
   打印日志 · 浅色主题视觉（原生控件实现，无 element-plus）。
   仅表现层：布局/配色/卡片/状态徽章/分页。逻辑与 IPC 通道未改。
   ============================================================ */
:root {
  --pl-brand: #3358e0;
  --pl-brand-soft: #eaf0fe;
  --pl-brand-grad: linear-gradient(135deg, #4f7bff 0%, #3358e0 100%);
  --pl-success: #16a34a;
  --pl-success-soft: #e7f6ec;
  --pl-success-text: #16823c;
  --pl-warning: #b5740f;
  --pl-warning-soft: #fef3e2;
  --pl-danger: #dc2626;
  --pl-danger-soft: #fdecec;
  --pl-text: #1a2233;
  --pl-text-2: #5b6472;
  --pl-text-3: #9aa3b2;
  --pl-border: #e6e9f0;
  --pl-page: #f4f6fa;
  --pl-card: #ffffff;
  --pl-header: #f7f9fc;
  --pl-radius-card: 12px;
  --pl-radius-ctrl: 8px;
  --pl-font: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  --pl-mono: "Cascadia Mono", "Consolas", monospace;
  --pl-shadow: 0 1px 3px rgba(26, 34, 51, 0.06), 0 8px 24px rgba(26, 34, 51, 0.05);
}

html,
body {
  margin: 0;
  padding: 0;
  background: var(--pl-page);
  color: var(--pl-text);
  font-family: var(--pl-font);
  -webkit-font-smoothing: antialiased;
}

/* 纵向布局：窗口自身不滚动；搜索卡与分页固定，表格区占据剩余空间并在内部滚动。 */
#app {
  height: 100vh;
  padding: 16px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ---------------- 原生表单控件统一外观 ---------------- */
.pl-ctrl {
  height: 30px;
  box-sizing: border-box;
  padding: 0 10px;
  border: none;
  border-radius: var(--pl-radius-ctrl);
  background-color: var(--pl-page);
  box-shadow: 0 0 0 1px var(--pl-border) inset;
  color: var(--pl-text);
  font-family: var(--pl-font);
  font-size: 13px;
  transition: box-shadow 0.15s ease;
}

.pl-ctrl:hover {
  box-shadow: 0 0 0 1px #c5cbd8 inset;
}

.pl-ctrl:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--pl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

/* 下拉框：去系统箭头 + data-uri chevron。 */
.pl-select {
  padding-right: 28px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'%3E%3Cpath fill='%239aa3b2' d='M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.776a29.12 29.12 0 0 0 0-41.6 30.592 30.592 0 0 0-42.752 0z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 9px center;
  background-size: 12px 12px;
}

/* 控件宽度收紧：两个 datetime-local + 两个 select + 操作按钮需同处一行（见 scroll-layout 回归）。 */
.pl-select {
  width: 114px;
}

.pl-dt {
  width: 164px;
}

/* ---------------- 筛选卡片 ---------------- */
.search-form {
  flex: 0 0 auto;
  background: var(--pl-card);
  border: 1px solid var(--pl-border);
  border-radius: var(--pl-radius-card);
  box-shadow: var(--pl-shadow);
  padding: 10px 16px;
  margin-bottom: 16px;
}

/* 顶部筛选栏：单行，左侧筛选项 + 右侧操作按钮，垂直居中、不换行。 */
.search-container {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.filter-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
}

.filter-label {
  color: var(--pl-text-2);
  font-weight: 500;
  font-size: 13px;
  white-space: nowrap;
}

.dt-sep {
  color: var(--pl-text-3);
  font-size: 12px;
}

/* 操作按钮：推到筛选栏右端 */
.search-btns {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.pl-btn {
  height: 30px;
  padding: 0 16px;
  border-radius: var(--pl-radius-ctrl);
  border: 1px solid var(--pl-border);
  background: var(--pl-card);
  color: var(--pl-text-2);
  font-family: var(--pl-font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: filter 0.15s ease, box-shadow 0.15s ease, background 0.15s ease,
    border-color 0.15s ease, color 0.15s ease;
}

.pl-btn:hover {
  border-color: #c5cbd8;
}

.pl-btn-primary {
  background: var(--pl-brand-grad);
  border: none;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(51, 88, 224, 0.25);
}

.pl-btn-primary:hover {
  filter: brightness(1.06);
  box-shadow: 0 3px 10px rgba(51, 88, 224, 0.32);
}

.pl-btn-primary:active {
  filter: brightness(0.96);
}

.pl-btn-danger {
  background: var(--pl-card);
  border: 1px solid #f2c2c2;
  color: var(--pl-danger);
}

.pl-btn-danger:hover {
  background: var(--pl-danger-soft);
  border-color: var(--pl-danger);
}

.pl-btn-danger:active {
  background: #fbdada;
}

/* ---------------- 表格 ---------------- */
/* 表格区占据搜索卡与分页之间的剩余高度；min-height:0 允许其在 flex 容器内收缩，
   由本容器（而非整窗）纵向滚动；横向恒不滚动（table-layout:fixed + colgroup 百分比列宽）。 */
.table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  margin-bottom: 12px;
  overflow-y: auto;
  overflow-x: hidden;
  border-radius: var(--pl-radius-card);
  border: 1px solid var(--pl-border);
  box-shadow: var(--pl-shadow);
  background: var(--pl-card);
}

.table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  color: var(--pl-text);
}

.table th,
.table td {
  padding: 6px 8px;
  text-align: left;
  font-size: 13px;
  border-bottom: 1px solid #f2f4f8;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 表头：粘性吸顶（在 .table-wrap 内部滚动时不随表体移动）。 */
.table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background-color: var(--pl-header);
  color: var(--pl-text-3);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--pl-border);
}

.td-center {
  text-align: center;
}

.td-ellipsis {
  word-break: break-all;
}

/* 排序表头：可点击 + 上下三角，方向高亮品牌色。 */
.table th.sortable {
  cursor: pointer;
  user-select: none;
  text-align: center;
}

.th-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.caret {
  position: relative;
  display: inline-block;
  width: 0;
  height: 14px;
  margin-left: 6px;
  vertical-align: middle;
}

.caret::before,
.caret::after {
  content: "";
  position: absolute;
  left: -4px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
}

.caret::before {
  top: 1px;
  border-bottom: 5px solid #c0c4cc;
}

.caret::after {
  bottom: 1px;
  border-top: 5px solid #c0c4cc;
}

.table th.sortable.asc .caret::before {
  border-bottom-color: var(--pl-brand);
}

.table th.sortable.desc .caret::after {
  border-top-color: var(--pl-brand);
}

/* 斑马纹 + hover */
.table tbody tr:nth-child(even) td {
  background: #fbfcfe;
}

.table tbody tr:hover td {
  background-color: var(--pl-brand-soft);
}

.empty-row td {
  text-align: center;
  color: var(--pl-text-3);
  padding: 28px 0;
  font-size: 13px;
}

.empty-row:hover td {
  background: transparent;
}

/* ---------------- 重打按钮（操作列） ---------------- */
.reprint-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 7px;
  background: var(--pl-brand-soft);
  color: var(--pl-brand);
  font-family: var(--pl-font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.reprint-btn:hover:not(:disabled) {
  background: #dbe5fd;
}

.reprint-btn:disabled {
  background: transparent;
  color: #c0c4cc;
  cursor: not-allowed;
}

/* ---------------- 状态 / 类型 语义徽章 ---------------- */
.status-pill,
.type-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  height: 20px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  font-family: var(--pl-font);
}

.pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.status-pill.status-success {
  background: var(--pl-success-soft);
  color: var(--pl-success-text);
}
.status-pill.status-success .pill-dot {
  background: var(--pl-success);
}
.status-pill.status-failed {
  background: var(--pl-danger-soft);
  color: #c0392b;
}
.status-pill.status-failed .pill-dot {
  background: var(--pl-danger);
}

.type-pill.type-local {
  background: var(--pl-brand-soft);
  color: var(--pl-brand);
}
.type-pill.type-transit {
  background: var(--pl-warning-soft);
  color: var(--pl-warning);
}

/* ---------------- 分页 ---------------- */
.pagination {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--pl-text-2);
}

.pl-page-size {
  height: 30px;
  width: 100px;
}

.pager-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  border: 1px solid var(--pl-border);
  border-radius: 6px;
  background: var(--pl-card);
  color: var(--pl-text-2);
  font-family: var(--pl-font);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.pager-btn:hover:not(:disabled) {
  border-color: var(--pl-brand);
  color: var(--pl-brand);
}

.pager-btn:disabled {
  color: #c0c4cc;
  cursor: not-allowed;
}

.pager-btn.active {
  background: var(--pl-brand-grad);
  border-color: transparent;
  color: #fff;
}

.pager-dots {
  border-color: transparent;
  background: transparent;
}

.pager-jump {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--pl-text-3);
}

.pager-jump input {
  width: 44px;
  height: 30px;
  box-sizing: border-box;
  padding: 0 4px;
  text-align: center;
  border: none;
  border-radius: 6px;
  background-color: var(--pl-page);
  box-shadow: 0 0 0 1px var(--pl-border) inset;
  color: var(--pl-text);
  font-family: var(--pl-font);
  font-size: 13px;
}

.pager-jump input:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--pl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.pager-total {
  margin-left: auto;
  font-size: 13px;
  color: var(--pl-text-3);
}

/* ---------------- 清空确认浮层 ---------------- */
.confirm-mask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 34, 51, 0.32);
  z-index: 100;
}

.confirm-box {
  width: 320px;
  max-width: calc(100vw - 48px);
  background: var(--pl-card);
  border-radius: var(--pl-radius-card);
  box-shadow: 0 12px 40px rgba(26, 34, 51, 0.22);
  padding: 18px 20px 16px;
  box-sizing: border-box;
}

.confirm-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--pl-text);
  text-align: center;
  margin-bottom: 12px;
}

.confirm-body {
  font-size: 13px;
  color: var(--pl-text-2);
  text-align: center;
  margin-bottom: 18px;
}

.confirm-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}
</style>
