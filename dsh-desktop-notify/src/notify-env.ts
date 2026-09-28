import { ENABLED_STORAGE_KEY, type NotifyStoreEnv } from './notify-store.ts'

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
