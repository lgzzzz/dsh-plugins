/** 运行时服务 / 上下文的最小结构类型切片,只含本插件消费的字段;取数不可用即 no-op,不回退 DOM。 */

/** 浏览器端上下文:仅用 get 取服务(所需依赖由 client.ts 的 export const inject 声明)。 */
export interface ClientContext {
  get?(name: string): unknown
}

/** 注册项的可写选项面:`order` 是上游渲染端排序用的字段(唯一会被本插件写的字段)。 */
export interface SlotEntryOptionsLike {
  id?: string
  order?: number
}

/** 注册项本体:上游 SlotCore 的 ledger 对象,entries() 返回的就是这些活引用。 */
export interface SlotEntryLike {
  options?: SlotEntryOptionsLike
}

/**
 * slots 服务(上游 SlotRegistry)的本插件消费面:
 * - `entries(key)`:该槽的活注册项(按 priority/order 排过的 ledger 序列);
 * - `subscribe(key, fn)`:注册变化的微任务批通知(含后到的注册,如独立 bundle 的 agent-team);
 * - `inject(key, cb)`:槽声明后运行一次 cb,声明塌缩时 dispose。
 */
export interface SlotsLike {
  entries?(key: string): readonly SlotEntryLike[] | undefined
  subscribe?(key: string, listener: () => void): (() => void) | undefined
  inject?(key: string, callback: () => void | (() => void)): unknown
}
