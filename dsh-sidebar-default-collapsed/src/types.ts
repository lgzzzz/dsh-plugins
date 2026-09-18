/** 运行时服务 / 上下文的最小结构类型切片,只含本插件消费的字段;取数不可用即 no-op,不回退 DOM。 */

/** 浏览器端上下文:仅用 get 取服务(所需依赖由 client.ts 的 export const inject 声明)。 */
export interface ClientContext {
  get?(name: string): unknown
}

/** layout 服务:只消费 toggleSidebar(左栏唯一能写到「收起」的入口)。 */
export interface LayoutLike {
  toggleSidebar?(): void
}

/** slots 注册项:布局 store handle 挂在 root 注册项的 store 字段上(ui-layout 的 root 注册自带 store 座)。 */
export interface SlotEntryLike {
  store?: StoreHandleLike
}

/** defineStore 返回的 handle:resolveStore 以对象标识查表,须原样回传注册项上的那个对象。 */
export interface StoreHandleLike {
  create?(scopeKey?: string): StoreInstanceLike
}

/** resolveStore 返回的活实例:仅需 getSnapshot。 */
export interface StoreInstanceLike {
  getSnapshot?(): unknown
}

/** slots 服务:entries('root') → resolveStore(handle, undefined) 两步取活实例(与渲染端同一份内存态)。 */
export interface SlotsLike {
  entries?(key: string): readonly SlotEntryLike[]
  resolveStore?(handle: unknown, scopeBinding: unknown): StoreInstanceLike | undefined
}

/** 布局快照的消费面:仅 sidebar 偏好与 viewportWidth(toggleSidebar 的两个判定输入)。 */
export interface LayoutInfoLike {
  /** 左栏宽度偏好(0 = 收起;264–420 为展开态区间)。 */
  sidebar: number
  /** 帧宽:toggleSidebar 用它与 1024 断点比较,故必须以 store 的值为准而非 window.innerWidth。 */
  viewportWidth: number
}

/** 本插件解析后的服务集合(判空后才装入)。 */
export interface Services {
  /** layout:启动时把左栏置为收起。 */
  layout: LayoutLike | undefined
  /** slots:读活布局 store(toggle 的幂等判定需要状态,服务面没有读方法)。 */
  slots: SlotsLike | undefined
}

/** 页面级窗口最小面:承载一次性标记(须能跨 client-hmr 的 fiber 替换存活)。 */
export interface WindowLike {
  [key: string]: unknown
}
