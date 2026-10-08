/**
 * 各桥接共用的运行时基础：诊断用的插件名、注册表固定输入联合类型里的 keydown 分支，
 * 以及主视图当前保留的那个 Session（停止桥接与审批桥接都在无 DOM 焦点时解析它）。
 */
import type {ShortcutFixedInput} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {SessionListState, SessionSummary} from '@deepseek-ai/dsh-api-session-controller/client'
// 空导入：让 TS 加载该包的 `declare module` 增强 —— 它声明
// `SessionReferenceSourceMap` 上的 `mainView` 来源标记(使 `retainedBy.mainView`
// 合法)与 `Context` 上的 `uiSession`。type-only 导入在打包前被擦除。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/** 插件 id：模块表 id、诊断前缀与固定输入标签都用它。 */
export const name = 'dsh-focus-free-shortcuts'

/** Session 标识，取自目录行自身的 id 字段。 */
export type SessionId = SessionSummary['id']

/** 注册表发布的固定输入中的一次 keydown。 */
export type KeydownInput = Extract<ShortcutFixedInput, { type: 'keydown' }>

/** 输出一行带插件前缀的诊断信息。 */
export function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** 收窄固定输入联合类型，调用处不必各自断言。 */
export function isKeydown(input: ShortcutFixedInput): input is KeydownInput {
  return input.type === 'keydown'
}

/**
 * 主视图当前保留的唯一 Session id，无 DOM 焦点读取。
 *
 * 保留 id 多于一个表示 Session 正在切换，此时返回 undefined 而不做动作。
 */
export function mainViewSessionId(list: SessionListState): SessionId | undefined {
  const mains = list.ids.filter((id) => hasMainViewRetention(list.byId[id]?.retainedBy))
  return mains.length === 1 ? mains[0] : undefined
}

/** 一行的保留记录中 `mainView` 来源计数是否为正。 */
function hasMainViewRetention(retainedBy: SessionSummary['retainedBy'] | undefined): boolean {
  if (retainedBy === undefined) return false
  const count = retainedBy.mainView
  return typeof count === 'number' && count > 0
}
