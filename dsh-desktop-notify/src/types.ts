import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// 空类型导入(不引入任何名字):只为加载这三个包对 `dsh-client-ui-session/client` 与
// `dsh-client-ui-slots` 的模块扩展(补全待处理交互的 kind 联合与槽位键),不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client'

export interface NotifyServices {
  sessions: ISessions | undefined
  uiSession: UiSession | undefined
  slots: SlotRegistry | undefined
}
