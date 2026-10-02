/**
 * Shortcut group 4 — a new key: `Ctrl+Alt+J` jumps the keyboard to the composer.
 *
 * Unlike the three bridged groups this key has **no bundled owner at all**: nothing
 * in the application reserves `Ctrl+Alt+J`, so this plugin registers its own fixed
 * row (`dsh-focus-free-shortcuts.focus-composer`, group `input`) — the same
 * read-only row mechanism `approval.allow` / `approval.reject` and `response.stop`
 * use. A mounted fixed row's presence *is* its reservation: configurable commands
 * are barred from the combination, and the row shows up as a fixed shortcut. The
 * bridge then asks the same question as the approval bridge — "does the mounted
 * row still reserve exactly this press?" (`fixedRowOwns`) — so a row that failed
 * to mount leaves the key alone.
 *
 * The action itself goes through the public per-session input face. The main-view
 * Session resolves without DOM focus (`retainedBy.mainView`, same fact as the stop
 * and approval bridges); its borrowed scope addresses `conversation.input`, and
 * `SessionInputResolver.for(actx)` answers the resident facade whose `focus()` is
 * the same "return the keyboard to the composer with the caret it last held"
 * operation the application itself runs after an overlay. A bare DOM `focus()` on
 * the contenteditable would land the caret at the start instead; the facade
 * restores the stored selection.
 *
 * The press is consumed only when the bridge actually focuses, and the bridge
 * stands down while a modal owns the screen, the target sits in a terminal, or
 * there is no unambiguous main-view Session. Like the approval keys this is a
 * fixed action on every runtime, so the bridge installs on Web and Desktop alike.
 */
import { fixedRowOwns } from './binding.ts'
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {
  ShortcutContext,
  ShortcutFixedCommand,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ShortcutCommandId} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {ISessions} from '@deepseek-ai/dsh-api-session-controller/client'
import type {IConversation, SessionInput} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {Context} from '@deepseek-ai/cordis'

/**
 * Whether one press may jump to the composer without DOM focus: a fresh,
 * unconsumed key with no modal layer above it and no terminal owning the
 * target. The physical key itself is not decided here — that is the mounted
 * fixed row's reservation (`fixedRowOwns`), mirroring how the approval bridge
 * splits admission from row matching. Both `page` and `editable` targets are
 * accepted: the whole point of the key is to pull the keyboard back from a
 * text field anywhere in the application.
 * @param gesture - the physical press being routed.
 * @param context - modal and region ownership for this press.
 * @returns whether the press is eligible to focus the composer.
 */
export function focusComposerEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && context.modal === null
    && context.region !== 'terminal'
}

/** Registered id of the fixed focus-composer row this bridge follows. */
export const FOCUS_COMPOSER_ID: ShortcutCommandId = 'dsh-focus-free-shortcuts.focus-composer' as ShortcutCommandId

/** The one physical combination the fixed row reserves: `Ctrl+Alt+J`. */
export const FOCUS_COMPOSER_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'KeyJ',
  modifiers: ['control', 'alt'],
}

/** The fixed row this plugin mounts: it reserves the key and names the action. */
export const FOCUS_COMPOSER_COMMAND: ShortcutFixedCommand = {
  id: FOCUS_COMPOSER_ID,
  label: () => '聚焦输入框',
  keys: ['Ctrl', 'Alt', 'J'],
  bindings: [FOCUS_COMPOSER_BINDING],
  group: 'input',
}

/**
 * Bridge the focus-composer key.
 *
 * Fixed keys are reserved by their owning feature, and fixed input comes from
 * the DOM channel on every runtime — so, like the approval bridge, this bridge
 * installs on Web and Desktop alike.
 * @param ctx - client root context.
 */
export function installFocusComposerBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sessions'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sessions: ISessions = scope.sessions
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; focus-composer key not installed')
      return
    }
    // The row must be mounted before the observer reads it; both live in this
    // scope, and the disposer pair tears them down in the same order.
    scope.effect(() => shortcuts.registerFixed(FOCUS_COMPOSER_COMMAND), `${name}: focus composer fixed row`)
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handleFocusComposerInput(shortcuts, sessions, input)
    }), `${name}: focus composer key`)
  })
}

/**
 * Handle one keydown against the mounted focus-composer row.
 *
 * Resolve everything the action needs *before* consuming: the row must still
 * own the press, the main-view Session must be unambiguous, and the composer's
 * input facade must be reachable. Only then is the press consumed and the
 * keyboard returned to the composer.
 * @param shortcuts - keyboard service.
 * @param sessions - Session catalog and scope owner.
 * @param input - one fixed keydown.
 */
function handleFocusComposerInput(shortcuts: Shortcuts, sessions: ISessions, input: KeydownInput): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (!focusComposerEligible(gesture, context)) return
  const rows = shortcuts.fixedCatalog.getSnapshot()
  if (!fixedRowOwns(rows, FOCUS_COMPOSER_ID, gesture)) return
  const sessionId: SessionId | undefined = mainViewSessionId(sessions.list.getSnapshot())
  if (sessionId === undefined) return
  const scoped = sessions.scope(sessionId)
  if (scoped === undefined) return
  const conversation: IConversation | undefined = scoped.get('conversation')
  const resolver = conversation?.input
  if (resolver === undefined || typeof resolver.for !== 'function') {
    warn('conversation input registry unavailable; composer focus not sent')
    return
  }
  // `for()` throws when the scope is not a retained Session scope (a Session
  // switch in flight); no answer is safer than focusing the wrong session.
  let facade: SessionInput
  try {
    facade = resolver.for(scoped)
  } catch (error) {
    warn('composer focus target unavailable:', error)
    return
  }
  // Consume before acting: this press is the focus-composer key's alone, and a
  // half-consumed jump from a text field would also type into that field.
  input.consume()
  facade.focus()
}