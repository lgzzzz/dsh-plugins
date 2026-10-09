/**
 * 本插件用到的最小结构形状。
 *
 * 这里按鸭子类型声明，而不是引入 `@deepseek-ai/dsh-client-ui-slots` /
 * `-ui-renderer` 的真实类型：客户端半部只用到注册表的三个方法，且这些形状是构建后
 * contract.json 校验的那份上游契约（`entries` 的原始账本视图、同 id 不同 priority 的遮蔽、
 * `register` 返回撤销函数），用本地形状即可把这份契约钉在一处。
 */

/** 账本条目上本插件读到的选项。 */
export interface LedgerEntryOptions {
  /** list 槽的格子标识；后台任务控件是 `"job-list"`。 */
  id?: string
  /** 条目在同槽内的显示顺序。 */
  order?: number
  /** 遮蔽优先级；list 槽里同 id 的条目按它决胜，最小者渲染。 */
  priority?: number
  /** 槽位检查界面显示的标签。 */
  label?: unknown
}

/** 本插件读到的一条账本条目。 */
export interface LedgerEntry {
  /** 渲染这个条目的组件。 */
  component: unknown
  /** 注册时给出的选项。 */
  options?: LedgerEntryOptions
  /** 字典命名空间；渲染器按它合成 `t` 座位。 */
  locale?: string
  /** 业务注入面工厂；渲染器只调用胜者条目的这个函数。 */
  inject?: (...args: never[]) => Record<string, unknown>
}

/**
 * 注册表面：`slots` 服务里本插件依赖的全部方法。
 *
 * `entries` 读的是**原始账本**而不是胜者投影，因为被遮蔽的源项必须仍能被读到；
 * `subscribe` 在槽位账本变化时回调，是本插件等到源项出现、以及发现源项消失的唯一途径。
 * 回调时机由注册表决定：`SlotCore.markDirty` 同步通知自己的变更听众，而 `subscribe` 登记的
 * 听众在一次微任务里统一冲刷，因此回调既可能在别处的调用栈里同步到达，也可能晚一拍到达；
 * 两种时机下对账都必须安全。
 */
export interface ShadowSlots {
  entries(key: string): readonly LedgerEntry[]
  register(options: Record<string, unknown>, component: unknown): () => void
  subscribe?(key: string, fn: () => void): () => void
  inject?(key: string, callback: () => void | (() => void)): void
}
