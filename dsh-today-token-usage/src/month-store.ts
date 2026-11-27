/**
 * 月度汇总的落盘：`<journal 目录>/months/YYYY-MM.json`，一个月一个文件。
 *
 * 面板只显示「今天」与「本月」，但每个月都会在跨月、重启与记录间隙里写一份汇总，供以后读取
 * （文件很小，约几百字节）。写盘用「临时文件 + rename」，读盘遇到缺失或损坏一律返回
 * undefined，由调用方回退成扫该月的日文件重建——月度汇总是可以随时重算的派生数据。
 *
 * 保留策略：日文件按 `retentionDays`（35 天）清理；月文件**不清理**，因为「过去的数据存起来，
 * 以后有需要再读」正是这一层的用途。
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  dayOfJournalFileName,
  journalFileName,
  totalsFromJournalText,
} from './journal.ts'
import {
  addBucketsToMonth,
  bucketsOf,
  emptyMonth,
  encodeMonthSummary,
  monthKeyOf,
  parseMonthSummary,
} from './month.ts'
import type { MonthSummary, MonthTotals } from './month.ts'

/** 月度汇总的子目录名。 */
export const MONTHS_DIR = 'months'

/** 月度汇总文件的扩展名。 */
export const MONTH_FILE_SUFFIX = '.json'

/**
 * 月度汇总目录。
 * @param directory - journal 目录。
 * @returns `months` 子目录的绝对路径。
 */
export function monthDirectory(directory: string): string {
  return join(directory, MONTHS_DIR)
}

/**
 * 一个月份对应的文件名。
 * @param month - `YYYY-MM`。
 * @returns `YYYY-MM.json`。
 */
export function monthFileName(month: string): string {
  return `${month}${MONTH_FILE_SUFFIX}`
}

/**
 * 一个月的汇总文件路径。
 * @param directory - journal 目录。
 * @param month - `YYYY-MM`。
 * @returns 绝对路径。
 */
export function monthPath(directory: string, month: string): string {
  return join(monthDirectory(directory), monthFileName(month))
}

/**
 * 确保月度汇总目录存在（所有者可读写，0700）。
 * @param directory - journal 目录。
 */
export async function ensureMonthDirectory(directory: string): Promise<void> {
  await mkdir(monthDirectory(directory), { recursive: true, mode: 0o700 })
}

/**
 * 读一个月的汇总；文件不存在或内容损坏时返回 undefined。
 * @param directory - journal 目录。
 * @param month - `YYYY-MM`。
 * @returns 汇总，或 undefined。
 */
export async function readMonthSummary(directory: string, month: string): Promise<MonthSummary | undefined> {
  let text: string
  try {
    text = await readFile(monthPath(directory, month), 'utf8')
  } catch {
    return undefined
  }
  return parseMonthSummary(text)
}

/**
 * 写一个月的汇总：临时文件 + rename，避免半截文件被下一次启动读到。
 * @param directory - journal 目录。
 * @param summary - 汇总。
 */
export async function writeMonthSummary(directory: string, summary: MonthSummary): Promise<void> {
  await ensureMonthDirectory(directory)
  const path = monthPath(directory, summary.month)
  const temporary = `${path}.tmp`
  await writeFile(temporary, encodeMonthSummary(summary), { mode: 0o600 })
  await rename(temporary, path)
}

/** 一个月从日文件重建的结果。 */
export interface MonthRebuild {
  /** 整月累计。 */
  readonly totals: MonthTotals
  /** 读不出来的日文件数（缺失以外，例如权限）。 */
  readonly unreadableFiles: number
  /** 无法解析的坏行数。 */
  readonly skippedLines: number
}

/**
 * 扫该月的所有日文件，重建成月累计（月度汇总缺失或损坏时的回退路径）。
 * @param directory - journal 目录。
 * @param month - `YYYY-MM`。
 * @returns 月累计与跳过的文件 / 坏行数。
 */
export async function rebuildMonthFromFiles(directory: string, month: string): Promise<MonthRebuild> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return { totals: emptyMonth(month), unreadableFiles: 0, skippedLines: 0 }
  }
  const days = names
    .map(name => dayOfJournalFileName(name))
    .filter((day): day is string => day !== undefined && monthKeyOf(day) === month)
    .sort()
  let totals = emptyMonth(month)
  let unreadableFiles = 0
  let skippedLines = 0
  for (const day of days) {
    let text: string
    try {
      text = await readFile(join(directory, journalFileName(day)), 'utf8')
    } catch {
      unreadableFiles += 1
      continue
    }
    const parsed = totalsFromJournalText(day, text)
    skippedLines += parsed.skipped
    totals = addBucketsToMonth(totals, bucketsOf(parsed.totals))
  }
  return { totals, unreadableFiles, skippedLines }
}

