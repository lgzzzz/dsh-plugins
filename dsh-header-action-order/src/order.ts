/**
 * 会话标题栏动作区的图标顺序:重写注册项上活着的 `options.order`,让上游渲染端按新值排序。
 *
 * 为什么是「改写 order」而不是「自己 re-register 一层遮蔽」:
 * 1) 上游渲染端对 list 槽的每一帧都读**活注册项**的 `options.order` 现算排序
 *    (`dsh-client-ui-renderer` 的 renderOutletContent:`entriesOfSlot(key).map(e => ({order: e.options.order ?? 0}))`
 *    → `sort((a,b) => a.order - b.order)`),所以改这个字段下一帧即生效;
 * 2) slot 只有 `entries`(只读)/`register`/`subscribe`,**没有 reorder/update**;
 *    另一条路是「同 id + 更低 priority 遮蔽 + 把别人的组件重新注册一遍」——那会换掉注册项标识、
 *    让该图标 React 重挂一次、并在上游 client-hmr 重建时留下悬空的旧组件引用;
 *    改写 order 不换标识、不重挂、不重新跑 inject,影响面只有排序;
 * 3) 上游从不回读 order(只用于渲染与 snapshot 展示),写入是幂等的。
 *
 * 代价:写入的是别人注册项上的字段。上游若改成冻结 options,写入抛错被单条吞掉,该项保持原序,
 * 其它项与整个页面不受影响(见 try/catch)。
 */
import type { SlotEntryLike, SlotEntryOptionsLike, SlotsLike } from './types.ts'

/** 目标槽:会话标题栏动作区(上游 ui-conversation 声明,list / session 作用域)。 */
export const HEADER_ACTION_SLOT = 'conversation.session.header.actions'

/**
 * 期望的显示顺序:数组下标越小越靠左。
 *
 * 当前上游各注册项的 order(0.1.7-alpha.1):agent-preset `-10`、schedule-catalog `10`、
 * job-list `20`、agent-team `20`、subagent-catalog `30`。这里把 schedule 与 job-list 挪到最后,
 * 其余保持原有先后(agent-team `20` 早于 subagent-catalog `30`)。
 * 未列出的 id(上游新增的图标)一律排在这些之后。
 */
export const HEADER_ACTION_ORDER: readonly string[] = [
  'agent-preset',
  'agent-team',
  'subagent-catalog',
  'schedule-catalog',
  'job-list',
]

/** 未列出项的 order 基址:远大于上表下标,保证它们整体排在上表各项之后。 */
export const UNLISTED_ORDER_BASE = 1000

/** 一条待写:把 target.order 写成 order(同一条注册项只出现一次)。 */
export interface OrderWrite {
  /** 注册项上活着的 options 对象(写它 = 改下一帧的排序)。 */
  target: SlotEntryOptionsLike
  order: number
  id: string
}

/**
 * 计算需要改写的项;纯函数(只读输入、不写 entry)。
 *
 * 目标值:表内 id → 数组下标;未列出的 id / 无 id 的项 → `UNLISTED_ORDER_BASE` + 按当前 order
 * 排名(相对先后不变)。下标与基址分段,故重复调用不会漂移(幂等)。
 *
 * @param entries - 该槽的活注册项(顺序无关,内部按当前 order 自行排序未列出项)。
 * @param preferred - 期望顺序;默认 {@link HEADER_ACTION_ORDER}。
 * @returns 仅包含「目标值与现值不同」的写入计划。
 */
export function planOrderWrites(
  entries: readonly SlotEntryLike[],
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
  const unlistedRank = new Map<SlotEntryLike, number>()
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

/** 未列出项的排序键:当前 order(缺省 0),相同则保持 ledger 序列(稳定排序)。 */
function byCurrentOrder(left: SlotEntryLike, right: SlotEntryLike): number {
  return (left.options?.order ?? 0) - (right.options?.order ?? 0)
}

/**
 * 把 {@link planOrderWrites} 的计划逐条写入。单条写入失败(如上游把 options 冻结)只放弃该条。
 *
 * @param slots - slots 服务。
 * @param preferred - 期望顺序;默认 {@link HEADER_ACTION_ORDER}。
 * @returns 实际写入的条数。
 */
export function applyHeaderActionOrder(
  slots: SlotsLike,
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
