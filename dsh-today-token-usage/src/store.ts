/**
 * 宿主半部的落盘存储：把当天每一次模型调用追加到 `requests-YYYY-MM-DD.jsonl`，同时维护当天与
 * 当月的内存合计供路由读取，并把每月汇总写进 `months/YYYY-MM.json`。
 *
 * 生命周期：`load()`（启动时读当天文件、恢复合计与当月累计）→ `record()`（每次模型流结束，
 * 同步更新内存 + 串行 append 一行，并给月度汇总排一次写入）→ `snapshot()`（路由读取）→
 * `dispose()`（清掉定时器、写完最后一份月度汇总、排空写队列）。跨过本地零点后自动换到新的一天，
 * 并顺手清理过期日文件；跨月时先把上月汇总落盘，再从零累计新月份。日文件按 {@link RETENTION_DAYS}
 * 清理；月文件不清理（过去的数据存起来，以后有需要再读）。
 *
 * 月度汇总与重启对账：汇总里带 `checkpointDay` / `checkpoint`（写入时刻当天的读数）。
 *   - checkpoint 就是今天：用 journal 当天文件里的全量替换它——journal 的追加是异步的，最后几笔
 *     可能晚于汇总落盘，换过之后跨重启既不重复也不漏计；
 *   - checkpoint 更早（隔了整天没写过）、缺失、损坏或月份对不上：差额法补不回中间那些日子，
 *     回退为扫本月日文件重建（当月日文件都在 {@link RETENTION_DAYS} 保留期内，31 个文件一遍读完）；
 *   - 今天的日文件读不出来：保留汇总原值，并且本次进程不再覆盖月文件——拿 0 去替换会把今天抹掉，
 *     而写回一个偏低的 checkpoint 会让下次重启重复计数。
 *
 * 汇总的写入是「首次待写后最多 2 秒」的节流：记录再密也不会一直向后推。
 *
 * 失败策略：**存储问题永远不冒到模型调用链**。读盘失败按空数据处理、写盘失败只告警一次，
 * 内存合计照常推进，因此面板在磁盘异常时仍然可用（重启后只能恢复成功写入的部分）。
 */

import { appendFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { TodayUsagePayload } from './wire.ts'
import { dayKey, shiftedDayKey } from './wire.ts'
import type { TodayTotals, UsageRecord } from './journal.ts'
import {
  RETENTION_DAYS,
  addRecord,
  dayOfJournalFileName,
  emptyTotals,
  encodeRecord,
  journalFileName,
  sanitizeUsage,
  totalsFromJournalText,
} from './journal.ts'
import {
  addRecordToMonth,
  checkpointOf,
  emptyMonth,
  monthKeyOf,
  monthSummaryOf,
  monthTotalsOf,
  replaceCheckpointDay,
} from './month.ts'
import type { MonthSummary, MonthTotals } from './month.ts'
import {
  ensureMonthDirectory,
  readMonthSummary,
  rebuildMonthFromFiles,
  writeMonthSummary,
} from './month-store.ts'

/** 一次模型调用的身份信息（监听入口同步抄下来的原始值）。 */
export interface RecordInput {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
  readonly sessionId?: string
  readonly purpose?: string
  readonly finish?: string
  readonly usage: TokenUsage
}

/** 一次记录之后，月度汇总最多延迟多久落盘（毫秒）。 */
export const MONTH_FLUSH_DELAY_MS = 2_000

/** 恢复当月累计的结果：内存值与能否写回磁盘。 */
export interface MonthRestore {
  /** 当月累计。 */
  readonly totals: MonthTotals
  /** 是否可以拿它覆盖月文件；重建不完整时为 false。 */
  readonly persist: boolean
}

/** 构造选项。 */
export interface TodayStoreOptions {
  /** journal 目录（`$DSH_HOME/state/today-token-usage`）。 */
  readonly directory: string
  /** 保留天数，含今天；默认 {@link RETENTION_DAYS}。 */
  readonly retentionDays?: number
  /** 当前时刻（测试可注入）。 */
  readonly now?: () => number
  /** 告警出口（测试可注入）；同一类错误每个实例只报一次。 */
  readonly onError?: (message: string, error?: unknown) => void
}

/** store 的对外面。 */
export interface TodayStore {
  /** journal 目录。 */
  readonly directory: string
  /** 读当天与当月文件恢复合计并清理过期文件；仅调用一次。 */
  load(): Promise<void>
  /** 记一次模型调用：同步更新当天 / 当月合计，异步串行追加一行并排一次月度汇总写入。 */
  record(input: RecordInput): void
  /** 读取当天合计（含当月累计；跨零点时自动切到新的一天并通知订阅者）。 */
  snapshot(): TodayUsagePayload
  /**
   * 订阅当天合计的变化：每次记录成功、以及跨零点后下一次读取都会回调一次。
   * @param listener - 新的当天读数（冻结的副本）。
   * @returns 取消订阅。
   */
  subscribe(listener: (payload: TodayUsagePayload) => void): () => void
  /** 清理超过保留期的日文件；月度汇总不清理。 */
  prune(): Promise<void>
  /** 写完最后一份月度汇总并排空写队列。 */
  dispose(): Promise<void>
}

/** 把当天与当月合计冻结成对外值。 */
function freezePayload(totals: TodayTotals, month: MonthTotals): TodayUsagePayload {
  return Object.freeze({
    day: totals.day,
    requests: totals.requests,
    uncachedInputTokens: totals.uncachedInputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    cost: Object.freeze({ ...totals.cost }),
    month: Object.freeze({
      month: month.month,
      requests: month.requests,
      uncachedInputTokens: month.uncachedInputTokens,
      outputTokens: month.outputTokens,
      cacheReadTokens: month.cacheReadTokens,
      cacheWriteTokens: month.cacheWriteTokens,
      cost: Object.freeze({ ...month.cost }),
    }),
  })
}

/**
 * 创建一个 journal 存储。
 * @param options - 目录、保留天数、时钟与告警出口。
 * @returns 未加载的 store；调用方必须先 `await load()`。
 */
export function createTodayStore(options: TodayStoreOptions): TodayStore {
  const directory = options.directory
  const retentionDays = Math.max(1, options.retentionDays ?? RETENTION_DAYS)
  const now = options.now ?? Date.now
  const report = options.onError ?? (() => {})
  const warned = new Set<string>()
  let totals: TodayTotals = emptyTotals(dayKey(now()))
  let monthTotals: MonthTotals = emptyMonth(monthKeyOf(totals.day))
  let queue: Promise<void> = Promise.resolve()
  let loaded = false
  let pendingMonth: MonthSummary | undefined
  let monthTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * 本次进程是否不许覆盖月文件：启动时今天的日文件读不出来时为 true——月汇总里今天的读数
   * 无从核对，写回任何 checkpoint 都会让下次重启重复或漏计，宁可在磁盘上留旧值。
   */
  let monthWritesBlocked = false
  const listeners = new Set<(payload: TodayUsagePayload) => void>()

  /** 同一类存储告警只报一次，避免每个请求刷一行日志。 */
  const warnOnce = (kind: string, message: string, error?: unknown): void => {
    if (warned.has(kind)) return
    warned.add(kind)
    report(message, error)
  }

  /** 把当前合计交给订阅者；单个订阅者失败不影响其它订阅者与记录主流程。 */
  const notify = (): void => {
    if (listeners.size === 0) return
    const payload = freezePayload(totals, monthTotals)
    for (const listener of [...listeners]) {
      try {
        listener(payload)
      } catch (error) {
        warnOnce('notify', '推送当天读数给订阅者失败', error)
      }
    }
  }

  /** 串行写盘；失败只告警，队列本身保持可继续使用。 */
  const enqueue = (kind: string, message: string, task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      warnOnce(kind, message, error)
    })
  }

  /**
   * 把待写的月度汇总排进写队列（同一时刻只有最新一份）。
   *
   * 写的是 `pendingMonth`，也就是最近一次记录时的当月累计：重建 / 对账之后要先把新合计赋给
   * `monthTotals` 再调用这里，否则写出去的会是赋值前的旧值。
   */
  const flushMonthNow = (): void => {
    const summary = pendingMonth
    if (summary === undefined) return
    pendingMonth = undefined
    enqueue('month-write', '写入月度汇总失败；下次记录或退出时重试', () => writeMonthSummary(directory, summary))
  }

  /**
   * 节流：第一次有待写汇总时起一个 {@link MONTH_FLUSH_DELAY_MS} 的定时器，到点把当时最新的
   * 累计写出去。记录再密也不会把这个定时器一直向后推，所以「最多滞后一个窗口」对连续流量也成立。
   */
  const scheduleMonthFlush = (): void => {
    if (monthTimer !== undefined) return
    monthTimer = setTimeout(() => {
      monthTimer = undefined
      flushMonthNow()
    }, MONTH_FLUSH_DELAY_MS)
    monthTimer.unref?.()
  }

  /** 把当前当月累计排成待写汇总（checkpoint 用当前这一天的读数）。 */
  const queueMonthSnapshot = (): void => {
    if (monthWritesBlocked) return
    pendingMonth = monthSummaryOf(monthTotals, totals.day, totals)
    scheduleMonthFlush()
  }

  /**
   * 跨过本地零点：换成新一天的空合计；跨月时先把上月汇总排进写队列，再从零累计新月份。
   *
   * 本地时钟回拨（新日期早于当前合计的日期）不算换天：把已经记下的今天清零、或者把今天的记录
   * 记到前一天，都会让日文件与月汇总对不上，所以只告警一次并停在当前这一天。
   * @param time - 当前时刻（毫秒）。
   * @returns 是否真的换了天（调用方据此决定要不要通知订阅者）。
   */
  const ensureDay = (time: number): boolean => {
    const day = dayKey(time)
    if (day === totals.day) return false
    if (day < totals.day) {
      warnOnce('clock-back', `本地日期从 ${totals.day} 回退到 ${day}；暂不换天，等时钟恢复`)
      return false
    }
    const previousMonth = monthKeyOf(totals.day)
    const nextMonth = monthKeyOf(day)
    if (previousMonth !== nextMonth) {
      // 上月到此为止：把当前快照写出去，然后换月清零。
      if (!monthWritesBlocked) {
        pendingMonth = monthSummaryOf(monthTotals, totals.day, totals)
        flushMonthNow()
      }
      monthTotals = emptyMonth(nextMonth)
    }
    totals = emptyTotals(day)
    // 换天顺手清理过期日文件：宿主连续运行几十天也不会一直攒着旧文件。
    void store.prune()
    return true
  }

  /**
   * 恢复当月累计。
   *
   * 只有「汇总的 checkpoint 就是今天、且今天的日文件读出来了」时才能靠差额对账；其余情况
   * （checkpoint 更早、缺失、损坏、月份对不上）都回退为扫本月日文件重建——当月日文件都在保留期内。
   * @param month - 当前月份键。
   * @param day - 当前日期键。
   * @param todayReadable - 今天的日文件是否成功读出（不存在也算读不出）。
   * @returns 当月累计与能否写回。
   */
  const restoreMonth = async (month: string, day: string, todayReadable: boolean): Promise<MonthRestore> => {
    try {
      await ensureMonthDirectory(directory)
    } catch (error) {
      warnOnce('months-dir', '创建月度汇总目录失败；月份只保存在内存里', error)
    }
    const summary = await readMonthSummary(directory, month)
    const checkpoint = summary !== undefined && summary.month === month ? checkpointOf(summary) : undefined
    if (summary !== undefined && summary.month === month && checkpoint !== undefined && checkpoint.day === day) {
      if (!todayReadable) {
        // 今天的日文件读不出来：保留汇总里的今天，别再减一次 0；本次进程也不覆盖月文件。
        monthWritesBlocked = true
        warnOnce('month-day', '今天的 journal 读不出来；本月沿用月汇总里的读数，本次运行不覆盖月文件')
        return { totals: monthTotalsOf(month, summary.totals), persist: false }
      }
      return { totals: replaceCheckpointDay(summary, checkpoint, totals), persist: true }
    }
    const rebuilt = await rebuildMonthFromFiles(directory, month)
    if (rebuilt.skippedLines > 0) {
      // 与当天读取共用同一个告警键：同一次启动里「journal 有坏行」只说一次。
      warnOnce('corrupt', `本月 journal 有 ${rebuilt.skippedLines} 行无法解析，已跳过`)
    }
    if (rebuilt.unreadableFiles > 0) {
      warnOnce('month-read', `本月有 ${rebuilt.unreadableFiles} 个日文件读不出来，当月合计可能偏小`)
    }
    // 日文件读不全时不拿偏小的重建结果覆盖月文件，只在内存里用。
    return { totals: rebuilt.totals, persist: rebuilt.unreadableFiles === 0 }
  }

  const store: TodayStore = {
    directory,

    async load(): Promise<void> {
      if (loaded) return
      loaded = true
      const day = dayKey(now())
      totals = emptyTotals(day)
      monthTotals = emptyMonth(monthKeyOf(day))
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 })
      } catch (error) {
        warnOnce('mkdir', '创建 journal 目录失败；用量只保存在内存里', error)
        return
      }
      const path = join(directory, journalFileName(day))
      let text: string | undefined
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          warnOnce('read', '读取当天 journal 失败；从零开始累计', error)
        }
      }
      if (text !== undefined) {
        const parsed = totalsFromJournalText(day, text)
        totals = parsed.totals
        if (parsed.skipped > 0) {
          warnOnce('corrupt', `当天 journal 有 ${parsed.skipped} 行无法解析，已跳过`)
        }
      }
      // 今天的日文件读不出来（不存在也算）时，恢复流程会保留汇总里的今天并禁止覆盖月文件。
      const restored = await restoreMonth(monthKeyOf(day), day, text !== undefined)
      monthTotals = restored.totals
      // 恢复之后才排队：queueMonthSnapshot 读的是 monthTotals，先赋后写才不会把空汇总写出去。
      if (restored.persist) queueMonthSnapshot()
      await store.prune()
    },

    record(input: RecordInput): void {
      const usage = sanitizeUsage(input.usage)
      if (usage === undefined) return
      const time = now()
      ensureDay(time)
      const record: UsageRecord = {
        v: 1,
        time,
        day: totals.day,
        provider: input.provider,
        model: input.model,
        ...input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort },
        ...input.sessionId === undefined ? {} : { sessionId: input.sessionId },
        ...input.purpose === undefined ? {} : { purpose: input.purpose },
        ...input.finish === undefined ? {} : { finish: input.finish },
        usage,
      }
      totals = addRecord(totals, record)
      monthTotals = addRecordToMonth(monthTotals, record)
      queueMonthSnapshot()
      notify()
      const line = `${encodeRecord(record)}\n`
      const path = join(directory, journalFileName(record.day))
      enqueue('append', '写入 journal 失败；面板仍按内存合计显示', async () => {
        await appendFile(path, line, { mode: 0o600 })
      })
    },

    snapshot(): TodayUsagePayload {
      if (ensureDay(now())) notify()
      return freezePayload(totals, monthTotals)
    },

    subscribe(listener: (payload: TodayUsagePayload) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async prune(): Promise<void> {
      let names: string[]
      try {
        names = await readdir(directory)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          warnOnce('prune', '读取 journal 目录失败；跳过过期清理', error)
        }
        return
      }
      // 保留今天 + 前 (retentionDays - 1) 天；文件名是 YYYY-MM-DD，字典序即时间序。
      const cutoff = shiftedDayKey(now(), -(retentionDays - 1))
      for (const name of names) {
        const day = dayOfJournalFileName(name)
        if (day === undefined || day >= cutoff) continue
        try {
          await unlink(join(directory, name))
        } catch (error) {
          warnOnce('prune-file', '删除过期 journal 失败', error)
        }
      }
      // 月度汇总目录里的文件不清理：过去的月份要留着以后读。
      try {
        await ensureMonthDirectory(directory)
      } catch (error) {
        warnOnce('months-dir', '创建月度汇总目录失败；月份只保存在内存里', error)
      }
    },

    async dispose(): Promise<void> {
      if (monthTimer !== undefined) {
        clearTimeout(monthTimer)
        monthTimer = undefined
      }
      // 退出前把当前月的最新读数写出去（没有记录时也写一份零值，便于区分「没跑过」与「空月份」）；
      // 今天日文件读不出来时写回会污染 checkpoint，本次进程就不覆盖月文件。
      if (!monthWritesBlocked) {
        pendingMonth = monthSummaryOf(monthTotals, totals.day, totals)
        flushMonthNow()
      }
      await queue
    },
  }

  return store
}
