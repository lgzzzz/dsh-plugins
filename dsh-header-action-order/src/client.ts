/**
 * 浏览器半部入口:把会话标题栏动作区(`conversation.session.header.actions`)的图标顺序改成
 * src/order.ts 里 HEADER_ACTION_ORDER 的顺序。
 *
 * 时序:各图标由上游插件经 `slots.inject` 各自注册,其中一个还来自独立 bundle(agent-team),
 * 注册先后不确定 ⇒ 槽声明后立即应用一次,并 `subscribe` 每次注册变化后重放(幂等)。
 * 槽不可用 / 服务缺席即 no-op(不改 DOM、不自己注册项)。
 */
import { HEADER_ACTION_ORDER, HEADER_ACTION_SLOT, applyHeaderActionOrder } from './order.ts'
import type { ClientContext, SlotsLike } from './types.ts'

export const name = 'dsh-header-action-order'

/** 浏览器半部注入的服务(模块加载器读取):只消费 slots。 */
export const inject = ['slots']

/** 双重判空后取服务(缺失时返回 undefined)。 */
function getSlots(ctx: ClientContext): SlotsLike | undefined {
  if (ctx.get === undefined || ctx.get === null) return undefined
  const value = ctx.get('slots') as SlotsLike | undefined
  return value === null || value === undefined ? undefined : value
}

export function apply(ctx: ClientContext): void {
  const slots = getSlots(ctx)
  if (slots === undefined) return

  const reapply = (): void => {
    try {
      applyHeaderActionOrder(slots, HEADER_ACTION_ORDER)
    } catch (error) {
      // 服务面异常(如 entries 抛错)只放弃本次重排,不影响标题栏与整个页面
      console.warn('[dsh-header-action-order] 重排失败:', error)
    }
  }

  if (typeof slots.inject !== 'function') {
    // 槽早已声明过(上游服务面简化)也要应用一次
    reapply()
    return
  }

  slots.inject(HEADER_ACTION_SLOT, () => {
    reapply()
    const unsubscribe = typeof slots.subscribe === 'function' ? slots.subscribe(HEADER_ACTION_SLOT, reapply) : undefined
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  })
}
