/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// ---- Electron preload 桥接契约（与 src/preload/*.js 一一对应）----
// 渲染端只能看到 contextBridge 暴露的最小面，这里据此声明类型。

type IpcListener = (event: unknown, ...args: unknown[]) => void

interface HiprintIndexBridge {
  readonly title: string
  readonly version: string
  send(
    channel:
      | 'getMachineId'
      | 'getAddress'
      | 'getConnectionStatus'
      | 'openSetting'
      | 'notification',
    data?: unknown
  ): void
  on(
    channel:
      | 'machineId'
      | 'address'
      | 'connectionStatus'
      | 'serverConnection'
      | 'printTask'
      | 'clientConnection',
    callback: IpcListener
  ): void
  writeText(text: string): void
}

interface HiprintSetBridge {
  readonly store: Record<string, unknown>
  send(channel: string, data?: unknown): void
  on(channel: 'getPrintersList' | 'openDialog', callback: IpcListener): void
  once(channel: 'getPrintersList' | 'openDialog', callback: IpcListener): void
  removeAllListeners(channel: 'getPrintersList' | 'openDialog'): void
}

interface HiprintPrintLogBridge {
  readonly rePrintAble: unknown
  send(channel: 'request-logs' | 'clear-logs' | 'reprint', data?: unknown): void
  onPrintLogs(callback: IpcListener): void
}

interface HiprintSoftwareLogLine {
  ts: string
  level: 'info' | 'warn' | 'error' | 'debug' | string
  msg: string
}

interface HiprintSoftwareLogPayload {
  lines: HiprintSoftwareLogLine[]
  file: string
  truncated: boolean
}

interface HiprintSoftwareLogBridge {
  listDates(): Promise<string[]>
  read(date: string): Promise<HiprintSoftwareLogPayload>
  openFolder(): void
}

interface Window {
  hiprintIndex?: HiprintIndexBridge
  hiprintSet?: HiprintSetBridge
  hiprintPrintLog?: HiprintPrintLogBridge
  hiprintSoftwareLog?: HiprintSoftwareLogBridge
}
