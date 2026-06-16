/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// jQuery 自身不带类型（未安装 @types/jquery）。render 垫片仅用 $(node).find()/.length，
// 作为厂商胶水按 any 暴露，限定在 render 垫片范围。nzh/bwip-js/jsbarcode 自带类型，无需声明。
declare module 'jquery' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jquery: any
  export default jquery
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
  on(
    channel: 'getPrintersList' | 'openDialog' | 'testTransitResult',
    callback: IpcListener,
  ): void
  once(
    channel: 'getPrintersList' | 'openDialog' | 'testTransitResult',
    callback: IpcListener,
  ): void
  removeAllListeners(
    channel: 'getPrintersList' | 'openDialog' | 'testTransitResult',
  ): void
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

// render 窗口主进程任务数据（png/pdf/print）。字段动态，保留索引签名以支持 {...data} 透传。
interface RenderTaskData {
  html?: unknown
  template?: unknown
  data?: unknown
  templateId?: string
  [key: string]: unknown
}

interface HiprintRenderBridge {
  on(channel: 'png' | 'pdf' | 'print', callback: (data: RenderTaskData) => void): void
  send(
    channel: 'capturePage' | 'printToPDF' | 'print' | 'showMessageBox',
    data?: unknown,
  ): void
}

interface Window {
  hiprintIndex?: HiprintIndexBridge
  hiprintSet?: HiprintSetBridge
  hiprintPrintLog?: HiprintPrintLogBridge
  hiprintSoftwareLog?: HiprintSoftwareLogBridge
  hiprintRender?: HiprintRenderBridge
}
