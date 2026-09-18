/** 视图层取数:当前会话与「完成未读」。
 * dsh 0.1.6-alpha.2 起 sessions.list 快照不再带 current / completed(选择权移出 Session Controller):
 * 当前会话改由 uiSession.current 绑定源承载,完成未读改由 uiSession.sessionStatus 承载。
 * 只读这两处服务面,不触碰 DOM、无 DOM 降级。 */
import type { Services, SessionListSnapshotLike } from './types.ts'

/** 当前会话 id:uiSession.current 绑定源的 key;源不可读时回退目录里被主视图持有的那一行(与上游 publishMain 同判据)。 */
export function currentSessionId(services: Services): string | undefined {
  let key: string | undefined
  try {
    key = services.uiSession?.current?.getSnapshot?.()?.key
  } catch {
    key = undefined
  }
  if (key !== undefined && key !== '') return key
  return mainViewSessionId(services.sessions?.list?.getSnapshot?.())
}

/** 目录里被主视图持有的会话 id(retainedBy.mainView > 0);快照不可读 / 无该字段即 undefined。 */
function mainViewSessionId(snapshot: SessionListSnapshotLike | undefined): string | undefined {
  const byId = snapshot?.byId
  if (byId === undefined || byId === null) return undefined
  for (const id of Object.keys(byId)) {
    if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
  }
  return undefined
}

/** 完成未读(替代已删除的 summary.completed):uiSession.sessionStatus 的 completionUnread。 */
export function completionUnread(services: Services, sessionId: string): boolean {
  let map: ReadonlyMap<string, { completionUnread?: boolean }> | undefined
  try {
    map = services.uiSession?.sessionStatus?.getSnapshot?.()
  } catch {
    map = undefined
  }
  if (map === undefined || map === null || typeof map.get !== 'function') return false
  return map.get(sessionId)?.completionUnread === true
}
