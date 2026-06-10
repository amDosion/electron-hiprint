<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { requireBridge } from '@/shared/bridge'

// Electron preload 桥接（src/preload/set.js）。缺失即在窗口初始化期抛错（说明未经正确 preload 加载）。
const ipc = requireBridge(window.hiprintSet, 'hiprintSet', 'preload/set.js')

interface FormItem {
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

interface SetFormData {
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
  logPath: string
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

const DEFAULTS: SetFormData = {
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
  logPath: '',
  pdfPath: '',
  defaultPrinter: '',
  exportDirectoryEnabled: false,
  exportDirectoryPath: '',
  exportDirectoryDisplayName: '',
  exportDirectoryMaxMb: 50,
  exportDirectoryAllowedExtensions:
    '.pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.txt,.json,.zip',
  exportDirectoryConflictPolicy: 'rename',
}

// 把主进程下发的设置快照展开为表单平铺字段（导出目录从嵌套对象拍平）
function inflateFormData(data: Record<string, unknown>): Record<string, unknown> {
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
      : '.pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.txt,.json,.zip',
    exportDirectoryConflictPolicy:
      (exportDirectory.conflictPolicy as string) || 'rename',
  }
}

// 表单平铺字段回收为主进程期望的结构（导出目录重新收拢为嵌套对象 + 扩展名归一化）
function serializeFormData(data: SetFormData): Record<string, unknown> {
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

const formRef = ref<FormInstance>()
const setTab = ref('basicSet')
const printerList = ref<Array<Record<string, unknown>>>([])
const formData = reactive<SetFormData>({
  ...DEFAULTS,
  ...inflateFormData(ipc.store),
})

const tabs = [
  { label: '基础设置', name: 'basicSet' },
  { label: '中转设置', name: 'transitSet' },
  { label: '高级设置', name: 'advancedSet' },
]

// 通知主进程按当前内容自适应窗口尺寸（切 tab / 切换开关后内容高度变化）
function handleTabChange(): void {
  nextTick(() => {
    const el = document.querySelector('#app')
    if (!el) return
    const rect = el.getBoundingClientRect()
    ipc.send('setContentSize', {
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    })
  })
}

function handleTest(): void {
  formRef.value?.validate((valid) => {
    if (valid) {
      ipc.send('testTransit', {
        url: formData.transitUrl,
        token: formData.transitToken,
      })
    }
  })
}

function chooseDirectory(type: string): void {
  const title = {
    logPath: '选择日志存储路径',
    pdfPath: '选择 PDF 缓存路径',
    exportDirectoryPath: '选择共享导出目录',
  }[type]
  ipc.send('showOpenDialog', {
    title,
    defaultPath: formData[type],
    properties: ['openDirectory'],
  })
  ipc.once('openDialog', (_event, result) => {
    const r = (result ?? {}) as { canceled?: boolean; filePaths?: string[] }
    if (!r.canceled && r.filePaths && r.filePaths[0]) {
      formData[type] = r.filePaths[0]
    }
  })
}

function openDirectory(type: string): void {
  if (formData[type]) {
    ipc.send('openDirectory', formData[type])
  }
}

function submit(): void {
  formRef.value?.validate((valid) => {
    if (valid) {
      ipc.send('setConfig', serializeFormData(formData))
    }
  })
}

function close(): void {
  ipc.send('closeSetWindow')
}

function getPrintersList(): void {
  ipc.send('getPrintersList')
}

const formOptions = computed(() => ({
  size: 'small',
  labelPosition: 'top',
  inline: true,
  span: 24,
  items: [
    {
      label: '端口设置',
      prop: 'port',
      is: 'el-input-number',
      attrs: {
        min: 10000,
        max: 65535,
        controls: false,
        placeholder: '请输入10000-65535之间的端口号(17521)',
      },
      display: setTab.value === 'basicSet',
      rules: [{ required: true, message: '端口号不能为空', trigger: 'blur' }],
    },
    {
      label: 'TOKEN 设置',
      prop: 'token',
      is: 'el-input',
      attrs: { minlength: 5, maxlength: 32, placeholder: '请输入5-32个字符作为TOKEN' },
      display: setTab.value === 'basicSet',
      rules: [{ min: 5, max: 32, message: '只能输入5-32个字符作为TOKEN', trigger: 'blur' }],
    },
    {
      label: '别名',
      prop: 'nickName',
      is: 'el-input',
      attrs: { placeholder: '请输入便于识别的别名' },
      tips: '方便识别的友好名称',
      display: setTab.value === 'basicSet',
    },
    {
      label: '日志路径',
      prop: 'logPath',
      is: 'el-input',
      tips: '程序运行时产生的日志路径',
      attrs: { readonly: true },
      event: { click: () => openDirectory('logPath') },
      span: 18,
      display: setTab.value === 'basicSet',
    },
    {
      label: '　',
      is: 'el-button',
      event: { click: () => chooseDirectory('logPath') },
      content: '选择',
      span: 6,
      display: setTab.value === 'basicSet',
    },
    {
      label: 'PDF 缓存路径',
      prop: 'pdfPath',
      is: 'el-input',
      tips: '系统运行过程中的临时 PDF 存储路径',
      attrs: { readonly: true },
      event: { click: () => openDirectory('pdfPath') },
      style: { marginBottom: '60px' },
      span: 18,
      display: setTab.value === 'basicSet',
    },
    {
      label: '　',
      is: 'el-button',
      event: { click: () => chooseDirectory('pdfPath') },
      content: '选择',
      span: 6,
      style: { marginBottom: '60px' },
      display: setTab.value === 'basicSet',
    },
    {
      label: '连接中转代理服务(node-hiprint-transit)',
      prop: 'connectTransit',
      is: 'el-switch',
      tips: '通过中转代理可以实现云打印，摆脱局域网限制',
      event: { change: () => handleTabChange() },
      display: setTab.value === 'transitSet',
    },
    {
      label: '服务器地址',
      prop: 'transitUrl',
      is: 'el-input',
      attrs: { placeholder: '请输入中转服务地址' },
      display: setTab.value === 'transitSet' && formData.connectTransit,
      rules: [{ required: true, message: '中转服务器地址不能为空', trigger: 'blur' }],
    },
    {
      label: '服务器 TOKEN',
      prop: 'transitToken',
      is: 'el-input',
      attrs: { minlength: 5, maxlength: 32, placeholder: '请输入中转服务 TOKEN' },
      span: 18,
      display: setTab.value === 'transitSet' && formData.connectTransit,
      rules: [{ required: true, message: '中转服务 Token 不能为空', trigger: 'blur' }],
    },
    {
      label: '　',
      is: 'el-button',
      event: { click: handleTest },
      content: '测试连接',
      span: 6,
      display: setTab.value === 'transitSet' && formData.connectTransit,
    },
    {
      label: '开机启动',
      prop: 'openAtLogin',
      is: 'el-switch',
      tips: '请注意杀毒软件拦截',
      span: 12,
      display: setTab.value === 'advancedSet',
    },
    {
      label: '静默启动',
      prop: 'openAsHidden',
      is: 'el-switch',
      tips: '启动后不显示主窗口，收起到托盘',
      span: 12,
      display: setTab.value === 'advancedSet',
    },
    {
      label: '默认打印机',
      prop: 'defaultPrinter',
      is: 'el-select',
      tips: '打印任务未指定打印机时将优先使用该打印机',
      optionIs: 'el-option',
      attrs: { clearable: true },
      options: printerList.value,
      display: setTab.value === 'advancedSet',
    },
    {
      label: '启用共享导出目录',
      prop: 'exportDirectoryEnabled',
      is: 'el-switch',
      tips: '允许 Web 端通过中转把文件导出到本机授权目录',
      span: 12,
      display: setTab.value === 'advancedSet',
    },
    {
      label: '导出目录名称',
      prop: 'exportDirectoryDisplayName',
      is: 'el-input',
      tips: '仅向 Web 端显示这个名称，不暴露真实路径',
      attrs: { placeholder: '例如：仓库导出目录' },
      span: 12,
      display: setTab.value === 'advancedSet' && formData.exportDirectoryEnabled,
    },
    {
      label: '共享导出目录',
      prop: 'exportDirectoryPath',
      is: 'el-input',
      tips: '文件只允许写入这个目录下，不能由 Web 端指定其他路径',
      attrs: { readonly: true },
      event: { click: () => openDirectory('exportDirectoryPath') },
      span: 18,
      display: setTab.value === 'advancedSet' && formData.exportDirectoryEnabled,
      rules: [{ required: true, message: '共享导出目录不能为空', trigger: 'blur' }],
    },
    {
      label: '　',
      is: 'el-button',
      event: { click: () => chooseDirectory('exportDirectoryPath') },
      content: '选择',
      span: 6,
      display: setTab.value === 'advancedSet' && formData.exportDirectoryEnabled,
    },
    {
      label: '单文件上限(MB)',
      prop: 'exportDirectoryMaxMb',
      is: 'el-input-number',
      attrs: { min: 1, max: 200, controls: false },
      span: 12,
      display: setTab.value === 'advancedSet' && formData.exportDirectoryEnabled,
    },
    {
      label: '允许扩展名',
      prop: 'exportDirectoryAllowedExtensions',
      is: 'el-input',
      tips: '逗号分隔，例如 .pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.png,.zip',
      attrs: { placeholder: '.pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.png,.zip' },
      span: 12,
      display: setTab.value === 'advancedSet' && formData.exportDirectoryEnabled,
    },
    {
      label: '重名处理',
      prop: 'exportDirectoryConflictPolicy',
      is: 'el-select',
      optionIs: 'el-option',
      options: [
        { label: '自动重命名', value: 'rename' },
        { label: '直接失败', value: 'fail' },
        { label: '覆盖原文件', value: 'overwrite' },
      ],
      display: setTab.value === 'advancedSet' && formData.exportDirectoryEnabled,
    },
    {
      label: '禁用GPU',
      prop: 'disabledGpu',
      is: 'el-switch',
      tips: '可能优化字体模糊问题',
      span: 12,
      display: setTab.value === 'advancedSet',
    },
    {
      label: '允许通知',
      prop: 'allowNotify',
      is: 'el-switch',
      span: 12,
      display: setTab.value === 'advancedSet',
    },
    {
      label: '关闭主窗口动作',
      prop: 'closeType',
      is: 'el-radio-group',
      optionIs: 'el-radio',
      options: [
        { label: 'tray', border: true, content: '最小化到托盘', style: { marginRight: '6px' } },
        { label: 'quit', border: true, content: '退出程序', style: { marginLeft: '6px' } },
      ],
      display: setTab.value === 'advancedSet',
    },
  ] as FormItem[],
}))

const rules = computed<Record<string, unknown[]>>(() => {
  const obj: Record<string, unknown[]> = {}
  formOptions.value.items.forEach(({ prop, rules: itemRules }) => {
    if (prop && Array.isArray(itemRules)) {
      obj[prop] = itemRules
    }
  })
  return obj
})

// 等价于原 created：注册事件 + 初始化（formData 已在上方用快照初始化）+ 拉取打印机列表
ipc.on('getPrintersList', (_event, printers) => {
  printerList.value = Array.isArray(printers) ? (printers as Array<Record<string, unknown>>) : []
})

// 测试连接结果：主进程回传后用应用内统一风格的 ElMessage 提示（替代 OS 原生对话框）。
// 顶层注册一次，避免每次点击「测试连接」叠加监听器。
ipc.on('testTransitResult', (_event, result) => {
  const r = (result ?? {}) as { type?: string; message?: string }
  const isSuccess = r.type === 'success'
  ElMessage({
    type: isSuccess ? 'success' : 'error',
    message: r.message || (isSuccess ? '连接成功！' : '连接失败'),
    duration: 3000,
  })
})

getPrintersList()

onMounted(() => {
  handleTabChange()
})

onBeforeUnmount(() => {
  ipc.removeAllListeners('getPrintersList')
  ipc.removeAllListeners('openDialog')
  ipc.removeAllListeners('testTransitResult')
})
</script>

<template>
  <el-tabs v-model="setTab" @tab-click="handleTabChange">
    <el-tab-pane v-for="tab in tabs" :key="tab.name" :label="tab.label" :name="tab.name" />
  </el-tabs>
  <el-form ref="formRef" :model="formData" :rules="rules" size="small" label-position="top" :inline="true">
    <el-row :gutter="12">
      <template v-for="item in formOptions.items" :key="item.prop || item.label">
        <el-col v-if="item.display !== false" :span="item.span || 24">
          <el-form-item :label="item.label" :prop="item.prop" :style="item.style">
            <template #label>
              <el-tooltip v-if="item.tips" :content="item.tips" placement="top-start">
                <span>{{ item.label }} <el-icon class="el-icon-question"><question-filled /></el-icon></span>
              </el-tooltip>
              <span v-else>{{ item.label }}</span>
            </template>
            <component
              v-if="item.optionIs"
              :is="item.is"
              v-model="formData[item.prop as string]"
              v-bind="item.attrs"
              v-on="item.event"
            >
              <component
                v-for="(option, oi) in item.options"
                :is="item.optionIs"
                :key="oi"
                v-bind="option"
              >
                {{ option.content || option.value }}
              </component>
            </component>
            <component
              v-else-if="item.prop"
              :is="item.is"
              v-model="formData[item.prop as string]"
              v-bind="item.attrs"
              v-on="item.event"
            >
              {{ item.content }}
            </component>
            <component v-else :is="item.is" v-bind="item.attrs" v-on="item.event">
              {{ item.content }}
            </component>
          </el-form-item>
        </el-col>
      </template>
      <el-col :span="24">
        <el-form-item>
          <el-row :gutter="12" style="width: 100%">
            <el-col :span="12">
              <el-button type="primary" size="small" @click="submit">应用</el-button>
            </el-col>
            <el-col :span="12">
              <el-button size="small" @click="close">关闭</el-button>
            </el-col>
          </el-row>
        </el-form-item>
      </el-col>
    </el-row>
  </el-form>
</template>

<style>
/* ============================================================
 * 设置窗口视觉（浅色主题，禁止 dark mode）。仅表现层，逻辑/IPC 未改。
 * 设计系统与已审核稿 docs/ui-redesign/02-settings.svg 一致。
 * ============================================================ */
:root {
  --font-base: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  --font-mono: "Cascadia Mono", "Consolas", monospace;

  --brand: #3358e0;
  --brand-strong: #2746b8;
  --brand-soft: #eaf0fe;

  --success: #16a34a;
  --warning: #b5740f;
  --danger: #dc2626;

  --text-1: #1a2233;
  --text-2: #5b6472;
  --text-3: #9aa3b2;
  --border: #e6e9f0;
  --page-bg: #f4f6fa;
  --card-bg: #ffffff;
  --field-bg: #f4f6fa;

  --radius-card: 12px;
  --radius-control: 8px;
  --shadow-card: 0 1px 4px rgba(26, 34, 51, 0.08);
}

html,
body {
  margin: 0;
  padding: 0;
  user-select: none;
  background: var(--page-bg);
  color: var(--text-1);
  font-family: var(--font-base);
  -webkit-font-smoothing: antialiased;
}

#app {
  padding: 18px 20px 20px;
  box-sizing: border-box;
}

/* ---------- 分段切换式 Tabs ---------- */
.el-tabs {
  margin-bottom: 18px;
}

.el-tabs__header {
  margin: 0;
}

.el-tabs__nav-wrap::after {
  display: none;
}

.el-tabs__active-bar {
  display: none;
}

.el-tabs__nav {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #e9edf4;
  border-radius: 9px;
  box-sizing: border-box;
}

.el-tabs__item {
  height: 30px;
  line-height: 30px;
  padding: 0 18px !important;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  border-radius: 7px;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.el-tabs__item:hover {
  color: var(--brand);
}

.el-tabs__item.is-active {
  color: var(--brand);
  background: var(--card-bg);
  box-shadow: var(--shadow-card);
}

/* ---------- 表单卡片容器 ---------- */
.el-form {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 14px 18px 6px;
  box-sizing: border-box;
}

.el-form-item {
  width: 100%;
  margin-bottom: 14px;
}

.el-form--label-top .el-form-item__label {
  padding: 0 0 4px;
  line-height: 1.4;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.el-form-item__label .el-icon-question {
  color: var(--text-3);
  font-size: 13px;
}

.el-form-item__error {
  font-size: 11px;
  color: var(--danger);
  padding-top: 3px;
}

.el-input-number,
.el-select,
.el-button {
  width: 100%;
}

/* ---------- 输入控件（element-plus 2.x：边框/底色在 __wrapper） ---------- */
.el-input__wrapper {
  background: var(--field-bg);
  border-radius: var(--radius-control);
  box-shadow: 0 0 0 1px var(--border) inset;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;
}

.el-input__wrapper:hover {
  box-shadow: 0 0 0 1px #c9cfdc inset;
}

.el-input__wrapper.is-focus,
.el-input__wrapper:focus-within {
  background: var(--card-bg);
  box-shadow: 0 0 0 1px var(--brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.el-input__inner {
  color: var(--text-1);
  font-size: 13px;
}

.el-textarea__inner {
  background: var(--field-bg);
  border: none;
  border-radius: var(--radius-control);
  box-shadow: 0 0 0 1px var(--border) inset;
  color: var(--text-1);
  font-size: 13px;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;
}

.el-input__inner::placeholder,
.el-textarea__inner::placeholder {
  color: var(--text-3);
}

.el-textarea__inner:hover {
  box-shadow: 0 0 0 1px #c9cfdc inset;
}

.el-textarea__inner:focus {
  background: var(--card-bg);
  box-shadow: 0 0 0 1px var(--brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

/* 只读路径输入用等宽字体 */
.el-input.is-disabled .el-input__inner,
.el-input__inner[readonly] {
  font-family: var(--font-mono);
  cursor: pointer;
}

.el-input.is-disabled .el-input__wrapper {
  cursor: pointer;
}

/* 数字输入框（端口 / 上限）等宽 + 左对齐 */
.el-input-number .el-input__inner {
  font-family: var(--font-mono);
  font-weight: 600;
  text-align: left;
}

/* ---------- Select 下拉 ---------- */
.el-select .el-input__inner {
  cursor: pointer;
}

.el-select-dropdown {
  border-radius: var(--radius-control);
  border: 1px solid var(--border);
  box-shadow: 0 6px 16px rgba(26, 34, 51, 0.12);
}

.el-select-dropdown__item.selected {
  color: var(--brand);
  font-weight: 600;
}

/* ---------- 开关 Switch ---------- */
.el-switch.is-checked .el-switch__core {
  border-color: var(--brand);
  background-color: var(--brand);
}

/* ---------- 单选（关闭主窗口动作） ---------- */
.el-radio.is-bordered {
  border-radius: var(--radius-control);
  border-color: var(--border);
  padding: 8px 14px;
}

.el-radio.is-bordered.is-checked {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.el-radio.is-checked .el-radio__inner {
  border-color: var(--brand);
  background: var(--brand);
}

.el-radio.is-checked .el-radio__label {
  color: var(--brand);
}

/* ---------- 按钮 ---------- */
.el-button {
  border-radius: var(--radius-control);
  font-size: 13px;
  font-weight: 600;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease,
    box-shadow 0.18s ease;
}

/* 行内「选择 / 测试连接」次级按钮：浅底品牌色 */
.el-button:not(.el-button--primary) {
  background: var(--brand-soft);
  border-color: transparent;
  color: var(--brand);
}

.el-button:not(.el-button--primary):hover,
.el-button:not(.el-button--primary):focus {
  background: #dde7fd;
  border-color: transparent;
  color: var(--brand-strong);
}

/* 主操作「应用」：实色品牌按钮 */
.el-button--primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.el-button--primary:hover,
.el-button--primary:focus {
  background: var(--brand-strong);
  border-color: var(--brand-strong);
}

/* ---------- 底部操作区分隔 ---------- */
.el-form > .el-row > .el-col:last-child > .el-form-item {
  margin-top: 4px;
  margin-bottom: 6px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

/* 隐藏滚动条但仍可滚动 */
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
