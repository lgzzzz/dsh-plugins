/** 发送侧:页面是否在前台 + 真正构造系统通知。 */
import type { PlannedNotification } from './notify-policy.ts'

export interface NotifyDelivery {
  /** 页面在前台(有焦点且可见)时为 true:此时不该打扰。 */
  isPageActive(): boolean
  deliver(plan: PlannedNotification): void
}

/** Notification 实例面(只声明本插件用到的成员)。 */
interface NotificationInstanceLike {
  onclick: (() => void) | null
  close?(): void
}

interface NotificationCtorLike {
  new (title: string, options?: Record<string, unknown>): NotificationInstanceLike
}

export function createBrowserDelivery(win: Window, doc: Document): NotifyDelivery {
  const ctor = (win as unknown as { Notification?: NotificationCtorLike }).Notification
  return {
    isPageActive: () => {
      // 窗口不在前台(焦点在别的应用)或标签页不可见(切到了别的标签页)都算「不在前台」
      if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return false
      return doc.visibilityState === 'visible'
    },
    deliver(plan) {
      if (ctor === null || ctor === undefined) return
      try {
        const notification = new ctor(plan.title, {
          body: plan.body,
          tag: plan.tag,
          // 同一个 tag 的后续通知仍要重新提醒,否则第二条会被静默替换掉
          renotify: true,
          silent: false,
        })
        notification.onclick = () => {
          try {
            win.focus()
          } catch {
            // 浏览器可以拒绝程序化聚焦:通知点击仍会把对应标签页激活
          }
          notification.close?.()
        }
      } catch (error) {
        console.warn('[dsh-desktop-notify] notify failed:', error)
      }
    },
  }
}
