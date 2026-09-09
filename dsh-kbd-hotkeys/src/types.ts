/**
 * dsh-kbd-hotkeys — 运行时服务与上下文的最小结构类型切片。
 *
 * 依据 AGENTS.md「类型解析约定」:`dsh-client-ui-slots` / `dsh-client-ui-primitives`
 * 等类型包不全,这里按 dsh-change-summary/src/client 的模板自行声明结构切片,
 * 仅覆盖本插件实际消费的字段,以 <dsh>/node_modules/@deepseek-ai 各包 lib 的
 * 构建产物为核实依据(见 docs/dsh-hotkeys-proposal.md 第 5 节)。
 */

/** apply(ctx) 的运行时上下文最小面。 */
export interface ClientContext {
  get?(name: string): unknown
  effect?(callback: () => void | (() => void)): void
}

/** 问答请求里的一个选项(见 dsh-user-questions/lib/types/types.d.ts AskUserQuestionOption)。 */
export interface PendingQuestionOptionLike {
  label: string
  description?: string
}

/**
 * 问答请求里的一道题(见 dsh-user-questions/lib/types/types.d.ts AskUserQuestionItem)。
 * 计划评审由 intent.kind==='plan-review' + intent.approve 标签标识,判定不依赖 DOM 顺序。
 */
export interface PendingQuestionItemLike {
  id: string
  question?: string
  detail?: string
  header?: string
  options?: readonly PendingQuestionOptionLike[]
  multiSelect?: boolean
  intent?: { kind?: string; approve?: string }
}

/**
 * 待处理交互里的一项(审批/问答/计划评审共用形态)。
 * - 审批(PendingApproval):answer('allowed-once' | 'rejected');
 * - 问答/计划评审(PendingQuestion):questions 携带选项与 intent,
 *   answer({ answers: [{ id, selected, custom? }] })、cancel()(计划评审的「去聊天里说」)。
 */
export interface PendingInteractionLike {
  kind?: string
  key?: string
  sessionId?: string
  /** 问答/计划评审请求的题目列表(审批载体无此字段)。 */
  questions?: readonly PendingQuestionItemLike[]
  answer?(payload: unknown): Promise<void> | void
  cancel?(): Promise<void> | void
}

/** uiSession 待处理交互的公开观察面(pendingInteractions 的 getSnapshot 半边)。 */
export interface PendingInteractionsLike {
  getSnapshot?(): ReadonlyMap<string, PendingInteractionLike>
}

/**
 * UiSession 服务实例消费面:
 * - `pendingInteractions` 为公开面(sessionId → interaction);
 * - `pendingSnapshot` 为同一份数据的私有字段,仅作兼容回退;
 * - `resolve(sessionId)` 取该会话**已物化的作用域绑定**(`{ key, ctx, hooks, … }`,
 *   与 UiSession 内部 bindStoreScope 用的是同一个对象),供 slots.resolveStore
 *   解析 session 级 store。
 */
export interface UiSessionLike {
  pendingInteractions?: PendingInteractionsLike
  pendingSnapshot?: ReadonlyMap<string, PendingInteractionLike>
  resolve?(sessionId: string): unknown
}

/** 作用域绑定最小面(store 解析入参:`key` = 会话 id,`ctx` = 该作用域的 Cordis 上下文)。 */
export interface ScopeBindingLike {
  key?: string
  ctx?: unknown
}

/** 会话摘要行消费面(见 dsh-api-session-controller …/sessions/service.d.ts)。 */
export interface SessionSummaryLike {
  id: string
  displayTitle?: string
  title?: string
  running?: boolean
  /** 已结束而未被查看(侧栏绿色「完成」提醒;缺席 = false)。 */
  completed?: boolean
  blank?: boolean
  updatedAt?: number
  /** 粗粒度持久来源(导航过滤用);普通会话缺省。 */
  origin?: string
}

/** workspaces(workspace 控制器)快照里的工作区实体(见 dsh-api-workspace-controller workspaceView)。 */
export interface WorkspaceItemLike {
  workspaceId: string
  path?: string
  title?: string
  /** 宿主记录的会话归属顺序(浏览器「按工作区」视图的组内默认顺序)。 */
  sessionIds?: readonly string[]
  createdAt?: string
  updatedAt?: string
}

/** workspaces 列表快照消费面(与 dsh-api-workspace-controller 的 RPC baseline 同构)。 */
export interface WorkspaceSnapshotLike {
  items?: readonly WorkspaceItemLike[]
  archivedSessionIds?: readonly string[]
}

/** workspaces(workspace 控制器)服务消费面。 */
export interface WorkspacesLike {
  list?: { getSnapshot?(): WorkspaceSnapshotLike }
}

/* ------------------------------------------------------------------ *
 * 侧栏(workspace 浏览器)视图状态:会话排序的权威来源
 * ------------------------------------------------------------------ */

/**
 * 侧栏 workspace 浏览器的视图 store 状态(见 dsh-client-ui-workspace 的
 * createWorkspaceViewStore,持久化键名 `dsh.workspace.view.v5`)。
 * 侧栏渲染顺序由它决定:分组方式 + 每组本地会话顺序账号。
 */
export interface WorkspaceViewStateLike {
  /** 分组方式:`workspace`(默认,按工作区分组) / `flat`(单列表)。 */
  groupBy?: string
  /** 排序方式:`manual`(仅手动序) / `updated`(默认,手动序 + 活跃提升)。 */
  orderBy?: string
  /** 分组展开状态:组 key(workspaceId 或 `''`)→ 是否展开。 */
  groupExpansion?: Readonly<Record<string, boolean | undefined>>
  /** 每组(或单列表)的本地会话顺序账号:组 key → 会话 id 顺序。 */
  sessionOrderByAccount?: Readonly<Record<string, readonly string[] | undefined>>
}

/** store 实例(createSnapshotStore 产物)消费面。 */
export interface StoreInstanceLike {
  getSnapshot?(): unknown
}

/**
 * defineStore 返回的 store handle 消费面。
 * - `spec.persist` 即持久化键名(侧栏视图状态的 localStorage 键);
 * - `create(scopeKey?)` 新建实例,`getSnapshot()` 直接读 handle 自带实例。
 */
export interface StoreHandleLike {
  spec?: { persist?: string }
  create?(scopeKey?: string): StoreInstanceLike
  getSnapshot?(): unknown
}

/** slots 注册项:workspace 浏览器把视图 store handle 挂在注册项上。 */
export interface SlotEntryLike {
  store?: StoreHandleLike
  /**
   * chain slot 的路由选择器(注册项自带;注册时必须提供)。用于确认该注册项就是
   * 承载当前待处理交互的那一个——即卡片真正使用的那份 store。
   */
  select?(owner: unknown): unknown
}

/**
 * 通用问答卡片草稿的**唯一真源**(dsh-client-ui-user-questions 的
 * createQuestionDraftStore,挂在 `conversation.composer` 注册项上):
 * 快照 `{ requestKey?, progress: { index, drafts } }`,动作面 replace / clear。
 */
export interface QuestionDraftLike {
  selected: string[]
  custom: string
  skipped: boolean
}

/** 一次问答请求的草稿进度:当前题号 + 每题草稿(上游 QuestionFlow.progress 同形)。 */
export interface QuestionProgressLike {
  index: number
  drafts: QuestionDraftLike[]
}

/** 草稿 store 快照(`requestKey` 标记这份进度属于哪一次请求)。 */
export interface QuestionDraftSnapshotLike {
  requestKey?: string
  progress?: QuestionProgressLike
}

/** defineStore 产出的动作面(仅本插件用到的两个)。 */
export interface QuestionDraftActionsLike {
  replace?(requestKey: string, progress: QuestionProgressLike): void
  clear?(requestKey: string): void
}

/** 草稿 store 活实例(resolveStore 产物)。 */
export interface QuestionDraftStoreLike extends StoreInstanceLike {
  actions?: QuestionDraftActionsLike
}

/**
 * slots 服务(SlotRegistry)消费面:
 * - `entries(key)` 返回某 slot 的注册项(含 `store` handle);
 * - `resolveStore(handle, scopeBinding)` 解析该 handle 的**活实例**(root 作用域
 *   无需 scopeBinding),与侧栏渲染同一份内存状态。
 */
export interface SlotsLike {
  entries?(key: string): readonly SlotEntryLike[]
  resolveStore?(handle: unknown, scopeBinding: unknown): StoreInstanceLike | undefined
}

/** 会话快照消费面(见 dsh-api-session-controller …/contract/snapshot.d.ts)。 */
export interface SessionSnapshotLike {
  running?: boolean
  /** 子代理会话的直系父地址;普通会话为 null。 */
  subagent?: { address?: { mode?: string } } | null
}

/** 单个会话的面(session.getSnapshot / session.cancel)。 */
export interface SessionFaceLike {
  getSnapshot?(): SessionSnapshotLike
  cancel?(): Promise<unknown> | void
}

/** sessions.binding(id) 结果(身份稳定的会话绑定)。 */
export interface SessionBindingLike {
  session?: SessionFaceLike
}

/** 子代理目录里的一行(kind==='child' 才是真子会话,diagnostic 行跳过)。 */
export interface SubagentCatalogEntryLike {
  kind?: string
  id?: string
}

/** 子代理目录快照(subagentsByParent[id])。 */
export interface SubagentCatalogLike {
  entries?: readonly SubagentCatalogEntryLike[]
}

/** sessions.list 快照消费面。 */
export interface SessionListSnapshotLike {
  ids?: readonly string[]
  byId?: Readonly<Record<string, SessionSummaryLike>>
  current?: string
  /** 直系子代理目录:父会话 id → 目录快照。 */
  subagentsByParent?: Readonly<Record<string, SubagentCatalogLike | undefined>>
}

/** sessions(sessions 控制器)消费面。 */
export interface SessionsLike {
  list?: { getSnapshot?(): SessionListSnapshotLike }
  open?(sessionId: string): void
  binding?(sessionId: string): SessionBindingLike | undefined
}

/** layout 服务消费面(ctx.reflect.provide("layout", …) 的 LayoutController)。 */
export interface LayoutLike {
  toggleSidebar?(): void
  openDetails?(): void
  closeDetails?(): void
}

/** 本插件解析后的服务集合(get 结果全部判空后才装进来)。 */
export interface Services {
  sessions: SessionsLike | undefined
  uiSession: UiSessionLike | undefined
  layout: LayoutLike | undefined
  workspaces: WorkspacesLike | undefined
  /** slots 服务:只用于读侧栏视图 store(会话跳转顺序的权威来源)。 */
  slots: SlotsLike | undefined
}
