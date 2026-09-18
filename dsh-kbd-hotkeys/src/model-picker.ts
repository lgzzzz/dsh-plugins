/** 模型浮窗(⌘/Ctrl+M)与思考强度循环(⇧Tab)的数据面与动作。
 * 共用 ctx.modelDirectories.directoryFor(session) 的 per-session 目录(与 /model 弹层、composer 座位同源);无降级。 */
import { currentSessionId } from './actions.ts'
import type {
  EffortCycleResultLike,
  ModelCatalogModelLike,
  ModelDirectoryLike,
  ModelDirectoryStateLike,
  ModelPickerCurrentLike,
  ModelPickerRowLike,
  ModelPickerViewLike,
  ModelProviderGroupLike,
  ModelReasoningLike,
  ModelSelectionLike,
  Services,
} from './types.ts'

/** 提供方默认档显示名（同上游 effort.providerDefault）。 */
const PROVIDER_DEFAULT = 'Default'

const NO_SESSION_NOTICE = '当前没有可切换模型的会话'

/* 服务链路取数 */

/** 当前会话的子代理地址（服务缺席 / 抛错即 undefined = 普通会话）。 */
function subagentAddressOf(services: Services, sessionId: string): unknown {
  const sessions = services.sessions
  const fn = sessions?.subagentAddress
  if (typeof fn !== 'function') return undefined
  try {
    return fn.call(sessions, sessionId)
  } catch {
    return undefined
  }
}

/** 当前会话的共享模型目录；服务 / 动词 / 会话 / 被寻址子代理任一不可用即 undefined（无降级）。 */
function directoryOf(services: Services): ModelDirectoryLike | undefined {
  const resolver = services.modelDirectories
  if (resolver === null || resolver === undefined) return undefined
  if (typeof resolver.directoryFor !== 'function') return undefined
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return undefined
  if (subagentAddressOf(services, sessionId) !== undefined) return undefined
  try {
    const directory = resolver.directoryFor(sessionId)
    return directory === null || directory === undefined ? undefined : directory
  } catch {
    return undefined
  }
}

/** 目录当前快照（store 缺席 / 抛错即 {}，按空目录渲染）。 */
function stateOf(directory: ModelDirectoryLike): ModelDirectoryStateLike {
  try {
    const state = directory.store?.getSnapshot?.()
    return state === null || state === undefined ? {} : state
  } catch {
    return {}
  }
}

/** 在分组里按 (provider, model) 查确切路由。 */
function modelOf(
  state: ModelDirectoryStateLike,
  provider: string,
  model: string,
): ModelCatalogModelLike | undefined {
  for (const group of state.groups ?? []) {
    if (group === null || group === undefined || group.id !== provider) continue
    for (const item of group.models ?? []) {
      if (item !== null && item !== undefined && item.id === model) return item
    }
  }
  return undefined
}

function isSameModel(
  selection: ModelSelectionLike | null | undefined,
  provider: string,
  model: string,
): boolean {
  return selection !== null && selection !== undefined && selection.provider === provider && selection.model === model
}

/** 一行的完整选择：复刻上游 selectionOf，当前选择已在该模型上时保留其 reasoningEffort。 */
function rowSelectionOf(
  group: ModelProviderGroupLike,
  model: ModelCatalogModelLike,
  current: ModelSelectionLike | null | undefined,
): ModelSelectionLike {
  const reasoningEffort = isSameModel(current, group.id, model.id)
    ? (current?.reasoningEffort ?? model.reasoning?.defaultEffort)
    : model.reasoning?.defaultEffort
  return {
    provider: group.id,
    model: model.id,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

/** 强度档显示名（undefined = Default，查不到 name 用 id）。 */
function effortLabelOf(reasoning: ModelReasoningLike, effort: string | undefined): string {
  if (effort === undefined || effort === '') return PROVIDER_DEFAULT
  for (const level of reasoning.efforts ?? []) {
    if (level === null || level === undefined || level.id !== effort) continue
    return typeof level.name === 'string' && level.name !== '' ? level.name : level.id
  }
  return effort
}

/** 浮窗顶部「当前」行（无有效选择时 null）。 */
function currentViewOf(state: ModelDirectoryStateLike): ModelPickerCurrentLike | null {
  const current = state.current
  if (current === null || current === undefined) return null
  const model = modelOf(state, current.provider, current.model)
  const name = model?.name
  const label = typeof name === 'string' && name !== '' ? name : `${current.provider}/${current.model}`
  const reasoning = model?.reasoning
  if (reasoning === undefined) return { label, effort: '' }
  return { label, effort: effortLabelOf(reasoning, current.reasoningEffort ?? reasoning.defaultEffort) }
}

/** 无行时提示（区分加载中 / 加载失败 / 没有模型）。 */
function defaultNotice(state: ModelDirectoryStateLike): string {
  if (state.status === 'error' && typeof state.error === 'string' && state.error !== '') {
    return `模型目录加载失败：${state.error}`
  }
  if (state.status === undefined || state.status === 'idle' || state.status === 'loading') {
    return '正在加载模型目录…'
  }
  return '当前没有可用的模型'
}

/** 把目录快照投影成浮窗渲染数据（纯函数，不触服务）。 */
function viewOf(state: ModelDirectoryStateLike, notice = '', footnote = ''): ModelPickerViewLike {
  const rows: ModelPickerRowLike[] = []
  for (const group of state.groups ?? []) {
    if (group === null || group === undefined) continue
    const provider = typeof group.name === 'string' && group.name !== '' ? group.name : group.id
    for (const model of group.models ?? []) {
      if (model === null || model === undefined) continue
      rows.push({
        selection: rowSelectionOf(group, model, state.current),
        label: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
        detail: provider,
        provider,
        current: isSameModel(state.current, group.id, model.id),
      })
    }
  }
  const failed = state.failures?.length ?? 0
  const notes = [footnote]
  if (failed > 0) notes.push(`${String(failed)} 个提供方的目录加载失败`)
  return {
    current: currentViewOf(state),
    rows,
    notice: rows.length > 0 ? '' : notice !== '' ? notice : defaultNotice(state),
    footnote: notes.filter((text) => text !== '').join(' · '),
  }
}

/* 动作 */

/** 任意态；模型浮窗渲染数据：异步 load() 一次目录再投影；目录不可用直接空态，不抛。 */
export async function modelPickerView(services: Services): Promise<ModelPickerViewLike> {
  const directory = directoryOf(services)
  if (directory === undefined) return viewOf({}, NO_SESSION_NOTICE)
  const state = stateOf(directory)
  if (typeof directory.load !== 'function') return viewOf(state)
  try {
    const loaded = await directory.load()
    return viewOf(loaded === null || loaded === undefined ? state : loaded)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return viewOf(state, '', `模型目录加载失败：${message}`)
  }
}

/** 提交完整模型选择；目录不可用 / select 缺席 / 参数非法即 false（异步拒绝内部吞掉）。 */
export function selectModel(services: Services, selection: ModelSelectionLike): boolean {
  const directory = directoryOf(services)
  if (directory === undefined) return false
  return fireSelect(directory, selection)
}

/** 目录 / 动词缺席、参数非法或抛错 → false;否则发出并吞异步拒绝。 */
function fireSelect(directory: ModelDirectoryLike, selection: ModelSelectionLike): boolean {
  if (typeof directory.select !== 'function') return false
  if (typeof selection.provider !== 'string' || selection.provider === '') return false
  if (typeof selection.model !== 'string' || selection.model === '') return false
  try {
    void Promise.resolve(directory.select(selection)).catch(() => {})
    return true
  } catch {
    return false
  }
}

/** ⇧Tab（browse / editing）：循环切换强度档（只改 reasoningEffort）；元数据缺失或候选不足两档 → ok:false 不吞键。 */
export function cycleEffort(services: Services): EffortCycleResultLike {
  const miss: EffortCycleResultLike = { ok: false, effortLabel: '' }
  const directory = directoryOf(services)
  if (directory === undefined) return miss
  const state = stateOf(directory)
  const current = state.current
  if (current === null || current === undefined) return miss
  const reasoning = modelOf(state, current.provider, current.model)?.reasoning
  if (reasoning === undefined) return miss

  const choices: (string | undefined)[] = [
    ...(reasoning.defaultEffort === undefined ? [undefined] : []),
    ...(reasoning.efforts ?? []).map((level) => level.id),
  ]
  if (choices.length <= 1) return miss

  const effective = current.reasoningEffort ?? reasoning.defaultEffort
  const at = choices.indexOf(effective)
  const next = choices[(at + 1) % choices.length]
  const selection: ModelSelectionLike = {
    provider: current.provider,
    model: current.model,
    ...(next === undefined ? {} : { reasoningEffort: next }),
  }
  if (!fireSelect(directory, selection)) return miss
  return { ok: true, effortLabel: effortLabelOf(reasoning, next) }
}
