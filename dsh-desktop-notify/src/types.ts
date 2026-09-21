/** 运行时服务 / 上下文的最小结构类型切片,只含本插件消费的字段;取数不可用即 no-op,不回退 DOM。 */

export interface ClientContext {
  get?(name: string): unknown
  effect?(callback: () => void | (() => void)): void
}

/** 一道待答题(question / plan-review 分支)。 */
export interface PendingQuestionLike {
  id?: string
  question?: string
  header?: string
  detail?: string
}

/**
 * 待处理交互(审批 / 问答 / 计划评审共用形态;由 uiSession 的待处理域发布)。
 * kind: 'approval' | 'question' | 'plan-review'。
 */
export interface PendingInteractionLike {
  /** 请求标识;换成新 key 才是一次新请求。 */
  key?: string
  kind?: string
  sessionId?: string
  /** approval 分支:请求审批的工具名。 */
  toolName?: string
  /** approval 分支:请求者给出的理由。 */
  reason?: string
  /** question / plan-review 分支:题目列表。 */
  questions?: readonly PendingQuestionLike[]
}

/** 一个会话的 UI 状态行(running / 待处理交互 / 完成未读)。 */
export interface SessionStatusLike {
  running?: boolean
  pendingInteraction?: PendingInteractionLike | undefined
  /** 主视图之外的回合已结束且尚未确认(本插件不发这类通知,仅随类型声明记录)。 */
  completionUnread?: boolean
}

/** uiSession.sessionStatus:全量状态表的可观察源。 */
export interface SessionStatusSourceLike {
  getSnapshot?(): ReadonlyMap<string, SessionStatusLike> | undefined
  subscribe?(listener: () => void): (() => void) | undefined
}

/** uiSession:本插件只消费 sessionStatus 根源。 */
export interface UiSessionLike {
  sessionStatus?: SessionStatusSourceLike
}

/** 会话列表行(取标题与子代理标记)。 */
export interface SessionSummaryLike {
  id?: string
  displayTitle?: string
  title?: string
  /** 'subagent' 标记子代理会话:不打扰。 */
  origin?: string
  running?: boolean
}

export interface SessionListSnapshotLike {
  byId?: Readonly<Record<string, SessionSummaryLike>>
}

/** sessions 服务:list 快照取标题。 */
export interface SessionsLike {
  list?: { getSnapshot?(): SessionListSnapshotLike | undefined }
}

/** slots.register 的注册项参数(只声明本插件用到的字段)。 */
export interface SlotRegisterOptionsLike {
  name: string
  id: string
  order?: number
  label?: string
}

/** slots 服务:inject → register 挂一个标题栏按钮。 */
export interface SlotsLike {
  inject?(key: string, callback: () => unknown): unknown
  register?(options: SlotRegisterOptionsLike, component: (props?: unknown) => unknown): unknown
}

/** 本插件解析后的服务集合(判空后才装入)。 */
export interface NotifyServices {
  sessions: SessionsLike | undefined
  uiSession: UiSessionLike | undefined
  slots: SlotsLike | undefined
}
