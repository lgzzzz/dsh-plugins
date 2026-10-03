/**
 * `Esc` 取消待答的用户问题。
 *
 * `ask_user_question` 把卡片作为输入区接管呈现，未作答时唯一的退出方式是面板自身的
 * 关闭/取消按钮，它调用 `PendingQuestion.dismiss()`。该动作没有绑定任何按键：卡片自己
 * 用 `Enter` 处理选项与输入框，`Escape` 则无主地传到页面。
 *
 * 本模块从固定输入通道（每个 keydown 都早于可配置派发运行，可消费该按键）取该按键，
 * 并经与审批桥接相同的已发布 pending interaction 作答，只是收窄到 question 域；一个
 * Session 同时只发布一个 pending interaction，所以两个域不会同时认领同一按键。
 *
 * 目标规则：终端保留自己的按键；`editable` 区默认保留，唯一例外是本面板自己的答题
 * 输入框（`[data-question-key]` / `[data-plan-review-key]` 卡片内），它的 keydown 只处理
 * `Enter`。
 */
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {ShortcutContext, ShortcutGesture, Shortcuts} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ISessions} from '@deepseek-ai/dsh-api-session-controller/client'
import type {PendingQuestion} from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type {
  SessionPendingInteraction,
  SessionStatusSnapshot,
  UiSession,
} from '@deepseek-ai/dsh-client-ui-session/client'
import type {Context} from '@deepseek-ai/cordis'

/** 问题包渲染的两种卡片根节点。 */
const QUESTION_CARD_SELECTOR = '[data-question-key], [data-plan-review-key]'

/** 这两个根节点携带请求 key 的属性名。 */
const QUESTION_CARD_ATTRIBUTES = ['data-question-key', 'data-plan-review-key'] as const

/**
 * 该按键能否在无 DOM 焦点时取消待答问题：`Escape`、首次、未消费、无修饰键、
 * `modal === null` 且 `region !== 'terminal'`；`editable` 在此放行，由调用方再收窄。
 */
export function questionEscapeEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return gesture.code === 'Escape'
    && !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && !gesture.control
    && !gesture.alt
    && !gesture.shift
    && !gesture.meta
    && context.modal === null
    && context.region !== 'terminal'
}

/**
 * 目标是否落在指定 key 的那张卡片内（比对 `data-question-key` / `data-plan-review-key`）；
 * key 不同则不是同一个请求。
 */
export function questionCardOwnsTarget(target: Element | null, key: string): boolean {
  if (target === null || typeof target.closest !== 'function') return false
  const card = target.closest(QUESTION_CARD_SELECTOR)
  if (card === null || typeof card.getAttribute !== 'function') return false
  return QUESTION_CARD_ATTRIBUTES.some((attribute) => card.getAttribute(attribute) === key)
}

/**
 * 把已发布的 pending interaction 收窄为可关闭的问题：`kind` 为 `'question'` 或
 * `'plan-review'`、`key` 为字符串且 `dismiss` 为函数。
 */
export function asDismissableQuestion(value: SessionPendingInteraction | undefined): PendingQuestion | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as unknown as {
    kind?: unknown
    key?: unknown
    dismiss?: unknown
  }
  if (candidate.kind !== 'question' && candidate.kind !== 'plan-review') return undefined
  if (typeof candidate.key !== 'string') return undefined
  if (typeof candidate.dismiss !== 'function') return undefined
  return candidate as unknown as PendingQuestion
}

/** 主视图为某个 Session 呈现的问题卡片；没有则返回 undefined。 */
export function presentedQuestion(
  sessionId: SessionId | undefined,
  statuses: SessionStatusSnapshot,
): PendingQuestion | undefined {
  if (sessionId === undefined) return undefined
  return asDismissableQuestion(statuses.get(sessionId)?.pendingInteraction)
}

/**
 * 安装问题卡片的 Escape 取消桥接：注册固定输入观察者。卡片本身是 Web 客户端功能，
 * 未挂载它的 Client 不会发布问题交互，此桥接保持为空操作。
 */
export function installQuestionBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sessions', 'uiSession'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sessions: ISessions = scope.sessions
    const uiSession: UiSession = scope.uiSession
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; question bridge not installed')
      return
    }
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handleQuestionInput(sessions, uiSession, input)
    }), `${name}: question keys`)
  })
}

/** 用当前呈现的问题卡片处理一次固定通道的 keydown。 */
function handleQuestionInput(
  sessions: ISessions,
  uiSession: UiSession,
  input: KeydownInput,
): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (!questionEscapeEligible(gesture, context)) return
  const question: PendingQuestion | undefined = presentedQuestion(
    mainViewSessionId(sessions.list.getSnapshot()),
    uiSession.sessionStatus.getSnapshot(),
  )
  if (question === undefined) return
  // editable 区保留自己的按键，例外是本面板自己的答题输入框（它的 keydown 只处理 Enter）。
  if (context.region === 'editable' && !questionCardOwnsTarget(context.target, question.key)) return
  // 先消费再关闭：该按键不得再传给浏览器，半消费的取消会让请求无人接管。
  input.consume()
  question.dismiss().catch((error: unknown) => {
    warn(`question ${question.key} was not cancelled:`, error)
  })
}
