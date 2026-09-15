/**
 * 浏览器半部入口:apply 时注入 src/css.ts 的卡片字号补丁(统一 14px、卡片间距 7px)。
 * **不覆盖** --dsh-content-font-size,设置里的「字号大小」仍可调;无 inject,卸载由 HMR 回收。
 */
import { CSS } from './css.ts'

export const name = 'dsh-code-card-fonts'

/** 运行时上下文最小面:仅用 effect 注册清理。 */
interface ClientContext {
  effect?(callback: () => void | (() => void)): void
}

export function apply(ctx?: ClientContext): void {
  installStyles(ctx)
}

/** 注入卡片字号补丁样式表。 */
function installStyles(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-code-card-fonts'
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
