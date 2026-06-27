import dayjs from 'dayjs'

export interface PrintLogRow {
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

export interface PrintLogSearchData {
  startTime: string
  endTime: string
  clientType: string
  status: string
}

export interface PrintLogSort {
  prop?: string
  order?: 'ascending' | 'descending'
}

export type PrintLogPageItem = number | 'l-dots' | 'r-dots'

export interface PrintLogsPayload {
  rows: PrintLogRow[]
  total: number
}

export function formatPrintLogTime(value: unknown): string {
  return dayjs(value as string | number).format('YYYY/MM/DD HH:mm:ss')
}

export function getPrintLogIndex(currentPage: number, pageSize: number, idx: number): number {
  return (currentPage - 1) * pageSize + idx + 1
}

export function buildPrintLogsRequest(
  searchData: PrintLogSearchData,
  currentPage: number,
  pageSize: number,
  sort: PrintLogSort,
): {
  condition: string[]
  params: unknown[]
  page: { currentPage: number; pageSize: number }
  sort: { prop?: string; order?: string }
} {
  const condition: string[] = []
  const params: unknown[] = []
  // datetime-local 产出 'YYYY-MM-DDTHH:mm:ss'；统一规整为 'YYYY-MM-DD HH:mm:ss' 与后端列格式对齐。
  const start = searchData.startTime ? dayjs(searchData.startTime) : null
  const end = searchData.endTime ? dayjs(searchData.endTime) : null
  if (start && end && start.isValid() && end.isValid()) {
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
  return {
    condition,
    params,
    page: { currentPage, pageSize },
    sort: { prop: sort.prop, order: sort.order },
  }
}

export function getNextPrintLogSort(current: PrintLogSort, prop: string): PrintLogSort {
  if (current.prop !== prop) {
    return { prop, order: 'ascending' }
  }
  if (current.order === 'ascending') {
    return { prop, order: 'descending' }
  }
  return { prop: undefined, order: undefined }
}

export function getPrintLogSortClass(sort: PrintLogSort, prop: string): string {
  // prop 守卫后，order 只可能是 onSort 设置的 ascending / descending（无第三态）。
  if (sort.prop !== prop) return ''
  return sort.order === 'ascending' ? 'asc' : 'desc'
}

export function getPrintLogPageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

// 分页按钮序列（窗口 5、首尾常驻、远端折叠为可点省略号），复刻 el-pagination pager-count=5 的观感。
export function getPrintLogPageItems(pageCount: number, currentPage: number): PrintLogPageItem[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  if (currentPage <= 4) return [1, 2, 3, 4, 5, 'r-dots', pageCount]
  if (currentPage >= pageCount - 3) {
    return [1, 'l-dots', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
  }
  return [1, 'l-dots', currentPage - 1, currentPage, currentPage + 1, 'r-dots', pageCount]
}

export function clampPrintLogPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, page), pageCount)
}

export function normalizePrintLogsPayload(payload: unknown): PrintLogsPayload {
  const data = (payload ?? {}) as { rows?: unknown; total?: unknown }
  return {
    rows: Array.isArray(data.rows) ? (data.rows as PrintLogRow[]) : [],
    total: Number(data.total) || 0,
  }
}
