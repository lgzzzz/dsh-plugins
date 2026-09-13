/**
 * dsh-kbd-hotkeys — 右侧侧边栏访问层。
 * 两个动作:
 * - `cycleRightSidebarTab`(⌘/Ctrl+Alt+← / →):在当前面板的标签之间循环切换;
 * - `revealRightSidebarFiles`(⌘/Ctrl+Alt+\):打开文件浏览器页并把它置于所在
 *   标签栏首位。
 *
 * 为什么需要这一层:右侧栏(`dsh-client-ui-sidebar-right`)的公开服务面
 * (`ISidebarRight`)只有 `active()`(当前标签)、`focus(tabId)`(聚焦某标签)与
 * `openTab(kind)`(打开页类型,落位是目标面板末尾),**没有** next / prev 动词、
 * 没有枚举标签的方法,也**没有**「插到第 N 位」的落位参数(`SidebarRightPlacement`
 * 只有 paneId / replaceTab / revealIfOpened)。标签顺序只存在于它自己的
 * **会话级 slot store** 里(store 快照 `{ bySession: { <sessionId>: { layout } } }`,
 * `layout` 为 docking kit 的 `LayoutState`)。因此:
 * - 「切标签」=「读权威 store 拿当前面板的标签顺序 + 调公开的
 *   `sidebarRight.focus(tabId)`」,与标签条(chip)点击同一入口;
 * - 「置顶」=「调公开的 `sidebarRight.openTab('files')` + 调 store 实例的
 *   `actions.placeTab(sessionId, tabId, paneId, 0)`」,与**标签拖拽**同一入口
 *   (seat 的 `intentsFor.placeTab`;绝不使用 `replaceTab`——那会关掉被顶掉的 tab)。
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
 *    - `tabs[tabId].id` → 传给 `sidebarRight.focus(tabId)` 的标签 id;
 *    - `tabs[tabId].kind` / `contentId` → 认出文件浏览器页(`kind === 'files'`,
 *      `contentId === 'sidebar://files'`);
 *    - 实例自己的 `actions.placeTab` → 置顶(defineStore 的实例动作面)。
 *
 * **无降级**(与 question-drafts.ts / sidebar-order.ts 同一约定):上述任一环节不可用
 * (服务缺失、slot 未注册、注册项无 store、作用域绑定缺 key、`resolveStore` 抛
 * `store handle is not registered`、当前会话尚无面板、`activePaneId` 找不到 pane 节点、
 * 标签 id 缺失)即返回 false / 静默跳过;不猜顺序、不写 DOM、也不在插件内镜像
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
 *   不冲突,故卡片打开时同样可以切右栏标签;
 * - 置顶只作用于文件浏览器 tab **所在的那个停靠面板**(优先当前面板 = 本次
 *   `openTab` 打开/揭示的那一个);浮窗里的 tab 不碰、别的分屏面板里已有的
 *   文件树 tab 也不搬(搬过去会被上游 `arriving()` 当成重复页 **关掉**),因此
 *   跨面板可能各有一份文件浏览器 tab——这是上游「页唯一性按面板」的既定语义。
 */
import type {
  Services,
  SidebarRightLayoutLike,
  SidebarRightLayoutNodeLike,
  SidebarRightStoreLike,
  SidebarRightTabsStateLike,
  SlotsLike,
  UiSessionLike,
} from './types.ts'

/** sidebar-right 面板 seat 注册的会话级 slot 名(其 store handle 挂在这一项上)。 */
const RIGHTBAR_SLOT = 'rightbar.session'

/** 右栏文件浏览器的**页类型** kind(dsh-client-ui-sidebar-files 的 FILES_KIND)。 */
const FILES_KIND = 'files'

/** 页类型的记录地址(上游 `pageAddress(kind)` = `sidebar://<kind>`),两个都认。 */
const FILES_PAGE_ADDRESS = 'sidebar://files'

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

/* ------------------------------------------------------------------ *
 * 文件浏览器:打开并置于首位(⌘/Ctrl+Alt+\)
 * ------------------------------------------------------------------ */

/** 一个文件浏览器 tab 的现场:它在哪个停靠面板、是哪个标签、第几位。 */
interface FilesTab {
  readonly paneId: string
  readonly tabId: string
  readonly index: number
}

/**
 * 在右侧栏打开文件浏览器,并把它置于所在标签栏的**首位**(⌘/Ctrl+Alt+\)。
 *
 * 两步,分别对应上游两个不同的入口:
 *
 * 1. **打开/揭示**:`sidebarRight.openTab('files')` —— 页类型按**目标面板**
 *    (`activeDockPaneId`)去重:该面板已有文件浏览器页就只聚焦它,否则在面板
 *    末尾新建;上游 store 的 `openContent` 恒先 `planSetExpanded(true)`,所以
 *    一次调用即「展开右栏 + 打开/聚焦」,不必也不该再调 `toggleExpanded()`
 *    (那会把本来开着的右栏关掉)。`require()` 在无挂载会话面(空白 / hero 会话、
 *    右栏插件缺席)时抛错,`files` 类型未注册时上游也抛错 → 一律兜住并返回 false
 *    (no-op 且**不吞键**,把按键交回页面)。
 * 2. **置顶**:读会话级 store 的活实例,找到文件浏览器 tab,`index > 0` 时调
 *    `actions.placeTab(sessionId, tabId, paneId, 0)` —— 与**标签拖拽**同一条
 *    入口(seat 的 `intentsFor.placeTab`),不是 DOM 操作、也不是 `replaceTab`
 *    (后者会关掉被顶掉的那个 tab,可能丢掉编辑器的未保存修改)。
 *
 * 置顶是 best-effort:任一层不可解析(无 slots / 无会话绑定 / 无面板 / 无
 * `actions.placeTab`)就静默跳过;**不回退**到任何 DOM 或 `replaceTab` 路径。
 * 打开本身成功即返回 true(该按键确实做了事 → 调用方吞键)。
 *
 * 边界:
 * - 已经在首位 → `planPlaceTab` 不产生任何 op(零提交、零历史),不打扰;
 * - 只认**停靠**面板(浮窗不碰),优先当前面板 = 本次 `openTab` 打开/揭示的那一个;
 * - 别的分屏面板里已有的文件树 tab 不搬过来(搬过去会被上游 `arriving()` 判为
 *   重复页而**关掉**),故跨面板可能各有一份 —— 上游「页唯一性按面板」的既定语义。
 *
 * @param services - 已解析服务集合(sidebarRight / sessions / slots / uiSession)。
 * @returns 是否确实发起过打开(false = no-op,调用方不吞键)。
 */
export function revealRightSidebarFiles(services: Services): boolean {
  const sidebarRight = services.sidebarRight
  if (sidebarRight === null || sidebarRight === undefined) return false
  if (typeof sidebarRight.openTab !== 'function') return false
  try {
    sidebarRight.openTab(FILES_KIND)
  } catch {
    // 'no session surface is mounted'(无挂载 seat)/ 'no tab type is registered
    // as "files"'(文件浏览器插件缺席)→ no-op,不吞键。
    return false
  }
  promoteFilesTab(services)
  return true
}

/** 把当前会话里的文件浏览器 tab 移到其所在停靠面板的第一位;任一环缺失即静默跳过。 */
function promoteFilesTab(services: Services): void {
  const resolved = rightbarStore(services)
  if (resolved === undefined) return
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return
  const actions = resolved.instance.actions
  const placeTab = actions?.placeTab
  if (actions === undefined || typeof placeTab !== 'function') return
  const layout = resolved.snapshot.bySession?.[sessionId]?.layout
  if (layout === undefined) return
  const target = filesTabIn(layout)
  // index 0 = 已经在首位:不提交、不记历史。
  if (target === undefined || target.index === 0) return
  try {
    // 与标签拖拽同一入口;同面板 = 上游 reorderTab,越界由它 clamp。
    placeTab.call(actions, sessionId, target.tabId, target.paneId, 0)
  } catch {
    // 无挂载会话面 / 会话无面板 → no-op(不回退 DOM)。
  }
}

/**
 * 找当前会话里的文件浏览器 tab:先扫**当前面板**(`layout.activePaneId`,
 * 即本次 `openTab` 的落点),再按布局顺序扫其余停靠面板;浮窗一律跳过。
 *
 * 认页的方式与上游同源:`kind === 'files'`(页类型 kind)或
 * `contentId === 'sidebar://files'`(上游 `pageAddress(kind)`)。
 *
 * @param layout - 该会话的 docking 布局。
 * @returns 面板 id / 标签 id / 下标;找不到即 undefined。
 */
function filesTabIn(layout: SidebarRightLayoutLike): FilesTab | undefined {
  const order: string[] = []
  const active = layout.activePaneId
  if (typeof active === 'string' && active !== '') order.push(active)
  for (const paneId of Object.keys(layout.nodes ?? {})) {
    if (paneId !== active) order.push(paneId)
  }
  for (const paneId of order) {
    const pane = paneOf(layout, paneId)
    // 浮窗里的 tab 不碰(其 host 为 'float')。
    if (pane === undefined || pane.host !== 'dock') continue
    const tabs = pane.tabs ?? []
    for (let index = 0; index < tabs.length; index += 1) {
      const tabId = tabs[index]
      if (typeof tabId !== 'string' || tabId === '') continue
      const record = layout.tabs?.[tabId]
      if (record === undefined || record === null) continue
      if (record.kind === FILES_KIND || record.contentId === FILES_PAGE_ADDRESS) {
        return { paneId, tabId, index }
      }
    }
  }
  return undefined
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
  const resolved = rightbarStore(services)
  if (resolved === undefined) return undefined
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return undefined
  return resolved.snapshot.bySession?.[sessionId]?.layout
}

/** 当前会话 id(无当前会话时 undefined)。 */
function currentSessionId(services: Services): string | undefined {
  const current = services.sessions?.list?.getSnapshot?.()?.current
  return current === undefined || current === '' ? undefined : current
}

/** 右栏会话级 store 的**活实例**与它的快照(读顺序与写置顶都需要实例上的 actions)。 */
interface RightbarStore {
  readonly instance: SidebarRightStoreLike
  readonly snapshot: SidebarRightTabsStateLike
}

/**
 * 解析 `rightbar.session` 注册项上的 store handle 的活实例。
 *
 * 三步(全部是上游公开面):`slots.entries('rightbar.session')` → 带 store 的注册项;
 * `uiSession.resolve(sessionId)` → 会话作用域绑定;`slots.resolveStore(handle, binding)`
 * → 活实例(含 `getSnapshot` 与动作面 `actions`)。任一步不可用返回 undefined。
 */
function rightbarStore(services: Services): RightbarStore | undefined {
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
    const resolved = asRightbarStore(instance)
    if (resolved !== undefined) return resolved
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

/**
 * 活实例形状校验:必须能 `getSnapshot()` 出 `{ bySession: {...} }`。
 * 动作面(`actions.placeTab`)是可选面——缺它只影响置顶,不影响读顺序。
 */
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

/** 按 id 取布局里的面板(dockkit `getPane` 同语义:节点缺失 / 非 pane 即不可用)。 */
function paneOf(layout: SidebarRightLayoutLike, paneId: string | undefined): SidebarRightLayoutNodeLike | undefined {
  if (typeof paneId !== 'string' || paneId === '') return undefined
  const node = layout.nodes?.[paneId]
  if (node === undefined || node === null) return undefined
  if (node.kind !== 'pane') return undefined
  return node
}
