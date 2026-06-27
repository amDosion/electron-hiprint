export interface SoftwareLogDisplayLine {
  ts: string
  level: string
  html: string
}

// HTML 转义，避免日志正文中的标签被当作 DOM 注入（v-html 渲染前必须转义）。
export function escapeSoftwareLogHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function escapeSoftwareLogRegExp(str: string): string {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isSoftwareLogLevelVisible(lineLevel: string, levelFilter: string): boolean {
  if (!levelFilter) return true
  if (levelFilter === 'info') return lineLevel === 'info' || lineLevel === 'verbose'
  if (levelFilter === 'debug') return lineLevel === 'debug' || lineLevel === 'silly'
  return lineLevel === levelFilter
}

export function buildSoftwareLogDisplayLines(
  lines: HiprintSoftwareLogLine[],
  levelFilter: string,
  keyword: string,
): SoftwareLogDisplayLine[] {
  const kw = keyword.trim()
  const kwLower = kw.toLowerCase()

  // 高亮作用在“已 HTML 转义”的文本上，故正则须用“转义后的关键字”构建。
  // 筛选仍用原始 msg，保持“哪些行显示”这一行为完全不变。
  const re = kw
    ? new RegExp('(' + escapeSoftwareLogRegExp(escapeSoftwareLogHtml(kw)) + ')', 'gi')
    : null

  const result: SoftwareLogDisplayLine[] = []
  lines.forEach((line) => {
    if (!isSoftwareLogLevelVisible(line.level, levelFilter)) return
    const msg = line.msg || ''
    if (kw && msg.toLowerCase().indexOf(kwLower) === -1) return
    let html = escapeSoftwareLogHtml(msg)
    if (re) {
      html = html.replace(re, '<span class="hl">$1</span>')
    }
    result.push({ ts: line.ts, level: line.level, html })
  })
  return result
}

export function formatSoftwareLogFooterSource(sourceDay: string): string {
  return sourceDay ? 'sqlite/software_logs · ' + sourceDay : 'sqlite/software_logs'
}

export function formatSoftwareLogFooterCount(shown: number, total: number): string {
  if (shown === total) {
    return total.toLocaleString() + ' 行'
  }
  return shown.toLocaleString() + ' / ' + total.toLocaleString() + ' 行'
}
