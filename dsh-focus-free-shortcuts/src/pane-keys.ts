/**
 * Shortcut group 1 — the Right-Sidebar pane keys (`⌘⌥Enter` fullscreen, `⌘\` split).
 *
 * `pane.fullscreen.toggle` and `pane.split` call `sidebarRight.focusedTarget(element)`
 * and return `command.noFocus` when the keydown target is outside a visible dock
 * pane. A keydown is dispatched to the focused element — or to `<body>` when
 * nothing is focused — so both decline until the user clicks into the pane.
 *
 * This bridge opens its own fixed-input observer — the channel that runs for every
 * keydown *before* configurable dispatch and can consume the press — and resolves
 * the same owner without DOM focus: `sidebarRight.commandTarget(element)`, whose
 * documented fallback is the on-screen Session's active dock pane.
 *
 * The focused pane stays authoritative (a press the bundled command already owns
 * is left untouched), so exactly one owner remains per press, and the bridge
 * follows the *effective* catalog row: a rebound, disabled, or absent bundled
 * command is left alone. Nothing is registered in the shortcut catalog. Web
 * runtime only — on Desktop these are configurable bindings dispatched by the
 * native keyboard bridge, which this DOM observer cannot suppress.
 */
import { bindingMatches, enabledBinding } from './binding.ts'
import { isKeydown, name, warn, type KeydownInput } from './runtime.ts'
import type {
  ShortcutCatalogEntry,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {Context} from '@deepseek-ai/cordis'
// 空导入(不引入任何名字):只为让 TS 加载本包的 `declare module '@deepseek-ai/cordis'`
// 增强 —— `ctx.sidebarRight` 由它声明。该面带 `focusedTarget` / `commandTarget` 的类
// 并不在包的 `/client` 导出名单里,所以 `Context['sidebarRight']` 是取它的公开途径。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

/** The Right-Sidebar face, exactly as the Cordis augmentation declares it. */
type Sidebar = Context['sidebarRight']

/** The two pane commands this plugin bridges, by their registered ids. */
export interface PaneCommandIds {
  readonly fullscreen: string
  readonly split: string
}

/** Which bundled pane action a press belongs to. */
export type PaneAction = 'fullscreen' | 'split'

/**
 * Which bundled pane command currently owns this press, if any.
 *
 * Reading the effective catalog instead of hardcoding a combination is what
 * keeps a rebound command authoritative and this bridge out of its way.
 * @param rows - the effective catalog snapshot.
 * @param gesture - the physical press being routed.
 * @param ids - the two command ids to test.
 * @returns the owned action, or undefined for any other press.
 */
export function paneActionFor(
  rows: readonly ShortcutCatalogEntry[],
  gesture: ShortcutGesture,
  ids: PaneCommandIds,
): PaneAction | undefined {
  if (gesture.secondCode !== undefined) return undefined
  const candidates: readonly (readonly [PaneAction, string])[] = [
    ['fullscreen', ids.fullscreen],
    ['split', ids.split],
  ]
  for (const [action, id] of candidates) {
    const binding = enabledBinding(rows, id)
    if (binding !== undefined && bindingMatches(binding, gesture)) return action
  }
  return undefined
}

/** Registered ids of the two bundled pane commands this bridge follows. */
const PANE_COMMAND_IDS: PaneCommandIds = {
  fullscreen: 'pane.fullscreen.toggle',
  split: 'pane.split',
}

/**
 * Bridge the pane fullscreen/split keys.
 *
 * Web runtime only: on Desktop these are configurable bindings dispatched by
 * the native keyboard bridge, and this DOM observer cannot suppress that
 * dispatch, so acting here as well would toggle twice.
 * @param ctx - client root context.
 */
export function installPaneBridge(ctx: Context): void {
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
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (gesture.composing || gesture.defaultPrevented) return
  // `pane.fullscreen.toggle` and `pane.split` declare no modals, so a modal
  // press is consumed-and-blocked by the bundled dispatch; stay out of it.
  if (context.modal !== null) return
  const rows = shortcuts.catalog.getSnapshot()
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
