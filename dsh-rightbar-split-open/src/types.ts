/**
 * dsh-rightbar-split-open — 运行时服务与上下文的最小结构类型切片。
 *
 * 依据 AGENTS.md「类型解析约定」:`dsh-client-ui-slots` / `dsh-client-store` /
 * `dsh-client-ui-dockkit` 等类型包不全,这里自行声明结构切片,仅覆盖本插件实际
 * 消费的字段,以 <dsh>/node_modules/@deepseek-ai 各包 lib 的构建产物为核实依据:
 *
 * - `@deepseek-ai/dsh-client-ui-dockkit` 的 `LayoutState` / `TabRecord` /
 *   `PaneNode` / `SplitNode`(见 dsh-web-frontend 内联的 dockkit 运行时:
 *   `{ nodes, tabs, rootId, floats, activePaneId, expanded, mode }`,split 节点带
 *   `axis` 与 `sizes`);
 * - `@deepseek-ai/dsh-client-ui-sidebar-right` 的 `createSidebarRightStore`
 *   快照(slot store 三步范式的第 3 步产物,见其 stores.d.ts 与 service.d.ts)。
 */

/** apply(ctx) 的运行时上下文最小面。 */
export interface ClientContext {
  get?(name: string): unknown
  effect?(callback: () => void | (() => void)): void
}

/** 布局里的一条标签记录(见 dockkit `TabRecord`;只消费 id/kind/contentId)。 */
export interface TabRecordLike {
  id: string
  kind: string
  contentId: string
  title?: string
}

/**
 * 面板节点(见 dockkit `PaneNode`)。
 * `host === 'dock'` 才是右栏里的停靠面板,`'float'` 是独立浮窗(本插件不碰)。
 */
export interface PaneNodeLike {
  kind: 'pane'
  id: string
  host: string
  tabs: readonly string[]
  activeTabId?: string
}

/**
 * 分栏节点(见 dockkit `SplitNode`)。
 * `sizes` 与 `children` 等长、和为 1,渲染端直接把它当 flexGrow(`h7()` 的
 * `style:{flexGrow: c[p]}`),因此「改比例」= 写这个数组。
 */
export interface SplitNodeLike {
  kind: 'split'
  id: string
  axis: string
  children: readonly string[]
  sizes: readonly number[]
}

/** 一个会话的停靠布局(见 dockkit `LayoutState`;只消费本插件读写的字段)。 */
export interface LayoutStateLike {
  nodes: Readonly<Record<string, PaneNodeLike | SplitNodeLike | undefined>>
  tabs: Readonly<Record<string, TabRecordLike | undefined>>
  rootId: string
  activePaneId: string
  expanded: boolean
}

/** 一个会话的停靠面(见 sidebar-right 的 `SurfaceState`;只消费 layout)。 */
export interface SurfaceStateLike {
  layout: LayoutStateLike
}

/**
 * `createSidebarRightStore()` 的快照(见 sidebar-right 的 `SidebarRightState`):
 * 会话 id → 该会话的停靠面。取自 `slots.entries('rightbar.session')` 注册项上的
 * store handle(会话级,需 `uiSession.resolve(sessionId)` 作用域绑定后
 * `slots.resolveStore`)。
 */
export interface RightbarSnapshotLike {
  bySession?: Readonly<Record<string, SurfaceStateLike | undefined>>
}

/**
 * 右侧栏会话级 store 的动作面(仅本插件用到的三个动词;见 sidebar-right
 * stores.d.ts 的 `SidebarRightActions`)。
 *
 * - `splitPane(sessionId, paneId?, settled?)`:与标签条「分栏」控件同一入口
 *   (seat 的 `intentsFor.splitPane`);上游在「已有 2 个停靠面板 / 目标面板为空 /
 *   超过面板预算 / 空间不足」时计划为空、不产生提交,此时 `settled` **不会**被调用
 *   (见 stores.d.ts 的 `settled` 约定:`next !== s` 才回吐新面板 id);
 * - `placeTab(sessionId, tabId, toPaneId, index)`:与标签拖拽同一入口,跨面板时由
 *   dockkit 落地为 `moveTab`(标签本身不销毁,与本插件「把刚打开的文件搬到新面板」
 *   的需求正好吻合);
 * - `resizeSplit(sessionId, splitId, sizes)`:与分隔条拖拽同一落点,上游调用
 *   dockkit 的 `planResizeSplit(splitId, sizes, 0.2)`,即**最小分栏比例 0.2**
 *   (→ 1:4 = [0.2, 0.8] 恰在上游允许的边界上,这是本插件选 1:4 的依据)。
 */
export interface RightbarActionsLike {
  splitPane?(sessionId: string, paneId?: string, settled?: (paneId: string) => void): void
  placeTab?(sessionId: string, tabId: string, paneId: string, index: number): void
  resizeSplit?(sessionId: string, splitId: string, sizes: readonly number[]): void
  focusTab?(sessionId: string, tabId: string): void
}

/**
 * `slots.resolveStore(handle, binding)` 返回的**活实例**(defineStore 的实例面:
 * `{ actions, getSnapshot, subscribe }`,见 dsh-client-store 的 defineStore)。
 * 与 seat 正在画的那份内存态**同一实例**:外部写入后 React 订阅者立即重渲染。
 */
export interface RightbarStoreLike {
  getSnapshot(): RightbarSnapshotLike
  subscribe?(listener: () => void): () => void
  actions?: RightbarActionsLike
}

/** slots 注册项(承载右栏 store handle 的那一项)。 */
export interface SlotEntryLike {
  store?: unknown
}

/** slots 服务(SlotRegistry)消费面。 */
export interface SlotsLike {
  entries?(key: string): readonly SlotEntryLike[]
  resolveStore?(handle: unknown, scopeBinding: unknown): unknown
}

/**
 * `uiSession` 服务消费面。
 *
 * `resolve(sessionId)` 取该会话**已物化的作用域绑定**(`{ key, ctx, hooks,
 * keyedHooks, props }`)——它内部就调了 `slots.bindStoreScope`,所以「会话级 store
 * 何时可解析」这件事唯一的公开信号就是「`uiSession.resolve` 何时被调用」。
 * 本插件因此在这一层做动作挂载(见 rightbar.ts 的 `installSessionWiring`)。
 */
export interface UiSessionLike {
  resolve?: (sessionId: string) => unknown
  [key: string]: unknown
}

/** 右侧栏 tab 页类型的 kind(dsh-client-ui-sidebar-files 注册的页类型)。 */
export type FilesKind = 'files'
