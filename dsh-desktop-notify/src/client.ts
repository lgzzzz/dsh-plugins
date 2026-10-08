/**
 * 浏览器半部:页面不在前台时,把「回合结束 / 待审批 / 待回答 / 待确认计划」弹成系统通知。
 *
 * 装配顺序即依赖顺序:`createBrowserNotifyEnv` 读 Notification 能力与 localStorage,
 * `createNotifyStore` 持有权限与开关快照,`startNotifyRuntime` 订阅 uiSession 的状态变化并在
 * 命中策略时调用 `createBrowserDelivery`。设置行注册进 `settings.general.item` 槽,样式由
 * `ensureNotifySettingsStyles` 自己挂一张 `<style>`。
 *
 * 没有 window / document(非浏览器环境)时直接返回,不注册任何东西。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import { createNotifySettingsRow, ensureNotifySettingsStyles } from './notify-settings.ts'
import { createBrowserDelivery } from './notify-delivery.ts'
import { createBrowserNotifyEnv } from './notify-env.ts'
import { startNotifyRuntime } from './notify-runtime.ts'
import { createNotifyStore } from './notify-store.ts'
import type { NotifyServices } from './types.ts'

export const name = 'dsh-desktop-notify'

export const inject = ['sessions', 'uiSession', 'slots']

const SETTINGS_ITEM_SLOT = 'settings.general.item'
const SETTINGS_ITEM_ID = 'desktop-notify'

const SETTINGS_ITEM_ORDER = 30

function getService(ctx: Context, serviceName: string): unknown {
  if (ctx.get === undefined || ctx.get === null) return undefined
  const value = ctx.get(serviceName)
  return value === null || value === undefined ? undefined : value
}

export function apply(ctx: Context): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const services: NotifyServices = {
    sessions: getService(ctx, 'sessions') as ISessions | undefined,
    uiSession: getService(ctx, 'uiSession') as UiSession | undefined,
    slots: getService(ctx, 'slots') as SlotRegistry | undefined,
  }

  const store = createNotifyStore(createBrowserNotifyEnv(window))
  const delivery = createBrowserDelivery(window, document)
  const disposeRuntime = startNotifyRuntime({
    services,
    store,
    isPageActive: () => delivery.isPageActive(),
    deliver: (plan) => {
      delivery.deliver(plan)
    },
  })

  const onFocus = (): void => {
    store.refresh()
  }
  window.addEventListener('focus', onFocus)

  ensureNotifySettingsStyles(document)
  const slots = services.slots
  if (slots?.inject !== undefined && slots.register !== undefined) {
    slots.inject(SETTINGS_ITEM_SLOT, () =>
      slots.register?.(
        { name: SETTINGS_ITEM_SLOT, id: SETTINGS_ITEM_ID, order: SETTINGS_ITEM_ORDER },
        createNotifySettingsRow(store),
      ),
    )
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      window.removeEventListener('focus', onFocus)
      disposeRuntime()
    })
  }
}
