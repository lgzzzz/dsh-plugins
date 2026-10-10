/**
 * 浏览器半部：折叠把阅读位置顶走时，把它补回原处。
 *
 * 这里只有装配——`apply()` 给每个聊天滚动口挂一个补偿器，并在插件卸载时收干净。
 * 认信号、算修正量的全部实现见 `viewport.ts`；上游锚点、已知边界与验证方式见
 * docs/dsh-ui-chat-fold-anchor.md。
 */
import { createRuntime } from './viewport.ts'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-ui-chat-fold-anchor'

/**
 * 在客户端上下文里装上补偿器。
 *
 * 没有 DOM 的环境（构建产物在 Node 里被装配）直接返回：本插件是纯浏览器补丁，
 * 不碰任何 cordis 服务，也不注册槽位。
 *
 * @param ctx - 客户端插件上下文；存在 `effect` 时用它挂清理。
 */
export function apply(ctx: Context): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  const runtime = createRuntime(document)
  if (typeof ctx.effect === 'function') ctx.effect(() => () => runtime.dispose(), 'ui-chat 折叠滚动补偿')
}
