/** 运行时服务 / 上下文的最小结构类型切片,只含本插件消费的字段;取数不可用即 no-op,不回退 DOM。 */

export interface ClientContext {
  get?(name: string): unknown
  effect?(callback: () => void | (() => void)): void
}

export interface PendingQuestionOptionLike {
  label: string
  description?: string
}

/** 计划评审由 intent.kind === 'plan-review' 标识。 */
export interface PendingQuestionItemLike {
  id: string
  question?: string
  detail?: string
  header?: string
  options?: readonly PendingQuestionOptionLike[]
  multiSelect?: boolean
  intent?: { kind?: string; approve?: string }
}

/** 待处理交互(审批 / 问答 / 计划评审共用形态)。 */
export interface PendingInteractionLike {
  kind?: string
  key?: string
  sessionId?: string
  /** 题目列表(审批载体无此字段)。 */
  questions?: readonly PendingQuestionItemLike[]
  answer?(payload: unknown): Promise<void> | void
  cancel?(): Promise<void> | void
}

/** uiSession 待处理交互的公开观察面;私有回退字段 pendingSnapshot 见下。 */
export interface PendingInteractionsLike {
  getSnapshot?(): ReadonlyMap<string, PendingInteractionLike>
}

/** 会话状态行(running / 待处理交互 / 完成未读)。 */
export interface SessionStatusLike {
  running?: boolean
  pendingInteraction?: PendingInteractionLike
  /** 已结束未查看(替代 0.1.6-alpha.1 的 summary.completed)。 */
  completionUnread?: boolean
}

/** id → 会话状态的可观察表。 */
export interface SessionStatusSourceLike {
  getSnapshot?(): ReadonlyMap<string, SessionStatusLike> | undefined
}

/** 会话作用域绑定源:上游只校验 reference.binding 与 sessions.binding(sessionId) 同一。 */
export interface SessionReferenceLike {
  sessionId: string
  binding: SessionBindingLike
}

/** uiSession:当前会话绑定源 + bindingSource 取已物化的作用域绑定(供 slots.resolveStore 解析会话级 store)。 */
export interface UiSessionLike {
  pendingInteractions?: PendingInteractionsLike
  pendingSnapshot?: ReadonlyMap<string, PendingInteractionLike>
  /** 视图层当前会话绑定源(0.1.6-alpha.2 起选择权在此);getSnapshot().key 即会话 id,缺席为 undefined。 */
  current?: { getSnapshot?(): ScopeBindingLike | undefined }
  /** 会话状态源:completionUnread 替代已删除的 summary.completed。 */
  sessionStatus?: SessionStatusSourceLike
  /** 物化一个会话的作用域绑定(0.1.6-alpha.2 起替代已删除的 resolve(sessionId));缺席投影的 key 为 undefined。 */
  bindingSource?(reference: SessionReferenceLike): { getSnapshot?(): unknown } | undefined
}

/** 作用域绑定最小面(key = 会话 id,ctx = 该作用域上下文)。 */
export interface ScopeBindingLike {
  key?: string
  ctx?: unknown
}

export interface SessionSummaryLike {
  id: string
  displayTitle?: string
  title?: string
  cwd?: string
  running?: boolean
  /** 本地引用来源计数(0.1.6-alpha.2 起):mainView > 0 即主视图当前持有的会话。 */
  retainedBy?: { mainView?: number }
  blank?: boolean
  updatedAt?: number
  /** 粗粒度持久来源(过滤子代理用);**fork 缺席**(与上游 `runningDescendants` 同判据)。 */
  origin?: string
  /** 直系父会话(0.1.7-alpha.1 起投影行必带);顶层会话缺席。**fork 行同样带,故不能单凭它判子代理**。 */
  parentId?: string
}

export interface WorkspaceItemLike {
  workspaceId: string
  path?: string
  title?: string
  /** 宿主记录的会话归属顺序(组内默认序)。 */
  sessionIds?: readonly string[]
  createdAt?: string
  updatedAt?: string
}

export interface WorkspaceSnapshotLike {
  items?: readonly WorkspaceItemLike[]
  archivedSessionIds?: readonly string[]
  /** 置顶会话集合(0.1.7-alpha.1 新增);缺席按空集。 */
  pinnedSessionIds?: readonly string[]
  /** 列表到达生命周期:pending / ready。 */
  phase?: string
}

export interface WorkspacesLike {
  list?: { getSnapshot?(): WorkspaceSnapshotLike }
}

/* ---- 近期对话浮窗(⌘/Ctrl+I):列表取数 + 打开落点 ---- */

/** 近期对话行(纯展示数据)。 */
export interface RecentSessionRowLike {
  sessionId: string
  label: string
  /** 次行('' = 省略)。 */
  detail: string
  current: boolean
  running: boolean
  completed: boolean
  pending: boolean
}

/** 一个工作区分组(无归属桶 label 为空串)。 */
export interface RecentSessionGroupLike {
  workspaceId: string
  label: string
  /** 组内会话行(最近更新在前)。 */
  rows: readonly RecentSessionRowLike[]
}

export interface RecentSessionsViewLike {
  /** 分组(空组已剔除;无归属桶在最后;全局最多 10 行)。 */
  groups: readonly RecentSessionGroupLike[]
  /** 可选中行的展平顺序(供 ↑/↓ 与 Enter 定位)。 */
  rows: readonly RecentSessionRowLike[]
  /** 初始高亮下标(当前会话所在行;缺失为 0)。 */
  initialIndex: number
  /** 无行时的提示文本('' = 有行)。 */
  notice: string
}

/* ---- 工作区浮窗(⌘/Ctrl+K):列表取数 + 切换落点 ---- */

/** 工作区行(纯展示数据)。 */
export interface WorkspaceRowLike {
  workspaceId: string
  /** 主标签:title → 路径末段 → 原路径。 */
  label: string
  /** 次行:规范路径(与 label 相同则留空)。 */
  detail: string
  sessionCount: number
  current: boolean
}

/** UiWorkspace 服务消费面:openWorkspace / startSession / openSession。 */
export interface UiWorkspaceLike {
  openSession?(sessionId: string): void
  openWorkspace?(workspaceId: string, beforeOpen?: (sessionId: string) => void): Promise<void> | void
  startSession?(workspaceId?: string): void
}

/* ---- 侧栏 workspace 浏览器视图状态:会话排序的权威来源 ---- */

/** 置顶 / 归档全局集合(上游 rowState 的 orderState 部分;两者缺席按空集)。 */
export interface RowStateLike {
  archivedSessionIds?: readonly string[]
  pinnedSessionIds?: readonly string[]
}

/** 侧栏 workspace 浏览器的视图 store 状态(持久化键 dsh.workspace.view.v5)。 */
export interface WorkspaceViewStateLike {
  /** 分组方式:workspace(默认) / flat。 */
  groupBy?: string
  /** 排序方式:manual / updated(默认)。 */
  orderBy?: string
  groupExpansion?: Readonly<Record<string, boolean | undefined>>
  /** 组 key → 本地会话顺序账号。 */
  sessionOrderByAccount?: Readonly<Record<string, readonly string[] | undefined>>
  /** 归档筛选(0.1.7-alpha.1 新增):default 隐藏 / show 一并显示 / only 仅归档;缺席按 default。 */
  archivedFilter?: string
}

export interface StoreInstanceLike {
  getSnapshot?(): unknown
}

/** defineStore 返回的 store handle:spec.persist 为持久化键,create() 建实例。 */
export interface StoreHandleLike {
  spec?: { persist?: string }
  create?(scopeKey?: string): StoreInstanceLike
  getSnapshot?(): unknown
}

/** slots 注册项(store handle 挂在这里)。 */
export interface SlotEntryLike {
  /** 注册选项(keyed slot 的 cell key 在这里;用于按实现包身份认注册项)。 */
  options?: { key?: string; id?: string; order?: number; priority?: number }
  store?: StoreHandleLike
  /** chain slot 路由选择器(注册项自带)。 */
  select?(owner: unknown): unknown
}

/** 通用问答卡片草稿(唯一真源在卡片的 slot store)。 */
export interface QuestionDraftLike {
  selected: string[]
  custom: string
  skipped: boolean
}

export interface QuestionProgressLike {
  index: number
  drafts: QuestionDraftLike[]
}

/** 草稿 store 快照(requestKey 标记属于哪一次请求)。 */
export interface QuestionDraftSnapshotLike {
  requestKey?: string
  progress?: QuestionProgressLike
}

export interface QuestionDraftActionsLike {
  replace?(requestKey: string, progress: QuestionProgressLike): void
  clear?(requestKey: string): void
}

export interface QuestionDraftStoreLike extends StoreInstanceLike {
  actions?: QuestionDraftActionsLike
}

/** slots 服务:entries → 会话作用域绑定(scope-binding.ts) → resolveStore 三步取活实例,与渲染同一份内存态。 */
export interface SlotsLike {
  entries?(key: string): readonly SlotEntryLike[]
  resolveStore?(handle: unknown, scopeBinding: unknown): StoreInstanceLike | undefined
}

export interface SessionSnapshotLike {
  running?: boolean
  /** 直系父地址;普通会话为 null。 */
  subagent?: { address?: { mode?: string } } | null
}

export interface SessionFaceLike {
  getSnapshot?(): SessionSnapshotLike
  cancel?(): Promise<unknown> | void
}

/** sessions.binding(id) 结果;ctx 为该会话的作用域上下文。 */
export interface SessionBindingLike {
  session?: SessionFaceLike
  ctx?: unknown
}

/** 子代理名册的一行(0.1.7-alpha.1 投影面;仅 id 与一次性/可续跑模式)。 */
export interface SubagentCatalogEntryLike {
  id?: string
  mode?: string
}

/** 一个会话的投影值(子代理名册由 subagentCatalog 提供)。 */
export interface SessionProjectionLike {
  values?: { subagentCatalog?: readonly SubagentCatalogEntryLike[] }
}

export interface SessionListSnapshotLike {
  ids?: readonly string[]
  byId?: Readonly<Record<string, SessionSummaryLike>>
  /** 按父会话聚合的投影(0.1.7-alpha.1 起取代已删除的 subagentsByParent)。 */
  projectionsBySession?: Readonly<Record<string, SessionProjectionLike | undefined>>
}

export interface SessionsLike {
  list?: { getSnapshot?(): SessionListSnapshotLike }
  binding?(sessionId: string): SessionBindingLike | undefined
  /** 子代理地址(普通会话 = undefined);上游据此判定可否选模型。 */
  subagentAddress?(sessionId: string): unknown
}

/** layout 服务:只消费 toggleSidebar(开关左栏)。 */
export interface LayoutLike {
  toggleSidebar?(): void
}

/** 打开落点;无 index,置顶只能经 store 的 placeTab。 */
export interface SidebarRightPlacementLike {
  paneId?: string
  /** 顶掉该标签槽位并在同一步关掉它。 */
  replaceTab?: string
  /** 资源 tab 是否按 (kind, contentId) 揭示已开项。 */
  revealIfOpened?: boolean
}

/** sidebarRight 服务:开关右栏 / 聚焦标签 / 按 kind 开页(openTab 自带展开)。 */
export interface SidebarRightLike {
  toggleExpanded?(): void
  isExpanded?(): boolean
  active?(): SidebarRightTabRecordLike | undefined
  /** 聚焦标签(与 chip 点击同一入口);标签不存在则静默跳过。 */
  focus?(tabId: string): void
  /** 关闭一个标签(与 chip 的关闭按钮同一入口);上游自带关闭钩子与「独占停靠的 guide 不关」判定。 */
  close?(tabId: string): void
  /** 按 kind 开页并展开右栏;页类型按目标面板去重。 */
  openTab?(kind: string, options?: SidebarRightPlacementLike): void
}

/* ---- 右栏标签切换(⌘/Ctrl+Alt+←/→):会话级 slot store ---- */

/** 标签记录(只消费 id)。 */
export interface SidebarRightTabRecordLike {
  id: string
  kind?: string
  title?: string
  contentId?: string
}

/** 布局节点(只消费 pane 分支的 tabs / activeTabId)。 */
export interface SidebarRightLayoutNodeLike {
  kind?: string
  host?: string
  id?: string
  tabs?: readonly string[]
  activeTabId?: string
}

/** 呈现方式(dockkit `DockMode`):`push` 占轨道、`fullscreen` 覆盖窗口。 */
export type SidebarRightDockMode = 'push' | 'fullscreen'

export interface SidebarRightLayoutLike {
  nodes?: Readonly<Record<string, SidebarRightLayoutNodeLike | undefined>>
  tabs?: Readonly<Record<string, SidebarRightTabRecordLike | undefined>>
  activePaneId?: string
  rootId?: string
  expanded?: boolean
  /** 手动呈现方式(dockkit 初始状态恒为 'push',只经 `setMode` 写入)。 */
  mode?: SidebarRightDockMode
}

export interface SidebarRightSurfaceLike {
  layout?: SidebarRightLayoutLike
}

/** 右栏会话级 store 快照(slot 'rightbar.session' handle,需作用域绑定)。 */
export interface SidebarRightTabsStateLike {
  bySession?: Readonly<Record<string, SidebarRightSurfaceLike | undefined>>
}

/* ---- 右栏会话级 store 的写面(⌘/Ctrl+\ 置顶文件浏览器、⌘/Ctrl+S 切全屏) ---- */

/** store 动作面:placeTab 是标签拖拽同一入口、setMode 是面板全屏按钮同一入口
 * (均需会话作用域绑定;仅窄窗退出全屏时会连带 setExpanded(false))。 */
export interface SidebarRightSurfaceActionsLike {
  placeTab?(sessionId: string, tabId: string, paneId: string, index: number): void
  setMode?(sessionId: string, mode: SidebarRightDockMode): void
  setExpanded?(sessionId: string, expanded: boolean): void
}

/** resolveStore 返回的活实例:除快照外还要 actions 才能写。 */
export interface SidebarRightStoreLike extends StoreInstanceLike {
  actions?: SidebarRightSurfaceActionsLike
}

/* ---- 右栏「变更审阅」diff / 文档预览的视图开关(⌘/Ctrl+D 换行;diff 分栏由 ⌘/Ctrl+S 触发同步) ---- */

/** 视图 store 的写面(tabId = 右栏标签 id;两侧的按钮走同一入口)。 */
export interface RightbarViewActionsLike {
  /** 变更审阅:左右对比 ⇄ 单栏对比。 */
  toggledSplit?(tabId: string): void
  /** 变更审阅 / 文档预览:自动换行开关。 */
  toggledWrap?(tabId: string): void
}

/** 一个页 body 的会话级 store 快照:byTab[tabId] 为该标签的视图状态桶。 */
export interface RightbarViewStateLike {
  byTab?: Readonly<Record<string, unknown>>
}

/** resolveStore 返回的视图 store 活实例。 */
export interface RightbarViewStoreLike extends StoreInstanceLike {
  actions?: RightbarViewActionsLike
}

/* ---- 输入框聚焦(⌘/Ctrl+J):conversation → composer editor ---- */

/** composer 的 contenteditable 宿主元素;只声明 focus / contains,引用来自服务链路。 */
export interface ComposerEditableLike {
  focus?(options?: { preventScroll?: boolean }): void
  contains?(node: unknown): boolean
}

/** shell 的 Lexical editor:只用 getRootElement()(focus() 不是 DOM 聚焦原语)。 */
export interface ComposerEditorLike {
  getRootElement?(): ComposerEditableLike | null
}

export interface SessionInputShellLike {
  editor?: ComposerEditorLike
}

/** InputHub:for(actx) / shell(id) 取会话 input facade。 */
export interface InputHubLike {
  for?(actx: unknown): SessionInputShellLike | undefined
  shell?(id: string): SessionInputShellLike | undefined
}

export interface ConversationLike {
  input?: InputHubLike
}

/** 本插件解析后的服务集合(判空后才装入)。 */
export interface Services {
  sessions: SessionsLike | undefined
  uiSession: UiSessionLike | undefined
  /** layout:开关左栏(⌘/Ctrl+B)。 */
  layout: LayoutLike | undefined
  /** sidebarRight:开关右栏(⌘/Ctrl+O)。 */
  sidebarRight: SidebarRightLike | undefined
  workspaces: WorkspacesLike | undefined
  /** slots:读侧栏视图 store(会话跳转顺序)。 */
  slots: SlotsLike | undefined
  /** conversation:取 composer editor(⌘/Ctrl+J)。 */
  conversation: ConversationLike | undefined
  /** uiWorkspace:工作区浮窗(⌘/Ctrl+K)、新建会话(⌘/Ctrl+N)。 */
  uiWorkspace: UiWorkspaceLike | undefined
  /** modelDirectories:模型浮窗(⌘/Ctrl+M)、强度循环(⇧Tab)。 */
  modelDirectories: ModelDirectoryResolverLike | undefined
}

/* ---- 模型浮窗(⌘/Ctrl+M)与强度循环(⇧Tab):会话级模型目录 ---- */

export interface ModelSelectionLike {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface ModelReasoningEffortLike {
  id: string
  name?: string
  description?: string
}

export interface ModelReasoningLike {
  efforts?: readonly ModelReasoningEffortLike[]
  defaultEffort?: string
}

export interface ModelCatalogModelLike {
  id: string
  name?: string
  description?: string
  reasoning?: ModelReasoningLike
}

export interface ModelProviderGroupLike {
  id: string
  name?: string
  models?: readonly ModelCatalogModelLike[]
}

/** 加载失败的提供方(不可选中)。 */
export interface ModelCatalogFailureLike {
  id: string
  name?: string
  message?: string
}

export interface ModelDirectoryStateLike {
  current?: ModelSelectionLike | null
  routable?: boolean | null
  groups?: readonly ModelProviderGroupLike[]
  failures?: readonly ModelCatalogFailureLike[]
  status?: string
  error?: string | null
}

/** 目录的共享快照 store。 */
export interface ModelDirectoryStoreLike {
  getSnapshot?(): ModelDirectoryStateLike
}

/** 一个会话的共享模型目录:load() 拉取,select() 提交。 */
export interface ModelDirectoryLike {
  store?: ModelDirectoryStoreLike
  load?(): Promise<ModelDirectoryStateLike>
  select?(selection: ModelSelectionLike): Promise<void>
}

/** ctx.modelDirectories:directoryFor(id) 取 per-session 目录(与上游两入口同一实例)。 */
export interface ModelDirectoryResolverLike {
  directoryFor?(sessionId: string): ModelDirectoryLike | undefined
}

export interface ModelPickerRowLike {
  /** 该行的完整选择(含推理强度)。 */
  selection: ModelSelectionLike
  label: string
  detail: string
  /** 分组显示名(同组行共用)。 */
  provider: string
  current: boolean
}

export interface ModelPickerCurrentLike {
  /** 模型名(找不到时回退 provider/model)。 */
  label: string
  /** 强度显示名('' = 无强度档)。 */
  effort: string
}

export interface ModelPickerViewLike {
  current: ModelPickerCurrentLike | null
  rows: readonly ModelPickerRowLike[]
  /** 无行时的提示文本('' = 有行)。 */
  notice: string
  /** 列表下方小字('' = 无)。 */
  footnote: string
}

/** ⇧Tab 循环思考强度的结果。 */
export interface EffortCycleResultLike {
  /** 是否提交了新选择(false = no-op,分发器据此不吞键)。 */
  ok: boolean
  /** 切换后的强度显示名('' = 未切换)。 */
  effortLabel: string
}

