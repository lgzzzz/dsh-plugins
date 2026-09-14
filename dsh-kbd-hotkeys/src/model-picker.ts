/**
 * dsh-kbd-hotkeys — 模型浮窗(⌘/Ctrl+Alt+M)与思考强度循环(⇧Tab)的数据面与动作。
 *
 * 两个动作共用**同一份** per-session 模型目录:上游 dsh-client-ui-model-selection
 * 把 `/model` 弹层与 composer 的模型座位都挂在 `ctx.modelDirectories`
 * (ModelDirectoryResolver)的 `directoryFor(sessionId)` 实例上——「the ONE state
 * both selection entries share」。本插件走同一条路取到**同一个实例**,因此浮窗里的
 * 切换与两个上游入口共用同一份内存态与同一条 `session.selectModel` 提交路径,
 * 不是镜像,也没有第二份状态。
 *
 * 取数(全部服务面,零 DOM):
 * - 列表 / 当前选择 = `directory.store.getSnapshot()`;`load()` 先拉一次宿主代数目录
 *   再回读同一快照。行 = `state.groups` **原样展开**(提供方顺序、模型顺序都按宿主,
 *   不重排、不排序);
 * - 每行的完整选择 = 上游 `/model` 弹层 `selectionOf` 的**同一条规则**:provider /
 *   model 取自所在分组,`reasoningEffort` 取「当前选择已落在该模型上时的
 *   `current.reasoningEffort`」否则取 `model.reasoning.defaultEffort`(逐字对齐,
 *   不自行发明默认档);
 * - 切换 = `directory.select(selection)`(与弹层 `onSelect`、座位 `select` 同一动词)。
 *
 * ⇧Tab 的循环集合 = 上游 composer 座位 `effortChoices` 的**同一条规则**:
 * - `reasoning` 缺席(适配器没有推理元数据)→ 该模型不提供强度档,**no-op 不吞键**;
 * - 否则循环 `[Default(仅当模型没有 defaultEffort 时才作为一个可选档)] + reasoning.efforts`;
 * - 当前档 = `current.reasoningEffort ?? reasoning.defaultEffort`(上游 effectiveEffort);
 *   当前档不在候选里(目录过期)时从候选首项重新开始;
 * - 只有一档(含「仅 Default」)时不切换、不吞键。
 *
 * **无降级**:modelDirectories 服务缺席 / 无当前会话 / 当前会话是被寻址的子代理
 * (`sessions.subagentAddress(id) !== undefined`,上游 available 的同一判据)/
 * `directoryFor` 抛错 → 一律 no-op(浮窗显示空态),不回退 DOM、不改用别的会话的目录。
 */
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

/** 提供方默认档的显示名(与上游 model 词典 `effort.providerDefault` 逐字一致)。 */
const PROVIDER_DEFAULT = 'Default'

/** 「没有可切换模型的会话」空态文案(浮窗与服务缺席共用)。 */
const NO_SESSION_NOTICE = '当前没有可切换模型的会话'

/* ------------------------------------------------------------------ *
 * 服务链路取数
 * ------------------------------------------------------------------ */

/** 当前会话的子代理地址(服务缺席 / 抛错时 undefined = 当作普通会话)。 */
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

/**
 * 当前会话的共享模型目录;不可用时 undefined(无降级)。
 *
 * 判空顺序:服务 / 动词缺席 → 无当前会话 → 被寻址的子代理会话(上游 `available`
 * 为 false,`load()` / `select()` 都会抛)→ `directoryFor` 抛错(未知会话 / 无挂载
 * 会话面)。提前判空是为了让浮窗显示**准确**的空态,而不是建出实例再让 load 抛错。
 */
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

/** 目录的当前快照(store 缺席 / 抛错时 `{}`,后续一律按空目录渲染)。 */
function stateOf(directory: ModelDirectoryLike): ModelDirectoryStateLike {
  try {
    const state = directory.store?.getSnapshot?.()
    return state === null || state === undefined ? {} : state
  } catch {
    return {}
  }
}

/** 在分组里按 (provider, model) 查该确切路由(找不到 = 目录未公告该模型)。 */
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

/**
 * 一行对应的完整选择:逐字复刻上游弹层的 `selectionOf`。
 *
 * 当前选择已落在该模型上时保留它的 `reasoningEffort`(缺席则回落该模型默认档),
 * 否则用该模型自己的默认档——避免「换个模型又切回来」把用户选过的档位丢掉。
 */
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

/** 强度档显示名(上游:先在 efforts 里按 id 查 name,查不到用原 id;undefined = Default)。 */
function effortLabelOf(reasoning: ModelReasoningLike, effort: string | undefined): string {
  if (effort === undefined || effort === '') return PROVIDER_DEFAULT
  for (const level of reasoning.efforts ?? []) {
    if (level === null || level === undefined || level.id !== effort) continue
    return typeof level.name === 'string' && level.name !== '' ? level.name : level.id
  }
  return effort
}

/** 浮窗顶部的「当前」行(无有效选择时 null)。 */
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

/** 无行时的默认提示(区分「加载中」/「加载失败」/「没有模型」)。 */
function defaultNotice(state: ModelDirectoryStateLike): string {
  if (state.status === 'error' && typeof state.error === 'string' && state.error !== '') {
    return `模型目录加载失败：${state.error}`
  }
  if (state.status === undefined || state.status === 'idle' || state.status === 'loading') {
    return '正在加载模型目录…'
  }
  return '当前没有可用的模型'
}

/** 把目录快照投影成浮窗渲染数据(纯函数,不触服务)。 */
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

/* ------------------------------------------------------------------ *
 * 动作
 * ------------------------------------------------------------------ */

/**
 * 模型浮窗的渲染数据:异步 `load()` 一次宿主代数目录,再投影成行。
 * 目录不可用(见 directoryOf)时直接给空态,不 await、不抛。
 */
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

/**
 * 提交一次完整模型选择(浮窗 Enter / 点击行)。
 *
 * @returns 是否已**发出**提交(目录不可用 / `select` 缺席 / provider、model 非法时为
 *   false)。异步拒绝在内部吞掉:失败详情落在目录 store 上(上游 `select` 会把
 *   `status: 'error'` + `error` 写进共享快照),调用方(浮窗)已关闭、无需重试面。
 */
export function selectModel(services: Services, selection: ModelSelectionLike): boolean {
  const directory = directoryOf(services)
  if (directory === undefined) return false
  return fireSelect(directory, selection)
}

/** 目录缺席 / 动词缺席 / 参数非法 / 同步抛错 → false;否则发出并吞异步拒绝。 */
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

/**
 * ⇧Tab:在当前模型的强度档之间**循环**切换一档。
 *
 * 只改 `reasoningEffort`,provider / model 沿用当前选择(与上游座位 `chooseEffort`
 * 同形)。no-op 的四种情形:目录 / 当前选择 / 推理元数据缺失,或候选档不足两档;
 * 另有 `select` 缺席、参数非法、同步抛错。no-op 一律返回 `ok: false`,分发器据此
 * **不吞键**(⇧Tab 交回页面默认行为)。
 */
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
