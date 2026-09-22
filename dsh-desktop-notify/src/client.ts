/**
 * 浏览器半部入口:设置 →「通用」挂「桌面通知」开关行,并订阅 uiSession.sessionStatus 发桌面通知。
 * 两条链路都走服务面;任一服务缺席即静默降级(不接 DOM 观测、不自行拉数据)。
 */
import { createNotifySettingsRow, ensureNotifySettingsStyles } from './notify-settings.ts'
import { createBrowserDelivery } from './notify-delivery.ts'
import { createBrowserNotifyEnv } from './notify-env.ts'
import { startNotifyRuntime } from './notify-runtime.ts'
import { createNotifyStore } from './notify-store.ts'
import type { ClientContext, NotifyServices, SessionsLike, SlotsLike, UiSessionLike } from './types.ts'

export const name = 'dsh-desktop-notify'

/** 浏览器半部注入的服务(模块加载器读取):sessions 取会话标题,uiSession 取状态源,slots 挂设置行。 */
export const inject = ['sessions', 'uiSession', 'slots']

/** 开关行落点:设置 →「通用」的条目区(上游 ui-settings-general 声明的 settings.general.item,
 *  root 作用域的 list slot);order 靠后,排在语言 / 聊天等既有条目之后。 */
const SETTINGS_ITEM_SLOT = 'settings.general.item'
const SETTINGS_ITEM_ID = 'desktop-notify'
const SETTINGS_ITEM_ORDER = 100

/** 双重判空后取服务(缺失时返回 undefined)。 */
function getService(ctx: ClientContext, serviceName: string): unknown {
  if (ctx.get === undefined || ctx.get === null) return undefined
  const value = ctx.get(serviceName)
  return value === null || value === undefined ? undefined : value
}

export function apply(ctx: ClientContext): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const services: NotifyServices = {
    sessions: getService(ctx, 'sessions') as SessionsLike | undefined,
    uiSession: getService(ctx, 'uiSession') as UiSessionLike | undefined,
    slots: getService(ctx, 'slots') as SlotsLike | undefined,
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

  // 权限可能在 Chrome 站点设置里被改:窗口重新获得焦点时重读一次
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
