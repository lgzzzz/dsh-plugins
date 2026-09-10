/**
 * dsh-left-dock — 布局宽度轴的取用与夹取。
 *
 * `ctx.layout`（ILayout）只暴露 selectPanel / beginNavigation / toggleSidebar /
 * openRightbar / closeRightbar —— **没有宽度写入口**。左栏宽度是 ui-layout 的 root
 * slot store（LayoutState.layoutInfo.sidebar）经 `setSidebar` 动作写的，因此本插件
 * 沿仓库既有先例（dsh-kbd-hotkeys/src/sidebar-order.ts 读侧栏视图 store 的同一路径）
 * 取 root 注册项上的 store handle，再 `slots.resolveStore(handle, undefined)`
 * （root 作用域无需 scopeBinding）拿活实例的 `actions.setSidebar`。
 *
 * 全程「无降级」：任一环节读不到就返回 undefined，调用方 no-op（宁可这次不写宽度，
 * 也不猜一个值写进别人的 store）。
 */
import type { SlotEntryLike, SlotsLike, StoreActionsLike } from './context.ts'

/** 左栏宽度下界（上游 ui-layout/src/client/columns.ts 的 SIDEBAR_MIN）。 */
export const SIDEBAR_MIN = 264
/** 左栏宽度上界（上游 SIDEBAR_MAX）。 */
export const SIDEBAR_MAX = 420

/**
 * 夹取左栏宽度到 ui-layout 的合同区间（本插件记录的是**整列轨道宽度**，
 * 即活动栏 + 面板）。
 * @param px - 期望宽度。
 * @returns 夹取并取整后的宽度。
 */
export function clampTrackWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_MIN
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)))
}

/**
 * 取 ui-layout root 注册项的布局动作面。
 * @param slots - slots 服务。
 * @returns `setSidebar` 可用的动作面；不可用时 undefined。
 */
export function rootLayoutActions(slots: SlotsLike): StoreActionsLike | undefined {
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined
  let entries: readonly SlotEntryLike[]
  try {
    entries = slots.entries('root') ?? []
  } catch {
    return undefined
  }
  for (const entry of entries) {
    const handle = entry?.store
    if (handle === undefined || handle === null) continue
    let instance
    try {
      instance = slots.resolveStore(handle, undefined)
    } catch {
      continue
    }
    const actions = instance?.actions
    if (actions === undefined || actions === null) continue
    if (typeof actions.setSidebar === 'function') return actions
  }
  return undefined
}
