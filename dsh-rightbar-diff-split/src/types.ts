/** 运行时服务 / 上下文的最小结构类型切片,只含本插件消费的字段;取数不可用即 no-op,不回退 DOM。
 * 上游实现以全局 dsh 包内置 scope 的 lib 源码为准(`dsh-client-ui-layout` / `dsh-client-ui-sidebar-right`
 * / `dsh-client-ui-deliverables` / `dsh-client-store` / `dsh-client-ui-session`)。 */

/** 浏览器端上下文:get 取服务,effect 挂订阅清理(所需依赖由 client.ts 的 export const inject 声明)。 */
export interface ClientContext {
  get?(name: string): unknown
  effect?(callback: () => void | (() => void)): void
}

/** 引擎 store 活实例的可订阅面:getSnapshot 读快照,subscribe 是 uSES 的 invalidation 侧(返回退订函数);
 * 声明了 store 的注册项其活实例另带烘焙好的写面 `actions`(本插件只消费变更审阅的 toggledSplit)。 */
export interface StoreInstanceLike {
  getSnapshot?(): unknown
  subscribe?(fn: () => void): (() => void) | undefined
  actions?: unknown
}

/** slots 注册项:store handle 挂在注册项上(keyed slot 的实现身份在 options.key)。 */
export interface SlotEntryLike {
  options?: { key?: string; id?: string }
  store?: unknown
}

/** slots 服务:entries → 会话作用域绑定(resolve.ts)→ resolveStore 三步取活实例(与渲染端同一份内存态)。
 * resolveStore 在上游类型里是 private 方法,运行时在原型上可用(本仓库既有插件同此用法)。 */
export interface SlotsLike {
  entries?(key: string): readonly SlotEntryLike[]
  resolveStore?(handle: unknown, scopeBinding: unknown): StoreInstanceLike | undefined
  /** 注册变化订阅(microtask 批量):座位晚到 / 重注册时重建订阅。 */
  subscribe?(key: string, fn: () => void): (() => void) | undefined
}

/** 作用域绑定(key = 会话 id;缺席投影的 key 为 undefined)。 */
export interface ScopeBindingLike {
  key?: string
  ctx?: unknown
}

/** sessions.binding(id) 的结果;bindingSource 只校验它与 sessions.binding(id) 同一。 */
export interface SessionBindingLike {
  ctx?: unknown
}

export interface SessionsLike {
  binding?(sessionId: string): SessionBindingLike | undefined
}

/** uiSession:current 是当前会话的绑定源(带 subscribe,故会话切换可事件驱动);
 * bindingSource 物化一个会话的作用域绑定(0.1.6-alpha.2 起替代已删除的 resolve(sessionId))。 */
export interface UiSessionLike {
  current?: StoreInstanceLike
  bindingSource?(reference: { sessionId: string; binding: SessionBindingLike }): StoreInstanceLike | undefined
}

/** 布局 store 快照的消费面:全屏真身 `layoutInfo.rightbarFullscreen`(`data-rightbar-fullscreen` 只是投影)。 */
export interface LayoutInfoLike {
  /** 左栏宽度偏好(仅用于与其它 root store 区分,不参与判定)。 */
  sidebar?: number
  /** 帧宽(同上)。 */
  viewportWidth?: number
  /** 上游 sidebar-right `syncPresentation` 写入的呈现事实:全屏(含窄窗 autoFullscreen)为 true。 */
  rightbarFullscreen?: boolean
}

export interface LayoutStoreSnapshotLike {
  layoutInfo?: LayoutInfoLike
}

/** 右栏布局节点:只消费 pane 分支的 activeTabId(上游以 `nodes[activePaneId].kind === 'pane'` 为不变量)。 */
export interface RightbarNodeLike {
  kind?: string
  activeTabId?: string
}

/** 标签记录(kind 为 'changes-review' 即「变更审阅」页)。 */
export interface RightbarTabRecordLike {
  id?: string
  kind?: string
}

/** 一个会话的布局:当前面板 id + 节点表 + 标签记录表。 */
export interface RightbarLayoutLike {
  nodes?: Readonly<Record<string, RightbarNodeLike | undefined>>
  tabs?: Readonly<Record<string, RightbarTabRecordLike | undefined>>
  activePaneId?: string
}

/** 一个会话的停靠画布(布局 + 历史 + id 计数器;只消费 layout)。 */
export interface RightbarSurfaceLike {
  layout?: RightbarLayoutLike
}

/** 右栏会话级 store 快照(slot 'rightbar.session' 的 handle,需会话作用域绑定)。 */
export interface RightbarStateLike {
  bySession?: Readonly<Record<string, RightbarSurfaceLike | undefined>>
}

/** 变更审阅视图 store 的写面:与页头「左右对比」按钮同一入口,**toggle 语义**(故必须先读 split)。 */
export interface ReviewActionsLike {
  toggledSplit?(tabId: string): void
}

/** 变更审阅视图 store 快照:byTab[tabId] 为该标签的视图状态桶。 */
export interface ReviewStateLike {
  byTab?: Readonly<Record<string, unknown>>
}

/** 本插件解析后的服务集合(判空后才装入)。 */
export interface Services {
  slots: SlotsLike | undefined
  sessions: SessionsLike | undefined
  uiSession: UiSessionLike | undefined
}
