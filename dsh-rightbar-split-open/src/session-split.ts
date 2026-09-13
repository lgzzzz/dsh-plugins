/**
 * dsh-rightbar-split-open — 执行层:把「文件树里点开文件」改造成「树 | 文件」分栏。
 *
 * ## 一次改造的动作(全部走上游公开面 / 公开写集)
 *
 * 1. `sidebarRight.split(树面板)` —— 与标签条「分栏」控件同一入口。它是唯一带**实测
 *    可行性判定**的入口(空间不够 / 面板预算已满 / 目标面板为空 → 返回 `undefined`),
 *    所以先问它;返回 `undefined` 就**不动作**,文件照上游默认行为留在树面板里。
 *    返回的是新面板 id(store 的 `settled` 回吐),因此后续步骤都是确定性的。
 * 2. store `placeTab(sessionId, 文件标签, 新面板, 0)` —— 与标签拖拽同一入口,dockkit
 *    跨面板时落地为 `moveTab`:标签不销毁、正文不重挂载(与「先关后开」有本质区别)。
 *    用 `placeTab` 而不是再调一次 `openResource({paneId})`,是因为后者默认
 *    `revealIfOpened: true` 会**跨分栏揭示**同一文件已开的那个标签,反而把焦点带走。
 * 3. store `resizeSplit(sessionId, splitId, [0.2, 0.8])` —— 与分隔条拖拽同一落点,
 *    就是我们想要的 1 : 4(见 split-open.ts 的说明)。
 * 4. store `focusTab(sessionId, 文件树标签)` —— 把活跃标签还给文件树,连续点开多个文件
 *    时不必每次回点树;树已是活跃标签时**不重复提交**(先读布局再决定)。
 *
 * ## 时序
 *
 * `split()` 与 store 的每个动作都是**同步提交**,所以三步可以顺序完成;唯一需要等的是
 * 「用户此前已经手动分过栏」那种现场 —— 那时不分栏,直接按 `plan.filePaneId` 搬移。
 * 没有定时器、没有轮询:一次打开最多读三次快照(split 前 / split 后写比例 / 搬移后)。
 *
 * 每一步写之前都**重新读布局做守卫**(打开与执行之间可能又发生了别的提交):
 * 文件标签已不在树面板就不搬(不误碰别的标签),分栏节点找不到就不写比例(宁可停在
 * 上游默认的 50/50,也不把 0.2 误加到文件一侧)。
 */
import { dockPaneOf, filesTabIn, paneOfTab, siblingPaneOf, sizesForTreeFirst, splitHolding } from './split-open.ts'
import { readLayout, type SidebarRightSplitLike, type SplitOpenEvent } from './rightbar.ts'
import type { LayoutStateLike, RightbarStoreLike } from './types.ts'

/** store 写集里本插件用到的动词(缺任一即跳过对应步骤,不降级到别的入口)。 */
interface WriteActions {
  readonly placeTab?: (sessionId: string, tabId: string, paneId: string, index: number) => void
  readonly resizeSplit?: (sessionId: string, splitId: string, sizes: readonly number[]) => void
  readonly focusTab?: (sessionId: string, tabId: string) => void
  readonly closeTab?: (sessionId: string, tabId: string) => void
}

/**
 * 创建改造处理器。
 *
 * @param sidebarRight - 控制器公开面(只用 `split`);缺席时整体 no-op。
 * @returns 可装到 `installSessionWiring` 的 `onOpen` 上。
 */
export function createSplitHandler(sidebarRight: SidebarRightSplitLike | undefined): (event: SplitOpenEvent) => void {
  return (event: SplitOpenEvent): void => {
    try {
      handleOpen(sidebarRight, event)
    } catch (error) {
      // 上游在「无挂载会话面」等情况下抛错:兜住并保持沉默 —— 布局仍是上游默认形态。
      console.warn('[dsh-rightbar-split-open] split-open failed:', error)
    }
  }
}

/** 一次打开:树已在分栏里就搬到兄弟格,否则先分栏再搬。 */
function handleOpen(sidebarRight: SidebarRightSplitLike | undefined, event: SplitOpenEvent): void {
  const { sessionId, store, layout, plan } = event
  if (typeof sidebarRight?.split !== 'function') return

  // 树面板已经在分栏里(用户此前手动分过、或本插件之前分过):直接搬到兄弟格。
  // 优先取兄弟格而不是 plan.filePaneId 的内容判定 —— 兄弟格是确定的,而内容判定在
  // 「新格也被 seed 了文件树」的真实布局里给不出答案(见 closeSeededPage)。
  const sibling = siblingPaneOf(layout, plan.treePaneId)
  if (sibling !== undefined) {
    placeFileTab(store, sessionId, plan.fileTabId, sibling.id, plan.treePaneId)
    focusTree(store, sessionId, plan.treePaneId)
    return
  }

  // 用户此前用别的格当过文件面板(树旁边那一格没有文件树、却有文件标签):沿用它。
  if (plan.filePaneId !== undefined) {
    placeFileTab(store, sessionId, plan.fileTabId, plan.filePaneId, plan.treePaneId)
    focusTree(store, sessionId, plan.treePaneId)
    return
  }

  const created = splitPane(sidebarRight, plan.treePaneId)
  if (created === undefined) return

  const afterSplit = readLayout(store, sessionId)
  if (afterSplit !== undefined) applyRatioIfTreeFirst(store, sessionId, afterSplit, plan.treePaneId)
  // `created` 是上游刚为这次分栏新建的格:它会被 planSettle 用一个默认页 seed
  // (当前组合下那个默认页就是文件树本身),搬完文件后要把那一枚 seed 关掉 —— 见
  // closeSeededPage。
  placeFileTab(store, sessionId, plan.fileTabId, created, plan.treePaneId, true)
  focusTree(store, sessionId, plan.treePaneId)
}

/**
 * 分栏:走控制器的 `split()`(带实测可行性判定与 `settled` 回吐的新面板 id)。
 * 上游对空面板 / 预算已满 / 放不下返回 `undefined`;此处不再回退到 store 动作。
 */
function splitPane(sidebarRight: SidebarRightSplitLike, treePaneId: string): string | undefined {
  const split = sidebarRight.split
  if (typeof split !== 'function') return undefined
  let created: unknown
  try {
    created = split.call(sidebarRight, treePaneId)
  } catch {
    // 无挂载会话面时控制器 require() 抛错 → 不动作。
    return undefined
  }
  return typeof created === 'string' && created !== '' ? created : undefined
}

/**
 * 把文件标签搬进目标面板(跨面板时 dockkit 落地为 `moveTab`)。
 *
 * 守卫:文件标签此刻必须**仍在树面板**里 —— 登记到执行之间它可能已被关掉或已被搬走,
 * 那时不做任何事(绝不误搬别的标签)。index 0 = 排在该面板标签条最前面。
 *
 * @param closeSeed - 该目标面板是不是**本插件刚为这次打开新建的格**。是则搬完之后
 *   把上游 seed 进来的默认页关掉(见 {@link closeSeededPage})。
 */
function placeFileTab(
  store: RightbarStoreLike,
  sessionId: string,
  fileTabId: string,
  targetPaneId: string,
  treePaneId: string,
  closeSeed = false,
): void {
  const actions = store.actions as WriteActions | undefined
  const placeTab = actions?.placeTab
  if (actions === undefined || actions === null || typeof placeTab !== 'function') return
  const fresh = readLayout(store, sessionId)
  if (fresh === undefined) return
  if (dockPaneOf(fresh, targetPaneId) === undefined) return
  const holder = paneOfTab(fresh, fileTabId)
  if (holder === undefined || holder.id !== treePaneId) return
  try {
    placeTab.call(actions, sessionId, fileTabId, targetPaneId, 0)
  } catch {
    // 上游拒绝(目标面板是浮窗 / 标签不存在)→ 保持现状。
    return
  }
  if (closeSeed) closeSeededPage(store, sessionId, targetPaneId, treePaneId)
}

/**
 * 关掉上游给**新分栏** seed 的那一枚默认页。
 *
 * 为什么会有这一枚:上游 store 的每个动作都过 `advance()` -> `planSettle()`,而
 * `planSettle` 会给「展开态下空着的停靠格」补一个默认页;默认页由 `defaultSeed`
 * 决定 —— 当前组合里只有一个引导入口(`files`),于是默认页就是**文件树本身**。
 * 结果是新分栏落地时自带一枚文件树标签(用户看到的就是「文件面板里多出一个 file
 * 标签」)。它只是 seed,不是用户开的,搬完文件后由本插件收掉。
 *
 * 安全边界(全部先读布局再决定):
 * - 只在**本插件这次新建的格**上做(调用方传 `closeSeed`),用户自己分的栏/自己放的
 *   文件树标签一律不碰;
 * - 只关**页类型**标签(kind 或页地址命中文件树),且该格**已持有文件标签**
 *   (搬移成功才会走到这里),因此不会把这一格关空;
 * - 该标签若恰好是「唯一的停靠标签」,上游 `closeTab` 会连带收起整列 —— 那种现场
 *   不可能出现(此刻至少还有树面板那一格),但仍交给上游的 `canCloseTab` 判定,
 *   它拒绝时什么都不会发生。
 */
function closeSeededPage(
  store: RightbarStoreLike,
  sessionId: string,
  paneId: string,
  treePaneId: string,
): void {
  if (paneId === treePaneId) return
  const actions = store.actions as WriteActions | undefined
  const closeTab = actions?.closeTab
  if (actions === undefined || actions === null || typeof closeTab !== 'function') return
  const fresh = readLayout(store, sessionId)
  if (fresh === undefined) return
  const pane = dockPaneOf(fresh, paneId)
  if (pane === undefined) return
  const seeded = filesTabIn(pane, fresh)
  if (seeded === undefined) return
  try {
    closeTab.call(actions, sessionId, seeded)
  } catch {
    // 上游拒绝(不存在 / 不能关)→ 留着一枚 seed,不影响功能。
  }
}

/**
 * 树侧在分栏最前面时写入 1 : 4 比例。
 *
 * 上游 `planSplitPane` 把被分栏的原面板排在 children 前面、新面板放后面,而本插件总是
 * 在文件树面板上分栏,所以正常路径下树侧恒为 0。这里仍显式判定(见
 * `sizesForTreeFirst`):树侧不在首位就不写比例,宁可停在 50/50,也不把文件压窄。
 */
function applyRatioIfTreeFirst(
  store: RightbarStoreLike,
  sessionId: string,
  layout: LayoutStateLike,
  treePaneId: string,
): void {
  const split = splitHolding(layout, [treePaneId])
  if (split === undefined) return
  const sizes = sizesForTreeFirst(split, treePaneId)
  if (sizes === undefined) return
  const actions = store.actions as WriteActions | undefined
  const resize = actions?.resizeSplit
  if (actions === undefined || actions === null || typeof resize !== 'function') return
  try {
    resize.call(actions, sessionId, split.id, sizes)
  } catch {
    // 分栏节点在这两次读之间消失 / 形状不符 → 跳过。
  }
}

/**
 * 把活跃标签还给文件树(便于连续点开文件)。
 *
 * 树已经是活跃标签时**不提交**:上游 `focusTab` 对「已经活跃」的计划为空、不记录历史,
 * 但先读布局可以省掉一次无意义的跨模块调用,也让行为更容易断言。
 */
function focusTree(store: RightbarStoreLike, sessionId: string, treePaneId: string): void {
  const actions = store.actions as WriteActions | undefined
  const focusTab = actions?.focusTab
  if (actions === undefined || actions === null || typeof focusTab !== 'function') return
  const layout = readLayout(store, sessionId)
  if (layout === undefined) return
  const treePane = dockPaneOf(layout, treePaneId)
  const treeTabId = filesTabIn(treePane, layout)
  if (treeTabId === undefined) return
  if (treePane?.activeTabId === treeTabId) return
  try {
    focusTab.call(actions, sessionId, treeTabId)
  } catch {
    // 忽略:焦点是收尾动作,失败不影响分栏与比例。
  }
}
