/**
 * 标题栏动作槽的重排计划与写入。
 *
 * 依赖的上游契约只有一条:`conversation.session.header.actions` 是 list 槽,渲染按各注册项
 * `options.order` 升序,所以重排就是就地改写这些 `options.order`。计划是纯函数,只有
 * `applyHeaderActionOrder` 会写入。
 */
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
// 空导入(不引入任何名字):让 TS 加载该包对 SlotMap 的模块扩展,否则下面
// slots.entries(HEADER_ACTION_SLOT) 会报类型错。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** 会话标题栏的动作槽;上游声明为 list 槽。 */
export const HEADER_ACTION_SLOT = 'conversation.session.header.actions'

/** 目标顺序:在此的 id 依次拿 0..n;上游没有的 id 自然无人认领,直接跳过。 */
export const HEADER_ACTION_ORDER: readonly string[] = [
  'agent-preset',
  'agent-team',
  'subagent-catalog',
  'schedule-catalog',
  'job-list',
]

/** 未列出的注册项接在这些序号之后,并保持它们彼此当前的相对顺序。 */
export const UNLISTED_ORDER_BASE = 1000

/** 一条待写入:把 `target.order` 改成 `order`。 */
export interface OrderWrite {
  /** 注册项的 options 对象,写入目标。 */
  target: StoredEntry['options']
  /** 目标序号。 */
  order: number
  /** 诊断用名字;注册项没有 id 时是 `'(no id)'`。 */
  id: string
}

/**
 * 算出需要改写的 order:列出的项按 `preferred` 的次序拿 0..n,未列出的项接在
 * `UNLISTED_ORDER_BASE` 之后、保持现有相对顺序;`order` 已等于目标值的项不产出写入。
 */
export function planOrderWrites(
  entries: readonly StoredEntry[],
  preferred: readonly string[] = HEADER_ACTION_ORDER,
): OrderWrite[] {
  const rank = new Map<string, number>()
  for (let index = 0; index < preferred.length; index += 1) {
    const id = preferred[index]
    if (id !== undefined && !rank.has(id)) rank.set(id, index)
  }

  const unlisted = entries.filter((entry) => {
    const id = entry.options?.id
    return id === undefined || !rank.has(id)
  })
  const unlistedRank = new Map<StoredEntry, number>()
  for (const [index, entry] of [...unlisted].sort(byCurrentOrder).entries()) unlistedRank.set(entry, index)

  const writes: OrderWrite[] = []
  for (const entry of entries) {
    const target = entry.options
    if (target === undefined) continue
    const id = target.id
    const listed = id !== undefined ? rank.get(id) : undefined
    const next = listed ?? UNLISTED_ORDER_BASE + (unlistedRank.get(entry) ?? 0)
    if (target.order !== next) writes.push({ target, order: next, id: id ?? '(no id)' })
  }
  return writes
}

function byCurrentOrder(left: StoredEntry, right: StoredEntry): number {
  return (left.options?.order ?? 0) - (right.options?.order ?? 0)
}

/**
 * 把 `preferred`(默认 `HEADER_ACTION_ORDER`)落到槽里:就地改写各注册项的 `options.order`,
 * 返回成功写入的条数。
 *
 * 注册表形状不符(没有 `entries`、或该槽读不到)时返回 0;单条写入抛错(如 `options` 被冻结)
 * 时只告警并跳过那一条,其余照写。
 */
export function applyHeaderActionOrder(
  slots: SlotRegistry,
  preferred: readonly string[] = HEADER_ACTION_ORDER,
): number {
  if (typeof slots.entries !== 'function') return 0
  const entries = slots.entries(HEADER_ACTION_SLOT)
  if (entries === undefined || entries === null) return 0
  let written = 0
  for (const write of planOrderWrites(entries, preferred)) {
    try {
      write.target.order = write.order
      written += 1
    } catch (error) {
      console.warn(`[dsh-header-action-order] 无法改写 ${write.id} 的 order:`, error)
    }
  }
  return written
}
