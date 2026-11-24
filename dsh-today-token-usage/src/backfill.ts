/**
 * 冷会话回填：给「今天有过活动、但投影缓存里还没有本插件那一行」的旧会话补一次折叠。
 *
 * 为什么需要它：会话列表里的冷会话只按**持久化缓存里的行**出投影值（`viewCheckpoint` 零 I/O，
 * 缺行不折），而这一行只在该会话活着跨过一次存档点时才会写。插件装上之前就已经冷掉的会话，
 * 它今天早些时候用掉的 Token 因此不在任何一行里；不补，面板第一次看到的数会偏小，直到那些
 * 会话被重新打开。
 *
 * 回填只读「可能有用量」的会话，判据取缓存里已有的、与列表同一份的 `sessionListMetadata`
 * （`lastPromptAt` 是最近一次人类提示）：两者都早于今天零点就跳过，一个都不折。真正的开销
 * （打开日志 → 整段折叠 → 写回缓存）只落在今天活跃、且缺行的少数会话上；行补齐之后，再启动
 * 时这一条判据直接命中「已有行」，不再读任何日志。
 *
 * 已知缺口：只由机器提示驱动的子智能体会话没有 `lastPromptAt`，如果它**创建于昨天、今天又继续
 * 用**，这条判据会漏掉它，直到那次会话重新变活（变活后投影登记表自己会算，行也会写回）。
 */

import type { SessionEvent, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session/types'
import { startOfDay } from './wire.ts'

/** 持久化里一个会话的快照：本模块只认这几个字段。 */
export interface BackfillSession<Header> {
  /** 会话 id（日志里读出来的 header 与它同代）。 */
  readonly id: SessionId
  /** 建会话时刻（毫秒）；比今天早也可能今天有用量。 */
  readonly createdAt: number
  /** 持久化层的格式状态；需要迁移的日志不折（读了也不能当当前格式用）。 */
  readonly formatStatus?: 'current' | 'migration-required'
  /** 交给 `cached` / `refresh` 原样传下去的不透明句柄。 */
  readonly header: Header
}

/** 缓存里与列表同源的那两行：本插件的行在不在，最近一次人类提示是何时。 */
export interface CachedRows {
  /** 本插件的投影行是否存在（存在就说明这个会话已经被折过）。 */
  readonly hasRow: boolean
  /** `sessionListMetadata.lastPromptAt`；没有该行时为 null。 */
  readonly lastPromptAt: number | null
}

/** 回填需要的外部动作；宿主半部把真实服务适配进来，测试给假实现。 */
export interface BackfillServices<Header> {
  /** 列出持久化里全部会话。 */
  list(): Promise<readonly BackfillSession<Header>[]>
  /** 读缓存里那两行；整个记录的代都不匹配时返回 undefined。 */
  cached(header: Header): CachedRows | undefined
  /** 该会话此刻是否活在内存里（活着的由投影登记表自己算，不能重复折）。 */
  isLive(id: SessionId): boolean
  /** 读整段日志与继承前缀长度。 */
  read(id: SessionId, signal: AbortSignal): Promise<{ header: Header; inherited: SessionLogOffset; events: readonly SessionEvent[] }>
  /** 折叠整段日志并把结果写回缓存；失败由实现方自己记日志。 */
  refresh(header: Header, inherited: SessionLogOffset, events: readonly SessionEvent[]): void
  /** 记一条告警（单个会话失败不该中断整轮回填）。 */
  warn(message: string): void
  /** 当前时刻（毫秒），用于算今天零点。 */
  now(): number
}

/** 一次回填的结果。 */
export interface BackfillReport {
  /** 持久化里看到的会话数。 */
  readonly scanned: number
  /** 真正折叠并写回的会话数。 */
  readonly refreshed: number
  /** 读日志或折叠失败的会话数（已告警）。 */
  readonly failed: number
}

/** 判定一个会话要不要回填；纯函数，便于单测。 */
export function needsBackfill(
  input: {
    readonly createdAt: number
    readonly lastPromptAt: number | null
    readonly hasRow: boolean
    readonly live: boolean
    readonly migrationRequired: boolean
  },
  dayStart: number,
): boolean {
  if (input.live || input.migrationRequired || input.hasRow) return false
  return Math.max(input.createdAt, input.lastPromptAt ?? 0) >= dayStart
}

/**
 * 跑一轮冷会话回填。
 * @param services - 外部动作适配。
 * @param signal - 插件卸载时中止。
 * @returns 本次回填的统计。
 */
export async function backfillToday<Header>(
  services: BackfillServices<Header>,
  signal: AbortSignal,
): Promise<BackfillReport> {
  const report = { scanned: 0, refreshed: 0, failed: 0 }
  const dayStart = startOfDay(services.now())
  let sessions: readonly BackfillSession<Header>[]
  try {
    sessions = await services.list()
  } catch (error: unknown) {
    services.warn(`列出会话失败，跳过今日用量回填: ${describe(error)}`)
    return report
  }
  for (const session of sessions) {
    if (signal.aborted) return report
    report.scanned += 1
    try {
      const cached = services.cached(session.header)
      const wanted = needsBackfill({
        createdAt: session.createdAt,
        lastPromptAt: cached?.lastPromptAt ?? null,
        hasRow: cached?.hasRow ?? false,
        live: services.isLive(session.id),
        migrationRequired: session.formatStatus === 'migration-required',
      }, dayStart)
      if (!wanted) continue
      const { header, inherited, events } = await services.read(session.id, signal)
      if (signal.aborted) return report
      services.refresh(header, inherited, events)
      report.refreshed += 1
    } catch (error: unknown) {
      report.failed += 1
      services.warn(`回填会话 ${session.id} 的今日用量失败: ${describe(error)}`)
    }
  }
  return report
}

/** 把任意异常折成一行文案。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
