/**
 * 浏览器半部入口:标题栏挂「开启通知」按钮,并订阅 uiSession.sessionStatus 发桌面通知。
 * 两条链路都走服务面;任一服务缺席即静默降级(不接 DOM 观测、不自行拉数据)。
 */
import { createNotifyAction, ensureActionStyles } from './notify-action.ts'
import { createBrowserDelivery } from './notify-delivery.ts'
import { createBrowserNotifyEnv } from './notify-env.ts'
import { startNotifyRuntime } from './notify-runtime.ts'
import { createNotifyStore } from './notify-store.ts'
import type { ClientContext, NotifyServices, SessionsLike, SlotsLike, UiSessionLike } from './types.ts'

export const name = 'dsh-desktop-notify'

/** 浏览器半部注入的服务(模块加载器读取):sessions 取会话标题,uiSession 取状态源,slots 挂按钮。 */
export const inject = ['sessions', 'uiSession', 'slots']

/** 按钮落点:会话标题栏动作区(与上游 jobs / 终端恢复同区);order 靠后,排在既有控件之后。 */
const ACTION_SLOT = 'conversation.session.header.actions'
const ACTION_ID = 'desktop-notify'
const ACTION_ORDER = 120

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

  ensureActionStyles(document)
  const slots = services.slots
  if (slots?.inject !== undefined && slots.register !== undefined) {
    slots.inject(ACTION_SLOT, () =>
      slots.register?.({ name: ACTION_SLOT, id: ACTION_ID, order: ACTION_ORDER }, createNotifyAction(store)),
    )
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      window.removeEventListener('focus', onFocus)
      disposeRuntime()
    })
  }
}
