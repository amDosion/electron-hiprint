<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Printer, View, Setting, DocumentCopy } from '@element-plus/icons-vue'

// Electron preload 桥接（src/preload/index.js）。缺失说明窗口未经正确 preload 加载，提前失败。
const indexBridge = window.hiprintIndex
if (!indexBridge) {
  throw new Error('hiprintIndex bridge 未注入：请确认窗口经 preload/index.js 加载')
}
// 显式标注为非可选类型，使后续闭包内引用无需重复收窄
const ipc: HiprintIndexBridge = indexBridge

document.title = ipc.title

const macAddress = ref('')
const ipAddress = ref('')
const deviceId = ref('')
const transitActiveFlag = ref(false)
const transitErrorMessage = ref('')
const socketActiveNum = ref(0)
const printing = ref(false)
const displayPrivate = ref(true)
const version = ref(ipc.version)

const transitStatusText = computed(() => {
  if (transitActiveFlag.value) return '已连接'
  return transitErrorMessage.value ? '连接失败' : '未连接'
})

const localClientStatusText = computed(() =>
  socketActiveNum.value ? `已连接 ${socketActiveNum.value} 条` : '暂无连接',
)

// 隐私遮罩：开启时把字母数字替换为 *，保护服务地址/设备号/MAC 不被旁观者读取
function privateData(data: string): string {
  return displayPrivate.value ? data.replace(/[a-zA-Z0-9]/g, '*') : data
}

function openSetting(): void {
  ipc.send('openSetting')
}

function handleTriggerView(): void {
  displayPrivate.value = !displayPrivate.value
}

// 复制始终使用真实值（而非遮罩后的展示值）
function handleCopy(value: string): void {
  ipc.writeText(value)
  ipc.send('notification', {
    title: '复制成功',
    body: '文本已成功复制到剪贴板中！',
  })
}

function updateConnectionStatus(arg: unknown): void {
  if (!arg || typeof arg !== 'object') return
  const status = arg as {
    localClientCount?: unknown
    transitConnected?: unknown
    transitErrorMessage?: unknown
    printing?: unknown
  }
  if (Number.isFinite(Number(status.localClientCount))) {
    socketActiveNum.value = Number(status.localClientCount)
  }
  if (typeof status.transitConnected === 'boolean') {
    transitActiveFlag.value = status.transitConnected
  }
  if (typeof status.transitErrorMessage === 'string') {
    transitErrorMessage.value = status.transitErrorMessage
  }
  if (typeof status.printing === 'boolean') {
    printing.value = status.printing
  }
}

onMounted(() => {
  ipc.send('getMachineId')
  ipc.on('machineId', (_event, arg) => {
    deviceId.value = String(arg ?? '')
  })
  ipc.send('getAddress')
  ipc.on('address', (_event, arg) => {
    const a = (arg ?? {}) as { ip?: string; port?: number; mac?: string }
    ipAddress.value = `http://${a.ip}:${a.port || 17521}`
    macAddress.value = a.mac || ''
  })
  ipc.on('serverConnection', (_event, arg) => {
    socketActiveNum.value = Number(arg) || 0
  })
  ipc.on('printTask', (_event, arg) => {
    printing.value = Boolean(arg)
  })
  ipc.on('clientConnection', (_event, arg) => {
    transitActiveFlag.value = Boolean(arg)
    if (arg) transitErrorMessage.value = ''
  })
  ipc.on('connectionStatus', (_event, arg) => {
    updateConnectionStatus(arg)
  })
  ipc.send('getConnectionStatus')
})
</script>

<template>
  <div class="box">
    <div class="container">
      <!-- 顶栏：品牌 + 常驻状态胶囊 + 隐私切换 + 设置 -->
      <div class="app-topbar">
        <div class="app-logo"><el-icon><Printer /></el-icon></div>
        <div class="app-brand">hiPrint 打印服务</div>
        <div class="app-topbar-spacer"></div>
        <div class="status-pill"><span class="dot"></span>运行中</div>
        <el-icon
          class="privateIcon"
          :class="{ hidden: !displayPrivate }"
          :title="displayPrivate ? '隐藏重要数据' : '显示重要数据'"
          @click="handleTriggerView"
        ><View /></el-icon>
        <el-icon class="setIcon" title="进入设置" @click="openSetting"><Setting /></el-icon>
      </div>

      <div class="app-body">
        <!-- 服务地址（最高频操作） -->
        <div class="hero-card">
          <div class="hero-main">
            <div class="field-label">服务地址 SERVICE URL</div>
            <span class="hero-value" :title="ipAddress" @click="handleCopy(ipAddress)">
              {{ privateData(ipAddress) }}
            </span>
          </div>
          <span class="copy-hint"><el-icon><DocumentCopy /></el-icon>复制</span>
        </div>

        <!-- 状态网格 -->
        <div class="tile-grid">
          <div class="tile">
            <span
              class="dot"
              :class="{
                'is-success': transitActiveFlag,
                'is-danger': !transitActiveFlag && transitErrorMessage,
              }"
            ></span>
            <div class="tile-body">
              <div class="tile-label">中转状态</div>
              <div class="tile-value" :title="transitErrorMessage">{{ transitStatusText }}</div>
            </div>
          </div>
          <div class="tile">
            <span class="dot" :class="{ 'is-success': socketActiveNum }"></span>
            <div class="tile-body">
              <div class="tile-label">本地客户端</div>
              <div class="tile-value">{{ localClientStatusText }}</div>
            </div>
          </div>
          <div class="tile">
            <span class="dot" :class="{ 'is-warning': printing }"></span>
            <div class="tile-body">
              <div class="tile-label">打印状态</div>
              <div class="tile-value">{{ printing ? '文档打印中' : '空闲' }}</div>
            </div>
          </div>
          <div class="tile">
            <div class="tile-body">
              <div class="tile-label">设备编号</div>
              <div class="tile-value is-mono" :title="deviceId" @click="handleCopy(deviceId)">
                {{ privateData(deviceId) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底栏：MAC + 版本 -->
      <div class="app-footer">
        <span class="footer-mac" :title="macAddress" @click="handleCopy(macAddress)">
          MAC&nbsp;&nbsp;{{ privateData(macAddress) }}
        </span>
        <span class="footer-ver">v{{ version }}</span>
      </div>
    </div>
  </div>
</template>

<style>
:root {
  --c-brand: #3358e0;
  --c-brand-soft: #eaf0fe;
  --c-success: #16a34a;
  --c-success-soft: #e7f6ec;
  --c-success-text: #16823c;
  --c-warning: #b5740f;
  --c-danger: #dc2626;
  --c-text: #1a2233;
  --c-text-2: #5b6472;
  --c-text-3: #9aa3b2;
  --c-border: #e6e9f0;
  --c-page: #f4f6fa;
  --c-card: #ffffff;
  --c-dot-idle: #c2c8d2;
  --r-card: 12px;
  --r-ctrl: 8px;
  --font-base: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  --font-mono: "Cascadia Mono", "Consolas", monospace;
}

body {
  margin: 0;
  padding: 0;
  user-select: none;
  background: var(--c-page);
  color: var(--c-text);
  font-family: var(--font-base);
}

/* 布局壳（替代原共享 style.css 的 .box/.container 基底） */
.box {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
}
.container {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

/* ---- 顶栏 ---- */
.app-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 18px;
  background: var(--c-card);
  border-bottom: 1px solid var(--c-border);
  box-sizing: border-box;
}
.app-logo {
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  border-radius: var(--r-ctrl);
  background: linear-gradient(135deg, #4f7bff 0%, #3358e0 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
}
.app-brand {
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text);
  white-space: nowrap;
}
.app-topbar-spacer {
  flex: 1 1 auto;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 24px;
  padding: 0 12px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--c-success-soft);
  color: var(--c-success-text);
}
.status-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-success);
}

/* 顶栏图标按钮（隐私切换 + 设置），常驻显示 */
.app-topbar .privateIcon,
.app-topbar .setIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 30px;
  height: 30px;
  margin: 0;
  font-size: 17px;
  line-height: 1;
  color: var(--c-text-3);
  border-radius: var(--r-ctrl);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.app-topbar .privateIcon:hover,
.app-topbar .setIcon:hover {
  background: var(--c-brand-soft);
  color: var(--c-brand);
}
/* 隐私关闭时的眼睛斜线（替代原共享 style.css 的 ::after） */
.app-topbar .privateIcon.hidden::after {
  position: absolute;
  content: "/";
  left: calc(50% - 6px);
}

/* ---- 主体 ---- */
.app-body {
  padding: 16px 18px 12px;
  box-sizing: border-box;
}

.hero-card {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--c-card);
  border-radius: var(--r-card);
  box-shadow: 0 2px 8px rgba(26, 34, 51, 0.08);
  padding: 12px 16px 12px 18px;
  overflow: hidden;
}
.hero-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 2px;
  background: var(--c-brand);
}
.hero-card .hero-main {
  flex: 1 1 auto;
  min-width: 0;
}
.field-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--c-text-3);
  margin-bottom: 4px;
}
.hero-value {
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  color: var(--c-text);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}
.hero-value:hover {
  color: var(--c-brand);
}
.copy-hint {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  height: 32px;
  padding: 0 12px;
  border-radius: var(--r-ctrl);
  background: var(--c-brand-soft);
  color: var(--c-brand);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  pointer-events: none;
}

/* 状态网格 2x2 */
.tile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}
.tile {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--c-card);
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(26, 34, 51, 0.08);
  padding: 8px 14px;
  min-height: 46px;
  box-sizing: border-box;
}
.tile .dot {
  flex: 0 0 10px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c-dot-idle);
  transition: background 0.2s;
}
.tile .dot.is-success {
  background: var(--c-success);
}
.tile .dot.is-warning {
  background: var(--c-warning);
}
.tile .dot.is-danger {
  background: var(--c-danger);
}
.tile .tile-body {
  min-width: 0;
  flex: 1 1 auto;
}
.tile-label {
  font-size: 11px;
  color: var(--c-text-3);
  margin-bottom: 2px;
}
.tile-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile-value.is-mono {
  font-family: var(--font-mono);
  cursor: pointer;
}
.tile-value.is-mono:hover {
  color: var(--c-brand);
}

/* ---- 底栏 ---- */
.app-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-top: 1px solid var(--c-border);
  font-size: 11px;
  color: var(--c-text-3);
}
.app-footer .footer-mac {
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-footer .footer-mac:hover {
  color: var(--c-brand);
}
.app-footer .footer-ver {
  flex: 0 0 auto;
  font-family: var(--font-mono);
}
</style>
