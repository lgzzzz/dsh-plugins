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

/** uiSession.pendingSnapshot 里的一项(审批/问题/计划评审共用形态)。 */
export interface PendingInteractionLike {
  kind?: string
  key?: string
  sessionId?: string
  answer?(outcome: unknown): Promise<void> | void
  cancel?(): Promise<void> | void
}

/** UiSession 服务实例消费面(pendingSnapshot: sessionId → interaction)。 */
export interface UiSessionLike {
  pendingSnapshot?: ReadonlyMap<string, PendingInteractionLike>
}

/** 会话摘要行消费面(见 dsh-api-session-controller …/sessions/service.d.ts)。 */
export interface SessionSummaryLike {
  id: string
  displayTitle?: string
  title?: string
  running?: boolean
  blank?: boolean
  updatedAt?: number
}

/** sessions.list 快照消费面。 */
export interface SessionListSnapshotLike {
  ids?: readonly string[]
  byId?: Readonly<Record<string, SessionSummaryLike>>
  current?: string
}

/** sessions(sessions 控制器)消费面。 */
export interface SessionsLike {
  list?: { getSnapshot?(): SessionListSnapshotLike }
  open?(sessionId: string): void
}

/** uiWorkspace 服务消费面(新建会话走 New Session 按钮同路径)。 */
export interface UiWorkspaceLike {
  startSession?(workspaceId?: string): void
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
  uiWorkspace: UiWorkspaceLike | undefined
  layout: LayoutLike | undefined
}
