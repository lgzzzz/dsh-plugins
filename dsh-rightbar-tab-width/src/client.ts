/** 浏览器半部入口:apply 注入 src/css.ts 的胶囊定宽补丁(右栏停靠 tab 外宽恒 100px);无 inject。 */
import { CSS } from './css.ts'

export const name = 'dsh-rightbar-tab-width'

// 运行时上下文最小面:仅用 effect 注册清理。
interface ClientContext {
  effect?(callback: () => void | (() => void)): void
}

export function apply(ctx?: ClientContext): void {
  installStyles(ctx)
}

// 注入胶囊定宽样式表。
function installStyles(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-rightbar-tab-width'
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
