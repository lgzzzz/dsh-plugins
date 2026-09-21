/** 浏览器环境缝:把 Notification API 与 localStorage 收成 NotifyStoreEnv,全部判空。 */
import { ENABLED_STORAGE_KEY, type NotifyStoreEnv } from './notify-store.ts'

/** Notification 构造面(只声明本插件用到的静态成员)。 */
interface NotificationCtorLike {
  permission?: string
  requestPermission?(callback?: (result: string) => void): Promise<string> | undefined
}

function notificationCtor(win: Window): NotificationCtorLike | undefined {
  const ctor = (win as unknown as { Notification?: NotificationCtorLike }).Notification
  return ctor === null || ctor === undefined ? undefined : ctor
}

export function createBrowserNotifyEnv(win: Window): NotifyStoreEnv {
  const ctor = notificationCtor(win)
  return {
    supported: ctor !== undefined,
    permission: () => {
      const value = ctor?.permission
      return value === null || value === undefined ? 'default' : value
    },
    async requestPermission() {
      const request = ctor?.requestPermission
      if (ctor === undefined || request === undefined) return 'default'
      // 老式回调形态(length 1,不需要 Promise 分支);现代 Chrome 返回 Promise 且 length 0
      if (request.length >= 1) {
        return await new Promise<string>((resolve) => {
          try {
            request.call(ctor, (value: string) => {
              resolve(value)
            })
          } catch {
            resolve('default')
          }
        })
      }
      const result = request.call(ctor)
      if (result !== undefined && typeof result.then === 'function') return await result
      return 'default'
    },
    readEnabled: () => {
      const raw = readStorage(win, ENABLED_STORAGE_KEY)
      return raw === null ? undefined : raw !== '0'
    },
    writeEnabled: (enabled) => {
      try {
        win.localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? '1' : '0')
      } catch {
        // 隐私模式 / 存储被禁用:开关退化为仅本页有效,不影响通知本身
      }
    },
  }
}

function readStorage(win: Window, key: string): string | null {
  try {
    return win.localStorage.getItem(key)
  } catch {
    return null
  }
}
