/**
 * dsh-rightbar-split-open — 纯判定层(无 DOM、无服务、无副作用,可单测)。
 *
 * 目标:用户在**右侧栏文件浏览器**里点开一个文件时,让这个文件落在文件树**旁边的
 * 另一个分栏**里,并且「文件树 : 文件」= 1 : 4。
 *
 * ## 为什么需要「判定 + 搬移」而不是「拦截打开」
 *
 * 上游文件树的行点击走的是**标签自身的动作**:
 * `dsh-client-ui-sidebar-files/lib/client.js` 的 `onOpen` →
 * `tabActions.openResource(fileAddressFor(...))` →
 * `TabDomain` 的 `tabActions.openResource` → `navigator.openResourceIn(sessionId, …)`
 * (见 dsh-client-ui-sidebar-right/lib/client.js 的 `hold()`/`place()`)。
 * 也就是说它**不经过**控制器公开的 `openResource`,落在 `options.paneId` 缺省时的
 * 「当前停靠面板」——而点文件时当前面板正是文件树自己所在的那一个。
 *
 * 因此本插件不做任何包装/猴子补丁,而是把「打开」当成**观察到的状态变化**:
 * 订阅该会话右栏 store 的提交,发现「文件树所在面板里多出一个资源标签」时,用上游
 * 同一份 store 的公开动作把这次打开**改造成分栏形态**:
 *
 * 1. `splitPane(sessionId, 文件树面板)` —— 与标签条「分栏」控件同一入口;
 * 2. `placeTab(sessionId, 文件标签, 新面板, 0)` —— 与标签拖拽同一入口(dockkit 落地为
 *    `moveTab`,标签不销毁、正文不重挂载);
 * 3. `resizeSplit(sessionId, splitId, [0.2, 0.8])` —— 与分隔条拖拽同一落点;
 * 4. `focusTab(sessionId, 文件树标签)` —— 把活跃标签还给文件树,便于连续点开多个文件。
 *
 * ## 比例为什么是 0.2 / 0.8
 *
 * 上游把「最小分栏比例」固定为 `0.2`(sidebar-right 的 store 调
 * `planResizeSplit(splitId, sizes, .2)`,DockSurface 的 `minPaneFraction: .2`)。
 * 1 : 4 恰好等于 20% : 80%,落在上游允许区间的边界上,因此:
 * - 该比例是上游既定契约内的取值(用户手拖分隔条也能拖到这里),不是越界状态;
 * - 但仍留 `RATIO_EPSILON` 的微量余量,避免浮点误差把它压到边界之外。
 *
 * **可行性由上游实测决定**:`sidebarRight.split()` 只有在面板实测宽度够两个格
 * (`(面板宽 - 分隔条)/2 ≥ 固定 chrome + 胶囊宽(≥100px)`)时才分栏。本插件因此
 * 先问「能不能分」,不能分就**不动作**(文件留在文件树面板里,与上游默认行为一致),
 * 见 client.ts 的 `splitPane` 调用点。
 *
 * ## 范围
 *
 * 只处理 `dsh-resource://file/**`(文本/代码等由右栏资源类型接管的文件)。图片 / PDF
 * 由 `dsh-client-ui-sidebar-documentpreview` 以 `fallback` 档认领类别,本插件不搬动它们
 * ——树里点开图片仍然就地显示(见 README「已知限制」)。
 */
import type { LayoutStateLike, PaneNodeLike, SplitNodeLike, TabRecordLike } from './types.ts'

/** 文件树页类型的 kind(dsh-client-ui-sidebar-files 注册的页类型)。 */
export const FILES_KIND = 'files'

/** 页类型记录的地址(上游 `pageAddress(kind)` = `sidebar://<kind>`),两个都认。 */
export const FILES_PAGE_ADDRESS = 'sidebar://files'

/** 文件资源地址前缀(dsh-client-ui-sidebar-files 的 `FILE_ADDRESS_PREFIX`)。 */
export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/**
 * 目标比例:文件树 20%、文件 80%(= 1 : 4)。
 * 与上游最小分栏比例 0.2 同值,再加 {@link RATIO_EPSILON} 余量。
 */
export const TREE_RATIO = 0.2

/** 文件格比例(= file 侧 80%)。 */
export const FILE_RATIO = 0.8

/**
 * 比例余量:让 `[0.2 + ε, 0.8 - ε]` 严格落在上游 `minPaneFraction = 0.2` 之上。
 * 取 1e-3 远小于任何可感知的像素(面板宽 1000px 时约 0.5px),只是把浮点边界变成
 * 严格不等式;它不改变「20% / 80%」这一目标比例。
 */
export const RATIO_EPSILON = 0.001

/** 上游允许的最小分栏比例(`planResizeSplit` 的第三参 / `minPaneFraction`)。 */
export const MIN_PANE_FRACTION = 0.2

/** 「把这次打开改造成分栏」的判定结果。 */
export interface SplitOpenPlan {
  /** 文件树所在面板(分栏的锚点,也是要保活/回焦的一侧)。 */
  readonly treePaneId: string
  /** 停在文件树面板里的新文件标签。 */
  readonly fileTabId: string
  /** 已经存在的文件面板(文件树旁边那一格);`undefined` = 需要先分栏。 */
  readonly filePaneId?: string
}

/** 布局里某个面板节点(不存在 / 不是 pane / 是浮窗都返回 undefined)。 */
export function paneOf(layout: LayoutStateLike | undefined, paneId: unknown): PaneNodeLike | undefined {
  if (layout === undefined || typeof paneId !== 'string' || paneId === '') return undefined
  const node = layout.nodes?.[paneId]
  if (node === undefined || node === null) return undefined
  if (node.kind !== 'pane') return undefined
  return node
}

/** 布局里的某个分栏节点(不存在 / 不是 split 返回 undefined)。 */
export function splitOf(layout: LayoutStateLike | undefined, splitId: unknown): SplitNodeLike | undefined {
  if (layout === undefined || typeof splitId !== 'string' || splitId === '') return undefined
  const node = layout.nodes?.[splitId]
  if (node === undefined || node === null) return undefined
  if (node.kind !== 'split') return undefined
  return node
}

/** 停靠面板(host === 'dock');浮窗(host === 'float')一律不算。 */
export function dockPaneOf(layout: LayoutStateLike | undefined, paneId: unknown): PaneNodeLike | undefined {
  const pane = paneOf(layout, paneId)
  if (pane === undefined) return undefined
  return pane.host === 'dock' ? pane : undefined
}

/** 布局里的全部停靠面板(dockkit `dockPaneIds` 同语义)。 */
export function dockPanes(layout: LayoutStateLike | undefined): readonly PaneNodeLike[] {
  const panes: PaneNodeLike[] = []
  if (layout === undefined) return panes
  for (const node of Object.values(layout.nodes ?? {})) {
    if (node === undefined || node === null) continue
    if (node.kind !== 'pane') continue
    if (node.host === 'dock') panes.push(node)
  }
  return panes
}

/** 在停靠面板里找承载某标签的那一个(dockkit `findTabPane` 同语义,浮窗跳过)。 */
export function paneOfTab(layout: LayoutStateLike | undefined, tabId: unknown): PaneNodeLike | undefined {
  if (typeof tabId !== 'string' || tabId === '') return undefined
  for (const pane of dockPanes(layout)) {
    if ((pane.tabs ?? []).includes(tabId)) return pane
  }
  return undefined
}

/** 某标签的记录(缺失返回 undefined)。 */
export function tabRecordOf(layout: LayoutStateLike | undefined, tabId: unknown): TabRecordLike | undefined {
  if (layout === undefined || typeof tabId !== 'string' || tabId === '') return undefined
  const record = layout.tabs?.[tabId]
  return record === undefined || record === null ? undefined : record
}

/** 这条标签是不是右侧栏文件浏览器的**页**(kind 或页地址任一命中)。 */
export function isFilesTab(record: TabRecordLike | undefined): boolean {
  if (record === undefined) return false
  return record.kind === FILES_KIND || record.contentId === FILES_PAGE_ADDRESS
}

/** 这条标签是不是 `dsh-resource://file/…` 这一类文件资源。 */
export function isFileResourceTab(record: TabRecordLike | undefined): boolean {
  if (record === undefined) return false
  return typeof record.contentId === 'string' && record.contentId.startsWith(FILE_ADDRESS_PREFIX)
}

/** 文件树所在面板里的文件树标签 id(没有就是 undefined)。 */
export function filesTabIn(pane: PaneNodeLike | undefined, layout: LayoutStateLike | undefined): string | undefined {
  if (pane === undefined) return undefined
  for (const tabId of pane.tabs ?? []) {
    if (isFilesTab(tabRecordOf(layout, tabId))) return tabId
  }
  return undefined
}

/** 文件树所在的停靠面板(全局唯一入口:先找到文件树标签,再定位它的面板)。 */
export function treePaneOf(layout: LayoutStateLike | undefined): PaneNodeLike | undefined {
  if (layout === undefined) return undefined
  for (const pane of dockPanes(layout)) {
    if (filesTabIn(pane, layout) !== undefined) return pane
  }
  return undefined
}

/**
 * 文件树旁边那一格(承载文件资源的停靠面板)。
 *
 * 判定与文件树面板**互斥**:一个面板同时装着文件树与文件资源时,它是文件树面板,
 * 不是文件面板 —— 那种现场属于「需要用 split 改造成分栏」的输入。
 *
 * 只作为 {@link siblingPaneOf} 的**后备**:上游给新分栏 seed 的默认页恰好就是文件树
 * (`defaultSeed` 在只有一个引导入口时选它),所以「用内容判定文件面板」在分栏现场里
 * 会把候选格全部排除掉。分栏存在时一律以兄弟格为准(见 {@link siblingPaneOf})。
 */
export function filePaneOf(layout: LayoutStateLike | undefined): PaneNodeLike | undefined {
  if (layout === undefined) return undefined
  for (const pane of dockPanes(layout)) {
    if (filesTabIn(pane, layout) !== undefined) continue
    for (const tabId of pane.tabs ?? []) {
      if (isFileResourceTab(tabRecordOf(layout, tabId))) return pane
    }
  }
  return undefined
}

/**
 * 与给定面板同处一个分栏的**兄弟格**(docking 树里另一个 child)。
 *
 * 上游 `planSplitPane` 把被分栏的原面板排在 children 前面、新面板放后面,所以
 * 「文件树面板的兄弟格」就是本插件新建的那一格 —— 这也是搬移文件时唯一可靠的落点:
 * 新格会被上游 seed 一个默认页(当前组合下恰好就是文件树本身),所以**不能**靠
 * 「这个格子里有没有文件树」来判定文件面板(见 {@link filePaneOf} 的说明)。
 *
 * 多个兄弟(理论上本产品不会产生,面板上限为 2)时返回第一个,不猜。
 */
export function siblingPaneOf(layout: LayoutStateLike | undefined, paneId: string): PaneNodeLike | undefined {
  if (layout === undefined) return undefined
  for (const node of Object.values(layout.nodes ?? {})) {
    if (node === undefined || node === null) continue
    if (node.kind !== 'split') continue
    if (!(node.children ?? []).includes(paneId)) continue
    for (const childId of node.children ?? []) {
      if (childId === paneId) continue
      const sibling = dockPaneOf(layout, childId)
      if (sibling !== undefined) return sibling
    }
  }
  return undefined
}

/**
 * `next` 相对 `prev` 新出现、且此刻停在 `pane` 里的文件资源标签。
 *
 * 「新出现」= 该标签 id 不在 `prev.tabs` 里(布局的标签字典就是全部标签的权威清单)。
 * 顺序跟随面板的标签顺序,调用方取第一个即可(一次提交通常只带来一个)。
 */
export function newFileTabsIn(
  prev: LayoutStateLike | undefined,
  next: LayoutStateLike | undefined,
  pane: PaneNodeLike | undefined,
): readonly string[] {
  if (prev === undefined || next === undefined || pane === undefined) return []
  const found: string[] = []
  for (const tabId of pane.tabs ?? []) {
    const before = prev.tabs?.[tabId]
    if (before !== undefined && before !== null) continue
    if (!isFileResourceTab(tabRecordOf(next, tabId))) continue
    found.push(tabId)
  }
  return found
}

/**
 * 判定一次「文件树里点开文件」要不要改造成分栏。
 *
 * @param prev - 上一次观察到的布局(插件侧维护的基线)。
 * @param next - 本次提交后的布局(权威快照)。
 * @returns 需要分栏/搬移时的计划;与本次打开无关(没有新开的文件、文件没落在文件树
 *   面板里、或文件树面板本身缺席)时返回 `undefined`。
 */
export function planSplitOpen(
  prev: LayoutStateLike | undefined,
  next: LayoutStateLike | undefined,
): SplitOpenPlan | undefined {
  if (prev === undefined || next === undefined) return undefined
  const treePane = treePaneOf(next)
  if (treePane === undefined) return undefined
  const opened = newFileTabsIn(prev, next, treePane)
  const fileTabId = opened[0]
  if (fileTabId === undefined) return undefined
  const filePane = filePaneOf(next)
  return filePane === undefined
    ? { treePaneId: treePane.id, fileTabId }
    : { treePaneId: treePane.id, fileTabId, filePaneId: filePane.id }
}

/**
 * 比例夹取:保证每一格都不低于 `min`(默认 = 上游最小分栏比例),
 * 并把和重新归一到 1(与 dockkit `es()` 同一算式,便于单测断言)。
 */
export function clampFractions(sizes: readonly number[], min: number = MIN_PANE_FRACTION): readonly number[] {
  if (sizes.length === 0) return []
  const floor = Math.min(Math.min(min, 1 / sizes.length), 1)
  const positives = sizes.map((size) => (size > 0 ? size : 0))
  const total = positives.reduce((sum, size) => sum + size, 0)
  let current = total > 0 ? positives.map((size) => size / total) : positives.map(() => 1 / sizes.length)
  const pinned = new Set<number>()
  for (;;) {
    const below = current.flatMap((size, index) => (!pinned.has(index) && size < floor ? [index] : []))
    if (below.length === 0) return current
    for (const index of below) pinned.add(index)
    const rest = 1 - pinned.size * floor
    const restTotal = current.reduce((sum, size, index) => (pinned.has(index) ? sum : sum + size), 0)
    current = current.map((size, index) => (pinned.has(index) ? floor : (size / restTotal) * rest))
  }
}

/**
 * 目标分栏比例(树侧在前 = 分栏节点的 children 顺序)。
 *
 * @param paneCount - 该分栏节点的 children 数量。2 时给 `[0.2, 0.8]`(1 : 4);
 *   其它数量(理论上本产品不产生,面板上限为 2)按最小比例均分后把**其余面板**平分,
 *   树侧仍取最小 —— 保证「文件树尽量窄」这一语义在任何形状下都成立。
 * @returns 长度为 `paneCount`、和恰为 1 的比例数组。
 */
export function targetSizes(paneCount: number): readonly number[] {
  if (!Number.isFinite(paneCount) || paneCount < 1) return []
  const count = Math.trunc(paneCount)
  if (count === 1) return [1]
  const tree = Math.min(TREE_RATIO + RATIO_EPSILON, 1 / count)
  if (count === 2) return [tree, 1 - tree]
  const rest = (1 - tree) / (count - 1)
  return [tree, ...Array.from({ length: count - 1 }, () => rest)]
}

/**
 * 该会话里「含文件树面板与文件面板的那个分栏节点」(调整比例的落点)。
 *
 * 只有当两者同属一个分栏时才有意义;找不到(还没分栏、或两格不在同一分栏)返回
 * `undefined`,调用方跳过调比例(布局仍可用,只是停在默认的 50/50)。
 */
export function splitHolding(
  layout: LayoutStateLike | undefined,
  paneIds: readonly (string | undefined)[],
): SplitNodeLike | undefined {
  if (layout === undefined) return undefined
  const wanted = paneIds.filter((paneId): paneId is string => typeof paneId === 'string' && paneId !== '')
  if (wanted.length === 0) return undefined
  for (const node of Object.values(layout.nodes ?? {})) {
    if (node === undefined || node === null) continue
    if (node.kind !== 'split') continue
    const children = node.children ?? []
    if (wanted.every((paneId) => children.includes(paneId))) return node
  }
  return undefined
}

/**
 * 该分栏节点里,「树侧」在 children 里的下标(树面板必须在最左/最前,比例才对应
 * 「树的宽度」)。缺席返回 -1。
 */
export function treeIndexIn(split: SplitNodeLike | undefined, treePaneId: string): number {
  if (split === undefined) return -1
  return (split.children ?? []).indexOf(treePaneId)
}

/**
 * 树侧在最前面的分栏,才写 `[0.2, 0.8]` 这一组比例。
 *
 * 上游 `planSplitPane` 把**被分栏的原面板**排在 children 前面、新面板放后面,而本插件
 * 总是在文件树面板上分栏,所以正常路径下树侧恒为 0。这里仍显式判定:若树侧不在首位
 * (例如用户先把文件拖到左侧格造成了反向现场),就不写比例 —— 宁可停在 50/50,也不把
 * 「0.2」误加到文件一侧,把文件压窄。
 *
 * @returns 可以直接交给 `resizeSplit` 的比例数组;不适用时 `undefined`。
 */
export function sizesForTreeFirst(split: SplitNodeLike | undefined, treePaneId: string): readonly number[] | undefined {
  if (split === undefined) return undefined
  if (treeIndexIn(split, treePaneId) !== 0) return undefined
  return targetSizes(split.children.length)
}
