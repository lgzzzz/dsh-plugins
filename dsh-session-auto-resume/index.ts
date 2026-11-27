/**
 * 宿主半部：DSH 启动后，把「没跑完就被打断」的会话恢复过来并自动续跑。
 *
 * 流程（每进程一次，HMR 重载会重跑一遍，但已有 live Agent 的会话会被跳过）：
 *
 *   1. 等 `startupDelayMs` 让 profile 启动稳定；
 *   2. 用 `ctx.sessionController.list()` 拿会话列表（不激活任何 Agent），按最近活动
 *      时间窗、归档、subagent、live / running 过滤出候选；
 *   3. 逐个读会话日志，取最后一轮的 `turn/end.reason`：
 *        - interrupted（崩溃 / 被杀）→ 恢复；
 *        - aborted 且原因是 disposed / parent / hook → 恢复；
 *        - aborted:user（用户点了停止）、aborted:legacy、completed、error、
 *          max-tokens、blocked → 不动；
 *   4. `ctx.sessionController.resolveAgent()` 恢复该会话的 Agent（与 GUI 打开会话
 *      走同一条路径：按会话自己的 preset 组合、按需给浏览器补观察者）；
 *   5. 追加一条可配置的续跑消息（`ctx.sessionController.prompt()`，与用户输入同一条
 *      准入路径，所以会记成一条普通 user 消息），再 `ctx.sessions.flush()` 等持久化确认。
 *
 * 已知边界（详见 docs/DETAIL.md）：会消耗 token；需要审批的工具在无人应答时按
 * fail-closed 结算为 unavailable；hook 取消默认也算“被打断”，可用配置关掉。
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  continuationText,
  inspectTurn,
  restartDecision,
  selectCandidates,
} from './src/decide.ts'

/** 日志前缀；插件名与包名、patch id / name 一致。 */
const LOG = 'dsh-session-auto-resume'

/** 插件标识（日志名）。 */
export const name = LOG

/** 默认续跑文案；`{reason}` 每次替换成这次中断的标签。 */
const DEFAULT_CONTINUATION = '（DSH 自动恢复：{reason}）上一轮没有正常结束。'
  + '请先检查当前状态和工具结果，再从中断处继续未完成的工作；不要重复已经完成的步骤。'

/**
 * 依赖的宿主服务。`sessionController` 只由 Web profile 提供：别的 profile 里本行
 * 会停在等待状态，不会误跑。
 */
export const inject = ['sessions', 'agents', 'sessionController', 'sessionQuery']

/** 本插件的配置；对应 `cordis.patch.yml` 里这一行的 `config`。 */
export interface Config {
  /** 只处理最近这么多天内有活动的会话；0 表示不限。 */
  windowDays: number
  /** 每次启动最多恢复几个会话。 */
  maxResumes: number
  /** 每次启动最多读多少个候选会话的日志（恢复数另有上限）。 */
  scanLimit: number
  /** 启动后等多久再扫描，让 profile 组合先稳定下来。 */
  startupDelayMs: number
  /** 续跑文案；`{reason}` 会替换成这次中断的标签。 */
  continuationMessage: string
  /** hook 主动取消的轮次是否也恢复（默认恢复；hook 可能每次都会重演）。 */
  includeHookCancelled: boolean
  /** 只记日志、不真的恢复，用来先核对会动哪些会话。 */
  dryRun: boolean
}

/** 配置 schema，默认值就是推荐的保守口径。 */
export const Config = z.object({
  windowDays: z.number().min(0).max(365).default(7)
    .description('只处理最近这么多天内有活动的会话；0 表示不限时间。'),
  maxResumes: z.natural().max(50).default(10)
    .description('每次启动最多恢复几个会话。'),
  scanLimit: z.natural().min(1).max(2000).default(300)
    .description('每次启动最多读多少个候选会话的日志。'),
  startupDelayMs: z.natural().max(120_000).default(3000)
    .description('启动后等多少毫秒再扫描，让 profile 组合先稳定下来。'),
  continuationMessage: z.string().default(DEFAULT_CONTINUATION)
    .description('恢复后追加的续跑消息；{reason} 会替换成中断标签。'),
  includeHookCancelled: z.boolean().default(true)
    .description('hook 主动取消的轮次是否也恢复；关掉后只恢复崩溃与被销毁的轮次。'),
  dryRun: z.boolean().default(false)
    .description('只记日志、不真的恢复，用来先核对会动哪些会话。'),
})

/** 挂载启动扫描；扫描失败只记日志，绝不让启动变成失败插件。 */
export function apply(ctx: Context, config: Config): void {
  // 先取出 logger：卸载后 ctx 上的服务访问会失效，日志引用本身仍然可用。
  const logger = ctx.logger
  // 生命周期结束时中断扫描：list / prompt 拿到的 signal 与“是否已取消”共用它。
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), `${LOG}: abort startup scan`)

  const timer = setTimeout(() => {
    void scan(ctx, config, lifetime.signal, logger).catch((error: unknown) => {
      if (!lifetime.signal.aborted) {
        logger.warn(`${LOG}: 启动扫描失败: ${describe(error)}`)
      }
    })
  }, config.startupDelayMs)
  timer.unref()
  ctx.effect(() => () => clearTimeout(timer), `${LOG}: clear startup timer`)
}

/**
 * 扫一遍会话列表，恢复被打断的会话。
 * @param ctx - 插件上下文。
 * @param config - 已校验的配置。
 * @param signal - 插件生命周期；abort 后不再发起新的恢复。
 * @param logger - 插件加载时取出的日志器。
 */
async function scan(
  ctx: Context,
  config: Config,
  signal: AbortSignal,
  logger: Context['logger'],
): Promise<void> {
  if (config.maxResumes <= 0) {
    logger.info(`${LOG}: maxResumes 为 0，跳过启动扫描`)
    return
  }

  const summaries = (await ctx.sessionController.list({}, signal)).items
  if (signal.aborted) return

  const archived = new Set<string>(
    (ctx.get('workspaceRegistry')?.archivedSessionIds ?? []).map((id) => String(id)),
  )
  const live = new Set<string>(ctx.agents.list().map((agent) => String(agent.id)))
  const candidates = selectCandidates(
    summaries.map((item) => ({
      sessionId: String(item.sessionId),
      updatedAt: item.updatedAt,
      running: item.running,
      blank: item.blank,
      ...(item.origin === undefined ? {} : { origin: item.origin }),
      ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
    })),
    {
      now: Date.now(),
      windowDays: config.windowDays,
      archived,
      live,
      scanLimit: config.scanLimit,
    },
  )

  let inspected = 0
  let resumed = 0
  let skipped = 0
  for (const candidate of candidates) {
    if (signal.aborted) return
    if (resumed >= config.maxResumes) break
    inspected++

    let events: readonly SessionEvent[]
    try {
      events = (await ctx.sessionQuery.readSession(candidate.sessionId as SessionId)).events
    } catch (error: unknown) {
      if (signal.aborted) return
      logger.warn(`${LOG}: 读取会话 ${candidate.sessionId} 失败: ${describe(error)}`)
      skipped++
      continue
    }
    if (signal.aborted) return

    const outcome = inspectTurn(events)
    const decision = restartDecision(outcome, config)
    if (decision === undefined) {
      skipped++
      continue
    }

    // 列表到读日志之间，这个会话可能已经被别人打开或跑起来了。
    if (ctx.agents.get(candidate.sessionId as SessionId) !== undefined) {
      skipped++
      continue
    }

    // 干跑只报告，不恢复：连 resolveAgent 都不做，避免顺手建立 live Agent。
    if (config.dryRun) {
      logger.info(`${LOG}: [dry-run] 会恢复会话 ${candidate.sessionId}（${decision.label}）`)
      resumed++
      continue
    }

    try {
      const resolved = await ctx.sessionController.resolveAgent(candidate.sessionId as SessionId)
      if (signal.aborted) return
      if ('error' in resolved) {
        logger.warn(
          `${LOG}: 无法恢复会话 ${candidate.sessionId}（${decision.label}）: `
          + `${resolved.error.code} ${resolved.error.message}`,
        )
        skipped++
        continue
      }
      const agent = resolved.agent
      // 恢复出来的 Agent 已经在跑说明有人先一步接手了，不再追加消息。
      if (agent.status !== 'idle') {
        skipped++
        continue
      }

      // 空文案会让 prompt 以 gateway/bad-request 失败；宁可回落到默认文案。
      const configured = config.continuationMessage.trim() === ''
        ? DEFAULT_CONTINUATION
        : config.continuationMessage
      const text = continuationText(configured, decision)
      await ctx.sessionController.prompt(
        {
          requestId: randomUUID() as SessionRequestId,
          sessionId: candidate.sessionId as SessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        },
        signal,
      )
      if (signal.aborted) return
      const flushed = await ctx.sessions.flush(agent.session)
      if (!flushed) {
        logger.warn(`${LOG}: 会话 ${candidate.sessionId} 的续跑消息没有持久化监听确认`)
      }
      if (signal.aborted) return
      resumed++
      logger.info(`${LOG}: 已恢复会话 ${candidate.sessionId}（${decision.label}）`)
    } catch (error: unknown) {
      if (signal.aborted) return
      logger.warn(
        `${LOG}: 恢复会话 ${candidate.sessionId}（${decision.label}）失败: ${describe(error)}`,
      )
      skipped++
    }
  }

  logger.info(
    `${LOG}: 扫描 ${inspected}/${candidates.length} 个候选会话，`
    + `恢复 ${resumed} 个，跳过 ${skipped} 个`
    + `${config.dryRun ? '（dry-run，未真正恢复）' : ''}`,
  )
}

/** 把未知错误压成一行，避免日志里出现 `[object Object]`。 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
