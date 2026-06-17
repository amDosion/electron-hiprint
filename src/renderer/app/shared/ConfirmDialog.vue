<script setup lang="ts">
// 通用确认浮层：替代 ElMessageBox / 阻塞式系统弹窗，自包含、零 element-plus。
// 由「打印记录·清空」与「软件日志·清空」共用，避免两窗各维护一份会漂移的确认浮层副本。
// 父组件持有 visible 并响应 confirm / cancel；样式 scoped，不污染各窗口的全局 <style>。
withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    message?: string
    confirmText?: string
    cancelText?: string
  }>(),
  {
    title: '提示',
    message: '',
    confirmText: '确定',
    cancelText: '取消',
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div v-if="visible" class="cd-mask" @click.self="emit('cancel')">
    <div class="cd-box" role="dialog" aria-modal="true">
      <div class="cd-title">{{ title }}</div>
      <div class="cd-body">{{ message }}</div>
      <div class="cd-actions">
        <button class="cd-btn" type="button" @click="emit('cancel')">{{ cancelText }}</button>
        <button class="cd-btn cd-btn-primary" type="button" @click="emit('confirm')">
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 自包含调色板（不依赖宿主窗口的 --pl-* / --sl-* token），与两窗确认浮层观感一致。 */
.cd-mask {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 34, 51, 0.32);
  z-index: 100;
}

.cd-box {
  width: 320px;
  max-width: calc(100vw - 48px);
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(26, 34, 51, 0.22);
  padding: 18px 20px 16px;
  box-sizing: border-box;
  font-family: 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif;
}

.cd-title {
  font-size: 15px;
  font-weight: 700;
  color: #1a2233;
  text-align: center;
  margin-bottom: 12px;
}

.cd-body {
  font-size: 13px;
  color: #5b6472;
  text-align: center;
  margin-bottom: 18px;
}

.cd-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.cd-btn {
  height: 30px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid #e6e9f0;
  background: #ffffff;
  color: #5b6472;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s ease, filter 0.15s ease;
}

.cd-btn:hover {
  border-color: #c5cbd8;
}

.cd-btn-primary {
  background: linear-gradient(135deg, #4f7bff 0%, #3358e0 100%);
  border: none;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(51, 88, 224, 0.25);
}

.cd-btn-primary:hover {
  filter: brightness(1.06);
}

.cd-btn-primary:active {
  filter: brightness(0.96);
}
</style>
