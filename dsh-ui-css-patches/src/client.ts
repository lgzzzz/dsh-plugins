/**
 * 浏览器半部:把 `css.ts` 的全部规则挂成一条 `<style>`,并在插件卸载时移除。
 *
 * 上下文没有 `effect` 时样式不随卸载移除,页面存活期间一直有效。
 */
import { CSS } from './css.ts'

export const name = 'dsh-ui-css-patches'

interface ClientContext {
  effect?(callback: () => void | (() => void)): void
}

export function apply(ctx?: ClientContext): void {
  installStyles(ctx)
}

function installStyles(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
