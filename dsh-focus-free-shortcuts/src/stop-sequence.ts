/**
 * Shortcut group 2 — the double-Escape turn stop.
 *
 * The fixed `response.stop` sequence requires its target inside
 * `[data-conversation-session]` / `[data-conversation-region]`, so it declines
 * until the user clicks into the conversation. This bridge opens its own
 * fixed-input observer — the channel that runs for every keydown *before*
 * configurable dispatch and can consume the press — and resolves the same owner
 * without DOM focus: the main-view Session from `sessions.list`, whose
 * `retainedBy.mainView` count is the same fact `UiSession.isMain` reads, then the
 * public `conversation.cancel()` of that Session's scope.
 *
 * Presses the bundled sequence owns belong to it alone: it holds turn identity,
 * which is not public, so this bridge stands down instead of running a second
 * cancel. Nothing is registered in the shortcut catalog, and the two presses are
 * the same short-lived sequence the bundled command applies.
 */
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {ShortcutContext, ShortcutGesture, Shortcuts} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ISessions, SessionBinding} from '@deepseek-ai/dsh-api-session-controller/client'
import type {IConversation} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {UiSession} from '@deepseek-ai/dsh-client-ui-session/client'
import type {Context} from '@deepseek-ai/cordis'

/**
 * Whether one press may start or complete this plugin's stop sequence: a bare
 * Escape, not a key repeat, not composing, not already consumed, outside a
 * terminal and with no modal open — the admission the bundled fixed sequence
 * applies before it even looks for its own target.
 * @param gesture - the physical press being routed.
 * @param context - modal and region ownership for this press.
 * @returns whether the press is eligible to stop a turn.
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

/** One press's identity for the stop sequence: a Session and its binding generation. */
export interface StopToken {
  readonly sessionId: SessionId
  /** The Session binding object itself; identity is the generation. */
  readonly binding: SessionBinding
}

/**
 * The two presses must name the same Session generation.
 * @param left - the pending first press.
 * @param right - the press being considered.
 * @returns whether both presses address the same generation.
 */
export function sameStopToken(left: StopToken, right: StopToken): boolean {
  return left.sessionId === right.sessionId && left.binding === right.binding
}

/** Clock and equality seams, so the sequence is testable without real time. */
export interface StopSequenceOptions {
  /** Maximum time between the two independent presses, from the shortcut service. */
  readonly intervalMs: number
  now?: () => number
  same?: (left: StopToken, right: StopToken) => boolean
}

/** One short-lived first press. */
export interface StopSequence {
  /**
   * Record one eligible press.
   * @param token - the Session generation this press would stop.
   * @returns whether this press completes the sequence.
   */
  press(token: StopToken): boolean
  /** Drop the pending first press and its expiry timer. */
  reset(): void
}

/**
 * Mirror of the bundled `StopSequence`: remember one press for at most
 * `intervalMs`, and treat a second press inside that window against the same
 * Session generation as the stop request.
 * @param options - interval plus optional clock/equality seams.
 * @returns the press/reset pair.
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
 * Whether the bundled stop sequence owns this press by target.
 *
 * Mirrors the bundled guard: an Element inside both conversation markers, and
 * not an approval control, an embedding frame, a terminal, or inert content.
 * When this holds, the bundled handler has strictly better evidence (turn
 * identity, which is not public) than this plugin can read, so this plugin must
 * stand down instead of running a second cancel.
 * @param target - the keydown target, or null without one.
 * @returns whether the bundled fixed sequence owns the press.
 */
export function conversationOwnsTarget(target: Element | null): boolean {
  if (target === null || typeof target.closest !== 'function') return false
  const occurrence = target.closest('[data-conversation-session]')
  const region = target.closest('[data-conversation-region]')
  if (occurrence === null || region === null) return false
  if (typeof occurrence.contains !== 'function' || !occurrence.contains(region)) return false
  return target.closest('[data-approval-key], iframe, .xterm, [inert]') === null
}

/** One eligible press's resolved Session. */
interface StopCandidate {
  readonly sessionId: SessionId
  readonly binding: SessionBinding
}

/**
 * Bridge the double-Escape turn stop.
 * @param ctx - client root context.
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
 * Handle one keydown against the bundled stop sequence.
 * @param ctx - injected scope carrying optional services.
 * @param shortcuts - keyboard service.
 * @param sessions - Session catalog and scope owner.
 * @param sequence - pending first press.
 * @param input - one fixed keydown.
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
  // Presses the bundled sequence owns belong to it alone: it holds turn
  // identity this plugin cannot read, and sharing the press would cancel twice.
  if (conversationOwnsTarget(context.target)) {
    sequence.reset()
    return
  }
  const candidate = resolveStopSession(ctx, sessions)
  if (candidate === undefined) {
    sequence.reset()
    return
  }
  // Same as the bundled first press: an accepted press is consumed, so a
  // half-sequence never leaks the Escape to the browser or a local control.
  input.consume()
  const token: StopToken = { sessionId: candidate.sessionId, binding: candidate.binding }
  if (!sequence.press(token)) return
  cancelSession(sessions, candidate.sessionId)
}

/**
 * Resolve the Session a focus-free stop should address.
 *
 * The main view's retained Session is the on-screen conversation; the running
 * and pending-interaction facts come from the same sources the bundled
 * sequence reads, minus the DOM target.
 * @param ctx - injected scope carrying optional services.
 * @param sessions - Session catalog and scope owner.
 * @returns the live candidate, or undefined when nothing may be stopped.
 */
function resolveStopSession(ctx: Context, sessions: ISessions): StopCandidate | undefined {
  const list = sessions.list.getSnapshot()
  const sessionId = mainViewSessionId(list)
  if (sessionId === undefined) return undefined
  if (list.byId[sessionId]?.running !== true) return undefined
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
 * Cancel one Session's in-flight turn through its scoped Conversation face,
 * the same operation the composer's Stop button uses.
 * @param sessions - Session catalog and scope owner.
 * @param sessionId - the Session to stop.
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
