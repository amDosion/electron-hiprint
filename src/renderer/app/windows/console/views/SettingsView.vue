<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'
import { requireBridge } from '@/shared/bridge'

// Electron preload 桥接（src/preload/console.js，合并桥）。缺失即在窗口初始化期抛错（说明未经正确 preload 加载）。
const ipc = requireBridge(window.hiprintSet, 'hiprintSet', 'preload/console.js')

const router = useRouter()

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

// setContentSize 相关逻辑已删除：统一窗口不再按内容改尺寸。
// 原 handleTabChange 中的 ipc.send('setContentSize', ...) 与 document.querySelector('#app') 量高代码均移除。
function handleTabChange(): void {
  // 切 tab 不再通知主进程改窗口尺寸，SPA 内容区自适应
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
  // 统一窗口内：返回上一路由，不再关闭独立设置窗口
  router.back()
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
      label: 'PDF 缓存路径',
      prop: 'pdfPath',
      is: 'el-input',
      tips: '系统运行过程中的临时 PDF 存储路径',
      attrs: { readonly: true },
      event: { click: () => openDirectory('pdfPath') },
      span: 18,
      display: setTab.value === 'basicSet',
    },
    {
      label: '　',
      is: 'el-button',
      event: { click: () => chooseDirectory('pdfPath') },
      content: '选择',
      span: 6,
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

onBeforeUnmount(() => {
  ipc.removeAllListeners('getPrintersList')
  ipc.removeAllListeners('openDialog')
  ipc.removeAllListeners('testTransitResult')
})
</script>

<template>
  <div class="cv-settings">
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
  </div>
</template>

<style>
/* ============================================================
 * 设置视图 · 命名空间 .cv-settings（SPA 路由视图，无全局规则）
 * 视觉与已审核稿 docs/ui-redesign/02-settings.svg 一致。
 * ============================================================ */
.cv-settings {
  height: 100%;
  overflow: auto;
  padding: 18px 20px 20px;
  box-sizing: border-box;
}

/* ---------- 分段切换式 Tabs ---------- */
.cv-settings .el-tabs {
  margin-bottom: 18px;
}

.cv-settings .el-tabs__header {
  margin: 0;
}

.cv-settings .el-tabs__nav-wrap::after {
  display: none;
}

.cv-settings .el-tabs__active-bar {
  display: none;
}

.cv-settings .el-tabs__nav {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #e9edf4;
  border-radius: 9px;
  box-sizing: border-box;
}

.cv-settings .el-tabs__item {
  height: 30px;
  line-height: 30px;
  padding: 0 18px !important;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  border-radius: 7px;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.cv-settings .el-tabs__item:hover {
  color: var(--brand);
}

.cv-settings .el-tabs__item.is-active {
  color: var(--brand);
  background: var(--card-bg);
  box-shadow: var(--shadow-card);
}

/* ---------- 表单卡片容器 ---------- */
.cv-settings .el-form {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  padding: 14px 18px 6px;
  box-sizing: border-box;
}

.cv-settings .el-form-item {
  width: 100%;
  margin-bottom: 14px;
}

.cv-settings .el-form--label-top .el-form-item__label {
  padding: 0 0 4px;
  line-height: 1.4;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.cv-settings .el-form-item__label .el-icon-question {
  color: var(--text-3);
  font-size: 13px;
}

.cv-settings .el-form-item__error {
  font-size: 11px;
  color: var(--danger);
  padding-top: 3px;
}

.cv-settings .el-input-number,
.cv-settings .el-select,
.cv-settings .el-button {
  width: 100%;
}

/* ---------- 输入控件（element-plus 2.x：边框/底色在 __wrapper） ---------- */
.cv-settings .el-input__wrapper {
  background: var(--field-bg);
  border-radius: var(--radius-control);
  box-shadow: 0 0 0 1px var(--border) inset;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;
}

.cv-settings .el-input__wrapper:hover {
  box-shadow: 0 0 0 1px #c9cfdc inset;
}

.cv-settings .el-input__wrapper.is-focus,
.cv-settings .el-input__wrapper:focus-within {
  background: var(--card-bg);
  box-shadow: 0 0 0 1px var(--brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

.cv-settings .el-input__inner {
  color: var(--text-1);
  font-size: 13px;
}

.cv-settings .el-textarea__inner {
  background: var(--field-bg);
  border: none;
  border-radius: var(--radius-control);
  box-shadow: 0 0 0 1px var(--border) inset;
  color: var(--text-1);
  font-size: 13px;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;
}

.cv-settings .el-input__inner::placeholder,
.cv-settings .el-textarea__inner::placeholder {
  color: var(--text-3);
}

.cv-settings .el-textarea__inner:hover {
  box-shadow: 0 0 0 1px #c9cfdc inset;
}

.cv-settings .el-textarea__inner:focus {
  background: var(--card-bg);
  box-shadow: 0 0 0 1px var(--brand) inset, 0 0 0 3px rgba(51, 88, 224, 0.12);
}

/* 只读路径输入用等宽字体 */
.cv-settings .el-input.is-disabled .el-input__inner,
.cv-settings .el-input__inner[readonly] {
  font-family: var(--font-mono);
  cursor: pointer;
}

.cv-settings .el-input.is-disabled .el-input__wrapper {
  cursor: pointer;
}

/* 数字输入框（端口 / 上限）等宽 + 左对齐 */
.cv-settings .el-input-number .el-input__inner {
  font-family: var(--font-mono);
  font-weight: 600;
  text-align: left;
}

/* ---------- Select 下拉 ---------- */
.cv-settings .el-select .el-input__inner {
  cursor: pointer;
}

.cv-settings .el-select-dropdown {
  border-radius: var(--radius-control);
  border: 1px solid var(--border);
  box-shadow: 0 6px 16px rgba(26, 34, 51, 0.12);
}

.cv-settings .el-select-dropdown__item.selected {
  color: var(--brand);
  font-weight: 600;
}

/* ---------- 开关 Switch ---------- */
.cv-settings .el-switch.is-checked .el-switch__core {
  border-color: var(--brand);
  background-color: var(--brand);
}

/* ---------- 单选（关闭主窗口动作） ---------- */
.cv-settings .el-radio.is-bordered {
  border-radius: var(--radius-control);
  border-color: var(--border);
  padding: 8px 14px;
}

.cv-settings .el-radio.is-bordered.is-checked {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.cv-settings .el-radio.is-checked .el-radio__inner {
  border-color: var(--brand);
  background: var(--brand);
}

.cv-settings .el-radio.is-checked .el-radio__label {
  color: var(--brand);
}

/* ---------- 按钮 ---------- */
.cv-settings .el-button {
  border-radius: var(--radius-control);
  font-size: 13px;
  font-weight: 600;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease,
    box-shadow 0.18s ease;
}

/* 行内「选择 / 测试连接」次级按钮：浅底品牌色 */
.cv-settings .el-button:not(.el-button--primary) {
  background: var(--brand-soft);
  border-color: transparent;
  color: var(--brand);
}

.cv-settings .el-button:not(.el-button--primary):hover,
.cv-settings .el-button:not(.el-button--primary):focus {
  background: #dde7fd;
  border-color: transparent;
  color: var(--brand-strong);
}

/* 主操作「应用」：实色品牌按钮 */
.cv-settings .el-button--primary {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

.cv-settings .el-button--primary:hover,
.cv-settings .el-button--primary:focus {
  background: var(--brand-strong);
  border-color: var(--brand-strong);
}

/* ---------- 底部操作区分隔 ---------- */
.cv-settings .el-form > .el-row > .el-col:last-child > .el-form-item {
  margin-top: 4px;
  margin-bottom: 6px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

/* 隐藏滚动条但仍可滚动 */
.cv-settings .hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.cv-settings .hide-scrollbar::-webkit-scrollbar {
  display: none;
}
</style>
