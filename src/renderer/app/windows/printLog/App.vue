<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import dayjs from 'dayjs'
import { cloneDeep } from 'lodash-es'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

// Electron preload 桥接（src/preload/printLog.js）。缺失说明窗口未经正确 preload 加载，提前失败。
const printLogBridge = window.hiprintPrintLog
if (!printLogBridge) {
  throw new Error('hiprintPrintLog bridge 未注入：请确认窗口经 preload/printLog.js 加载')
}
const ipc: HiprintPrintLogBridge = printLogBridge

// rePrint 总开关（preload 启动时同步读取，全程不变）
const rePrintAble = ipc.rePrintAble

interface PrintLogRow {
  timestamp?: string | number
  clientType?: string
  status?: string
  rePrintAble?: number
  [key: string]: unknown
}

type CellFormatter = (
  row: PrintLogRow,
  column: unknown,
  cellValue: unknown,
  index: number,
) => string

interface ColumnConfig {
  prop: string
  label: string
  width?: string
  align?: string
  sortable?: string | boolean
  showOverflowTooltip?: boolean
  formatter?: CellFormatter
}

const logs = ref<PrintLogRow[]>([])
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)
const sort = ref<{ prop?: string; order?: string }>({ prop: undefined, order: undefined })

const searchData = reactive<{
  timestamp: string[]
  clientType: string
  status: string
}>({
  timestamp: [],
  clientType: '',
  status: '',
})

// 表格高度：撑满窗口减去筛选卡 + 分页 + 间距（与原静态实现一致）
const tableHeight = 'calc(100vh - 51px - 42px - 16px)'

// 列配置：status/clientType 列由作用域插槽渲染语义徽章，故不再设 formatter（其余列保留格式化）
const columns: ColumnConfig[] = [
  {
    label: '序号',
    prop: 'index',
    width: '60px',
    align: 'center',
    formatter: (_row, _column, _cellValue, index) =>
      String((currentPage.value - 1) * pageSize.value + index + 1),
  },
  {
    prop: 'timestamp',
    label: '时间',
    width: '160px',
    align: 'center',
    sortable: 'custom',
    formatter: (_row, _column, cellValue) =>
      dayjs(cellValue as string | number).format('YYYY/MM/DD HH:mm:ss'),
  },
  { prop: 'clientType', label: '连接类型', align: 'center', width: '102px', sortable: 'custom' },
  { prop: 'printer', label: '打印机', align: 'center', width: '120px' },
  { prop: 'templateId', label: '模板 ID', showOverflowTooltip: true, align: 'center', width: '120px' },
  {
    prop: 'pageNum',
    label: '页数',
    align: 'center',
    width: '80px',
    formatter: (_row, _column, cellValue) => `${cellValue}页`,
  },
  { prop: 'status', label: '状态', align: 'center', width: '74px', sortable: 'custom' },
  { prop: 'errorMessage', label: '错误信息' },
  { prop: 'action', label: '操作', align: 'center', width: '120px' },
]

function fetchLogs(): void {
  const condition: string[] = []
  const params: unknown[] = []
  const data = cloneDeep(searchData)
  if (
    dayjs(data.timestamp?.[0] || null).isValid() &&
    dayjs(data.timestamp?.[1] || null).isValid()
  ) {
    condition.push('timestamp >= ? AND timestamp <= ?')
    params.push(data.timestamp[0])
    params.push(data.timestamp[1])
  }
  const rest: Record<string, string> = {
    clientType: data.clientType,
    status: data.status,
  }
  Object.keys(rest).forEach((key) => {
    if (rest[key]) {
      condition.push(`${key} = ?`)
      params.push(rest[key])
    }
  })
  // 传纯对象快照：sort.value 是 Vue 响应式 Proxy，直接经 ipcRenderer.send 结构化克隆会抛
  // "An object could not be cloned"。展开为普通对象后数据一致且可序列化。
  ipc.send('request-logs', {
    condition,
    params,
    page: { currentPage: currentPage.value, pageSize: pageSize.value },
    sort: { prop: sort.value.prop, order: sort.value.order },
  })
}

function sortChange({ prop, order }: { prop: string | null; order: string | null }): void {
  sort.value = { prop: prop ?? undefined, order: order ?? undefined }
  currentPage.value = 1
  fetchLogs()
}

function handleSizeChange(size: number): void {
  pageSize.value = size
  fetchLogs()
}

function handleCurrentChange(page: number): void {
  currentPage.value = page
  fetchLogs()
}

function clearLogs(): void {
  ElMessageBox.confirm('确定要清空日志吗？', '提示', {
    type: 'warning',
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    center: true,
    showClose: false,
    closeOnClickModal: false,
    closeOnPressEscape: false,
  })
    .then(() => {
      ipc.send('clear-logs')
      logs.value = []
      total.value = 0
    })
    .catch(() => {
      /* 用户取消，无需处理 */
    })
}

function handleRePrint(row: PrintLogRow): void {
  ipc.send('reprint', row)
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
  <el-config-provider :locale="zhCn">
    <el-form :model="searchData" class="search-form" :inline="true" size="small" label-suffix="：">
      <div class="search-container">
        <div class="search-item">
          <el-form-item label="时间" prop="timestamp">
            <el-date-picker
              v-model="searchData.timestamp"
              type="datetimerange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD HH:mm:ss"
            />
          </el-form-item>
        </div>
        <div class="search-item">
          <el-form-item label="连接类型" prop="clientType">
            <el-select v-model="searchData.clientType" placeholder="请选择连接类型" clearable>
              <el-option label="本地" value="local" />
              <el-option label="中转" value="transit" />
            </el-select>
          </el-form-item>
        </div>
        <div class="search-item">
          <el-form-item label="状态" prop="status">
            <el-select v-model="searchData.status" placeholder="请选择状态" clearable>
              <el-option label="成功" value="success" />
              <el-option label="失败" value="failed" />
            </el-select>
          </el-form-item>
        </div>
        <div class="search-btns">
          <el-button type="primary" size="small" @click="fetchLogs">搜索</el-button>
          <el-button type="danger" size="small" @click="clearLogs">清空</el-button>
        </div>
      </div>
    </el-form>

    <el-table
      class="table"
      :data="logs"
      :height="tableHeight"
      border
      stripe
      @sort-change="sortChange"
    >
      <el-table-column v-for="column in columns" :key="column.prop" v-bind="column">
        <template v-if="column.prop === 'action'" #default="{ row }">
          <el-button
            :disabled="row.rePrintAble === 0 || !rePrintAble"
            type="text"
            @click="handleRePrint(row)"
          >
            重打
          </el-button>
        </template>
        <template v-else-if="column.prop === 'status'" #default="{ row }">
          <span class="status-pill" :class="'status-' + row.status">
            <span class="pill-dot"></span>{{ row.status === 'success' ? '成功' : '失败' }}
          </span>
        </template>
        <template v-else-if="column.prop === 'clientType'" #default="{ row }">
          <span class="type-pill" :class="'type-' + row.clientType">
            {{ row.clientType === 'local' ? '本地' : '中转' }}
          </span>
        </template>
      </el-table-column>
    </el-table>

    <div class="pagination">
      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[20, 50, 100, 200]"
        :pager-count="5"
        :total="total"
        background
        layout="sizes, prev, pager, next, jumper , -> , total"
        @size-change="handleSizeChange"
        @current-change="handleCurrentChange"
      />
    </div>
  </el-config-provider>
</template>

<style>
/* ============================================================
   打印日志 · 浅色主题视觉（element-plus 2.x）。
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

#app {
  padding: 16px;
  box-sizing: border-box;
}

/* ---------------- 筛选卡片 ---------------- */
.search-form {
  background: var(--pl-card);
  border: 1px solid var(--pl-border);
  border-radius: var(--pl-radius-card);
  box-shadow: var(--pl-shadow);
  padding: 12px 16px 4px;
  margin-bottom: 16px;
}

.search-container {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 4px 16px;
}

.search-item {
  display: inline-flex;
}

.search-form .el-form-item {
  display: inline-flex;
  margin-bottom: 8px;
}

.search-form .el-form-item__label {
  color: var(--pl-text-2);
  font-weight: 500;
}

.el-date-editor--datetimerange.el-input,
.el-date-editor--datetimerange.el-input__wrapper {
  width: 334px !important;
}

.search-form .el-select {
  width: 160px !important;
}

/* 输入控件（element-plus 2.x 边框/底色在 .el-input__wrapper 上，用 inset box-shadow 描边） */
.search-form .el-input__wrapper,
.search-form .el-range-editor.el-input__wrapper {
  background-color: var(--pl-page);
  border-radius: var(--pl-radius-ctrl);
  box-shadow: 0 0 0 1px var(--pl-border) inset;
  transition: box-shadow 0.15s ease;
}

.search-form .el-input__wrapper:hover,
.search-form .el-range-editor.el-input__wrapper:hover {
  box-shadow: 0 0 0 1px #c5cbd8 inset;
}

.search-form .el-input__wrapper.is-focus,
.search-form .el-range-editor.is-active,
.search-form .el-range-editor.is-active:hover {
  box-shadow: 0 0 0 1px var(--pl-brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.search-form .el-range-input {
  background-color: transparent;
  color: var(--pl-text);
}

.search-form .el-input__inner::placeholder,
.search-form .el-range-input::placeholder {
  color: var(--pl-text-3);
}

.search-form .el-input__icon,
.search-form .el-range__icon,
.search-form .el-range-separator {
  color: var(--pl-text-3);
}

/* 搜索按钮：品牌渐变 */
.search-btns {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.search-btns .el-button--primary {
  background: var(--pl-brand-grad);
  border: none;
  border-radius: var(--pl-radius-ctrl);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(51, 88, 224, 0.25);
  transition: filter 0.15s ease, box-shadow 0.15s ease;
}

.search-btns .el-button--primary:hover,
.search-btns .el-button--primary:focus {
  filter: brightness(1.06);
  box-shadow: 0 3px 10px rgba(51, 88, 224, 0.32);
}

.search-btns .el-button--primary:active {
  filter: brightness(0.96);
}

/* 清空按钮：白底 + 红描边 + 红字 */
.search-btns .el-button--danger {
  background: var(--pl-card);
  border: 1px solid #f2c2c2;
  border-radius: var(--pl-radius-ctrl);
  color: var(--pl-danger);
  font-weight: 500;
}

.search-btns .el-button--danger:hover,
.search-btns .el-button--danger:focus {
  background: var(--pl-danger-soft);
  border-color: var(--pl-danger);
  color: var(--pl-danger);
}

.search-btns .el-button--danger:active {
  background: #fbdada;
}

/* ---------------- 表格卡片 ---------------- */
.table.el-table {
  width: 100%;
  margin-bottom: 12px;
  border-radius: var(--pl-radius-card);
  border: 1px solid var(--pl-border);
  box-shadow: var(--pl-shadow);
  overflow: hidden;
  color: var(--pl-text);
}

.table.el-table::before,
.table.el-table::after {
  display: none;
}

.table .el-table__cell {
  padding: 6px 0;
}

.table .el-table__header-wrapper th.el-table__cell {
  background-color: var(--pl-header);
  color: var(--pl-text-3);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.3px;
  border-bottom: 1px solid var(--pl-border);
}

.table td.el-table__cell {
  border-bottom: 1px solid #f2f4f8;
  color: var(--pl-text);
  font-size: 13px;
}

.table.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell {
  background: #fbfcfe;
}

.table .el-table__body tr:hover > td.el-table__cell {
  background-color: var(--pl-brand-soft) !important;
}

/* 排序箭头对齐品牌色 */
.table .ascending .sort-caret.ascending {
  border-bottom-color: var(--pl-brand);
}
.table .descending .sort-caret.descending {
  border-top-color: var(--pl-brand);
}

/* ---------------- 重打按钮（操作列内的 text 按钮） ---------------- */
.el-table .el-button--text {
  padding: 4px 12px;
  border-radius: 7px;
  background: var(--pl-brand-soft);
  color: var(--pl-brand);
  font-weight: 500;
  transition: background 0.15s ease, color 0.15s ease;
}

.el-table .el-button--text:hover,
.el-table .el-button--text:focus {
  background: #dbe5fd;
  color: var(--pl-brand);
}

.el-table .el-button--text.is-disabled,
.el-table .el-button--text.is-disabled:hover {
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
  display: flex;
  justify-content: flex-end;
}

.pagination .el-pagination {
  color: var(--pl-text-2);
  font-weight: 400;
}

.pagination .el-pagination__total,
.pagination .el-pagination__jump {
  color: var(--pl-text-3);
}

.pagination .el-pagination.is-background .el-pager li,
.pagination .el-pagination.is-background .btn-prev,
.pagination .el-pagination.is-background .btn-next {
  background: var(--pl-card);
  border: 1px solid var(--pl-border);
  border-radius: 6px;
  color: var(--pl-text-2);
  font-weight: 500;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.pagination .el-pagination.is-background .el-pager li:hover,
.pagination .el-pagination.is-background .btn-prev:hover,
.pagination .el-pagination.is-background .btn-next:hover {
  border-color: var(--pl-brand);
  color: var(--pl-brand);
}

.pagination .el-pagination.is-background .el-pager li:not(.disabled).is-active {
  background: var(--pl-brand-grad);
  border-color: transparent;
  color: #ffffff;
}
</style>
