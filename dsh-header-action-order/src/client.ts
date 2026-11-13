/**
 * 浏览器半部:把会话标题栏的动作图标按固定顺序重排。
 *
 * `slots` 服务缺席就整体不装。注册表支持 `inject` 时,先等槽位声明、声明后立即排一次并订阅后续
 * 注册变化重排 —— 新注册项带的是它自己的默认 order,只在注册那一刻再排才不会留下乱序;不支持
 * `inject` 的注册表就立即排一次。
 */
import { HEADER_ACTION_ORDER, HEADER_ACTION_SLOT, applyHeaderActionOrder } from './order.ts'
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):加载渲染器对 `Context.slots` 的服务声明,以及
// ui-conversation 对 `SlotMap` 的键声明(`conversation.session.header.actions`)。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export const name = 'dsh-header-action-order'

export const inject = ['slots']

function getSlots(ctx: Context): Context['slots'] | undefined {
  if (ctx.get === undefined || ctx.get === null) return undefined
  const value = ctx.get('slots') as Context['slots'] | undefined
  return value === null || value === undefined ? undefined : value
}

export function apply(ctx: Context): void {
  const slots = getSlots(ctx)
  if (slots === undefined) return

  const reapply = (): void => {
    try {
      applyHeaderActionOrder(slots, HEADER_ACTION_ORDER)
    } catch (error) {
      console.warn('[dsh-header-action-order] 重排失败:', error)
    }
  }

  if (typeof slots.inject !== 'function') {
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
