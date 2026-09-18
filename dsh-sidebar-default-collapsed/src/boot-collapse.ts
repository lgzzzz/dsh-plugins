/** 启动即收起的判定核心:读活布局 store → 一次性标记 → 条件写入;无降级(读不到即 no-op)。 */
import type { LayoutInfoLike, Services, SlotEntryLike, SlotsLike, StoreHandleLike, WindowLike } from './types.ts'

/** 布局 store 挂在 root 注册项上(ui-layout 的 root 注册自带 store 座)。 */
const ROOT_SLOT = 'root'

/** 上游窄窗断点(ui-layout SIDEBAR_AUTO_COLLAPSE):低于它上游本就收起。 */
export const SIDEBAR_AUTO_COLLAPSE = 1024

/**
 * 本次页面加载的一次性标记键。写在 window 上而非模块作用域:client-hmr 的热替换会重新
 * import 模块(fiber 替换),模块级变量随之重置,窗口属性才跨替换存活。
 */
export const BOOT_MARK = '__dshSidebarDefaultCollapsed'

/** 单次启动判定的结果(可诊断;只有 'closed' 发生了写入)。 */
export type BootOutcome =
  /** 宽窗 + 原本展开 → 已切换为收起。 */
  | 'closed'
  /** 宽窗但已是收起态,无需写入。 */
  | 'already-closed'
  /** 窄窗:上游默认即收起,toggle 会走 narrowExpanded 分支反而展开,故不动。 */
  | 'narrow'
  /** 本次页面加载已判定过(重建 fiber 不重复插手用户的选择)。 */
  | 'visited'
  /** 读不到布局 store → 不置标记,留给下次 apply 重试。 */
  | 'no-store'
  /** layout 服务或 toggleSidebar 缺席。 */
  | 'no-service'
  /** toggleSidebar 抛错(已吞,不影响启动)。 */
  | 'failed'

/**
 * 启动时把左栏置为收起:仅在「本次页面加载的首次判定 + toggleSidebar 的宽分支 + 当前展开」时写入一次。
 * 幂等性来自读活 store 而非盲 toggle:纯翻转会把用户已收起的栏打开。
 * @param services - 已解析的服务集合。
 * @param win - 承载一次性标记的窗口对象(测试可注入)。
 * @returns 判定结果。
 */
export function collapseSidebarOnBoot(services: Services, win: WindowLike): BootOutcome {
  if (win[BOOT_MARK] === true) return 'visited'

  const info = readLayoutInfo(services.slots)
  if (info === undefined) return 'no-store'
  // 状态已读到 ⇒ 无论是否写入都算「判定完成」:之后的 fiber 重建不再插手用户的手动选择
  win[BOOT_MARK] = true

  if (info.viewportWidth < SIDEBAR_AUTO_COLLAPSE) return 'narrow'
  if (info.sidebar === 0) return 'already-closed'

  const layout = services.layout
  if (layout === null || layout === undefined) return 'no-service'
  if (typeof layout.toggleSidebar !== 'function') return 'no-service'
  try {
    // 必须以「方法」形式调用:摘下来会丢 this 抛错(上游服务是类实例)
    layout.toggleSidebar()
  } catch {
    return 'failed'
  }
  return 'closed'
}

/** 读活布局 store 的 layoutInfo:entries('root') → 带 store 的注册项 → resolveStore(handle, undefined) → 形状校验。 */
export function readLayoutInfo(slots: SlotsLike | undefined): LayoutInfoLike | undefined {
  if (slots === null || slots === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined
  for (const entry of entriesOf(slots)) {
    const handle = entry?.store
    if (handle === null || handle === undefined) continue
    const info = asLayoutInfo(snapshotOf(slots, handle))
    if (info !== undefined) return info
  }
  return undefined
}

/** root 注册项列表(调用抛错视为不可用)。 */
function entriesOf(slots: SlotsLike): readonly SlotEntryLike[] {
  try {
    const entries = slots.entries?.(ROOT_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 解析 handle 的活实例并取快照(root 作用域不传 binding);任一环抛错视为不可用。 */
function snapshotOf(slots: SlotsLike, handle: StoreHandleLike): unknown {
  try {
    return slots.resolveStore?.(handle, undefined)?.getSnapshot?.()
  } catch {
    return undefined
  }
}

/** 形状校验:只接受带数值 sidebar / viewportWidth 的 layoutInfo;顺带排除 root 上其它注册项的 store。 */
function asLayoutInfo(snapshot: unknown): LayoutInfoLike | undefined {
  if (!isPlainObject(snapshot)) return undefined
  const info = snapshot.layoutInfo
  if (!isPlainObject(info)) return undefined
  const { sidebar, viewportWidth } = info
  if (typeof sidebar !== 'number' || typeof viewportWidth !== 'number') return undefined
  return { sidebar, viewportWidth }
}

/** 普通对象判定(排除 null 与数组)。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
