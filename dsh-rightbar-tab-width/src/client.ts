/**
 * dsh-rightbar-tab-width — 浏览器半部入口(TypeScript 真源;由
 * scripts/build-client.mjs 用 esbuild 打包为 lib/client.js)。
 *
 * 功能:apply 时注入 <style data-plugin="dsh-rightbar-tab-width">,装载
 * src/css.ts 的胶囊定宽补丁——右栏每个停靠 tab 胶囊(`[data-dockkit-tab][role="tab"]`)
 * 的外宽固定为 CAPSULE_WIDTH_PX(100px,= 上游胶囊自身的地板值),不再随标签文字在
 * 100px–190px 之间浮动。
 *
 * 注意事项:上游 tab 条 / 胶囊 CSS 来自 dockkit,它只被 dsh-client-ui-sidebar-right
 * 消费(dockkit 的类名与属性钩子见 src/css.ts 头部);纯样式补丁不需要任何服务,
 * 故**不声明** inject。样式标签带 data-plugin,卸载时模块加载器(HMR 驱动)会回收;
 * 这里再用 ctx.effect 注册 disposer 兜底。
 */
import { CSS } from './css.ts'

export const name = 'dsh-rightbar-tab-width'

/** apply(ctx) 的运行时上下文最小面:仅用 effect 注册清理。 */
interface ClientContext {
  effect?(callback: () => void | (() => void)): void
}

export function apply(ctx?: ClientContext): void {
  installStyles(ctx)
}

/** 注入胶囊定宽样式表。 */
function installStyles(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-rightbar-tab-width'
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
