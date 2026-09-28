export type NotifyPermission = 'unsupported' | 'default' | 'granted' | 'denied'

export interface NotifyStoreState {
  permission: NotifyPermission
  enabled: boolean
}

export interface NotifyStoreEnv {
  supported: boolean
  permission(): string
  requestPermission(): Promise<string>
  readEnabled(): boolean | undefined
  writeEnabled(enabled: boolean): void
}

export interface NotifyStore {
  getSnapshot(): NotifyStoreState
  subscribe(listener: () => void): () => void
  activate(): Promise<void>
  refresh(): void
  isActive(): boolean
}

export const ENABLED_STORAGE_KEY = 'dsh.desktop-notify.enabled'

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
