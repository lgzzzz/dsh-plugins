/**
 * dsh-code-card-fonts — 浏览器半部入口(TypeScript 真源;由
 * scripts/build-client.mjs 用 esbuild 打包为 lib/client.js)。
 *
 * 功能:apply 时注入 <style data-plugin="dsh-code-card-fonts">,装载 src/css.ts
 * 的字号补丁
 * 注意事项:样式标签带 data-plugin,卸载时模块加载器(HMR 驱动)会回收;这里
 * 再用 ctx.effect 注册 disposer 兜底。本插件不消费任何服务,不声明 inject。
 */
import { CSS } from './css.ts'

export const name = 'dsh-code-card-fonts'

/** apply(ctx) 的运行时上下文最小面:只用 effect 注册卸载清理。 */
interface ClientContext {
  effect?(callback: () => void | (() => void)): void
}

export function apply(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-code-card-fonts'
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
