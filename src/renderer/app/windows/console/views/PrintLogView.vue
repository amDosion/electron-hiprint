<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRaw } from 'vue'
import dayjs from 'dayjs'
import { requireBridge } from '@/shared/bridge'
import ConfirmDialog from '@/shared/ConfirmDialog.vue'

// 打印记录是一个「分页日志表」（每页 ≤200 行），刻意不引入 element-plus：原生 <table> + 手写分页 +
// 原生 <select> + <input type="datetime-local"> + 内联 SVG 即可覆盖全部交互，避免 el-table /
// el-date-picker / el-pagination 拖进整套虚拟滚动 / 日历 / 浮层机器（实测 ~494KB JS、37 个组件）。
// 改原生后包体只剩 Vue+dayjs+应用，托盘打开无需依赖 V8 code cache 才快（见
// .investigations/2026-06-17-log-window-dom-ready-full-element-plus.md 第 12 节）。
// IPC 契约（request-logs / clear-logs / reprint 负载结构、sort.order 取值 ascending/descending）保持不变。

// Electron preload 桥接（src/preload/console.js，合并桥）。缺失即在窗口初始化期抛错（说明未经正确 preload 加载）。
const ipc = requireBridge(window.hiprintPrintLog, 'hiprintPrintLog', 'preload/console.js')

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
  if (searchData.clientType) {
    condition.push('clientType = ?')
    params.push(searchData.clientType)
  }
  if (searchData.status) {
    condition.push('status = ?')
    params.push(searchData.status)
  }
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
  // prop 守卫后，order 只可能是 onSort 设置的 ascending / descending（无第三态）。
  if (sort.value.prop !== prop) return ''
  return sort.value.order === 'ascending' ? 'asc' : 'desc'
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

// 分页按钮序列（窗口 5、首尾常驻、远端折叠为可点省略号），复刻 el-pagination pager-count=5 的观感。
const pageItems = computed<(number | 'l-dots' | 'r-dots')[]>(() => {
  const pc = pageCount.value
  const cur = currentPage.value
  if (pc <= 7) return Array.from({ length: pc }, (_, i) => i + 1)
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
  <div class="cv-print-log">
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
          @click="goPage(currentPage + (item === 'l-dots' ? -5 : 5))"
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

    <!-- 清空确认（共享浮层，替代 ElMessageBox，不触发阻塞式系统弹窗） -->
    <ConfirmDialog
      :visible="clearConfirmVisible"
      message="确定要清空日志吗？"
      @confirm="confirmClear"
      @cancel="clearConfirmVisible = false"
    />
  </div>
</template>

<style>
/* ============================================================
   打印记录视图 · 命名空间 .cv-print-log（SPA 路由视图，无全局规则）
   ============================================================ */
.cv-print-log {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  overflow: hidden;
}

/* ---------------- 原生表单控件统一外观 ---------------- */
.cv-print-log .pl-ctrl {
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

.cv-print-log .pl-ctrl:hover {
  box-shadow: 0 0 0 1px #c5cbd8 inset;
}

.cv-print-log .pl-ctrl:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--pl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.cv-print-log .pl-select {
  padding-right: 28px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1024 1024'%3E%3Cpath fill='%239aa3b2' d='M831.872 340.864 512 652.672 192.128 340.864a30.592 30.592 0 0 0-42.752 0 29.12 29.12 0 0 0 0 41.6L489.664 714.24a32 32 0 0 0 44.672 0l340.288-331.776a29.12 29.12 0 0 0 0-41.6 30.592 30.592 0 0 0-42.752 0z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 9px center;
  background-size: 12px 12px;
}

.cv-print-log .pl-select {
  width: 114px;
}

.cv-print-log .pl-dt {
  width: 164px;
}

/* ---------------- 筛选卡片 ---------------- */
.cv-print-log .search-form {
  flex: 0 0 auto;
  background: var(--pl-card);
  border: 1px solid var(--pl-border);
  border-radius: var(--pl-radius-card);
  box-shadow: var(--pl-shadow);
  padding: 10px 16px;
  margin-bottom: 16px;
}

.cv-print-log .search-container {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
}

.cv-print-log .filter-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
}

.cv-print-log .filter-label {
  color: var(--pl-text-2);
  font-weight: 500;
  font-size: 13px;
  white-space: nowrap;
}

.cv-print-log .dt-sep {
  color: var(--pl-text-3);
  font-size: 12px;
}

.cv-print-log .search-btns {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.cv-print-log .pl-btn {
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

.cv-print-log .pl-btn:hover {
  border-color: #c5cbd8;
}

.cv-print-log .pl-btn-primary {
  background: var(--pl-brand-grad);
  border: none;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(51, 88, 224, 0.25);
}

.cv-print-log .pl-btn-primary:hover {
  filter: brightness(1.06);
  box-shadow: 0 3px 10px rgba(51, 88, 224, 0.32);
}

.cv-print-log .pl-btn-primary:active {
  filter: brightness(0.96);
}

.cv-print-log .pl-btn-danger {
  background: var(--pl-card);
  border: 1px solid #f2c2c2;
  color: var(--pl-danger);
}

.cv-print-log .pl-btn-danger:hover {
  background: var(--pl-danger-soft);
  border-color: var(--pl-danger);
}

.cv-print-log .pl-btn-danger:active {
  background: #fbdada;
}

/* ---------------- 表格 ---------------- */
.cv-print-log .table-wrap {
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

.cv-print-log .table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  color: var(--pl-text);
}

.cv-print-log .table th,
.cv-print-log .table td {
  padding: 6px 8px;
  text-align: left;
  font-size: 13px;
  border-bottom: 1px solid #f2f4f8;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cv-print-log .table thead th {
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

.cv-print-log .td-center {
  text-align: center;
}

.cv-print-log .td-ellipsis {
  word-break: break-all;
}

.cv-print-log .table th.sortable {
  cursor: pointer;
  user-select: none;
  text-align: center;
}

.cv-print-log .th-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.cv-print-log .caret {
  position: relative;
  display: inline-block;
  width: 0;
  height: 14px;
  margin-left: 6px;
  vertical-align: middle;
}

.cv-print-log .caret::before,
.cv-print-log .caret::after {
  content: "";
  position: absolute;
  left: -4px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
}

.cv-print-log .caret::before {
  top: 1px;
  border-bottom: 5px solid #c0c4cc;
}

.cv-print-log .caret::after {
  bottom: 1px;
  border-top: 5px solid #c0c4cc;
}

.cv-print-log .table th.sortable.asc .caret::before {
  border-bottom-color: var(--pl-brand);
}

.cv-print-log .table th.sortable.desc .caret::after {
  border-top-color: var(--pl-brand);
}

.cv-print-log .table tbody tr:nth-child(even) td {
  background: #fbfcfe;
}

.cv-print-log .table tbody tr:hover td {
  background-color: var(--pl-brand-soft);
}

.cv-print-log .empty-row td {
  text-align: center;
  color: var(--pl-text-3);
  padding: 28px 0;
  font-size: 13px;
}

.cv-print-log .empty-row:hover td {
  background: transparent;
}

/* ---------------- 重打按钮（操作列） ---------------- */
.cv-print-log .reprint-btn {
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

.cv-print-log .reprint-btn:hover:not(:disabled) {
  background: #dbe5fd;
}

.cv-print-log .reprint-btn:disabled {
  background: transparent;
  color: #c0c4cc;
  cursor: not-allowed;
}

/* ---------------- 状态 / 类型 语义徽章 ---------------- */
.cv-print-log .status-pill,
.cv-print-log .type-pill {
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

.cv-print-log .pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.cv-print-log .status-pill.status-success {
  background: var(--pl-success-soft);
  color: var(--pl-success-text);
}
.cv-print-log .status-pill.status-success .pill-dot {
  background: var(--pl-success);
}
.cv-print-log .status-pill.status-failed {
  background: var(--pl-danger-soft);
  color: #c0392b;
}
.cv-print-log .status-pill.status-failed .pill-dot {
  background: var(--pl-danger);
}

.cv-print-log .type-pill.type-local {
  background: var(--pl-brand-soft);
  color: var(--pl-brand);
}
.cv-print-log .type-pill.type-transit {
  background: var(--pl-warning-soft);
  color: var(--pl-warning);
}

/* ---------------- 分页 ---------------- */
.cv-print-log .pagination {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--pl-text-2);
}

.cv-print-log .pl-page-size {
  height: 30px;
  width: 100px;
}

.cv-print-log .pager-btn {
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

.cv-print-log .pager-btn:hover:not(:disabled) {
  border-color: var(--pl-brand);
  color: var(--pl-brand);
}

.cv-print-log .pager-btn:disabled {
  color: #c0c4cc;
  cursor: not-allowed;
}

.cv-print-log .pager-btn.active {
  background: var(--pl-brand-grad);
  border-color: transparent;
  color: #fff;
}

.cv-print-log .pager-dots {
  border-color: transparent;
  background: transparent;
}

.cv-print-log .pager-jump {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--pl-text-3);
}

.cv-print-log .pager-jump input {
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

.cv-print-log .pager-jump input:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--pl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.cv-print-log .pager-total {
  margin-left: auto;
  font-size: 13px;
  color: var(--pl-text-3);
}
</style>
