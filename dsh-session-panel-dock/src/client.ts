/**
 * 浏览器半部:把 `css.ts` 里的「会话面板始终停靠」规则挂成一条 `<style>`,
 * 并在插件卸载时移除。
 *
 * 样式先于面板测量生效即可:探针规则一旦命中,下一次 ResizeObserver 回报 1px,
 * 面板就从 hidden/overlay 切到 docked;正文宽度规则同时生效,让 Conversation 主体
 * 在同一帧里把正文和输入框向左让位。没有 JS 参与布局,也就不存在 React 生命周期、
 * 会话切换或浮层关闭顺序的耦合。
 *
 * `ctx` 是可选的:传入的运行时上下文没有 `effect` 时,样式不随卸载移除,
 * 页面存活期间一直有效。
 */
import type { Context } from '@deepseek-ai/cordis'
import { CSS, STYLE_TAG_ID } from './css.ts'

export const name = 'dsh-session-panel-dock'

export function apply(ctx?: Context): void {
  installStyles(ctx)
}

/**
 * 把样式表挂到文档上。
 * @param ctx - 可选的 cordis 上下文;带 `effect` 时注册卸载清理。
 */
export function installStyles(ctx?: Context): void {
  if (typeof document === 'undefined') return
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
