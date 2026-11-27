/**
 * 浏览器半部:把 `css.ts` 的全部规则挂成一条 `<style>`,并在插件卸载时移除;
 * 再挂两条运行时兜底:
 *   - 会话面板在「历史偏好被关过」的页面上重新打开;
 *   - 左栏只允许因窗口变窄自动收起,手动收起(按钮 / 快捷键 / 遮罩)一律不生效。
 *
 * `ctx` 是可选的:调用方可能不传;传入的运行时上下文没有 `effect` 时,样式与巡查都不随
 * 卸载移除,页面存活期间一直有效;没有 `ctx` 时也装不了依赖服务的左栏守卫。
 */
import type { Context } from '@deepseek-ai/cordis'
import { CSS } from './css.ts'
import { keepSessionPanelOpen } from './pin.ts'
import { installLeftSidebarPin } from './sidebar.ts'

export const name = 'dsh-ui-css-patches'

export function apply(ctx?: Context): void {
  installStyles(ctx)
  installPanelPin(ctx)
  installLeftSidebarPinGuard(ctx)
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

/**
 * 安装会话面板的启动期兜底。样式先挂载:探针被固定为 1px 之后,兜底里的一次点击才会
 * 按停靠处理;没有 `window`(非浏览器环境)时整体跳过。
 * @param ctx - 可选的 cordis 上下文;带 `effect` 时注册卸载清理。
 */
function installPanelPin(ctx?: Context): void {
  if (typeof window === 'undefined') return
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => keepSessionPanelOpen(window))
    return
  }
  keepSessionPanelOpen(window)
}

/**
 * 安装左栏手动收起守卫:布局服务可用后包住 `toggleSidebar`,只放行「展开」方向。
 * 没有浏览器文档或没有可用上下文时整体跳过(样式里的按钮隐藏仍然生效)。
 * @param ctx - 可选的 cordis 上下文。
 */
function installLeftSidebarPinGuard(ctx?: Context): void {
  if (typeof window === 'undefined' || ctx === undefined) return
  installLeftSidebarPin(ctx, window.document)
}
