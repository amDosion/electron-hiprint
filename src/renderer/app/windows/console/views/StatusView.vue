<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Printer, View, Setting, DocumentCopy } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
// index 窗口未整体注册 element-plus（main.ts 仅 createApp），故按需引入 ElMessage 的样式，
// 否则复制反馈的提示条无样式。与设置窗口的反馈语言保持一致。
import 'element-plus/es/components/message/style/css'
import { requireBridge } from '@/shared/bridge'

// Electron preload 桥接（src/preload/index.js）。缺失即在窗口初始化期抛错（说明未经正确 preload 加载）。
const ipc = requireBridge(window.hiprintIndex, 'hiprintIndex', 'preload/index.js')

document.title = ipc.title

const router = useRouter()

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
  // 同窗导航到设置视图（不再开独立设置窗）
  router.push('/settings')
}

function handleTriggerView(): void {
  displayPrivate.value = !displayPrivate.value
}

// 复制始终使用真实值（而非遮罩后的展示值）；空值（IPC 回填前/获取失败）直接忽略，
// 避免写入空串并谎报"复制成功"。反馈用应用内 ElMessage（即时、自动消失），
// 取代旧的 OS 系统通知——后者可能被 Windows 专注助手/通知设置压制，导致"点了没反应"。
function handleCopy(value: string): void {
  if (!value) return
  ipc.writeText(value)
  ElMessage({ type: 'success', message: '已复制到剪贴板', duration: 1500 })
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
    // ip 兜底：无可用网卡时主进程 address.ip() 可能返回 undefined，避免渲染出 http://undefined:port
    const ip = a.ip || '127.0.0.1'
    ipAddress.value = `http://${ip}:${a.port || 17521}`
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
  <div class="cv-status">
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
            <span class="hero-value" :title="privateData(ipAddress)" @click="handleCopy(ipAddress)">
              {{ privateData(ipAddress) }}
            </span>
          </div>
          <span class="copy-hint" @click="handleCopy(ipAddress)"><el-icon><DocumentCopy /></el-icon>复制</span>
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
              <div class="tile-value is-mono" :title="privateData(deviceId)" @click="handleCopy(deviceId)">
                {{ privateData(deviceId) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 底栏：MAC + 版本 -->
      <div class="app-footer">
        <span class="footer-mac" :title="privateData(macAddress)" @click="handleCopy(macAddress)">
          MAC&nbsp;&nbsp;{{ privateData(macAddress) }}
        </span>
        <span class="footer-ver">v{{ version }}</span>
      </div>
    </div>
  </div>
</template>

<style>
/* ============================================================
   连接状态视图 · 命名空间 .cv-status（SPA 路由视图，无全局规则）
   ============================================================ */
.cv-status {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cv-status .container {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

/* ---- 顶栏 ---- */
.cv-status .app-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 18px;
  background: var(--c-card);
  border-bottom: 1px solid var(--c-border);
  box-sizing: border-box;
}
.cv-status .app-logo {
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
.cv-status .app-brand {
  font-size: 15px;
  font-weight: 700;
  color: var(--c-text);
  white-space: nowrap;
}
.cv-status .app-topbar-spacer {
  flex: 1 1 auto;
}
.cv-status .status-pill {
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
.cv-status .status-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-success);
}

/* 顶栏图标按钮（隐私切换 + 设置），常驻显示 */
.cv-status .app-topbar .privateIcon,
.cv-status .app-topbar .setIcon {
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
.cv-status .app-topbar .privateIcon:hover,
.cv-status .app-topbar .setIcon:hover {
  background: var(--c-brand-soft);
  color: var(--c-brand);
}
/* 隐私关闭时的眼睛斜线（替代原共享 style.css 的 ::after） */
.cv-status .app-topbar .privateIcon.hidden::after {
  position: absolute;
  content: "/";
  left: calc(50% - 6px);
}

/* ---- 主体 ---- */
.cv-status .app-body {
  padding: 16px 18px 12px;
  box-sizing: border-box;
}

.cv-status .hero-card {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--c-card);
  border-radius: var(--r-card);
  box-shadow: 0 2px 8px rgba(26, 34, 51, 0.08);
  padding: 12px 16px 12px 18px;
  overflow: hidden;
}
.cv-status .hero-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 2px;
  background: var(--c-brand);
}
.cv-status .hero-card .hero-main {
  flex: 1 1 auto;
  min-width: 0;
}
.cv-status .field-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--c-text-3);
  margin-bottom: 4px;
}
.cv-status .hero-value {
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
.cv-status .hero-value:hover {
  color: var(--c-brand);
}
.cv-status .copy-hint {
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
  transition: background 0.15s, color 0.15s;
}
.cv-status .copy-hint:hover {
  background: var(--c-brand);
  color: #fff;
}
.cv-status .copy-hint:active {
  filter: brightness(0.96);
}

/* 状态网格 2x2 */
.cv-status .tile-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}
.cv-status .tile {
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
.cv-status .tile .dot {
  flex: 0 0 10px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c-dot-idle);
  transition: background 0.2s;
}
.cv-status .tile .dot.is-success {
  background: var(--c-success);
}
.cv-status .tile .dot.is-warning {
  background: var(--c-warning);
}
.cv-status .tile .dot.is-danger {
  background: var(--c-danger);
}
.cv-status .tile .tile-body {
  min-width: 0;
  flex: 1 1 auto;
}
.cv-status .tile-label {
  font-size: 11px;
  color: var(--c-text-3);
  margin-bottom: 2px;
}
.cv-status .tile-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv-status .tile-value.is-mono {
  font-family: var(--font-mono);
  cursor: pointer;
}
.cv-status .tile-value.is-mono:hover {
  color: var(--c-brand);
}

/* ---- 底栏 ---- */
.cv-status .app-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border-top: 1px solid var(--c-border);
  font-size: 11px;
  color: var(--c-text-3);
}
.cv-status .app-footer .footer-mac {
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv-status .app-footer .footer-mac:hover {
  color: var(--c-brand);
}
.cv-status .app-footer .footer-ver {
  flex: 0 0 auto;
  font-family: var(--font-mono);
}
</style>
