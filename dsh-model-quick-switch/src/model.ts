/**
 * 模型列表的纯投影层：把「设置里存的列表」「Host 模型目录」「当前会话的选择」三份读数拼成
 * 浮层与设置页需要的那几行。
 *
 * 三份读数各有各的问题，所以规则集中在这里、由测试直接驱动：
 *
 *   - **列表可以过时**：用户删掉一个提供方、模型下架、账号退登之后，存着的 `provider/model`
 *     仍会在列表里。投影照旧列出这一行（标「目录外」），浮层不替用户静默删数据 —— 删不删是
 *     设置页的决定。
 *   - **目录可以缺席**：模型目录没加载完（或加载失败）时，行标题退回模型 id、副标题退回
 *     provider id，界面仍然可用。
 *   - **当前选择可能是默认值**：Host 的 `modelSelection` 投影在会话从未选过模型时是 `null`，
 *     这时上游用目录里的 `default`；调用方把 `current ?? defaultSelection` 传进来即可。
 *
 * 本文件不 import React、不碰 DOM，也不读任何上游服务：模型目录、当前选择与目录失败都只是
 * 调用方交进来的值。这些数据契约直接用会话语义包（`@deepseek-ai/dsh-api-session-controller/types`）
 * 的公开类型，本文件只在它们之上加展示用的投影。
 */
import type {
  ModelCatalogFailure,
  ModelCatalogModel,
  ModelProviderGroup,
  ModelReasoning,
  ModelReasoningEffort,
  ModelSelection,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { PaletteRow } from './palette.ts'

/** 一条可选模型（与宿主 Config 的 `models[]` 同形；插件私有配置领域类型）。 */
export interface ModelChoice {
  /** 已注册的提供方路由。 */
  readonly provider: string
  /** 提供方持有的模型 id。 */
  readonly model: string
  /** 适配器公布的推理强度 id；缺席表示交给默认值。 */
  readonly reasoningEffort?: string
}

/** 当前选择（`modelSelection` 投影 / 目录默认值 / 本插件写回的那一份）；上游 `ModelSelection`。 */
export type ModelSelectionLike = ModelSelection

/** 模型目录里的一个推理强度；上游 `ModelReasoningEffort`。 */
export type CatalogEffort = ModelReasoningEffort

/** 模型目录里一个模型的推理元数据；上游 `ModelReasoning`。 */
export type CatalogReasoning = ModelReasoning

/** 模型目录里的一个模型；上游 `ModelCatalogModel`。 */
export type CatalogModelEntry = ModelCatalogModel

/** 模型目录里的一个提供方分组；上游 `ModelProviderGroup`。 */
export type CatalogGroup = ModelProviderGroup

/** 模型目录里加载失败的提供方；上游 `ModelCatalogFailure`。 */
export type CatalogFailure = ModelCatalogFailure

/** 目录模型公布的角标；上游 `ModelCatalogModel['badge']`（`LlmModelBadge` 的展示数据）。 */
export type CatalogModelBadge = NonNullable<ModelCatalogModel['badge']>

/** 目录展开后的一行：分组名 + 模型名，供设置页按提供方分组渲染。 */
export interface CatalogModelRow {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly modelName: string
  /** 上游目录模型上的角标（`ModelCatalogModel['badge']`），设置页原样交给渲染方。 */
  readonly badge?: CatalogModelBadge
  readonly efforts: readonly CatalogEffort[]
  readonly defaultEffort?: string
}

/** 浮层行要显示的三段文字。 */
export interface ChoicePresentation {
  readonly title: string
  readonly subtitle: string
  /** 目录里能不能找到这个模型；找不到时行上标「目录外」。 */
  readonly known: boolean
}

/** 一个值是不是普通记录。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 非空字符串（去掉首尾空白后仍非空）。 */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 把设置里的一条原始记录收成 {@link ModelChoice}。
 *
 * `provider` / `model` 缺一不可；`reasoningEffort` 允许缺席（交给默认值），空字符串按缺席处理。
 * @param raw - 原始值（来自配置表单或 profile patch）。
 * @returns 合法选择，或 undefined。
 */
export function normalizeChoice(raw: unknown): ModelChoice | undefined {
  if (!isRecord(raw)) return undefined
  const provider = nonEmptyString(raw.provider)
  const model = nonEmptyString(raw.model)
  if (provider === undefined || model === undefined) return undefined
  const effort = nonEmptyString(raw.reasoningEffort)
  return { provider, model, ...effort === undefined ? {} : { reasoningEffort: effort } }
}

/**
 * 读配置表单里的 `models` 字段。
 *
 * 容忍接线错误的形状（不是对象、`models` 不是数组、元素不是对象）——这些情况一律得到空列表，
 * 而不是让设置页抛错。重复的条目按首次出现保留。
 * @param value - 配置表单快照的 `value`。
 * @returns 去重后的列表。
 */
export function readChoices(value: unknown): ModelChoice[] {
  if (!isRecord(value) || !Array.isArray(value.models)) return []
  const choices: ModelChoice[] = []
  const seen = new Set<string>()
  for (const raw of value.models) {
    const choice = normalizeChoice(raw)
    if (choice === undefined) continue
    const key = choiceKey(choice)
    if (seen.has(key)) continue
    seen.add(key)
    choices.push(choice)
  }
  return choices
}

/**
 * 一条选择的稳定身份。
 *
 * 用 JSON 数组而不是拼接字符串：provider / model id 里出现分隔符时不会撞车。推理强度算进
 * 身份里 —— 同一个模型的「默认强度」与「显式 high」是两行。
 * @param choice - 一条选择。
 * @returns 稳定 key。
 */
export function choiceKey(choice: ModelSelectionLike): string {
  return JSON.stringify([choice.provider, choice.model, choice.reasoningEffort ?? ''])
}

/** 两条选择是否完全相同（provider / model / 推理强度都相等）。 */
export function sameSelection(left: ModelSelectionLike | null | undefined, right: ModelSelectionLike | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) return false
  return choiceKey(left) === choiceKey(right)
}

/**
 * 列表里的这一条是否就是当前选择。
 *
 * 一条没写推理强度的选择覆盖该模型的**任意**强度：用户加了一行 `provider/model`，当前会话
 * 实际跑在 `provider/model + high` 上时，这一行仍然是「当前」——它选中的就是这个模型。
 * 写了强度时要求强度也相等。
 * @param choice - 列表里的一行。
 * @param current - 当前选择。
 * @returns 是否命中。
 */
export function matchesCurrent(choice: ModelSelectionLike, current: ModelSelectionLike | null | undefined): boolean {
  if (current === null || current === undefined) return false
  if (choice.provider !== current.provider || choice.model !== current.model) return false
  if (choice.reasoningEffort === undefined) return true
  return choice.reasoningEffort === current.reasoningEffort
}

/** 列表里有没有这一条（按完整身份比较）。 */
export function hasChoice(choices: readonly ModelChoice[], choice: ModelSelectionLike): boolean {
  const key = choiceKey(choice)
  return choices.some((entry) => choiceKey(entry) === key)
}

/**
 * 追加一条选择（已存在则原样返回）。
 * @param choices - 当前列表。
 * @param choice - 要添加的选择。
 * @returns 新列表；没有变化时返回原引用。
 */
export function addChoice(choices: readonly ModelChoice[], choice: ModelChoice): readonly ModelChoice[] {
  if (hasChoice(choices, choice)) return choices
  return [...choices, choice]
}

/**
 * 删除一条选择（不存在则原样返回）。
 * @param choices - 当前列表。
 * @param choice - 要删除的选择。
 * @returns 新列表；没有变化时返回原引用。
 */
export function removeChoice(choices: readonly ModelChoice[], choice: ModelSelectionLike): readonly ModelChoice[] {
  const key = choiceKey(choice)
  const next = choices.filter((entry) => choiceKey(entry) !== key)
  return next.length === choices.length ? choices : next
}

/**
 * 把目录里的分组按显示顺序排好：DeepSeek 账号第一、DeepSeek 第二，第三方保持目录原有顺序。
 *
 * 与上游两个模型入口的 `orderModelProviders` 同一条规则；这里只做展示排序，不改变选择。
 * @param groups - 目录分组。
 * @returns 排序后的副本。
 */
export function orderCatalogGroups(groups: readonly CatalogGroup[]): CatalogGroup[] {
  const rank = (id: string): number => (id === 'deepseek-account' ? 0 : id === 'deepseek' ? 1 : 2)
  // Array.prototype.sort 是稳定排序：同 rank 的第三方分组保持目录顺序。
  return [...groups].sort((left, right) => rank(left.id) - rank(right.id))
}

/**
 * 把目录分组展开成一行一个模型。
 * @param groups - 目录分组（已按显示顺序排好）。
 * @returns 展开后的行。
 */
export function flattenCatalog(groups: readonly CatalogGroup[]): CatalogModelRow[] {
  const rows: CatalogModelRow[] = []
  for (const group of groups) {
    for (const model of group.models ?? []) {
      rows.push({
        provider: group.id,
        providerName: group.name ?? group.id,
        model: model.id,
        modelName: model.name ?? model.id,
        ...model.badge === undefined ? {} : { badge: model.badge },
        efforts: model.reasoning?.efforts ?? [],
        ...model.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort },
      })
    }
  }
  return rows
}

/** 在展开后的目录里找一条选择对应的模型行。 */
export function findCatalogModel(
  catalog: readonly CatalogModelRow[],
  choice: ModelSelectionLike,
): CatalogModelRow | undefined {
  return catalog.find((row) => row.provider === choice.provider && row.model === choice.model)
}

/** 推理强度 id 在目录里的显示名；目录没有给出时退回 id 本身。 */
export function effortName(row: CatalogModelRow | undefined, effortId: string): string {
  return row?.efforts.find((effort) => effort.id === effortId)?.name ?? effortId
}

/**
 * 一条选择在界面上显示的两段文字。
 *
 * 目录里有这个名字时用目录名（模型名 / 提供方名 / 强度名）；目录缺席时退回 id，行仍然可读。
 * @param choice - 一条选择。
 * @param catalog - 展开后的目录（可以是空数组）。
 * @returns 标题、副标题与「目录里有没有」。
 */
export function choicePresentation(
  choice: ModelSelectionLike,
  catalog: readonly CatalogModelRow[],
): ChoicePresentation {
  const row = findCatalogModel(catalog, choice)
  const providerName = row?.providerName ?? choice.provider
  const title = row?.modelName ?? choice.model
  const effort = choice.reasoningEffort === undefined ? undefined : effortName(row, choice.reasoningEffort)
  return {
    title,
    subtitle: effort === undefined ? providerName : `${providerName} · ${effort}`,
    known: row !== undefined,
  }
}

/**
 * 把列表投影成浮层行。
 *
 * 顺序照抄列表，不排序、不截断；当前选择标 `current`，目录里找不到的标「目录外」。
 * @param choices - 设置里保存的列表。
 * @param catalog - 展开后的目录。
 * @param current - 当前选择（已经是 `会话语义 ?? 目录默认值`）。
 * @param options - `catalogReady` 为 false 时（目录还没加载完 / 加载失败）不标「目录外」：
 *   那时每个模型都「找不到」，全标一遍反而误导。
 * @returns 浮层行。
 */
export function choiceRows(
  choices: readonly ModelChoice[],
  catalog: readonly CatalogModelRow[],
  current: ModelSelectionLike | null | undefined,
  options: { readonly catalogReady?: boolean } = {},
): PaletteRow[] {
  const catalogReady = options.catalogReady !== false
  return choices.map((choice) => {
    const presentation = choicePresentation(choice, catalog)
    const currentHit = matchesCurrent(choice, current)
    return {
      key: choiceKey(choice),
      title: presentation.title,
      subtitle: presentation.subtitle,
      ...currentHit ? { current: true } : {},
      ...catalogReady && !presentation.known ? { badges: ['目录外'] } : {},
    }
  })
}

/** 当前选择行在浮层候选里的下标；没有命中时为 -1。 */
export function currentChoiceIndex(rows: readonly PaletteRow[]): number {
  return rows.findIndex((row) => row.current === true)
}

/** 供浮层写回 Host 的一条选择（去掉内部表示里的可选空字段）。 */
export function selectionOfChoice(choice: ModelChoice): ModelSelectionLike {
  return {
    provider: choice.provider,
    model: choice.model,
    ...choice.reasoningEffort === undefined ? {} : { reasoningEffort: choice.reasoningEffort },
  }
}

/** 思考等级浮层里的一行（「当前」标记由 {@link effortRows} 投影）。 */
export interface EffortChoice {
  /** 强度 id；缺席表示「默认」（不写 reasoningEffort，交给 Host 的默认值）。 */
  readonly reasoningEffort?: string
  /** 主标题。 */
  readonly title: string
  /** 副标题。 */
  readonly subtitle: string
}

/**
 * 一个模型可选的思考等级：第一行固定是「默认」，后面是模型目录公布的每个强度。
 *
 * 目录缺席（还没加载完或加载失败）与「模型不公布强度」都只得到「默认」一行 —— 调用方据此
 * 判断要不要进入第二步（长度 ≤ 1 就直接切换）。
 * @param choice - 用户在模型浮层里选中的那一行。
 * @param row - 这个模型在展开后的目录里的那一行；找不到时为 undefined。
 * @returns 思考等级候选。
 */
export function effortChoices(choice: ModelSelectionLike, row: CatalogModelRow | undefined): EffortChoice[] {
  const fallback = row?.defaultEffort === undefined ? undefined : effortName(row, row.defaultEffort)
  const choices: EffortChoice[] = [
    {
      title: '默认',
      subtitle: fallback === undefined ? '跟随模型目录的默认强度' : `跟随目录默认 · ${fallback}`,
    },
  ]
  for (const effort of row?.efforts ?? []) {
    // 上游把 `name` 声明为必填，但目录缺席时的读数与测试替身可能只带 id：运行时仍按缺席处理，
    // 这里收成可选字符串再判，不上游类型更窄而改掉兜底行为。
    const name: string | undefined = effort.name
    choices.push({
      reasoningEffort: effort.id,
      title: name ?? effort.id,
      subtitle: name === undefined || name === effort.id ? '思考等级' : effort.id,
    })
  }
  return choices
}

/**
 * 把思考等级候选投影成浮层行。
 *
 * 「当前」按完整身份比较：没写强度的行只在会话也没写强度时才算当前；写了强度时要求强度相等。
 * @param choice - 选中的模型（只取 provider / model）。
 * @param efforts - {@link effortChoices} 的结果。
 * @param current - 会话当前的选择；没有时为 null。
 * @returns 浮层行。
 */
export function effortRows(
  choice: ModelSelectionLike,
  efforts: readonly EffortChoice[],
  current: ModelSelectionLike | null,
): PaletteRow[] {
  const sameModel = current !== null && current.provider === choice.provider && current.model === choice.model
  return efforts.map((effort) => ({
    key: choiceKey({
      provider: choice.provider,
      model: choice.model,
      ...effort.reasoningEffort === undefined ? {} : { reasoningEffort: effort.reasoningEffort },
    }),
    title: effort.title,
    subtitle: effort.subtitle,
    ...sameModel && current.reasoningEffort === effort.reasoningEffort ? { current: true } : {},
  }))
}

/**
 * 进入思考等级浮层时应该选中哪一行。
 *
 * 优先用设置里那一行固定的强度，其次是会话当前使用的强度；都没有（或目录里已经不存在）时
 * 选「默认」。这样用户直接按 Enter 就等于沿用当前状态，不会莫名其妙改掉强度。
 * @param choice - 选中的模型。
 * @param efforts - 思考等级候选。
 * @param current - 会话当前的选择。
 * @returns 候选下标；没有候选时为 0。
 */
export function initialEffortIndex(
  choice: ModelSelectionLike,
  efforts: readonly EffortChoice[],
  current: ModelSelectionLike | null,
): number {
  const preferred = choice.reasoningEffort
    ?? (current !== null && current.provider === choice.provider && current.model === choice.model
      ? current.reasoningEffort
      : undefined)
  if (preferred === undefined) return 0
  const index = efforts.findIndex((effort) => effort.reasoningEffort === preferred)
  return index < 0 ? 0 : index
}

/** 一条思考等级选择折成写回 Host 的形状（默认行不带 reasoningEffort）。 */
export function selectionOfEffort(choice: ModelSelectionLike, effort: EffortChoice): ModelSelectionLike {
  return {
    provider: choice.provider,
    model: choice.model,
    ...effort.reasoningEffort === undefined ? {} : { reasoningEffort: effort.reasoningEffort },
  }
}
