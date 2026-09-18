/** 右栏标签 / 文件浏览器 / 终端访问层(⌘/Ctrl+Alt+←→、⌘/Ctrl+\、⌘/Ctrl+L、⌘/Ctrl+.)。
 * 三步取数:entries → uiSession.resolve → resolveStore;无降级;terminal 是 multiple 页,认页由插件读 store。 */
import type {
  Services,
  SidebarRightLayoutLike,
  SidebarRightLayoutNodeLike,
  SidebarRightLike,
  SidebarRightStoreLike,
  SidebarRightTabsStateLike,
  SlotsLike,
  UiSessionLike,
} from './types.ts'
import { currentSessionId } from './session-view.ts'

/** sidebar-right seat 注册的会话级 slot 名（store handle 挂在该注册项上）。 */
const RIGHTBAR_SLOT = 'rightbar.session'

/** 文件浏览器页类型 kind。 */
const FILES_KIND = 'files'

/** 文件浏览器页地址（上游 pageAddress(kind)）。 */
const FILES_PAGE_ADDRESS = 'sidebar://files'

/** 终端页类型 kind。 */
const TERMINAL_KIND = 'terminal'

/** 终端页地址前缀：multiple 页的 contentId 带 UUID，故认前缀而非全等。 */
const TERMINAL_PAGE_PREFIX = 'sidebar://terminal'

interface TabAxis {
  readonly ids: readonly string[]
  /** 当前激活标签在 `ids` 里的下标;找不到时为 -1。 */
  readonly active: number
}

/** ⌘/Ctrl+Alt+←→：在当前面板标签间循环切换（任意态）；单标签 / 任一层不可用即 no-op 不吞键。 */
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
    sidebarRight.focus(target)
    return true
  } catch {
    return false
  }
}

/* 关闭当前标签（⌘/Ctrl+.） */

/** ⌘/Ctrl+.:关闭右栏当前面板的当前标签(任意态);现场仍取会话级 store 布局(与标签切换同源),
 * 关闭调公开的 sidebarRight.close(tabId)(上游拒关独占停靠的 guide);关完回读布局确认消失,否则 no-op 不吞键。 */
export function closeRightSidebarTab(services: Services): boolean {
  const sidebarRight = services.sidebarRight
  if (sidebarRight === null || sidebarRight === undefined) return false
  if (typeof sidebarRight.close !== 'function') return false
  const resolved = rightbarStore(services)
  if (resolved === undefined) return false
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return false
  const layout = resolved.snapshot.bySession?.[sessionId]?.layout
  if (layout === undefined) return false
  const tabId = activeTabId(layout)
  if (tabId === undefined) return false
  try {
    sidebarRight.close(tabId)
  } catch {
    return false
  }
  return !tabStillOpen(resolved.instance, sessionId, tabId)
}

/** 当前面板的当前标签 id；无激活标签 / 标签不在面板里即 undefined。 */
function activeTabId(layout: SidebarRightLayoutLike): string | undefined {
  const pane = paneOf(layout, layout.activePaneId)
  if (pane === undefined) return undefined
  const active = pane.activeTabId
  if (typeof active !== 'string' || active === '') return undefined
  return (pane.tabs ?? []).includes(active) ? active : undefined
}

/** 关闭后回读同一份活实例：该标签是否仍在（读不回布局按「仍在」处理，宁可放行）。 */
function tabStillOpen(instance: SidebarRightStoreLike, sessionId: string, tabId: string): boolean {
  const getSnapshot = instance.getSnapshot
  if (typeof getSnapshot !== 'function') return true
  let snapshot: unknown
  try {
    snapshot = getSnapshot.call(instance)
  } catch {
    return true
  }
  const layout = (snapshot as SidebarRightTabsStateLike | undefined)?.bySession?.[sessionId]?.layout
  if (layout === undefined) return false
  return layout.tabs?.[tabId] !== undefined
}

/* 文件浏览器：打开并置于首位（⌘/Ctrl+\） */

interface FilesTab {
  readonly paneId: string
  readonly tabId: string
  readonly index: number
}

/** ⌘/Ctrl+\：任意态；openTab('files') 打开 / 聚焦文件浏览器页（同一步展开右栏），再经 store 实例的 placeTab 置顶；不用 replaceTab。 */
export function revealRightSidebarFiles(services: Services): boolean {
  const sidebarRight = services.sidebarRight
  if (sidebarRight === null || sidebarRight === undefined) return false
  if (typeof sidebarRight.openTab !== 'function') return false
  try {
    sidebarRight.openTab(FILES_KIND)
  } catch {
    return false
  }
  promoteFilesTab(services)
  return true
}

/** 把当前会话的文件浏览器 tab 置为其所在停靠面板的首位；任一环缺失即静默跳过。 */
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
  if (target === undefined || target.index === 0) return
  try {
    placeTab.call(actions, sessionId, target.tabId, target.paneId, 0)
  } catch {
  }
}

/** 找当前会话的文件浏览器 tab：当前面板优先、再扫其余停靠面板，浮窗跳过。 */
function filesTabIn(layout: SidebarRightLayoutLike): FilesTab | undefined {
  for (const paneId of paneOrder(layout)) {
    const pane = paneOf(layout, paneId)
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

/** 面板扫描顺序：当前面板优先，其余按布局节点键顺序。 */
function paneOrder(layout: SidebarRightLayoutLike): string[] {
  const order: string[] = []
  const active = layout.activePaneId
  if (typeof active === 'string' && active !== '') order.push(active)
  for (const paneId of Object.keys(layout.nodes ?? {})) {
    if (paneId !== active) order.push(paneId)
  }
  return order
}

/* 终端：定位（已有则聚焦）/ 缺则新建（⌘/Ctrl+L） */

interface TerminalTab {
  readonly paneId: string
  readonly tabId: string
/** 是否已是所在面板当前标签（决定要不要补元素级聚焦）。 */
  readonly current: boolean
}

/** ⌘/Ctrl+L:任意态;定位终端——已有则 focus(tabId)(折叠时补 toggleExpanded)、不置顶,没有才 openTab 新建。
 * terminal 是 multiple 页、每次 openTab 铸 UUID,故认页由插件读 store;无降级;已知限制:抢地址栏与 shell 清屏。 */
export function revealRightSidebarTerminal(services: Services): boolean {
  const sidebarRight = services.sidebarRight
  if (sidebarRight === null || sidebarRight === undefined) return false
  const layout = currentLayout(services)
  if (layout !== undefined) {
    const held = terminalTabIn(layout)
    if (held !== undefined) {
      if (typeof sidebarRight.focus !== 'function') return false
      // 「本来就可见」须在 toggleExpanded 之前判定。
      const alreadyVisible = held.current && layout.expanded !== false
      try {
        sidebarRight.focus(held.tabId)
      } catch {
        return false
      }
      expandColumn(sidebarRight, layout)
      if (alreadyVisible) focusTerminalScreen(held.paneId)
      return true
    }
  }
  if (typeof sidebarRight.openTab !== 'function') return false
  try {
    sidebarRight.openTab(TERMINAL_KIND)
  } catch {
    return false
  }
  return true
}

/** 把 DOM 焦点移进终端的 xterm:唯一一处有界选择器查询(按 paneId 找面板再取 textarea.xterm-helper-textarea);失败即 no-op。 */
function focusTerminalScreen(paneId: string): boolean {
  if (typeof document === 'undefined') return false
  const pane = paneElement(paneId)
  if (pane === undefined) return false
  const query = pane.querySelector
  if (typeof query !== 'function') return false
  let screen: unknown
  try {
    screen = query.call(pane, 'textarea.xterm-helper-textarea')
  } catch {
    return false
  }
  if (typeof screen !== 'object' || screen === null) return false
  const focus = (screen as { focus?: unknown }).focus
  if (typeof focus !== 'function') return false
  try {
    ;(focus as (options?: { preventScroll?: boolean }) => void).call(screen, { preventScroll: true })
    return true
  } catch {
    return false
  }
}

/** 按 dockkit 属性上的面板 id 找面板元素。 */
function paneElement(paneId: string): Element | undefined {
  const queryAll = document.querySelectorAll
  if (typeof queryAll !== 'function') return undefined
  let panes: ArrayLike<Element>
  try {
    panes = queryAll.call(document, '[data-dockkit-pane]')
  } catch {
    return undefined
  }
  for (let index = 0; index < panes.length; index += 1) {
    const pane = panes[index]
    if (pane === undefined || pane === null) continue
    const attribute = pane.getAttribute
    if (typeof attribute === 'function' && attribute.call(pane, 'data-dockkit-pane') === paneId) return pane
  }
  return undefined
}

/** 折叠着才展开右栏（layout.expanded !== false 时不动，避免关掉开着的右栏）。 */
function expandColumn(sidebarRight: SidebarRightLike, layout: SidebarRightLayoutLike): void {
  if (layout.expanded !== false) return
  const toggle = sidebarRight.toggleExpanded
  if (typeof toggle !== 'function') return
  try {
    toggle.call(sidebarRight)
  } catch {
  }
}

/** 找当前会话的终端 tab：当前面板优先、面板内优先当前激活项，浮窗跳过。 */
function terminalTabIn(layout: SidebarRightLayoutLike): TerminalTab | undefined {
  for (const paneId of paneOrder(layout)) {
    const pane = paneOf(layout, paneId)
    if (pane === undefined || pane.host !== 'dock') continue
    const activeTabId = pane.activeTabId
    let first: string | undefined
    for (const tabId of pane.tabs ?? []) {
      if (typeof tabId !== 'string' || tabId === '') continue
      if (!isTerminalTab(layout, tabId)) continue
      if (tabId === activeTabId) return { paneId, tabId, current: true }
      if (first === undefined) first = tabId
    }
    if (first !== undefined) return { paneId, tabId: first, current: false }
  }
  return undefined
}

/** 记录是否终端页（以 kind 为准，兼容带 UUID 的页地址前缀）。 */
function isTerminalTab(layout: SidebarRightLayoutLike, tabId: string): boolean {
  const record = layout.tabs?.[tabId]
  if (record === undefined || record === null) return false
  if (record.kind === TERMINAL_KIND) return true
  const contentId = record.contentId
  return (
    typeof contentId === 'string' &&
    (contentId === TERMINAL_PAGE_PREFIX || contentId.startsWith(`${TERMINAL_PAGE_PREFIX}/`))
  )
}

/** 当前会话右栏当前面板的标签顺序与激活项。 */
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

function currentLayout(services: Services): SidebarRightLayoutLike | undefined {
  const resolved = rightbarStore(services)
  if (resolved === undefined) return undefined
  const sessionId = currentSessionId(services)
  if (sessionId === undefined) return undefined
  return resolved.snapshot.bySession?.[sessionId]?.layout
}

interface RightbarStore {
  readonly instance: SidebarRightStoreLike
  readonly snapshot: SidebarRightTabsStateLike
}

/** 解析 rightbar.session 注册项 store handle 的活实例（三步取数，任一步不可用即 undefined）。 */
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
      instance = slots.resolveStore(handle, binding)
    } catch {
      continue
    }
    const resolved = asRightbarStore(instance)
    if (resolved !== undefined) return resolved
  }
  return undefined
}

/** slots 注册项列表（服务异常 / 形状不符即空）。 */
function entriesOf(slots: SlotsLike): readonly { store?: unknown }[] {
  try {
    const entries = slots.entries?.(RIGHTBAR_SLOT)
    return Array.isArray(entries) ? entries : []
  } catch {
    return []
  }
}

/** 会话作用域绑定（必须带字符串 key）。 */
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

/** 活实例形状校验：必须能 getSnapshot() 出 { bySession }；actions 为可选面。 */
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

/** 按 id 取布局里的面板（节点缺失 / 非 pane 即 undefined）。 */
function paneOf(layout: SidebarRightLayoutLike, paneId: string | undefined): SidebarRightLayoutNodeLike | undefined {
  if (typeof paneId !== 'string' || paneId === '') return undefined
  const node = layout.nodes?.[paneId]
  if (node === undefined || node === null) return undefined
  if (node.kind !== 'pane') return undefined
  return node
}
