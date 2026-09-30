/**
 * Browser half: install the Verbose fold patch on the live Chat view.
 *
 * Activation mirrors `dsh-header-action-order`: the ledger is scanned as soon
 * as the slot is declared, and every later registration change re-runs the
 * scan, so the patch lands whether ui-chat registers before or after this
 * plugin. No upstream component is shadowed or re-registered.
 */
import {
  CHAT_VIEW_ID, CHAT_VIEW_SLOT, createFoldPatchState, patchChatView,
} from './policy-fold.ts'
import type { ClientContext, SlotsLike } from './types.ts'

export const name = 'dsh-ui-chat-verbose-fold'

export const inject = ['slots']

/** Read the slots registry, tolerating an absent service. */
function getSlots(ctx: ClientContext): SlotsLike | undefined {
  if (typeof ctx.get !== 'function') return undefined
  const value = ctx.get('slots') as SlotsLike | undefined
  return value === null || value === undefined ? undefined : value
}

/** Emit one prefixed diagnostic. */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** Install the fold patch on one client context. */
export function apply(ctx: ClientContext): void {
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
    // A slot declaration can precede ui-chat's own registration by one tick:
    // only a ledger still empty after that tick is worth reporting.
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
