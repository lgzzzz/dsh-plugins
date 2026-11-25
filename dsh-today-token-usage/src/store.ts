/**
 * 宿主半部的落盘存储：把当天每一次模型调用追加到 `requests-YYYY-MM-DD.jsonl`，同时维护
 * 当天内存合计供路由读取。
 *
 * 生命周期：`load()`（启动时读当天文件、恢复合计）→ `record()`（每次模型流结束，同步更新
 * 内存 + 串行追加一行）→ `snapshot()`（路由读取）→ `dispose()`（排空写队列）。跨过本地零点后
 * 自动换到新的一天：内存合计清零，旧文件按 {@link RETENTION_DAYS} 清理（保留今天 + 前 29 天）。
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
  parseRecordLine,
  sanitizeUsage,
} from './journal.ts'

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
  /** 读当天文件恢复合计并清理过期文件；仅调用一次。 */
  load(): Promise<void>
  /** 记一次模型调用：同步更新合计，异步串行追加一行。 */
  record(input: RecordInput): void
  /** 读取当天合计（跨零点时自动切到新的一天并通知订阅者）。 */
  snapshot(): TodayUsagePayload
  /**
   * 订阅当天合计的变化：每次记录成功、以及跨零点后下一次读取都会回调一次。
   * @param listener - 新的当天读数（冻结的副本）。
   * @returns 取消订阅。
   */
  subscribe(listener: (payload: TodayUsagePayload) => void): () => void
  /** 清理超过保留期的日文件。 */
  prune(): Promise<void>
  /** 排空写队列。 */
  dispose(): Promise<void>
}

/** 把当天合计冻结成对外值。 */
function freezePayload(totals: TodayTotals): TodayUsagePayload {
  return Object.freeze({
    day: totals.day,
    requests: totals.requests,
    uncachedInputTokens: totals.uncachedInputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
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
  let queue: Promise<void> = Promise.resolve()
  let loaded = false
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
    const payload = freezePayload(totals)
    for (const listener of [...listeners]) {
      try {
        listener(payload)
      } catch (error) {
        warnOnce('notify', '推送当天读数给订阅者失败', error)
      }
    }
  }

  /**
   * 跨过本地零点：换成新一天的空合计（旧文件留在磁盘上，由 prune 处理）。
   * @returns 是否真的换了天（调用方据此决定要不要通知订阅者）。
   */
  const ensureDay = (time: number): boolean => {
    const day = dayKey(time)
    if (day === totals.day) return false
    totals = emptyTotals(day)
    return true
  }

  /** 串行追加一行；失败只告警，队列本身保持可继续使用。 */
  const enqueue = (task: () => Promise<void>): void => {
    queue = queue.then(task).catch((error: unknown) => {
      warnOnce('append', '写入 journal 失败；面板仍按内存合计显示', error)
    })
  }

  const store: TodayStore = {
    directory,

    async load(): Promise<void> {
      if (loaded) return
      loaded = true
      const day = dayKey(now())
      totals = emptyTotals(day)
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 })
      } catch (error) {
        warnOnce('mkdir', '创建 journal 目录失败；用量只保存在内存里', error)
        return
      }
      const path = join(directory, journalFileName(day))
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          warnOnce('read', '读取当天 journal 失败；从零开始累计', error)
        }
        await store.prune()
        return
      }
      let skipped = 0
      for (const line of text.split('\n')) {
        const record = parseRecordLine(line, day)
        if (record === undefined) {
          if (line.trim().length > 0) skipped += 1
          continue
        }
        totals = addRecord(totals, record)
      }
      if (skipped > 0) {
        warnOnce('corrupt', `当天 journal 有 ${skipped} 行无法解析，已跳过`)
      }
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
      notify()
      const line = `${encodeRecord(record)}\n`
      const path = join(directory, journalFileName(record.day))
      enqueue(async () => {
        await appendFile(path, line, { mode: 0o600 })
      })
    },

    snapshot(): TodayUsagePayload {
      if (ensureDay(now())) notify()
      return freezePayload(totals)
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
    },

    async dispose(): Promise<void> {
      await queue
    },
  }

  return store
}
