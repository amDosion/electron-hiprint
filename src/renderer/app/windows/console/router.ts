import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/status" },
    { path: "/status", name: "status", component: () => import("./views/StatusView.vue") },
    { path: "/settings", redirect: "/settings/basic" },
    {
      path: "/settings/basic",
      name: "settingsBasic",
      component: () => import("./views/SettingsView.vue"),
      meta: { settingsTab: "basicSet" },
    },
    {
      path: "/settings/transit",
      name: "settingsTransit",
      component: () => import("./views/SettingsView.vue"),
      meta: { settingsTab: "transitSet" },
    },
    {
      path: "/settings/advanced",
      name: "settingsAdvanced",
      component: () => import("./views/SettingsView.vue"),
      meta: { settingsTab: "advancedSet" },
    },
    { path: "/print-log", name: "printLog", component: () => import("./views/PrintLogView.vue") },
    { path: "/software-log", name: "softwareLog", component: () => import("./views/SoftwareLogView.vue") },
  ],
});
