import { createRouter, createWebHashHistory } from 'vue-router'

const Placeholder = { template: '<div style="padding:24px;color:#9aa3b2">加载中…</div>' }

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/status' },
    { path: '/status', name: 'status', component: Placeholder },
    { path: '/settings', name: 'settings', component: Placeholder },
    { path: '/print-log', name: 'printLog', component: Placeholder },
    { path: '/software-log', name: 'softwareLog', component: Placeholder },
  ],
})
