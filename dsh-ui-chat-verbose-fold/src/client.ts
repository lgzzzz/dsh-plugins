/**
 * 浏览器半部:在实时 Chat 视图上打 verbose 折叠补丁。
 *
 * 槽一被声明就扫描账本,之后每次注册变化再扫一次,因此 ui-chat 在本插件之前或
 * 之后注册都能打上;注册表不带 `inject` 时退化为装配当场扫一次。不遮蔽也不重注册
 * 任何上游组件。
 *
 * ui-chat 的客户端包依赖一长串服务(`uiWorkspace` / `uiConversation` / `sidebarRight`
 * 等),它注册 `conversation.view` 的时刻可能比本插件看到槽声明晚好几个任务;所以
 * 「账本上还没有 chat 注册项」在启动期是常态,只有过了有界自检窗口仍为空才算真缺席 ——
 * 否则会在补丁其实已经(或马上)生效时误报。
 *
 * 行为差异、机制与失败模式见 docs/dsh-ui-chat-verbose-fold.md。
 */
import {
  CHAT_VIEW_ID, CHAT_VIEW_SLOT, createFoldPatchState, patchChatView,
} from './policy-fold.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'

export const name = 'dsh-ui-chat-verbose-fold'

export const inject = ['slots']

/** 自检窗口里两次探测之间的间隔(毫秒)。 */
export const MISSING_PROBE_MS = 50

/**
 * 自检窗口的探测次数:窗口 ≈ `MISSING_PROBE_MS × MISSING_PROBE_ATTEMPTS` ≈ 1 秒。
 *
 * 覆盖客户端 roster 的启动期(ui-chat 的包与它的依赖链陆续激活)。窗口内一发现 chat
 * 注册项就停止探测,所以只有真的没有该注册项时才会走满窗口并告警一次。
 */
export const MISSING_PROBE_ATTEMPTS = 20

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

/** 一次延迟自检;没有定时器的环境里直接同步跑。 */
function whenLater(ms: number, run: () => void): void {
  if (typeof setTimeout === 'function') setTimeout(run, ms)
  else run()
}

/** 在一个客户端上下文上安装折叠补丁。 */
export function apply(ctx: Context): void {
  const slots = getSlots(ctx)
  if (slots === undefined) return

  const state = createFoldPatchState()
  let attemptsLeft = MISSING_PROBE_ATTEMPTS
  let probeScheduled = false
  let missingReported = false

  /**
   * 扫一遍账本;账本上还没有 chat 注册项时,在有界窗口内继续探测。
   *
   * 窗口的每一拍都重扫一遍,chat 注册项一到就在那一拍之后停止探测(不再排下一拍);
   * 窗口走完仍没有才算真缺席,告警一次。注入面形状已告警的情形(注册项在、但
   * `hooks.presentation` 不在)不再重复报「未找到」。
   */
  const reapply = (): void => {
    let outcome
    try {
      outcome = patchChatView(slots, state, warn)
    } catch (error) {
      warn('打补丁失败:', error)
      return
    }
    // `patched` / `already` 都是补丁已落地(或早已落地),没有任何要等的注册项。
    if (outcome !== 'pending' || missingReported || probeScheduled) return
    probeScheduled = true
    whenLater(MISSING_PROBE_MS, () => {
      probeScheduled = false
      if (missingReported) return
      attemptsLeft -= 1
      if (attemptsLeft > 0) {
        reapply()
        return
      }
      missingReported = true
      if (state.wrappedCount === 0 && !state.shapeWarned) {
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
