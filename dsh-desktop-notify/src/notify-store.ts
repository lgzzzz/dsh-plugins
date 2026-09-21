/**
 * 通知开关 + 浏览器权限的共享状态:标题栏按钮与运行时共读同一份(按钮写、运行时读)。
 * 环境差异全部经 NotifyStoreEnv 缝注入,本模块不碰 window / Notification,可纯 Node 测。
 */

/** 归一化后的权限:unsupported = 环境里没有 Notification API。 */
export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied'

export interface NotifyStoreState {
  permission: NotifyPermission
  /** 用户开关:权限已授予但用户关掉时也不发通知。 */
  enabled: boolean
}

/** 环境缝(浏览器实现见 notify-env.ts)。 */
export interface NotifyStoreEnv {
  /** 环境是否提供 Notification API。 */
  supported: boolean
  /** 当前浏览器权限(非标准值归入 default)。 */
  permission(): string
  requestPermission(): Promise<string>
  /** 持久化开关读数(undefined = 从未存过)。 */
  readEnabled(): boolean | undefined
  writeEnabled(enabled: boolean): void
}

export interface NotifyStore {
  getSnapshot(): NotifyStoreState
  subscribe(listener: () => void): () => void
  /** 按钮点击:未授权先请求权限(该调用发生在点击的用户手势里),已授权则翻转开关。 */
  activate(): Promise<void>
  /** 重读浏览器权限(用户可能在 Chrome 站点设置里改过)。 */
  refresh(): void
  /** 现在是否应当真的发通知。 */
  isActive(): boolean
}

/** 开关持久化键(同源 localStorage,仅本机页面可见)。 */
export const ENABLED_STORAGE_KEY = 'dsh.desktop-notify.enabled'

/** 浏览器权限字符串 → 归一化权限。 */
function normalize(raw: string): NotifyPermission {
  if (raw === 'granted') return 'granted'
  if (raw === 'denied') return 'denied'
  return 'default'
}

export function createNotifyStore(env: NotifyStoreEnv): NotifyStore {
  const listeners = new Set<() => void>()
  const readPermission = (): NotifyPermission => (env.supported ? normalize(env.permission()) : 'unsupported')

  let snapshot: NotifyStoreState = {
    permission: readPermission(),
    // 默认开启:用户点按钮授权后立即生效;主动关掉才写 0
    enabled: env.readEnabled() !== false,
  }

  const publish = (next: NotifyStoreState): void => {
    if (next.permission === snapshot.permission && next.enabled === snapshot.enabled) return
    snapshot = next
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        console.warn('[dsh-desktop-notify] store listener failed:', error)
      }
    }
  }

  const setPermission = (permission: NotifyPermission): void => {
    publish({ permission, enabled: snapshot.enabled })
  }

  const setEnabled = (enabled: boolean): void => {
    env.writeEnabled(enabled)
    publish({ permission: snapshot.permission, enabled })
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isActive: () => snapshot.permission === 'granted' && snapshot.enabled,
    refresh: () => {
      setPermission(readPermission())
    },
    async activate() {
      if (!env.supported) return
      const current = readPermission()
      if (current === 'denied') {
        // 被拒绝后浏览器不会再弹授权框:保持现状,由按钮提示去站点设置里改
        setPermission(current)
        return
      }
      if (current !== 'granted') {
        let result: NotifyPermission = current
        try {
          result = normalize(await env.requestPermission())
        } catch (error) {
          console.warn('[dsh-desktop-notify] requestPermission failed:', error)
          result = readPermission()
        }
        setPermission(result)
        if (result === 'granted') setEnabled(true)
        return
      }
      setEnabled(!snapshot.enabled)
    },
  }
}
