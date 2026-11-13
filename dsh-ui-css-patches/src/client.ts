/**
 * 浏览器半部:把 `css.ts` 的全部规则挂成一条 `<style>`,并在插件卸载时移除。
 *
 * `ctx` 是可选的:调用方可能不传;传入的运行时上下文没有 `effect` 时,样式不随卸载移除,
 * 页面存活期间一直有效。
 */
import type { Context } from '@deepseek-ai/cordis'
import { CSS } from './css.ts'

export const name = 'dsh-ui-css-patches'

export function apply(ctx?: Context): void {
  installStyles(ctx)
}

function installStyles(ctx?: Context): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
