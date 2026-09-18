/** 浏览器半部入口:apply 注入 src/css.ts 的右栏字号补丁(预览正文/代码与变更审阅 diff 跟字号轴);无 inject。 */
import { CSS } from './css.ts'

export const name = 'dsh-rightbar-fonts'

// 运行时上下文最小面:仅用 effect 注册清理。
interface ClientContext {
  effect?(callback: () => void | (() => void)): void
}

export function apply(ctx?: ClientContext): void {
  installStyles(ctx)
}

// 注入右栏字号补丁样式表。
function installStyles(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-rightbar-fonts'
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
