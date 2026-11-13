import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):只加载各包对 cordis `Context` 的服务声明
// (`sessions` / `uiSession` / `slots`),以及 `dsh-client-ui-session/client` 与
// `dsh-client-ui-slots` 的模块扩展(补全待处理交互的 kind 联合与槽位键),不产生运行时导入。
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client'

/**
 * 本插件从 cordis 上下文读到的三个服务;缺席(尚未挂载)时字段为 `undefined`。
 *
 * 服务类型直接取自上游 `Context`,不再本地复写 `ISessions` / `UiSession` /
 * `SlotRegistry` 的形状。
 */
export interface NotifyServices {
  sessions: Context['sessions'] | undefined
  uiSession: Context['uiSession'] | undefined
  slots: Context['slots'] | undefined
}
