import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";
import App from "./App.vue";

// 设置窗口为配置驱动表单，用 <component :is="字符串"> 动态渲染控件，
// 需要组件按名称全局可解析，故整体注册 element-plus（含图标），而非按需导入。
const app = createApp(App);
app.use(ElementPlus, { locale: zhCn });
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component as never);
}
app.mount("#app");
