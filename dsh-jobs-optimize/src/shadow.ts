/**
 * 后台任务控件的账本遮蔽逻辑：纯计算，不碰 DOM、React 与定时器。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-jobs` 在 `conversation.session.header.actions` 槽里以
 * `id: "job-list"` 注册那个「{count} 个后台任务」控件，开合状态是组件私有的 `useState`，
 * 上游没有为指针悬停暴露配置项。本模块用 slots 的**遮蔽**规则接住它：list 槽里同 id、
 * **不同 priority** 的两项不冲突，`priority` 最小者渲染（上游的注册错误文案：「register at
 * a different priority to shadow it (lowest renders)」，见 contract.json 的 shadow-rule）。
 * 于是不改上游产物、不写上游对象，只注册一个更低 priority 的同 id 项，把源项的
 * `component` 换成包装组件。
 *
 * 从源项抄什么、为什么不抄什么：
 *   - `inject` 必须抄：业务面（`hooks.jobs` / `watchRows` / `observe` / `killJob`）只由
 *     `options.inject()` 交出来，而渲染器只调用胜者条目的 inject；
 *   - `locale` 必须抄：`t` 座位由渲染器按条目的 locale 命名空间合成；
 *   - `order` 抄来即保持控件原有的位置；
 *   - `priority` 取源项减一；
 *   - `label` 抄来只为让槽位检查界面显示同一个名字；
 *   - `children` 与 `store` **不抄**：JobListAction 既不声明子槽也不声明存储座位，而抄
 *     `children` 会撞上「子槽已被声明」的注册错误。
 *
 * 胜负判定只按 `component` 的对象身份区分「我们的项」和「源项」：`register()` 把包装组件
 * 原样存成条目的 `component`，而包装组件在每次安装时都是新的闭包，因此它与上游的
 * JobListAction 永不相等。源项从账本消失后，剩下的唯一同 id 项就是我们的项，于是不会再被
 * 误认为源项。
 */
import type { LedgerEntry, ShadowSlots } from './types.ts'

/** 承载后台任务控件的槽。 */
export const JOB_LIST_SLOT = 'conversation.session.header.actions'

/** 上游在该槽里给后台任务控件使用的注册 id。 */
export const JOB_LIST_ID = 'job-list'

/** 本插件的记账：源项、我们注册的包装组件、以及注册的撤销函数。 */
export interface ShadowState {
  /** 当前被遮蔽的源项。 */
  source?: LedgerEntry
  /** 交给 `register()` 的包装组件（它同时是「哪一项是我们的」的身份凭据）。 */
  wrapped?: unknown
  /** `register()` 返回的撤销函数。 */
  dispose?: () => void
  /** 对账进行中标记。 */
  busy?: boolean
}

/** 一次对账的结果，供调用方决定是否告警以及测试断言。 */
export type ShadowOutcome =
  /** 账本上既没有源项、我们也没有遮蔽项。 */
  | 'absent'
  /** 源项从账本消失，已撤回遮蔽项。 */
  | 'withdrawn'
  /** 已在遮蔽，且源项仍是同一个对象。 */
  | 'hold'
  /** 首次遮蔽。 */
  | 'install'
  /** 源项换成了新对象（上游重挂载），已撤回并重建。 */
  | 'replace'
  /**
   * 上一次对账还没结束就又被调用（注册表在 `register()` 或撤销里同步回调订阅者）。
   * 本次调用不做事：外层那次对账已经覆盖了这次变更后的账本状态。
   */
  | 'busy'

/** 空的记账对象。 */
export function createShadowState(): ShadowState {
  return {}
}

/**
 * 在账本快照里取源项。
 *
 * @param entries - `slots.entries(JOB_LIST_SLOT)` 的原始账本视图（不是 `entriesOfSlot` 的
 *   胜者投影：投影会隐藏被遮蔽的源项，而遮蔽项自身也要能从原始账本里读到）。
 * @param wrapped - 我们注册的包装组件；用它排除我们自己的条目。
 * @returns 源项；账本上没有（或只剩我们自己的项）时返回 undefined。
 */
export function findSourceEntry(entries: readonly LedgerEntry[], wrapped: unknown): LedgerEntry | undefined {
  return entries.find((entry) => entry.options?.id === JOB_LIST_ID && entry.component !== wrapped)
}

/**
 * 由源项算出遮蔽项的注册选项。省略的键不会出现在账本条目上（`register` 只在值非
 * `undefined` 时落键）。
 *
 * @param source - 被遮蔽的源项。
 * @returns 交给 `slots.register()` 的选项。
 */
export function shadowOptions(source: LedgerEntry): Record<string, unknown> {
  const options: Record<string, unknown> = { name: JOB_LIST_SLOT, id: JOB_LIST_ID }
  const order = source.options?.order
  if (order !== undefined) options.order = order
  if (source.options?.label !== undefined) options.label = source.options.label
  if (source.locale !== undefined) options.locale = source.locale
  if (source.inject !== undefined) options.inject = source.inject
  options.priority = (source.options?.priority ?? 0) - 1
  return options
}

/**
 * 撤回遮蔽项并清空记账。重复调用是幂等的。
 *
 * @param state - 本插件的记账。
 * @returns 本次是否真的撤销了一个注册。
 */
export function withdrawShadow(state: ShadowState): boolean {
  const dispose = state.dispose
  state.dispose = undefined
  state.source = undefined
  state.wrapped = undefined
  if (dispose === undefined) return false
  dispose()
  return true
}

/**
 * 把账本对到记账上：源项在就遮蔽它，源项走了就撤回。可重复调用。
 *
 * 撤回与新注册都发生在同一次调用里，因此源项换对象时不会留下两个遮蔽项；先撤回再注册，
 * 所以 `register()` 抛错（例如 priority 撞车）时记账仍是干净的，只由调用方告警。
 *
 * 对账期间再次进入（`busy`）直接返回，不做事：注册表可以在 `register()` 或撤销里同步回调
 * 订阅者，而那次嵌套调用看到的是「记账只写了一半」的中间状态——若照它对账，会把我们自己的
 * 遮蔽项当成新的源项再包一层（priority 变成源项减二），或在重建路径上撞上同 priority 的
 * 重复注册。外层调用返回时记账与账本已经一致，嵌套那次没有任何要补的。
 *
 * @param slots - 读账本、注册条目所需的注册表面。
 * @param state - 本插件的记账，就地更新。
 * @param wrap - 把源项组件包成包装组件；每次安装调用一次。
 * @returns 本次对账的结果。
 */
export function reconcileShadow(
  slots: ShadowSlots,
  state: ShadowState,
  wrap: (inner: unknown) => unknown,
): ShadowOutcome {
  if (state.busy === true) return 'busy'
  state.busy = true
  try {
    const source = findSourceEntry(slots.entries(JOB_LIST_SLOT), state.wrapped)
    if (source === undefined) {
      if (state.dispose === undefined && state.wrapped === undefined) return 'absent'
      withdrawShadow(state)
      return 'withdrawn'
    }
    if (state.dispose !== undefined && state.source === source) return 'hold'

    const replacing = state.dispose !== undefined
    withdrawShadow(state)
    const wrapped = wrap(source.component)
    const dispose = slots.register(shadowOptions(source), wrapped)
    state.source = source
    state.wrapped = wrapped
    state.dispose = dispose
    return replacing ? 'replace' : 'install'
  } finally {
    state.busy = false
  }
}
