import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/status" },
    { path: "/status", name: "status", component: () => import("./views/StatusView.vue") },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue") },
    { path: "/print-log", name: "printLog", component: () => import("./views/PrintLogView.vue") },
    { path: "/software-log", name: "softwareLog", component: () => import("./views/SoftwareLogView.vue") },
  ],
});
