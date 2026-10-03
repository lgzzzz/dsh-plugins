/**
 * Shortcut group 6 — `Esc` cancels the pending user question.
 *
 * `ask_user_question` presents its card as a composer takeover: the card owns the
 * composer seat while the request waits, and the only way to leave it without
 * answering is the panel's own close/cancel button, which calls
 * `PendingQuestion.dismiss()`. That single verb covers both card shapes the
 * package declares: a request the Host named by tool call is only withdrawn
 * (`hide` — the request stands, and its tool call row brings the panel back),
 * while a request that carries no tool call has no row to return from, so closing
 * it rejects the whole wait as `ASK_CANCELLED` (the button's own "Dismiss all
 * questions"). No key is bound to that action: the card answers `Enter` on its own
 * options and fields, and `Escape` reaches the page with no owner at all.
 *
 * This bridge opens the fixed-input channel (which runs for every keydown *before*
 * configurable dispatch and can consume the press) and answers Escape through the
 * same published pending interaction the approval bridge reads, narrowed to the
 * question domain. One Session publishes one pending interaction at a time, so the
 * approval domain and this one can never both claim the same press.
 *
 * Target rules, in the same spirit as the other bridges but with one deliberate
 * widening: the panel binds no Escape anywhere, so a press inside *this* panel's
 * own answer field (a `<textarea>`, hence the `editable` region) is this bridge's
 * to take — the field's own `keydown` only ever looks at `Enter`. Every other
 * owned region stands: a terminal keeps its keys, and an editable target outside
 * this card (the sidebar's search box, a rename field) keeps its own.
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

/** The two card roots the question package renders, by their request key. */
const QUESTION_CARD_SELECTOR = '[data-question-key], [data-plan-review-key]'

/** The two attribute names those roots carry the request key on. */
const QUESTION_CARD_ATTRIBUTES = ['data-question-key', 'data-plan-review-key'] as const

/**
 * Whether one press may cancel a pending question without DOM focus.
 *
 * The same admission the bundled stop sequence applies before it looks for its
 * own target — a bare, first, unconsumed Escape outside a modal and outside a
 * terminal — except that the turn-stop condition (`pendingInteraction ===
 * undefined`) is exactly the fact this bridge acts on. A terminal keeps its
 * Escape, and `editable` passes here on purpose: the handler narrows it through
 * {@link questionCardOwnsTarget}, so only this panel's own answer field is taken.
 * @param gesture - the physical press being routed.
 * @param context - modal and region ownership for this press.
 * @returns whether the press may cancel a pending question.
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
 * Whether the press lands inside the presented card itself.
 *
 * The key comparison is what makes this precise: a card that is still mounted
 * after the registry moved on (or a read-only review card of another call) is a
 * different request, and its field is not this bridge's to take.
 * @param target - the keydown target, or null without one.
 * @param key - the presented question's `PendingQuestion.key`.
 * @returns whether the target sits inside that exact card.
 */
export function questionCardOwnsTarget(target: Element | null, key: string): boolean {
  if (target === null || typeof target.closest !== 'function') return false
  const card = target.closest(QUESTION_CARD_SELECTOR)
  if (card === null || typeof card.getAttribute !== 'function') return false
  return QUESTION_CARD_ATTRIBUTES.some((attribute) => card.getAttribute(attribute) === key)
}

/**
 * Narrow one published pending interaction to the question this bridge may close.
 *
 * The slot's declared type is a merge-extensible map that admits every pending
 * domain (the approval panel is one), so the runtime checks stay: only a card
 * that names itself a question or a plan review, carries a string key, and offers
 * the same `dismiss()` its close/cancel button calls is returned. A settled card
 * is gone from the registry, and a card whose close is already in flight removes
 * itself idempotently.
 * @param value - one Session's published pending interaction.
 * @returns the dismissable question, or undefined for anything else.
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

/**
 * The question the main view is presenting for one Session, or undefined.
 *
 * The composer takeover renders the card for exactly the Session whose published
 * pending interaction is that card, and the retained main-view Session is the one
 * on screen — the same fact the stop and approval bridges resolve without focus.
 * @param sessionId - the retained main-view Session, or undefined when ambiguous.
 * @param statuses - published per-Session UI status.
 * @returns the dismissable question, or undefined when none is on screen.
 */
export function presentedQuestion(
  sessionId: SessionId | undefined,
  statuses: SessionStatusSnapshot,
): PendingQuestion | undefined {
  if (sessionId === undefined) return undefined
  return asDismissableQuestion(statuses.get(sessionId)?.pendingInteraction)
}

/**
 * Bridge the question card's Escape cancel.
 *
 * Unlike the pane keys these are not configurable bindings on any runtime, so the
 * bridge installs wherever the fixed-input channel exists — no runtime guard is
 * needed, because nothing here can double-dispatch. The card itself is a Web
 * client feature (`dsh-client-ui-user-questions` declares `platform: "web"`), so
 * on a Client that does not mount it nothing ever publishes a question
 * interaction and this bridge stays a no-op.
 * @param ctx - client root context.
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

/**
 * Handle one keydown against the presented question card.
 * @param sessions - Session catalog and main-view owner.
 * @param uiSession - publisher of each Session's pending interaction.
 * @param input - one fixed keydown.
 */
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
  // An editable target keeps its own keys — except this panel's own answer field,
  // whose keydown handles Enter alone. Without this check, the first Escape in the
  // sidebar's search box would cancel the question showing on the other side.
  if (context.region === 'editable' && !questionCardOwnsTarget(context.target, question.key)) return
  // Consume before closing: the press must not also reach the browser, and a
  // half-consumed cancel would leave the request waiting with no owner.
  input.consume()
  question.dismiss().catch((error: unknown) => {
    warn(`question ${question.key} was not cancelled:`, error)
  })
}
