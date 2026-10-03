/**
 * 浏览器半部:在实时 Chat 视图上打 verbose 折叠补丁。
 *
 * 槽一被声明就扫描账本,之后每次注册变化再扫一次,因此 ui-chat 在本插件之前或
 * 之后注册都能打上;不遮蔽也不重注册任何上游组件。
 */
import {
  CHAT_VIEW_ID, CHAT_VIEW_SLOT, createFoldPatchState, patchChatView,
} from './policy-fold.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'

export const name = 'dsh-ui-chat-verbose-fold'

export const inject = ['slots']

/** 读取 slots 注册表;服务缺席时返回 undefined。 */
function getSlots(ctx: Context): SlotRegistry | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get('slots') as SlotRegistry | undefined
  return value === null || value === undefined ? undefined : value
}

/** 输出一条带插件名前缀的告警。 */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** 在一个客户端上下文上安装折叠补丁。 */
export function apply(ctx: Context): void {
  const slots = getSlots(ctx)
  if (slots === undefined) return

  const state = createFoldPatchState()
  let missingReported = false

  const reapply = (): void => {
    let outcome
    try {
      outcome = patchChatView(slots, state, warn)
    } catch (error) {
      warn('打补丁失败:', error)
      return
    }
    if (outcome !== 'pending' || missingReported) return
    missingReported = true
    // 槽声明可能比 ui-chat 自身的注册早一拍:只有过了这一拍账本仍为空才告警。
    queueMicrotask(() => {
      if (state.wrappedCount === 0) {
        warn(`未找到 ${CHAT_VIEW_SLOT}#${CHAT_VIEW_ID};verbose 折叠补丁未生效`)
      }
    })
  }

  if (typeof slots.inject !== 'function') {
    reapply()
    return
  }

  slots.inject(CHAT_VIEW_SLOT, () => {
    reapply()
    const unsubscribe = typeof slots.subscribe === 'function' ? slots.subscribe(CHAT_VIEW_SLOT, reapply) : undefined
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  })
}
