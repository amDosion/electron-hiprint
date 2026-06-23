import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import './tokens.css'
import { router } from './router'
import AppShell from './AppShell.vue'

const app = createApp(AppShell)
app.use(ElementPlus, { locale: zhCn })
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component as never)
}
app.use(router)
app.mount('#app')
