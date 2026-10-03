/**
 * 排序规划：把「注册表当前顺序 + 工作区快照 + 策略」算成「期望顺序」和
 * 「最小移动序列」，不碰任何服务，因此可以脱离宿主单独测试。
 *
 * 两个纯函数分别对应两侧的真源：
 *   - {@link planWorkspaceOrder} 决定顺序应该是什么（比较规则、置顶、稳定性）；
 *   - {@link planReorderSteps} 决定怎样用注册表的 `insertBefore`（DOM
 *     insertBefore 语义：移到锚点之前，缺锚点则追加到末尾）把它做实，
 *     这里模拟一遍插入排序，已就位的条目一次也不会被移动。
 */
import type { Workspace } from '@deepseek-ai/dsh-workspace'

/** 规划排序所需的工作区投影（只取比较用得到的字段）。 */
export interface SortableWorkspace {
  /** 注册表记录 id；同序时的最后一级稳定判据。 */
  readonly id: string
  /** 显示标题（允许重名）。 */
  readonly title: string
  /** 规范化目录路径。 */
  readonly path: string
  /** ISO-8601 创建时刻。 */
  readonly createdAt: string
  /** ISO-8601 最后改动时刻：创建、改名、会话归属变化会推进它，纯排序不会。 */
  readonly updatedAt: string
}

/** 支持的排序依据；同时是配置 schema 的取值集合。 */
export const SORT_ORDERS = [
  'updated-desc',
  'updated-asc',
  'title-asc',
  'title-desc',
  'path-asc',
  'path-desc',
  'created-asc',
  'created-desc',
] as const

/** 一种排序依据。 */
export type SortOrder = (typeof SORT_ORDERS)[number]

/** 展开默认值之后的排序策略。 */
export interface SortPolicy {
  /** 排序依据。 */
  readonly order: SortOrder
  /** 置顶项：按显示标题或绝对路径匹配，数组顺序即置顶段内的顺序。 */
  readonly pinned: readonly string[]
  /** 比较标题与路径时是否区分大小写。 */
  readonly caseSensitive: boolean
  /** 比较用的 BCP-47 语言标签；省略时用运行环境的默认语言。 */
  readonly locale?: string | undefined
}

/** 一次移动：`id` 移到 `beforeId` 之前；`beforeId` 缺省表示追加到末尾。 */
export interface ReorderStep<Id> {
  /** 被移动的工作区 id。 */
  readonly id: Id
  /** 锚点工作区 id；缺省表示移到末尾。 */
  readonly beforeId?: Id
}

/** 排序真正读取的字段。 */
type SortField = 'title' | 'path' | 'createdAt' | 'updatedAt'

/**
 * 把注册表实体投影成规划输入。
 * @param workspace - 注册表里的工作区实体。
 * @returns 可比较的工作区投影。
 */
export function toSortable(workspace: Workspace): SortableWorkspace {
  return {
    id: String(workspace.id),
    title: workspace.title,
    path: workspace.path,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
}

/**
 * 两个顺序是否逐位相同（长度也要相同）。
 * @param left - 顺序 A。
 * @param right - 顺序 B。
 * @returns 完全相同为 true。
 */
export function sameOrder<Id>(left: readonly Id[], right: readonly Id[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * 算出工作区应该出现的顺序。
 *
 * 置顶项先按策略匹配（标题或路径命中即算置顶）并整段排在前面，段内按
 * `pinned` 数组顺序；其余条目按依据字段比较（标题/路径走 Intl 比较器，时刻
 * 字段按 ISO 码点序），同值再比路径、最后比 id，因此任何输入顺序都得到同一个
 * 结果——重排不会来回抖动。
 * @param workspaces - 当前工作区投影（入参顺序无关）。
 * @param policy - 排序策略。
 * @returns 期望的 id 顺序。
 */
export function planWorkspaceOrder(
  workspaces: readonly SortableWorkspace[],
  policy: SortPolicy,
): string[] {
  const collator = collatorFor(policy)
  const pinned = pinnedRanks(policy, workspaces)
  const ranked = workspaces.map((workspace) => ({
    workspace,
    pin: pinned.get(workspace.id) ?? Number.POSITIVE_INFINITY,
  }))
  ranked.sort((left, right) => {
    if (left.pin !== right.pin) return left.pin - right.pin
    return compareWorkspaces(left.workspace, right.workspace, policy, collator)
  })
  return ranked.map((entry) => entry.workspace.id)
}

/**
 * 把「当前顺序 → 期望顺序」折算成最小移动序列。
 *
 * 逐个位置对齐：该位已经是目标条目就跳过，否则把它移到该位。锚点取移走它
 * 之后仍排在该位的那一条，正好对应注册表 `insertBefore` 的语义；到位所需
 * 的移动次数不超过条目数。
 * @param current - 注册表当前顺序。
 * @param desired - 期望顺序（元素集合应与 current 相同）。
 * @returns 依次执行的移动；已就位时为空数组。
 */
export function planReorderSteps<Id>(
  current: readonly Id[],
  desired: readonly Id[],
): ReorderStep<Id>[] {
  const working = [...current]
  const steps: ReorderStep<Id>[] = []
  for (let index = 0; index < desired.length; index += 1) {
    const id = desired[index]
    if (id === undefined || working[index] === id) continue
    const without = working.filter((value) => value !== id)
    const beforeId = without[index]
    steps.push(beforeId === undefined ? { id } : { id, beforeId })
    without.splice(index, 0, id)
    working.length = 0
    working.push(...without)
  }
  return steps
}

/**
 * 取比较器：数字序（`a2` 排在 `a10` 前）与大小写折叠交给 Intl，
 * 语言标签非法时退回运行环境默认语言，绝不因一次配置笔误让排序失效。
 * @param policy - 排序策略。
 * @returns 该策略对应的比较器。
 */
function collatorFor(policy: SortPolicy): Intl.Collator {
  const options: Intl.CollatorOptions = {
    numeric: true,
    sensitivity: policy.caseSensitive ? 'variant' : 'base',
  }
  try {
    return new Intl.Collator(policy.locale, options)
  } catch {
    return new Intl.Collator(undefined, options)
  }
}

/** 匹配键：区分大小写时原样，否则折叠为小写。 */
function matchKey(policy: SortPolicy, value: string): string {
  return policy.caseSensitive ? value : value.toLowerCase()
}

/**
 * 置顶表：先出现的置顶值赢；标题命中优先于路径命中。
 * @param policy - 排序策略。
 * @param workspaces - 当前工作区投影。
 * @returns 工作区 id → 置顶位次（未命中不出现在表里）。
 */
function pinnedRanks(
  policy: SortPolicy,
  workspaces: readonly SortableWorkspace[],
): Map<string, number> {
  const ranks = new Map<string, number>()
  if (policy.pinned.length === 0) return ranks
  const byValue = new Map<string, number>()
  for (let index = 0; index < policy.pinned.length; index += 1) {
    const value = policy.pinned[index]
    if (value === undefined) continue
    const key = matchKey(policy, value)
    if (!byValue.has(key)) byValue.set(key, index)
  }
  for (const workspace of workspaces) {
    const rank =
      byValue.get(matchKey(policy, workspace.title)) ??
      byValue.get(matchKey(policy, workspace.path))
    if (rank !== undefined) ranks.set(workspace.id, rank)
  }
  return ranks
}

/**
 * 两条工作区的完整比较：依据字段（带方向）→ 路径 → id。
 * @param left - 左值。
 * @param right - 右值。
 * @param policy - 排序策略。
 * @param collator - 已按策略构造的比较器。
 * @returns 负数表示 left 在前。
 */
function compareWorkspaces(
  left: SortableWorkspace,
  right: SortableWorkspace,
  policy: SortPolicy,
  collator: Intl.Collator,
): number {
  const field = fieldOf(policy.order)
  const direction = policy.order.endsWith('-desc') ? -1 : 1
  const primary =
    field === 'title' || field === 'path'
      ? collator.compare(left[field], right[field])
      : compareText(left[field], right[field])
  if (primary !== 0) return direction * primary
  const byPath = collator.compare(left.path, right.path)
  if (byPath !== 0) return byPath
  return compareText(left.id, right.id)
}

/** 排序依据对应的字段。 */
function fieldOf(order: SortOrder): SortField {
  if (order.startsWith('path')) return 'path'
  if (order.startsWith('created')) return 'createdAt'
  if (order.startsWith('updated')) return 'updatedAt'
  return 'title'
}

/**
 * 与语言无关的码点比较：ISO-8601 UTC 字符串的码点序就是时间序，id 只需稳定，
 * 两者都不该经过语言相关的比较器。
 */
function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
