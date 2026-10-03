/**
 * Browser entry: installs one focus-free bridge per shortcut group.
 *
 * A keydown is dispatched to the focused element — or to `<body>` when nothing
 * is focused — and every bundled owner derives its owner from that target, so all
 * of them silently decline until the user clicks into the exact region. The
 * fixed-input channel runs for every keydown *before* configurable dispatch and
 * can consume the press, so each bridge opens its own fixed observer and resolves
 * its owner without DOM focus:
 *
 *   - pane commands (`⌘⌥Enter` / `⌘\`) → `pane-keys.ts`;
 *   - stop (`Esc` `Esc`) → `stop-sequence.ts`;
 *   - approval (`Enter` / `Esc`) → `approval-keys.ts`;
 *   - question cancel (`Esc` on a presented `ask_user_question` card) →
 *     `question-keys.ts` — the one group whose bundled owner is *nobody* rather
 *     than an owner that declines without focus: the card binds no Escape in any
 *     focus state (only its close/cancel button dismisses it), and both stop
 *     sequences refuse while a pending interaction exists. This bridge reads the
 *     same published `pendingInteraction` slot as the approval bridge but
 *     narrowed to the question domain, and calls the card's own `dismiss()` (the
 *     operation that button calls) instead of `answer()`;
 *   - focus composer (`Ctrl+Alt+J`) → `focus-composer.ts` — this one is a new
 *     key with no bundled owner, so it registers its own fixed row and then
 *     follows that row like the approval bridge follows its mounted rows;
 *   - page cycle (`Ctrl+Alt+←` / `Ctrl+Alt+→`) → `page-cycle.ts` — the other
 *     new key pair, also with no bundled owner: it registers one fixed row
 *     carrying both arrows, steps the Right Sidebar's shown page through the
 *     public Sidebar face, and hands the keyboard to the page it lands on
 *     (a terminal takes it itself; the bridge only fills the gap). A focused
 *     terminal stops the keydown before it reaches the fixed-input channel, so
 *     this bridge additionally withholds terminal-bound presses at the capture
 *     phase (see `page-cycle.ts`). The same module carries the expand hand-over:
 *     when the bundled `sidebar.right.toggle` key expands the column, the
 *     toggle focuses the active *pane container* after the terminal's own
 *     self-focus ran, so the bridge descends one frame later into the page's
 *     own input (the terminal's xterm) — never consuming the toggle's press.
 *
 * Each group file carries its own pure decision and the observer that runs it, and
 * imports the upstream faces it uses (`Shortcuts`, `ISessions`, `UiSession`, …)
 * directly from the package that declares them — no upstream shape is restated
 * here. `binding.ts` holds the gesture/binding model both shortcut catalogs match
 * against, and `runtime.ts` the plugin name, the fixed-input narrowing, and the
 * main-view Session. For the bundled commands nothing is registered in the
 * shortcut catalog: no default bindings, no conflicts, no settings edits — each
 * bridge follows the effective catalog row or the mounted fixed row, so a
 * rebound, unbound, or absent bundled command is left alone. The two exceptions
 * are the focus-composer key and the page-cycle pair, which mount their own fixed
 * rows because no bundled feature reserves them.
 */
import { installApprovalBridge } from './approval-keys.ts'
import { installFocusComposerBridge } from './focus-composer.ts'
import { installPageCycleBridge } from './page-cycle.ts'
import { installPaneBridge } from './pane-keys.ts'
import { installQuestionBridge } from './question-keys.ts'
import { installStopBridge } from './stop-sequence.ts'
import { name } from './runtime.ts'
import type {Context} from '@deepseek-ai/cordis'

export { name }

/** The keyboard service owns fixed input; without it there is nothing to bridge. */
export const inject = ['shortcuts']

/**
 * Client plugin body.
 * @param ctx - client root context carrying the keyboard service.
 */
export function apply(ctx: Context): void {
  installPaneBridge(ctx)
  installStopBridge(ctx)
  installApprovalBridge(ctx)
  installQuestionBridge(ctx)
  installFocusComposerBridge(ctx)
  installPageCycleBridge(ctx)
}
