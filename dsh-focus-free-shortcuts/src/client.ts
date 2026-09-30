/**
 * Browser half: two focus-free bridges over the bundled keyboard commands.
 *
 * A keydown is dispatched to the focused element — or to `<body>` when nothing
 * is focused — and both bundled commands derive their owner from that target:
 * `pane.fullscreen.toggle` / `pane.split` call `sidebarRight.focusedTarget(element)`
 * and return `command.noFocus` when the target is outside a visible dock pane,
 * while the fixed `response.stop` sequence requires its target inside
 * `[data-conversation-session]` / `[data-conversation-region]`. Both therefore
 * decline until the user clicks into the exact region.
 *
 * The fixed-input channel runs for every keydown *before* configurable dispatch
 * and can consume the press, so this plugin opens its own fixed observer and
 * resolves the same owner without DOM focus:
 *
 *   - pane commands → `sidebarRight.commandTarget(element)`, whose documented
 *     fallback is the on-screen Session's active dock pane (the focused pane
 *     stays authoritative: a press the bundled command already owns is left
 *     untouched, so exactly one owner remains per press);
 *   - stop → the main-view Session from `sessions.list`, whose
 *     `retainedBy.mainView` count is the same fact `UiSession.isMain` reads,
 *     then the public `conversation.cancel()` of that Session's scope.
 *
 * Nothing is registered in the shortcut catalog: no default bindings, no
 * conflicts, no settings edits. The bridge follows the *effective* catalog row,
 * so a rebound, disabled, or absent bundled command is left alone.
 */
import {
  conversationOwnsTarget,
  createStopSequence,
  escapeEligible,
  mainViewSessionId,
  paneActionFor,
  sameStopToken,
  type CatalogRowLike,
  type GestureLike,
  type PaneCommandIds,
  type StopSequence,
  type StopToken,
} from './decide.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { ShortcutFixedInput } from '@deepseek-ai/dsh-client-shortcuts/client'
// 空导入(不引入任何名字):只为让 TS 加载各包的 `declare module '@deepseek-ai/cordis'`
// 增强 —— Context 上的 `sidebarRight` / `sessions` / `uiSession` 由这些文件声明。
// 它们是 type-only 导入,在打包前被擦除,客户端纯度门不会看到它们。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

export const name = 'dsh-focus-free-shortcuts'

/** The keyboard service owns fixed input; without it there is nothing to bridge. */
export const inject = ['shortcuts']

/** Registered ids of the two bundled pane commands this bridge follows. */
const PANE_COMMAND_IDS: PaneCommandIds = {
  fullscreen: 'pane.fullscreen.toggle',
  split: 'pane.split',
}

/** The client faces this plugin reads, taken from the ambient Context. */
type Shortcuts = Context['shortcuts']
type Sidebar = Context['sidebarRight']
type Sessions = Context['sessions']
type SessionId = Parameters<Sessions['binding']>[0]
type SessionBindingFace = NonNullable<ReturnType<Sessions['binding']>>
type KeydownInput = Extract<ShortcutFixedInput, { type: 'keydown' }>
type ScopedConversation = { cancel(): Promise<void> }

/** One eligible press's resolved Session. */
interface StopCandidate {
  readonly sessionId: SessionId
  readonly binding: SessionBindingFace
}

/** Emit one prefixed diagnostic line. */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** Narrow the fixed-input union without a cast at every use site. */
function isKeydown(input: ShortcutFixedInput): input is KeydownInput {
  return input.type === 'keydown'
}

/**
 * Client plugin body.
 * @param ctx - client root context carrying the keyboard service.
 */
export function apply(ctx: Context): void {
  installPaneBridge(ctx)
  installStopBridge(ctx)
}

/**
 * Bridge the pane fullscreen/split keys.
 *
 * Web runtime only: on Desktop these are configurable bindings dispatched by
 * the native keyboard bridge, and this DOM observer cannot suppress that
 * dispatch, so acting here as well would toggle twice.
 * @param ctx - client root context.
 */
function installPaneBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sidebarRight'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sidebar: Sidebar = scope.sidebarRight
    if (shortcuts.runtime !== 'web') {
      warn('desktop runtime: pane keys are dispatched by the native keyboard bridge, so the focus-free pane bridge is not installed here')
      return
    }
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; pane bridge not installed')
      return
    }
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handlePaneInput(shortcuts, sidebar, input)
    }), `${name}: pane keys`)
  })
}

/**
 * Handle one keydown against the bundled pane commands.
 *
 * Resolve what the bundled command would do first: it runs its own resolve in
 * this same keydown, and its verdict is the authority on who owns the press.
 * @param shortcuts - keyboard service.
 * @param sidebar - Right-Sidebar face.
 * @param input - one fixed keydown.
 */
function handlePaneInput(shortcuts: Shortcuts, sidebar: Sidebar, input: KeydownInput): void {
  const gesture: GestureLike = input.gesture
  const context = input.context
  if (gesture.composing || gesture.defaultPrevented) return
  // `pane.fullscreen.toggle` and `pane.split` declare no modals, so a modal
  // press is consumed-and-blocked by the bundled dispatch; stay out of it.
  if (context.modal !== null) return
  const rows = shortcuts.catalog.getSnapshot() as readonly CatalogRowLike[]
  const action = paneActionFor(rows, gesture, PANE_COMMAND_IDS)
  if (action === undefined) return
  const element = context.target ?? (typeof document === 'undefined' ? null : document.activeElement)
  // A focused pane is the bundled command's own case: `focusedTarget` resolves,
  // its command runs in this keydown, and a second action here would undo it.
  if (sidebar.focusedTarget(element) !== undefined) return
  // Without a visible panel there is no pane to present fullscreen; expanding
  // first also focuses the active pane, after which the bundled command works.
  if (!sidebar.isExpanded()) return
  const target = sidebar.commandTarget(element)
  if (target === undefined) return
  // Consume before acting: the bundled command would otherwise resolve to
  // `command.noFocus` and call preventDefault itself, and this press must not
  // reach it once this bridge has taken the owner over.
  input.consume()
  if (gesture.repeat) return
  if (!sidebar.isTargetCurrent(target)) return
  if (action === 'fullscreen') sidebar.toggleFullscreen(target)
  else sidebar.split(target.paneId)
}

/**
 * Bridge the double-Escape turn stop.
 * @param ctx - client root context.
 */
function installStopBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sessions'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sessions: Sessions = scope.sessions
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
  sessions: Sessions,
  sequence: StopSequence,
  input: KeydownInput,
): void {
  const gesture: GestureLike = input.gesture
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
function resolveStopSession(ctx: Context, sessions: Sessions): StopCandidate | undefined {
  const list = sessions.list.getSnapshot()
  const sessionId = mainViewSessionId(list)
  if (sessionId === undefined) return undefined
  if (list.byId[sessionId]?.running !== true) return undefined
  const binding = sessions.binding(sessionId)
  if (binding === undefined) return undefined
  const snapshot = binding.session.getSnapshot()
  if (!snapshot.running || snapshot.removed) return undefined
  if (snapshot.subagent !== null && snapshot.subagent.address.mode !== 'continuable') return undefined
  const uiSession: Context['uiSession'] | undefined = ctx.get('uiSession')
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
function cancelSession(sessions: Sessions, sessionId: SessionId): void {
  const scoped = sessions.scope(sessionId)
  const conversation: ScopedConversation | undefined = scoped?.get('conversation')
  if (conversation === undefined || typeof conversation.cancel !== 'function') {
    warn(`conversation service unavailable for session ${String(sessionId)}; stop not sent`)
    return
  }
  conversation.cancel().catch((error: unknown) => {
    warn(`stop failed for session ${String(sessionId)}:`, error)
  })
}
