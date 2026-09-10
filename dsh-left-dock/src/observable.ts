/**
 * dsh-left-dock — 极简观察源。
 *
 * 框架的 inject face 支持 `hooks: { name: source }`：每个 source 会被绑成组件上的
 * `use<Name>` 选择器 hook（`hooks: { panels }` → prop `usePanels`）。上游用
 * `createSnapshotStore`（`dsh-client-store`）实现；该包不在 DSH 模块表里，无法从
 * 本插件 bundle 里 require，因此这里给出同形状的最小实现（getSnapshot + subscribe），
 * 只承载 sidebar.panellist 行元数据这一份数据。
 */
import type { HostObservable } from './context.ts'

/** 可写观察源：对框架是 HostObservable，对本插件多一个 set/dispose。 */
export interface Observable<T> extends HostObservable<T> {
  set(next: T): void
  dispose(): void
}

/**
 * 建立一份观察源。
 * @param initial - 初始快照。
 * @returns 可读可写的观察源。
 */
export function createObservable<T>(initial: T): Observable<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: T) => {
      if (Object.is(next, value)) return
      value = next
      // 复制后遍历：监听器里可能再读写，避免边遍历边改集合。
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch (error) {
          console.error('[dsh-left-dock] panels subscriber failed:', error)
        }
      }
    },
    dispose: () => { listeners.clear() },
  }
}
