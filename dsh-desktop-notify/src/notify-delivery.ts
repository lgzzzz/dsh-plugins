import type { PlannedNotification } from './notify-policy.ts'

export interface NotifyDelivery {
  isPageActive(): boolean
  deliver(plan: PlannedNotification): void
}

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
      if (typeof doc.hasFocus === 'function' && !doc.hasFocus()) return false
      return doc.visibilityState === 'visible'
    },
    deliver(plan) {
      if (ctor === null || ctor === undefined) return
      try {
        const notification = new ctor(plan.title, {
          body: plan.body,
          tag: plan.tag,
          renotify: true,
          silent: false,
        })
        notification.onclick = () => {
          try {
            win.focus()
          } catch {
          }
          notification.close?.()
        }
      } catch (error) {
        console.warn('[dsh-desktop-notify] notify failed:', error)
      }
    },
  }
}
