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
 * - `pendingSnapshot` 为同一份数据的私有字段,仅作兼容回退。
 */
export interface UiSessionLike {
  pendingInteractions?: PendingInteractionsLike
  pendingSnapshot?: ReadonlyMap<string, PendingInteractionLike>
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
}
