/** 右栏会话级 store 的解析层(⌘/Ctrl+Alt+←→、⌘/Ctrl+\、⌘/Ctrl+L、⌘/Ctrl+,、⌘/Ctrl+S 共用)。
 * 三步取数:entries → 会话作用域绑定 → resolveStore;无降级(任一环不可用即 undefined)。
 * 标签序/标签内容与呈现方式同源同一份活实例,故由本模块统一解析、各动作只读自己要的字段。 */
import type {
  Services,
  SidebarRightLayoutLike,
  SidebarRightStoreLike,
  SidebarRightTabsStateLike,
  SlotsLike,
} from './types.ts'
import { currentSessionId } from './session-view.ts'
import { sessionScopeBinding } from './scope-binding.ts'

/** sidebar-right seat 注册的会话级 slot 名(store handle 挂在该注册项上)。 */
const RIGHTBAR_SLOT = 'rightbar.session'

export interface RightbarStore {
  readonly instance: SidebarRightStoreLike
  readonly snapshot: SidebarRightTabsStateLike
}

/** 当前会话的右栏布局(存储链路不可用 / 该会话尚无面板即 undefined)。 */
export function currentRightbarLayout(services: Services): SidebarRightLayoutLike | undefined {
  const resolved = resolveRightbarStore(services)
  if (resolved === undefined) return undefined
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return undefined
  return resolved.snapshot.bySession?.[sessionId]?.layout
}

/**
 * 解析 rightbar.session 注册项 store handle 的活实例(三步取数,任一步不可用即 undefined)。
 * @param services - 插件解析后的服务集合。
 * @param sessionId - 目标会话;缺省取视图层当前会话(调用方已有会话可传入,免二次解析)。
 * @returns 活实例与其快照;链路任一步不可用即 undefined。
 */
export function resolveRightbarStore(services: Services, sessionId?: string): RightbarStore | undefined {
  const slots = services.slots
  if (slots === null || slots === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined
  const scoped = sessionId ?? currentSessionId(services)
  if (scoped === undefined) return undefined
  const binding = sessionScopeBinding(services, scoped)
  if (binding === undefined) return undefined

  for (const entry of entriesOf(slots)) {
    const handle = entry?.store
    if (handle === undefined || handle === null) continue
    let instance: unknown
    try {
      instance = slots.resolveStore(handle, binding)
    } catch {
      continue
    }
    const resolved = asRightbarStore(instance)
    if (resolved !== undefined) return resolved
  }
  return undefined
}

/** slots 注册项列表(服务异常 / 形状不符即空)。 */
function entriesOf(slots: SlotsLike): readonly { store?: unknown }[] {
  try {
    const entries = slots.entries?.(RIGHTBAR_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 活实例形状校验:必须能 getSnapshot() 出 { bySession };actions 为可选面。 */
function asRightbarStore(instance: unknown): RightbarStore | undefined {
  if (typeof instance !== 'object' || instance === null) return undefined
  const getSnapshot = (instance as { getSnapshot?: unknown }).getSnapshot
  if (typeof getSnapshot !== 'function') return undefined
  let snapshot: unknown
  try {
    snapshot = (getSnapshot as () => unknown).call(instance)
  } catch {
    return undefined
  }
  if (typeof snapshot !== 'object' || snapshot === null) return undefined
  const bySession = (snapshot as { bySession?: unknown }).bySession
  if (typeof bySession !== 'object' || bySession === null || Array.isArray(bySession)) return undefined
  return {
    instance: instance as SidebarRightStoreLike,
    snapshot: snapshot as SidebarRightTabsStateLike,
  }
}
