import type { SlotEntryLike, SlotEntryOptionsLike, SlotsLike } from './types.ts'

export const HEADER_ACTION_SLOT = 'conversation.session.header.actions'

export const HEADER_ACTION_ORDER: readonly string[] = [
  'agent-preset',
  'agent-team',
  'subagent-catalog',
  'schedule-catalog',
  'job-list',
]

export const UNLISTED_ORDER_BASE = 1000

export interface OrderWrite {
  target: SlotEntryOptionsLike
  order: number
  id: string
}

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

function byCurrentOrder(left: SlotEntryLike, right: SlotEntryLike): number {
  return (left.options?.order ?? 0) - (right.options?.order ?? 0)
}

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
