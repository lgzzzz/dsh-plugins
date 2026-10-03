/**
 * 宿主半部：把最近有会话活动的工作区提到左侧栏 Workspace 分组最前。
 *
 * 分组顺序就是 Workspace 注册表的持久显示顺序（`ctx.workspaceRegistry` 的 `workspaceIds`），
 * 浏览器通过 workspace 控制器 follow() 的 order 增量跟随。插件只写注册表顺序：用注册表自己的
 * `insertBefore` 把目标工作区移到最前。
 *
 * 触发与动作：
 *   - `api-session/activity`：该会话所属工作区上浮到最前；
 *   - `session/created`：登记非 subagent 且此刻还没有工作区归属的新会话；
 *   - `domain/changed`（workspace 域、工作区表）：让登记的新会话认领工作区，认领到就上浮一次。
 *
 * 其余情况不动顺序：手动拖拽、改名、新建/删除工作区都不会被覆盖。每一轮都跳过「已经在最前」
 * 的请求；插件只写全局顺序单例（`table` 为 `''`），只听工作区表。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
// 空类型导入：加载这些包对 cordis Events 的类型增强（session/created、
// api-session/activity、domain/changed），让下面的 ctx.on 回调参数有类型；不引入运行时导入。
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-storage-domain'
import {
  PENDING_TTL_MS,
  frontMove,
  owningWorkspaceId,
  planActivityFronts,
  planPendingFronts,
} from './src/bump.ts'
import type { WorkspaceRow } from './src/bump.ts'

/** 插件标识（日志名，与包名一致）。 */
export const name = 'dsh-workspace-activity-sort'

/** 依赖的宿主服务：注册表就绪前不挂载。 */
export const inject = ['workspaceRegistry']

/** 一轮收敛循环的最大轮数。 */
const MAX_ROUNDS = 8

/** 挂载自动上浮。 */
export function apply(ctx: Context): void {
  mount(ctx.workspaceRegistry, ctx)
}

/** 订阅会话活动与工作区写入，驱动上浮。 */
function mount(registry: WorkspaceRegistry, ctx: Context): void {
  let active = true
  /** 已登记、还没认领工作区的新会话：会话 id → 登记时刻。 */
  const pending = new Map<string, number>()
  /** 刚有活动、还没解析归属的会话，按事件到达顺序。 */
  const activeSessions: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let draining = false
  let pendingRun = false
  let announced = false

  ctx.effect(
    () => () => {
      active = false
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    },
    'dsh-workspace-activity-sort',
  )

  /** 注册表当前投影：字符串 id → 品牌 id，以及每个工作区账下的会话。 */
  const snapshot = (): { byId: Map<string, WorkspaceId>; rows: WorkspaceRow[] } => {
    const entities = registry.list()
    return {
      byId: new Map(entities.map((entity) => [String(entity.id), entity.id])),
      rows: entities.map((entity) => ({
        id: String(entity.id),
        sessionIds: entity.sessionIds.map(String),
      })),
    }
  }

  /**
   * 把某个工作区提到最前；已在最前或不在注册表里时不写盘。
   * 注册表拒绝时记一条告警并返回 false。
   */
  const front = async (workspaceId: string): Promise<boolean> => {
    const { byId, rows } = snapshot()
    const move = frontMove(
      rows.map((row) => row.id),
      workspaceId,
    )
    if (move === undefined) return false
    const target = byId.get(move.id)
    const anchor = byId.get(move.beforeId)
    if (target === undefined || anchor === undefined) return false
    try {
      await registry.insertBefore(target, anchor)
    } catch (error) {
      ctx.logger.warn(`dsh-workspace-activity-sort: 上浮失败（${move.id}）: ${String(error)}`)
      return false
    }
    return true
  }

  /** 跑一轮：先让登记的新会话落位，再按到达顺序处理活动请求（最新的因此停在最前）。 */
  const runOnce = async (): Promise<number> => {
    const { rows } = snapshot()
    const plan = planPendingFronts({
      workspaces: rows,
      pending: [...pending].map(([sessionId, since]) => ({ sessionId, since })),
      now: Date.now(),
      ttl: PENDING_TTL_MS,
    })
    for (const sessionId of plan.settled) pending.delete(sessionId)
    for (const sessionId of plan.expired) pending.delete(sessionId)
    const activity = activeSessions.splice(0)
    const requested = [...plan.fronts, ...planActivityFronts(rows, activity)]
    let moved = 0
    for (const request of requested) {
      if (!active) break
      if (await front(request.workspaceId)) moved += 1
    }
    return moved
  }

  /**
   * 请求一轮收敛：空闲时排到下一个宏任务，正忙就记下还要再跑一轮。
   * 延迟一个宏任务是为了读到 `domain/changed` 之后的注册表实体快照。
   */
  const schedule = (): void => {
    if (!active) return
    if (draining) {
      pendingRun = true
      return
    }
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      void drain()
    }, 0)
  }

  /** 收敛循环：一轮跑完后，如果期间又来了事件就再跑一轮；`MAX_ROUNDS` 兜底。 */
  const drain = async (): Promise<void> => {
    if (draining) {
      pendingRun = true
      return
    }
    draining = true
    try {
      let rounds = 0
      do {
        pendingRun = false
        rounds += 1
        const moved = await runOnce()
        if (moved > 0) {
          report(ctx, moved, announced)
          announced = true
        }
      } while (pendingRun && active && rounds < MAX_ROUNDS)
      if (pendingRun && rounds >= MAX_ROUNDS) {
        ctx.logger.warn('dsh-workspace-activity-sort: 连续上浮未收敛，已暂停本轮')
      }
    } catch (error) {
      ctx.logger.warn(`dsh-workspace-activity-sort: 上浮失败: ${String(error)}`)
    } finally {
      draining = false
    }
  }

  // 用户消息提交：把该会话所属工作区提到最前。
  ctx.on('api-session/activity', (sessionId) => {
    activeSessions.push(String(sessionId))
    schedule()
  })

  // 新会话：此刻注册表还没把它记到工作区账下（attach 写在创建之后），先登记。
  // 已经在账下的（resume / 重新打开旧会话）不是新建，不参与上浮。
  ctx.on('session/created', (session) => {
    if (session.header.origin === 'subagent') return
    const sessionId = String(session.id)
    if (owningWorkspaceId(snapshot().rows, sessionId) !== undefined) return
    pending.set(sessionId, Date.now())
  })

  // 会话离开宿主：还没落位的登记一并作废。
  ctx.on('session/disposed', (session) => {
    pending.delete(String(session.id))
  })

  // 工作区表的持久写入（attach / detach / 改名 …）：让登记的新会话认领一次归属。
  // 只听工作区表，因此插件自己写全局顺序单例时不会触发自己。
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'workspace' || change.table !== 'workspaces') return
    schedule()
  })
}

/** 报告一次真实发生的上浮：首次 info，之后 debug。 */
function report(ctx: Context, moved: number, announced: boolean): void {
  const line = `dsh-workspace-activity-sort: 会话活动上浮工作区（${moved} 次移动）`
  if (announced) ctx.logger.debug(line)
  else ctx.logger.info(line)
}

export default { name, inject, apply }
