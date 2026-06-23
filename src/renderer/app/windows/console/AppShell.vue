<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Monitor, Operation, Share, Tools, Document, Tickets } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const NAV = [
  { name: 'status', path: '/status', label: '连接状态', icon: Monitor },
  { name: 'settingsBasic', path: '/settings/basic', label: '基础设置', icon: Operation },
  { name: 'settingsTransit', path: '/settings/transit', label: '中转设置', icon: Share },
  { name: 'settingsAdvanced', path: '/settings/advanced', label: '高级配置', icon: Tools },
  { name: 'printLog', path: '/print-log', label: '打印记录', icon: Tickets },
  { name: 'softwareLog', path: '/software-log', label: '软件日志', icon: Document },
]
onMounted(() => {
  // 主进程托盘点击 → 切到对应路由
  window.hiprintConsole?.onNavigate((r: string) => { if (r) router.push(r) })
})
</script>

<template>
  <div class="shell">
    <nav class="shell-side">
      <div class="shell-brand"><span class="shell-logo"></span>hiPrint</div>
      <button
        v-for="item in NAV" :key="item.name" class="shell-nav"
        :class="{ active: route.name === item.name }"
        @click="router.push(item.path)"
      >
        <el-icon class="shell-nav-ic"><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </button>
    </nav>
    <main class="shell-main"><router-view /></main>
  </div>
</template>

<style>
.shell { display: flex; height: 100vh; }
.shell-side { flex: 0 0 188px; background: var(--c-card); border-right: 1px solid var(--c-border); display: flex; flex-direction: column; gap: 4px; padding: 14px 10px; box-sizing: border-box; }
.shell-brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; color: var(--c-text); padding: 6px 10px 14px; }
.shell-logo { width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(135deg,#4f7bff,#3358e0); }
.shell-nav { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--c-text-2); font-size: 13.5px; font-family: var(--font-base); cursor: pointer; text-align: left; transition: background .15s, color .15s; }
.shell-nav:hover { background: var(--c-brand-soft); color: var(--c-brand); }
.shell-nav.active { background: var(--c-brand-soft); color: var(--c-brand); font-weight: 600; }
.shell-nav-ic { font-size: 17px; }
.shell-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
</style>
