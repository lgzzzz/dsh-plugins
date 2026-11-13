/**
 * 宿主半部：把最近有会话活动的工作区提到左侧栏 Workspace 分组最前。
 *
 * 分组顺序就是 Workspace 注册表的持久显示顺序（域全局单例的 `workspaceIds`，`registry.list()` 按它投影），
 * 浏览器通过 workspace 控制器 follow() 的 order 增量跟随。插件只写注册表顺序：用注册表自己的
 * `insertBefore` 把目标工作区移到最前。
 *
 * 触发与动作：
 *   - `api-session/activity`：该会话所属工作区上浮到最前；
 *   - `session/created`：登记非 subagent 且此刻还没有工作区归属的新会话；
 *   - `domain/changed`（workspace 域、工作区表）：让登记的新会话认领工作区，认领到就上浮一次；
 *   - `session/event` 的 `turn/end`：任务完成（`completed` 且跑过 step），或模型请求重试
 *     耗尽后的报错（见 `taskOutcome`），该会话所属工作区上浮。
 *
 * 其余情况不动顺序：手动拖拽、改名、新建/删除工作区都不会被覆盖。每一轮都跳过「已经在最前」
 * 的请求；插件只写全局顺序单例（`table` 为 `''`），只听工作区表。
 *
 * 触发条件、上浮规则与已知边界见 docs/dsh-workspace-activity-sort.md。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WorkspaceId, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
// 空类型导入：加载这些包对 cordis Events 的类型增强（session/created、session/event、
// api-session/activity、domain/changed），让下面的 ctx.on 回调参数有类型；不引入运行时导入。
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-storage-domain'
import {
  PENDING_TTL_MS,
  frontMove,
  owningWorkspaceId,
  planActivityFronts,
  planPendingFronts,
  taskOutcome,
} from './src/bump.ts'
import type { RequestRetry, WorkspaceRow } from './src/bump.ts'

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
  /** 当前 step 最近一次模型请求重试：会话 id → 记录（`step/start` 时清空，重试按 step 计数）。 */
  const retries = new Map<string, RequestRetry>()
  /** 最近开始过 step 的回合：会话 id → 回合号，用来判定回合有没有真的跑过模型。 */
  const steppedTurn = new Map<string, number>()
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

  // 会话离开宿主：还没落位的登记、重试记录一并作废。
  ctx.on('session/disposed', (session) => {
    const sessionId = String(session.id)
    pending.delete(sessionId)
    retries.delete(sessionId)
    steppedTurn.delete(sessionId)
  })

  // 回合终态：任务完成，或模型请求重试耗尽后的报错，都算一次活跃。
  // 重试按 step 计数（`llm/retry` 属于当前 step），`step/start` 清空上一 step 的记录。
  ctx.on('session/event', (session, event) => {
    if (session.header.origin === 'subagent') return
    const sessionId = String(session.id)
    if (event.type === 'step/start') {
      retries.delete(sessionId)
      steppedTurn.set(sessionId, event.data.turn)
      return
    }
    const retry = retryEventData(event)
    if (retry !== undefined) {
      retries.set(sessionId, retry)
      return
    }
    if (event.type !== 'turn/end') return
    const { turn, reason } = event.data
    const outcome = taskOutcome({
      turn,
      kind: reason.kind,
      failureCode: reason.kind === 'error' ? reason.error.code : undefined,
      retry: retries.get(sessionId),
      hadStep: steppedTurn.get(sessionId) === turn,
    })
    retries.delete(sessionId)
    steppedTurn.delete(sessionId)
    if (outcome === undefined) return
    activeSessions.push(sessionId)
    schedule()
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

/**
 * `llm/retry` 事件里规划需要的字段。
 *
 * 返回类型是上游 `LlmRetryEventData` 的投影（见 `RequestRetry`）；读取仍按公开事件结构逐字段
 * 校验：恢复的旧日志或字段不完整的事件一律返回 undefined（宁可不判定，也不误判）。
 */
function retryEventData(event: SessionEvent): RequestRetry | undefined {
  const raw = event as unknown as { type: string; data?: Record<string, unknown> }
  if (raw.type !== 'llm/retry') return undefined
  const data = raw.data
  if (data === undefined) return undefined
  const { mode, turn, retry, maxRetries } = data
  if (mode !== 'normal' && mode !== 'always') return undefined
  if (typeof turn !== 'number' || typeof retry !== 'number') return undefined
  if (mode === 'normal' && typeof maxRetries !== 'number') return undefined
  return {
    mode,
    turn,
    retry,
    ...(mode === 'normal' ? { maxRetries: maxRetries as number } : {}),
  }
}

export default { name, inject, apply }
