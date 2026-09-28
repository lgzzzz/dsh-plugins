import { createNotifyPolicy, type PlannedNotification, type PolicySnapshot } from './notify-policy.ts'
import type { NotifyStore } from './notify-store.ts'
import type { NotifyServices } from './types.ts'

export interface NotifyRuntimeDeps {
  services: NotifyServices
  store: Pick<NotifyStore, 'isActive'>
  isPageActive(): boolean
  deliver(plan: PlannedNotification): void
}

export function readPolicySnapshot(services: NotifyServices): PolicySnapshot {
  const statuses = services.uiSession?.sessionStatus?.getSnapshot?.()
  const rows = services.sessions?.list?.getSnapshot?.()?.byId
  return {
    statuses: statuses === null || statuses === undefined ? new Map() : statuses,
    rows: rows === null || rows === undefined ? {} : rows,
  }
}

export function startNotifyRuntime(deps: NotifyRuntimeDeps): () => void {
  const source = deps.services.uiSession?.sessionStatus
  if (source === null || source === undefined) return () => {}
  const getSnapshot = source.getSnapshot
  const subscribe = source.subscribe
  if (getSnapshot === undefined || subscribe === undefined) return () => {}

  const policy = createNotifyPolicy()
  const onStatusChange = (): void => {
    const plans = policy.observe(readPolicySnapshot(deps.services))
    if (plans.length === 0) return
    if (!deps.store.isActive()) return
    if (deps.isPageActive()) return
    for (const plan of plans) deps.deliver(plan)
  }

  const dispose = subscribe.call(source, onStatusChange)
  return typeof dispose === 'function' ? dispose : () => {}
}
