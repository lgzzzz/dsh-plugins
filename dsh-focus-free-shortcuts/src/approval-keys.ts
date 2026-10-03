/**
 * Shortcut group 3 — the approval panel's Enter / Escape decision.
 *
 * The approval panel answers its own keydown only while `document.activeElement`
 * is inside `[data-approval-key]`, and while it is presented the composer takeover
 * hides the composer bar, so the focused element — the composer textarea — is
 * removed and focus falls back to `<body>`. Both keys then reach the application
 * with no owner at all. This bridge opens the fixed-input channel (which runs for
 * every keydown *before* configurable dispatch and can consume the press) and
 * answers through the main-view Session's published pending interaction — the
 * upstream `PendingApproval`, whose `answer()` is the same operation the panel's
 * Allow once / Reject buttons call.
 *
 * The fixed channel is a **bubble-phase** listener on the window, so it is the
 * last stop of a press, not the first: anything focused answers before it, and a
 * process card answers `Enter` itself. A tool card's
 * `div[role="button"][tabindex="0"]` and a trajectory row's `tr[tabindex="0"]`
 * both toggle or select from their own React `keydown` handler and call
 * `preventDefault()` on the way. That leaves the observer standing down twice
 * over: the card has already acted, and the press reads as consumed. Focus is
 * therefore not only "outside the panel" but possibly parked on a control that
 * owns the very key the user means as the decision — clicking a card and then
 * pressing `Enter` re-triggered the card instead of allowing the request.
 *
 * The bridge therefore delivers through **two** paths, exactly as the page-cycle
 * bridge does for a focused terminal: the fixed-channel observer above, and a
 * window **capture-phase** listener that runs before any target or bubble handler
 * (`capture.ts` supplies the readings a capture hook needs). Both paths resolve
 * the same ownership (`approvalCaptureOutcome` shares `approvalOutcomeFor`,
 * `approvalEligible`, and `approvalPanelOwnsTarget`) and a press is acted on
 * exactly once: a capture hook that answers swallows the event, so the card never
 * runs and the observer never sees it; a hook that declines leaves the press
 * flowing, and the observer then decides identically.
 *
 * It follows the mounted `approval.allow` / `approval.reject` fixed rows, so it
 * stays out of the keys once that panel unloads, and it stands down whenever the
 * panel itself owns the press (a target inside `[data-approval-key]`). Nothing is
 * registered in the shortcut catalog. Unlike the pane keys these are fixed
 * actions on every runtime, so this bridge installs on Web and Desktop alike.
 *
 * Answering also moves focus: the composer takeover belongs to the Session and
 * hands the keyboard back when it unloads, so the app switches to keyboard
 * modality right after the press and whatever is still `:focus-visible` starts
 * painting a ring. Both paths therefore withdraw the ring on the control they
 * took the press from, through the app's own `data-dsh-automatic-focus` marker
 * (`focus-ring.ts`) — focus stays where the user put it, and the outline the
 * taken press would otherwise reveal never appears.
 */
import { captureContext, captureGesture, pressElement } from './capture.ts'
import { suppressFocusRing } from './focus-ring.ts'
import { fixedRowOwns } from './binding.ts'
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {
  ShortcutContext,
  ShortcutFixedCatalogEntry,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ISessions} from '@deepseek-ai/dsh-api-session-controller/client'
import type {ApprovalDecision, PendingApproval} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {
  SessionPendingInteraction,
  SessionStatusSnapshot,
  UiSession,
} from '@deepseek-ai/dsh-client-ui-session/client'
import type {Context} from '@deepseek-ai/cordis'

/** The two fixed approval actions this plugin bridges, by their registered ids. */
export interface ApprovalCommandIds {
  readonly allow: string
  readonly reject: string
}

/**
 * Which approval decision this press is, when the mounted approval actions reserve it.
 * @param rows - the mounted fixed catalog snapshot.
 * @param gesture - the physical press being routed.
 * @param ids - the two approval command ids to test.
 * @returns the requested decision, or undefined for any other press.
 */
export function approvalOutcomeFor(
  rows: readonly ShortcutFixedCatalogEntry[],
  gesture: ShortcutGesture,
  ids: ApprovalCommandIds,
): ApprovalDecision | undefined {
  const candidates: readonly (readonly [ApprovalDecision, string])[] = [
    ['allowed-once', ids.allow],
    ['rejected', ids.reject],
  ]
  for (const [outcome, id] of candidates) {
    if (fixedRowOwns(rows, id, gesture)) return outcome
  }
  return undefined
}

/**
 * Whether one press may answer an approval without DOM focus.
 *
 * Mirrors the guard the approval panel applies to its own keydown, minus the
 * focus requirement this plugin exists to remove: a first, unconsumed press,
 * no modal layer above it, and focus on the page rather than inside a text
 * control or a terminal — the panel keeps an editable target's key for that
 * control, and this bridge does the same.
 * @param gesture - the physical press being routed.
 * @param context - modal and region ownership for this press.
 * @returns whether the press may answer a pending approval.
 */
export function approvalEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && context.modal === null
    && context.region === 'page'
}

/**
 * Whether the approval panel owns this press by target.
 *
 * The panel renders one `[data-approval-key]` root whose own handler answers a
 * press landing inside it — and deliberately leaves Enter on a focused button to
 * that button. Whenever the target resolves into that panel, this bridge must
 * stand down; answering as well would replace a Reject click with an Allow.
 * @param target - the keydown target, or null without one.
 * @returns whether the panel owns the press.
 */
export function approvalPanelOwnsTarget(target: Element | null): boolean {
  if (target === null || typeof target.closest !== 'function') return false
  return target.closest('[data-approval-key]') !== null
}

/**
 * Whether one capture-phase press is the approval's own, and which decision it is.
 *
 * The same ownership question {@link handleApprovalInput} asks of the fixed
 * channel, asked one phase earlier and with one deliberate difference: the
 * captured gesture never carries `defaultPrevented` (`capture.ts` builds it
 * before anything has run), so the gate that makes the observer stand down
 * cannot veto a press the user means as the decision. That is exactly the press
 * this path exists for — the one a stale local control would claim moments
 * later. The panel's own target still wins, and every other precondition
 * (region, modal, repeat, composition, the mounted row) is the observer's own.
 * @param rows - the mounted fixed catalog snapshot.
 * @param gesture - the physical press being routed, built at the capture phase.
 * @param element - the press's own element, or null to fall back to the focused one.
 * @returns the requested decision, or undefined when the press is not the approval's.
 */
export function approvalCaptureOutcome(
  rows: readonly ShortcutFixedCatalogEntry[],
  gesture: ShortcutGesture,
  element: Element | null,
): ApprovalDecision | undefined {
  // The mounted row is the cheap gate and the reservation: a press that is not
  // `Enter` / `Escape` (as the panel currently declares them) never pays for the
  // context the next line builds, which reads the document for a modal layer.
  const outcome: ApprovalDecision | undefined = approvalOutcomeFor(rows, gesture, APPROVAL_COMMAND_IDS)
  if (outcome === undefined) return undefined
  const context: ShortcutContext = captureContext(element)
  if (!approvalEligible(gesture, context)) return undefined
  return approvalPanelOwnsTarget(context.target) ? undefined : outcome
}

/**
 * Narrow one published pending interaction to the approval this bridge may answer.
 *
 * The slot's declared type is the approval domain's `PendingApproval`, but it is
 * a runtime slot: a merge-extensible map admits other domains (a user question,
 * for example) and a settled request must never accept another answer. The checks
 * therefore stay, and only a still-answerable approval is returned.
 * @param value - one Session's published pending interaction.
 * @returns the answerable approval, or undefined for anything else.
 */
export function asAnswerableApproval(value: SessionPendingInteraction | undefined): PendingApproval | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as unknown as {
    kind?: unknown
    key?: unknown
    answerable?: unknown
    answer?: unknown
  }
  if (candidate.kind !== 'approval') return undefined
  if (typeof candidate.key !== 'string') return undefined
  if (candidate.answerable !== true) return undefined
  if (typeof candidate.answer !== 'function') return undefined
  return candidate as unknown as PendingApproval
}

/**
 * The approval the main view is presenting for one Session, or undefined.
 *
 * The composer takeover renders the panel for exactly the Session whose
 * published pending interaction is that approval, and the retained main-view
 * Session is the one on screen — the same fact the stop bridge resolves
 * without focus. Ambiguity (a Session switch in flight) yields no answer.
 * @param sessionId - the retained main-view Session, or undefined when ambiguous.
 * @param statuses - published per-Session UI status.
 * @returns the answerable approval, or undefined when none is on screen.
 */
export function presentedApproval(
  sessionId: SessionId | undefined,
  statuses: SessionStatusSnapshot,
): PendingApproval | undefined {
  if (sessionId === undefined) return undefined
  return asAnswerableApproval(statuses.get(sessionId)?.pendingInteraction)
}

/** Registered ids of the two fixed approval actions this bridge follows. */
const APPROVAL_COMMAND_IDS: ApprovalCommandIds = {
  allow: 'approval.allow',
  reject: 'approval.reject',
}

/**
 * Bridge the approval panel's Enter / Escape decision.
 *
 * The panel answers its own keydown only while focus is inside
 * `[data-approval-key]`, and while it is presented the composer takeover hides
 * the composer bar (`renderChainResult` sets `display: none` on the unused
 * fallback), so the focused element — the composer textarea — is removed and
 * focus falls back to `<body>`. That press has no owner at all, which is what
 * the fixed-input observer below rescues. Focus can just as well be parked on a
 * process card the user clicked, which is worse: the card owns the press, acts
 * on it, and marks it consumed before the observer runs, so the capture listener
 * takes that one a phase earlier. Unlike the pane keys, these are fixed actions
 * on every runtime, so this bridge installs on Web and Desktop alike.
 * @param ctx - client root context.
 */
export function installApprovalBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sessions', 'uiSession'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sessions: ISessions = scope.sessions
    const uiSession: UiSession = scope.uiSession
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; approval bridge not installed')
      return
    }
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handleApprovalInput(shortcuts, sessions, uiSession, input)
    }), `${name}: approval keys`)
    // The capture half: presses a local control claims before the bubble-phase
    // channel can receive them (see `installApprovalCapture`). Both halves live
    // in this scope, and the disposer pair tears them down together.
    scope.effect(() => installApprovalCapture(shortcuts, sessions, uiSession), `${name}: approval capture`)
  })
}

/**
 * Bridge the approval keys ahead of every local control.
 *
 * A capture-phase listener on the window runs before any target or bubble
 * handler — before React's root handlers, which is where a focused process card
 * answers `Enter` and calls `preventDefault()`. Reading the press there restores
 * the ownership the bubble channel can no longer see, and swallowing it keeps
 * the card from acting at all. The decision is the observer's own
 * (`approvalCaptureOutcome`); only the resolution of "which approval" is
 * repeated, because it also needs the mounted row and the published pending
 * interaction.
 * @param shortcuts - keyboard service.
 * @param sessions - Session catalog and main-view owner.
 * @param uiSession - publisher of each Session's pending interaction.
 * @returns disposer releasing the listener (a no-op where no window exists).
 */
function installApprovalCapture(
  shortcuts: Shortcuts,
  sessions: ISessions,
  uiSession: UiSession,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.type !== 'keydown') return
    const target: Element | null = pressElement(event)
    const outcome: ApprovalDecision | undefined = approvalCaptureOutcome(
      shortcuts.fixedCatalog.getSnapshot(),
      captureGesture(event),
      target,
    )
    if (outcome === undefined) return
    const approval: PendingApproval | undefined = presentedApproval(
      mainViewSessionId(sessions.list.getSnapshot()),
      uiSession.sessionStatus.getSnapshot(),
    )
    if (approval === undefined) return
    // Stamp the press out before answering: the card that holds focus must not
    // also act on it, and the bubble channel must not see the same press again.
    event.preventDefault()
    event.stopPropagation()
    // Answering the approval hands the keyboard back to the composer, and that
    // focus move is what makes the app paint the ring this press would otherwise
    // reveal on the card it was taken from (`focus-ring.ts`).
    suppressFocusRing(target)
    approval.answer(outcome).catch((error: unknown) => {
      warn(`approval ${approval.key} was not sent:`, error)
    })
  }
  window.addEventListener('keydown', onKeydown, true)
  return () => window.removeEventListener('keydown', onKeydown, true)
}

/**
 * Handle one keydown against the mounted approval actions.
 * @param shortcuts - keyboard service.
 * @param sessions - Session catalog and main-view owner.
 * @param uiSession - publisher of each Session's pending interaction.
 * @param input - one fixed keydown.
 */
function handleApprovalInput(
  shortcuts: Shortcuts,
  sessions: ISessions,
  uiSession: UiSession,
  input: KeydownInput,
): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (!approvalEligible(gesture, context)) return
  const rows = shortcuts.fixedCatalog.getSnapshot()
  const outcome: ApprovalDecision | undefined = approvalOutcomeFor(rows, gesture, APPROVAL_COMMAND_IDS)
  if (outcome === undefined) return
  // The panel owns every press landing inside it: it either answered with
  // evidence this bridge cannot read (composition), or deliberately left Enter
  // to a focused Allow once / Reject button.
  if (approvalPanelOwnsTarget(context.target)) return
  const approval: PendingApproval | undefined = presentedApproval(
    mainViewSessionId(sessions.list.getSnapshot()),
    uiSession.sessionStatus.getSnapshot(),
  )
  if (approval === undefined) return
  // Consume before answering: this press must not also reach the browser, and a
  // half-consumed decision would leave the request waiting with no owner.
  input.consume()
  // Same courtesy as the capture path: the control the press was taken from
  // keeps its focus, without the ring the answer's focus move would reveal.
  suppressFocusRing(context.target)
  approval.answer(outcome).catch((error: unknown) => {
    warn(`approval ${approval.key} was not sent:`, error)
  })
}
