/**
 * dsh-kbd-hotkeys — 右侧侧边栏「标签切换」访问层(⌘/Ctrl+Alt+← / →)。
 *
 * 为什么需要这一层:右侧栏(`dsh-client-ui-sidebar-right`)的公开服务面
 * (`ISidebarRight`)只有 `active()`(当前标签)与 `focus(tabId)`(聚焦某标签),
 * **没有** next / prev 动词,也没有枚举标签的方法;标签顺序只存在于它自己的
 * **会话级 slot store** 里(store 快照 `{ bySession: { <sessionId>: { layout } } }`,
 * `layout` 为 docking kit 的 `LayoutState`)。因此「切标签」=
 * 「读权威 store 拿当前面板的标签顺序 + 调公开的 `sidebarRight.focus(tabId)`」,
 * 与标签条(chip)点击同一入口。
 *
 * 取数路径(全部是上游公开面,不触碰 DOM;即 AGENTS.md 的 slot store 三步范式):
 *
 * 1. `slots.entries('rightbar.session')` → 注册项;带 `store` 的那一项即
 *    `createSidebarRightStore()` 的 handle(sidebar-right 的 seat 行注册:
 *    `ctx.slots.register({ name: "rightbar.session", …, store })`);
 * 2. `uiSession.resolve(sessionId)` → 该会话**已物化的作用域绑定**
 *    (与 question-drafts.ts 同一句;`slots.bindStoreScope` 用的就是这个对象);
 * 3. `slots.resolveStore(handle, binding)` → 活实例;`getSnapshot().bySession[sessionId]`
 *    即该会话的面板(dockkit `SurfaceState`),其 `layout` 里读:
 *    - `nodes[activePaneId]` → **当前面板**;`tabs` 即标签顺序、`activeTabId` 是当前标签;
 *    - `tabs[tabId].id` → 传给 `sidebarRight.focus(tabId)` 的标签 id。
 *
 * **无降级**(与 question-drafts.ts / sidebar-order.ts 同一约定):上述任一环节不可用
 * (服务缺失、slot 未注册、注册项无 store、作用域绑定缺 key、`resolveStore` 抛
 * `store handle is not registered`、当前会话尚无面板、`activePaneId` 找不到 pane 节点、
 * 标签 id 缺失)即返回 false → 调用方 no-op;不猜顺序、不写 DOM、也不在插件内镜像
 * 一份面板状态。
 *
 * 语义:
 * - 只在**当前面板**(`layout.activePaneId`;上游 `active()` 与标签条的「当前」同源)的
 *   标签之间切换,分屏的其它面板不参与;
 * - **循环**:末个标签按 → 回到第一个,首个标签按 ← 到最后一个(标签条 chip 是任意跳,
 *   热键是「轮到下一个」,循环才闭合滚动语义);
 * - 面板只有一个标签(或没有标签)时**不循环回自身**:返回 false = no-op 且不吞键,
 *   把按键交回页面,避免「按了没反应还吃掉按键」;
 * - 面板折叠着也能切:只改 store 的当前标签,展开时看到的就是它;
 * - 三态(含 `card`)均生效:问答卡片占用的是**裸** `←`/`→`,与带 `mod+alt` 的组合键
 *   不冲突,故卡片打开时同样可以切右栏标签。
 */
import type {
  Services,
  SidebarRightLayoutLike,
  SidebarRightLayoutNodeLike,
  SidebarRightTabsStateLike,
  SlotsLike,
  UiSessionLike,
} from './types.ts'

/** sidebar-right 面板 seat 注册的会话级 slot 名(其 store handle 挂在这一项上)。 */
const RIGHTBAR_SLOT = 'rightbar.session'

/** 当前面板的标签现场。 */
interface TabAxis {
  /** 面板内的标签顺序(标签条的渲染顺序)。 */
  readonly ids: readonly string[]
  /** 当前激活标签在 `ids` 里的下标;找不到时为 -1。 */
  readonly active: number
}

/**
 * 在右侧栏当前面板的标签之间循环切换(⌘/Ctrl+Alt+← / →)。
 *
 * @param services - 已解析服务集合(slots / uiSession / sidebarRight / sessions)。
 * @param delta - 方向:-1 = 上一个标签,1 = 下一个标签。
 * @returns 是否确实发起了切换(false = no-op,调用方不吞键)。
 */
export function cycleRightSidebarTab(services: Services, delta: number): boolean {
  const sidebarRight = services.sidebarRight
  if (sidebarRight === null || sidebarRight === undefined) return false
  if (typeof sidebarRight.focus !== 'function') return false
  const axis = currentPaneTabs(services)
  if (axis === undefined || axis.ids.length <= 1) return false

  const step = delta < 0 ? -1 : 1
  const index = axis.active < 0 ? 0 : (axis.active + step + axis.ids.length) % axis.ids.length
  const target = axis.ids[index]
  if (target === undefined || target === axis.ids[axis.active]) return false
  try {
    // 与标签 chip 点击同一入口(focus = 聚焦该标签 + 其所在面板)。
    sidebarRight.focus(target)
    return true
  } catch {
    // 无挂载会话面时控制器 require() 抛错 → no-op(不吞键、不回退 DOM 点击)。
    return false
  }
}

/**
 * 读当前会话右栏面板的标签顺序与激活项。
 *
 * @returns 标签现场;任一层不可解析即 undefined(调用方 no-op)。
 */
function currentPaneTabs(services: Services): TabAxis | undefined {
  const layout = currentLayout(services)
  if (layout === undefined) return undefined
  const pane = paneOf(layout, layout.activePaneId)
  if (pane === undefined) return undefined
  const ids: string[] = []
  for (const tabId of pane.tabs ?? []) {
    if (typeof tabId !== 'string' || tabId === '') continue
    const id = layout.tabs?.[tabId]?.id
    ids.push(typeof id === 'string' && id !== '' ? id : tabId)
  }
  if (ids.length === 0) return undefined
  const activeTabId = pane.activeTabId
  return {
    ids,
    active: typeof activeTabId === 'string' ? ids.indexOf(activeTabId) : -1,
  }
}

/** 当前会话的右栏 docking 布局;无挂载会话面 / 该会话尚无面板时 undefined。 */
function currentLayout(services: Services): SidebarRightLayoutLike | undefined {
  const state = rightbarTabsState(services)
  if (state === undefined) return undefined
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return undefined
  return state.bySession?.[sessionId]?.layout
}

/** 当前会话 id(无当前会话时 undefined)。 */
function currentSessionId(services: Services): string | undefined {
  const current = services.sessions?.list?.getSnapshot?.()?.current
  return current === undefined || current === '' ? undefined : current
}

/**
 * 解析 `rightbar.session` 注册项上的 store handle 的活实例快照。
 *
 * 三步(全部是上游公开面):`slots.entries('rightbar.session')` → 带 store 的注册项;
 * `uiSession.resolve(sessionId)` → 会话作用域绑定;`slots.resolveStore(handle, binding)`
 * → 活实例快照。任一步不可用返回 undefined。
 */
function rightbarTabsState(services: Services): SidebarRightTabsStateLike | undefined {
  const slots = services.slots
  const uiSession = services.uiSession
  if (slots === null || slots === undefined || uiSession === null || uiSession === undefined) return undefined
  if (typeof slots.entries !== 'function' || typeof slots.resolveStore !== 'function') return undefined
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return undefined
  const binding = resolveBinding(uiSession, sessionId)
  if (binding === undefined) return undefined

  for (const entry of entriesOf(slots)) {
    const handle = entry?.store
    if (handle === undefined || handle === null) continue
    let instance: unknown
    try {
      // 会话级 store 必须带作用域绑定解析(渲染端同一句 resolveStore)。
      instance = slots.resolveStore(handle, binding)
    } catch {
      // 'store handle is not registered' / 作用域不匹配 → 换下一个注册项。
      continue
    }
    const state = asTabsState(instance)
    if (state !== undefined) return state
  }
  return undefined
}

/** slots 注册项列表(服务异常 / 形状不符时视为不可用)。 */
function entriesOf(slots: SlotsLike): readonly { store?: unknown }[] {
  try {
    const entries = slots.entries?.(RIGHTBAR_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 取会话的作用域绑定(必须带字符串 key,否则会话级 store 无法解析)。 */
function resolveBinding(uiSession: UiSessionLike, sessionId: string): unknown {
  const resolve = uiSession.resolve
  if (typeof resolve !== 'function') return undefined
  let binding: unknown
  try {
    binding = resolve.call(uiSession, sessionId)
  } catch {
    return undefined
  }
  if (typeof binding !== 'object' || binding === null) return undefined
  const key = (binding as { key?: unknown }).key
  return typeof key === 'string' && key !== '' ? binding : undefined
}

/** 活实例形状校验:必须能 `getSnapshot()` 出 `{ bySession: {...} }`。 */
function asTabsState(instance: unknown): SidebarRightTabsStateLike | undefined {
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
  return snapshot as SidebarRightTabsStateLike
}

/** 按 id 取布局里的面板(dockkit `getPane` 同语义:节点缺失 / 非 pane 即不可用)。 */
function paneOf(layout: SidebarRightLayoutLike, paneId: string | undefined): SidebarRightLayoutNodeLike | undefined {
  if (typeof paneId !== 'string' || paneId === '') return undefined
  const node = layout.nodes?.[paneId]
  if (node === undefined || node === null) return undefined
  if (node.kind !== 'pane') return undefined
  return node
}
