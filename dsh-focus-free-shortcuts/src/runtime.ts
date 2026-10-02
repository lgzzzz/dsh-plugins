/**
 * Shared runtime ground for the three bridges.
 *
 * `pane-keys.ts`, `stop-sequence.ts`, and `approval-keys.ts` each open the same
 * fixed-input channel and each need the same small set of runtime facts:
 *
 *   - the plugin name diagnostics are prefixed with;
 *   - the keydown branch of the registry's own fixed-input union, narrowed without
 *     a cast at every use site;
 *   - the one Session the main view currently retains, which the stop and the
 *     approval bridge both resolve without DOM focus.
 *
 * Service faces are *not* restated here: each bridge imports the upstream face it
 * uses (`Shortcuts`, `ISessions`, `UiSession`, …) from the package that declares it.
 * Nothing here decides ownership — the gesture/binding rules live in `binding.ts`.
 */
import type {ShortcutFixedInput} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {SessionListState, SessionSummary} from '@deepseek-ai/dsh-api-session-controller/client'
// 空导入(不引入任何名字):只为让 TS 加载本包的 `declare module` 增强 ——
// `SessionReferenceSourceMap` 上的 `mainView` 来源标记由它声明(`retainedBy.mainView`
// 由此合法);它同时声明了 `Context` 上的 `uiSession`。type-only 导入在打包前被擦除。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** Plugin id: the module-table id, the diagnostic prefix, and the fixed-input labels. */
export const name = 'dsh-focus-free-shortcuts'

/** Session identity, taken from the catalog row's own id field. */
export type SessionId = SessionSummary['id']

/** One fixed keydown, as the registry publishes it. */
export type KeydownInput = Extract<ShortcutFixedInput, { type: 'keydown' }>

/** Emit one prefixed diagnostic line. */
export function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** Narrow the fixed-input union without a cast at every use site. */
export function isKeydown(input: ShortcutFixedInput): input is KeydownInput {
  return input.type === 'keydown'
}

/**
 * The one Session the main view currently retains, read without DOM focus.
 *
 * `sessions.list.byId[id].retainedBy.mainView` is the same fact `UiSession`
 * reads in `isMain`. More than one retained id means a Session switch is in
 * flight, and no answer is safer than cancelling the wrong turn.
 * @param list - the Session list snapshot.
 * @returns the retained main-view Session id, or undefined when it is ambiguous.
 */
export function mainViewSessionId(list: SessionListState): SessionId | undefined {
  const mains = list.ids.filter((id) => hasMainViewRetention(list.byId[id]?.retainedBy))
  return mains.length === 1 ? mains[0] : undefined
}

/**
 * Read the positive `mainView` source count off a row's retention record.
 * @param retainedBy - a Session summary's retention counts.
 * @returns whether the main view retains that Session.
 */
function hasMainViewRetention(retainedBy: SessionSummary['retainedBy'] | undefined): boolean {
  if (retainedBy === undefined) return false
  const count = retainedBy.mainView
  return typeof count === 'number' && count > 0
}
