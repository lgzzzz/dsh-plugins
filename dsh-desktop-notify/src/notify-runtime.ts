/**
 * 运行时:订阅 uiSession.sessionStatus,把判定结果交给 delivery。
 * 不碰 DOM(页面是否前台、Notification 构造都由 deps 注入),便于纯 Node 驱动。
 */
import { createNotifyPolicy, type PlannedNotification } from './notify-policy.ts'
import type { NotifyStore } from './notify-store.ts'
import type { NotifyServices, SessionStatusLike, SessionSummaryLike } from './types.ts'

export interface PolicySnapshotLike {
  statuses: ReadonlyMap<string, SessionStatusLike>
  rows: Readonly<Record<string, SessionSummaryLike>>
}

export interface NotifyRuntimeDeps {
  services: NotifyServices
  /** 只需要开关读数(isActive),运行时从不写状态。 */
  store: Pick<NotifyStore, 'isActive'>
  /** 页面在前台(有焦点且可见)时为 true:此时不打扰。 */
  isPageActive(): boolean
  deliver(plan: PlannedNotification): void
}

/** 读一帧:状态表(源缺席 / 未就绪 = 空表) + 会话列表行(取标题用)。 */
export function readPolicySnapshot(services: NotifyServices): PolicySnapshotLike {
  const statuses = services.uiSession?.sessionStatus?.getSnapshot?.()
  const rows = services.sessions?.list?.getSnapshot?.()?.byId
  return {
    statuses: statuses === null || statuses === undefined ? new Map() : statuses,
    rows: rows === null || rows === undefined ? {} : rows,
  }
}

/**
 * 开始观察。返回取消订阅的 disposer。
 * 服务面(uiSession.sessionStatus)缺席即 no-op —— 不降级到 DOM 观测。
 * 判定始终推进(即使当前不发通知),这样中途开启开关不会把历史状态补发一遍。
 */
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

  // 上游两方法都是闭包属性,不读 this;仍按服务面惯例以方法形式调用
  const dispose = subscribe.call(source, onStatusChange)
  return typeof dispose === 'function' ? dispose : () => {}
}
