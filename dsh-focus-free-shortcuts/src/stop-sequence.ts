/**
 * 连按两次 Escape 停止当前回合。
 *
 * 打开自己的 fixed-input 观察者(在可配置分发之前运行，可消费按键)，不依赖 DOM
 * 焦点解析归属：从 `sessions.list` 取主视图 Session(`retainedBy.mainView` 计数即
 * `UiSession.isMain` 读的事实)，再调用该 Session scope 上的 `conversation.cancel()`。
 *
 * 目标位于 `[data-conversation-session]` / `[data-conversation-region]` 内的按键归
 * 官方 fixed 序列所有，本桥不动作。不在快捷键目录中注册任何条目。
 */
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {ShortcutContext, ShortcutGesture, Shortcuts} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ISessions, SessionBinding} from '@deepseek-ai/dsh-api-session-controller/client'
import type {IConversation} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {UiSession} from '@deepseek-ai/dsh-client-ui-session/client'
import type {Context} from '@deepseek-ai/cordis'

/**
 * 该次按键能否启动或完成停止序列：裸 Escape、非重复、非输入法组合中、未被消费、
 * 无修饰键、无模态，且区域不是终端。
 */
export function escapeEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
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

/** 停止序列中一次按键的身份：一个 Session 及其绑定代次。 */
export interface StopToken {
  readonly sessionId: SessionId
  /** 绑定对象本身；其身份即代次。 */
  readonly binding: SessionBinding
}

/** 两次按键是否指向同一 Session 代次。 */
export function sameStopToken(left: StopToken, right: StopToken): boolean {
  return left.sessionId === right.sessionId && left.binding === right.binding
}

/** 时钟与相等性接缝，使该序列无需真实时间即可测试。 */
export interface StopSequenceOptions {
  /** 两次独立按键之间的最大间隔，取自快捷键服务。 */
  readonly intervalMs: number
  now?: () => number
  same?: (left: StopToken, right: StopToken) => boolean
}

/** 一次短命的首次按键。 */
export interface StopSequence {
  /** 记录一次符合条件的按键；返回该次按键是否完成序列。 */
  press(token: StopToken): boolean
  /** 丢弃待定的首次按键及其过期定时器。 */
  reset(): void
}

/**
 * 记住一次按键至多 `intervalMs`；窗口内针对同一 Session 代次的第二次按键视为停止
 * 请求。返回 press/reset 组合。
 */
export function createStopSequence(options: StopSequenceOptions): StopSequence {
  const now = options.now ?? (() => performance.now())
  const same = options.same ?? sameStopToken
  let first: { token: StopToken; deadline: number } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const reset = (): void => {
    first = undefined
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    press(token) {
      const previous = first
      reset()
      if (previous !== undefined && now() <= previous.deadline && same(previous.token, token)) return true
      first = { token, deadline: now() + options.intervalMs }
      timer = setTimeout(reset, options.intervalMs + 1)
      return false
    },
    reset,
  }
}

/**
 * 该次按键的目标是否属于官方停止序列：位于 `[data-conversation-session]` 与
 * `[data-conversation-region]` 之内，且不在审批控件、内嵌 frame、终端或惰性内容中。
 */
export function conversationOwnsTarget(target: Element | null): boolean {
  if (target === null || typeof target.closest !== 'function') return false
  const occurrence = target.closest('[data-conversation-session]')
  const region = target.closest('[data-conversation-region]')
  if (occurrence === null || region === null) return false
  if (typeof occurrence.contains !== 'function' || !occurrence.contains(region)) return false
  return target.closest('[data-approval-key], iframe, .xterm, [inert]') === null
}

/** 一次符合条件的按键解析出的 Session。 */
interface StopCandidate {
  readonly sessionId: SessionId
  readonly binding: SessionBinding
}

/**
 * 桥接连按两次 Escape 停止回合。
 */
export function installStopBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sessions'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sessions: ISessions = scope.sessions
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; stop bridge not installed')
      return
    }
    const sequence: StopSequence = createStopSequence({
      intervalMs: shortcuts.stopSequenceMs,
      same: sameStopToken,
    })
    scope.effect(() => {
      const off = shortcuts.observeFixedInput((input) => {
        if (!isKeydown(input)) {
          sequence.reset()
          return
        }
        handleStopInput(scope, shortcuts, sessions, sequence, input)
      })
      return () => {
        off()
        sequence.reset()
      }
    }, `${name}: stop sequence`)
  })
}

/**
 * 处理一次 keydown：判定通过后消费该按键，第二次按键命中同一 Session 代次时取消回合。
 */
function handleStopInput(
  ctx: Context,
  shortcuts: Shortcuts,
  sessions: ISessions,
  sequence: StopSequence,
  input: KeydownInput,
): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (!escapeEligible(gesture, context)) {
    sequence.reset()
    return
  }
  // 官方序列占用的按键归其所有：共享该按键会取消两次。
  if (conversationOwnsTarget(context.target)) {
    sequence.reset()
    return
  }
  const candidate = resolveStopSession(ctx, sessions)
  if (candidate === undefined) {
    sequence.reset()
    return
  }
  // 被接受的按键即被消费，序列未完成时 Escape 也不会泄漏给浏览器或本地控件。
  input.consume()
  const token: StopToken = { sessionId: candidate.sessionId, binding: candidate.binding }
  if (!sequence.press(token)) return
  cancelSession(sessions, candidate.sessionId)
}

/**
 * 解析无焦点停止应作用的 Session；没有可停止的对象时返回 undefined。
 *
 * 主视图保留的 Session 即在屏会话；运行中与待交互状态取自官方序列读取的同一来源，
 * 只是不经 DOM 目标。
 */
function resolveStopSession(ctx: Context, sessions: ISessions): StopCandidate | undefined {
  const list = sessions.list.getSnapshot()
  const sessionId = mainViewSessionId(list)
  if (sessionId === undefined) return undefined
  if (!list.byId[sessionId]?.running) return undefined
  const binding = sessions.binding(sessionId)
  if (binding === undefined) return undefined
  const snapshot = binding.session.getSnapshot()
  if (!snapshot.running || snapshot.removed) return undefined
  if (snapshot.subagent !== null && snapshot.subagent.address.mode !== 'continuable') return undefined
  const uiSession: UiSession | undefined = ctx.get('uiSession')
  const pending = uiSession?.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction
  if (pending !== undefined) return undefined
  return { sessionId, binding }
}

/**
 * 通过该 Session scope 上的 Conversation 面取消进行中的回合，与输入框的停止按钮
 * 是同一操作。
 */
function cancelSession(sessions: ISessions, sessionId: SessionId): void {
  const scoped = sessions.scope(sessionId)
  const conversation: IConversation | undefined = scoped?.get('conversation')
  if (conversation === undefined || typeof conversation.cancel !== 'function') {
    warn(`conversation service unavailable for session ${String(sessionId)}; stop not sent`)
    return
  }
  conversation.cancel().catch((error: unknown) => {
    warn(`stop failed for session ${String(sessionId)}:`, error)
  })
}
