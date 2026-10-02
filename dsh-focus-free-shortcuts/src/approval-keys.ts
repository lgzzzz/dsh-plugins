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
 * It follows the mounted `approval.allow` / `approval.reject` fixed rows, so it
 * stays out of the keys once that panel unloads, and it stands down whenever the
 * panel itself owns the press (a target inside `[data-approval-key]`). Nothing is
 * registered in the shortcut catalog. Unlike the pane keys these are fixed
 * actions on every runtime, so this bridge installs on Web and Desktop alike.
 */
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
 * focus falls back to `<body>`. Both keys then reach the application with no
 * owner at all. Unlike the pane keys, these are fixed actions on every runtime,
 * so this bridge installs on Web and Desktop alike.
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
  })
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
  approval.answer(outcome).catch((error: unknown) => {
    warn(`approval ${approval.key} was not sent:`, error)
  })
}
