// 控制台单页入口（L3：合并 status / settings / printLog / softwareLog 四视图）。
// 不再全量 `import ElementPlus` / 全量图标 / 全量 CSS：旧写法把 ~145 个组件 + ~290 个图标
// 塞进入口，打包出 ~1.1MB 的 console chunk，dom-ready 前渲染进程必须整体 parse+compile+execute
// 这一坨，托盘打开控制台极慢（叠加隐藏窗口节流时实测达数十秒）。
//
// 现在走按需：模板里静态写的 el- 组件由 unplugin-vue-components(ElementPlusResolver) 自动
// 引入「组件 + 对应样式」。下面只手动补「resolver 静态分析覆盖不到」的两类样式：
//   ① 服务式 API：ElMessage（StatusView / SettingsView 显式 import 调用，非模板标签）
//   ② 配置驱动表单里以字符串 :is 动态渲染的控件（SettingsView，见其 FIELD_COMPONENTS）
// locale 改由 AppShell 顶层 <el-config-provider> 注入，不再 app.use(ElementPlus)。
import { createApp } from "vue";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/input-number/style/css";
import "element-plus/es/components/select/style/css";
import "element-plus/es/components/option/style/css";
import "element-plus/es/components/switch/style/css";
import "element-plus/es/components/radio/style/css";
import "element-plus/es/components/radio-group/style/css";
import "element-plus/es/components/button/style/css";
import "./tokens.css";
import { router } from "./router";
import AppShell from "./AppShell.vue";

const app = createApp(AppShell);
app.use(router);
app.mount("#app");
