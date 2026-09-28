import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client'

export interface NotifyServices {
  sessions: ISessions | undefined
  uiSession: UiSession | undefined
  slots: SlotRegistry | undefined
}
