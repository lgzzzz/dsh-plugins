/**
 * 本插件用到的上游类型，以及一条无法用上游静态类型表达的读取面。
 *
 * 直接使用上游命名导出：
 *   - 槽注册表 `SlotRegistry`（@deepseek-ai/dsh-client-ui-renderer/client）；
 *   - 账本条目 `StoredEntry`、translate 座位 `Translate`（@deepseek-ai/dsh-client-ui-slots）；
 *   - Chat 窗口快照 `ChatSnapshot`、Chat 选择器座位 `UseChat`、聊天节点
 *     `ConversationNode`（@deepseek-ai/dsh-client-ui-chat/client）；
 *   - projection 读取座位 `UseProjection`（@deepseek-ai/dsh-api-session-controller/client）；
 *   - 本插件自己的 `recentStepStats` 投影键与逐步类型（`./recent-shared.ts`，
 *     键声明随该模块的 `declare module` 一起加载）。
 *
 * 仍留在本地的只有一条读取面：`ShadowSlots`——`conversation.composer.dock` 的槽键由
 * ui-conversation 声明，可直接用上游 `entries` / `inject` / `subscribe`；只有
 * `register()` 要原样转发源条目的 `locale` / `inject`（运行时任意命名空间与任意参数表），
 * 无法通过 `SlotMap` 的静态注册表签名表达，因此只把 `register` 放宽成动态键视图。
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
// 空类型导入(不引入任何名字):加载 ui-conversation 对 `SlotMap` 的槽键声明。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// 空类型导入(不引入任何名字):把 `recentStepStats` 键并入 `SessionProjectionMap`。
import type {} from './recent-shared.ts'

/**
 * 动态键的槽注册表视图。
 *
 * `entries` / `inject` / `subscribe` 等成员直接沿用上游 `SlotRegistry`；只有
 * `register` 放宽为动态键——遮蔽项的选项由源账本条目派生，`locale` 是运行时的
 * 任意命名空间，`inject` 是源条目原样透传的业务面，二者都超出静态注册表签名的
 * 表达能力。
 */
export type ShadowSlots = Omit<SlotRegistry, 'register'> & {
  /**
   * 注册遮蔽项。
   *
   * @param options - 由源条目派生的注册选项（原样转发 locale / label / order / inject）。
   * @param component - 包装后的组件。
   * @returns 撤销注册的函数。
   */
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** 账本条目（上游命名导出的转出）。 */
export type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'

/** 最近步次统计的共享类型；导入本模块同时加载 `recentStepStats` 的键声明。 */
export type { RecentStatsTotals, RecentStepStats } from './recent-shared.ts'

/** 会话作用域 slot 的标准 projection 读取座位（上游命名导出的转出）。 */
export type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'

/** 聊天字典的 translate 座位（本插件只用到 counts、速度段与两个时长单位）。 */
export type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** Chat 窗口快照与 Chat 选择器座位（上游命名导出的转出）。 */
export type { ChatSnapshot, ConversationNode, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'

/** 本插件折叠的节点集合形态。 */
export type ChatNodes = ChatSnapshot['legacy']['nodes']
