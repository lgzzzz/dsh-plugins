/**
 * 本插件用到的最小结构形状。
 *
 * 这里按鸭子类型声明，而不是引入 `@deepseek-ai/dsh-client-ui-slots` /
 * `-ui-renderer` / `-ui-chat` 的真实类型：客户端半部只用到注册表的四个方法、
 * 两个标准 hook 与一个 projection 形状，这些事实由构建后的 `contract.json`
 * 校验（上游一改名，check:css 显式失败），用本地形状即可把它们钉在一处。
 */

/** 账本条目上本插件读到的选项。 */
export interface LedgerEntryOptions {
  /** list 槽的格子标识；统计按钮是 `"activity"`。 */
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
 * `entries` 读**原始账本**而不是胜者投影，因为被遮蔽的源项必须仍能被读到；
 * `subscribe` 在槽位账本变化时回调，是等到源项出现、以及发现源项消失的唯一途径。
 * 回调时机由注册表决定：`SlotCore.markDirty` 同步通知自己的变更听众，而
 * `subscribe` 登记的听众在一次微任务里统一冲刷，因此回调既可能在别处的调用栈里
 * 同步到达，也可能晚一拍到达；两种时机下对账都必须安全。
 */
export interface ShadowSlots {
  entries(key: string): readonly LedgerEntry[]
  register(options: Record<string, unknown>, component: unknown): () => void
  subscribe?(key: string, fn: () => void): () => void
  inject?(key: string, callback: () => void | (() => void)): void
}

/** 浏览器 cordis 上下文里本插件用到的最小面。 */
export interface ClientContext {
  /** 读取已激活的 cordis 服务。 */
  get?(name: string): unknown
}

/** `sessionStats` projection 的客户端可读形状（本插件只读两个字段）。 */
export interface SessionStatsReading {
  /** 已记录首 token 的步骤的 TTFT 总和，毫秒。 */
  ttftMs: number
  /** 记录到首 token 的步骤数。 */
  ttftSteps: number
}

/** 一个 assistant 节点上与本插件相关的 timing 字段。 */
export interface AssistantTiming {
  /** `step/start` 的时刻；缺失表示该步没有记录边界。 */
  stepStartTime: number | null
  /** 首个输出 token 的时刻；缺失表示没有记录到首 token。 */
  firstTokenTime: number | null
}

/** 窗口折叠只用到的 assistant 节点形状。 */
export interface AssistantNode {
  /** 节点种类；只有 `"assistant"` 计入。 */
  kind: string
  /** 步骤边界；缺失时不参与折叠。 */
  timing?: AssistantTiming
}

/** `useChat` 选择器读到的窗口快照形状。 */
export interface ChatSnapshot {
  legacy?: {
    nodes?: readonly AssistantNode[]
  }
}

/** 聊天字典的 translate 座位（本插件用到的键只有 counts 与两个时长单位）。 */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/** 会话作用域 slot 自动获得的 projection 读取座位。 */
export type UseProjection = (key: string, selector?: (value: unknown) => unknown) => unknown

/** 会话作用域 slot 自动获得的 Chat 选择器座位。 */
export type UseChat = (selector: (snapshot: ChatSnapshot) => unknown) => unknown
