export interface FormItem {
  label: string
  prop?: string
  is: string
  optionIs?: string
  attrs?: Record<string, unknown>
  event?: Record<string, (...args: unknown[]) => void>
  options?: Array<Record<string, unknown>>
  tips?: string
  span?: number
  style?: Record<string, string>
  content?: string
  display?: boolean
  rules?: unknown[]
}

export interface SetFormData {
  port: number
  token: string
  openAtLogin: boolean
  openAsHidden: boolean
  connectTransit: boolean
  nickName: string
  transitUrl: string
  transitToken: string
  allowNotify: boolean
  disabledGpu: boolean
  closeType: string
  pdfPath: string
  defaultPrinter: string
  exportDirectoryEnabled: boolean
  exportDirectoryPath: string
  exportDirectoryDisplayName: string
  exportDirectoryMaxMb: number
  exportDirectoryAllowedExtensions: string
  exportDirectoryConflictPolicy: string
  // 配置驱动表单需按字符串 prop 动态读写
  [key: string]: unknown
}

export const DEFAULT_EXPORT_EXTENSIONS_TEXT =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.txt,.json,.zip'

export const DEFAULTS: SetFormData = {
  port: 17521,
  token: '',
  openAtLogin: false,
  openAsHidden: false,
  connectTransit: false,
  nickName: '',
  transitUrl: '',
  transitToken: '',
  allowNotify: false,
  disabledGpu: false,
  closeType: 'tray',
  pdfPath: '',
  defaultPrinter: '',
  exportDirectoryEnabled: false,
  exportDirectoryPath: '',
  exportDirectoryDisplayName: '',
  exportDirectoryMaxMb: 50,
  exportDirectoryAllowedExtensions: DEFAULT_EXPORT_EXTENSIONS_TEXT,
  exportDirectoryConflictPolicy: 'rename',
}

export const SETTING_TABS = [
  {
    label: '基础设置',
    name: 'basicSet',
    description: '端口、本地授权、设备别名与缓存路径',
  },
  {
    label: '中转设置',
    name: 'transitSet',
    description: '云打印中转服务与连接测试',
  },
  {
    label: '高级配置',
    name: 'advancedSet',
    description: '启动、打印机、导出目录与关闭行为',
  },
]

// 把主进程下发的设置快照展开为表单平铺字段（导出目录从嵌套对象拍平）
export function inflateFormData(data: Record<string, unknown>): Record<string, unknown> {
  const exportDirectory = (data.exportDirectory || {}) as Record<string, unknown>
  return {
    ...data,
    exportDirectoryEnabled: exportDirectory.enabled === true,
    exportDirectoryPath: (exportDirectory.path as string) || '',
    exportDirectoryDisplayName: (exportDirectory.displayName as string) || '',
    exportDirectoryMaxMb: Math.max(
      1,
      Math.round((Number(exportDirectory.maxBytes) || 52428800) / 1048576),
    ),
    exportDirectoryAllowedExtensions: Array.isArray(exportDirectory.allowedExtensions)
      ? (exportDirectory.allowedExtensions as string[]).join(',')
      : DEFAULT_EXPORT_EXTENSIONS_TEXT,
    exportDirectoryConflictPolicy:
      (exportDirectory.conflictPolicy as string) || 'rename',
  }
}

// 表单平铺字段回收为主进程期望的结构（导出目录重新收拢为嵌套对象 + 扩展名归一化）
export function serializeFormData(data: SetFormData): Record<string, unknown> {
  const allowedExtensions = String(data.exportDirectoryAllowedExtensions || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item.startsWith('.') ? item : `.${item}`))
  const output: Record<string, unknown> = {
    ...data,
    exportDirectory: {
      enabled: data.exportDirectoryEnabled === true,
      path: data.exportDirectoryPath || '',
      displayName: data.exportDirectoryDisplayName || '',
      maxBytes: Math.max(1, Number(data.exportDirectoryMaxMb) || 50) * 1048576,
      allowedExtensions: allowedExtensions.length
        ? Array.from(new Set(allowedExtensions))
        : [
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.jpg',
            '.jpeg', '.png', '.webp', '.txt', '.json', '.zip',
          ],
      conflictPolicy: data.exportDirectoryConflictPolicy || 'rename',
    },
  }
  delete output.exportDirectoryEnabled
  delete output.exportDirectoryPath
  delete output.exportDirectoryDisplayName
  delete output.exportDirectoryMaxMb
  delete output.exportDirectoryAllowedExtensions
  delete output.exportDirectoryConflictPolicy
  return output
}
