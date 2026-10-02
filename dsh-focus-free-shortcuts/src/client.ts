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
 *   - approval (`Enter` / `Esc`) → `approval-keys.ts`.
 *
 * Each group file carries its own pure decision and the observer that runs it, and
 * imports the upstream faces it uses (`Shortcuts`, `ISessions`, `UiSession`, …)
 * directly from the package that declares them — no upstream shape is restated
 * here. `binding.ts` holds the gesture/binding model both shortcut catalogs match
 * against, and `runtime.ts` the plugin name, the fixed-input narrowing, and the
 * main-view Session. Nothing is registered in the shortcut catalog: no default
 * bindings, no conflicts, no settings edits — each bridge follows the effective
 * catalog row or the mounted fixed row, so a rebound, unbound, or absent bundled
 * command is left alone.
 */
import { installApprovalBridge } from './approval-keys.ts'
import { installPaneBridge } from './pane-keys.ts'
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
}
