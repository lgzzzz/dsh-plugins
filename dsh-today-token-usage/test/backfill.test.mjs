/**
 * 回填计划与执行：只补「今天活跃、缺行、不活、可读」的会话；单个失败不中断整轮。
 *
 * 运行：`node test/backfill.test.mjs`（或 pnpm test 跑全部）。直接 import `src/backfill.ts`。
 */
import { backfillToday, needsBackfill } from '../src/backfill.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const today = new Date(2026, 10, 24, 15, 0, 0, 0).getTime()
const todayStart = new Date(2026, 10, 24, 0, 0, 0, 0).getTime()
const yesterday = new Date(2026, 10, 23, 22, 0, 0, 0).getTime()

console.log('--- B① 判据 ---')
checkTrue('今天建、缺行、不在内存：要补', needsBackfill({
  createdAt: today, lastPromptAt: null, hasRow: false, live: false, migrationRequired: false,
}, todayStart))
checkTrue('昨天建、今天提示过：要补', needsBackfill({
  createdAt: yesterday, lastPromptAt: today, hasRow: false, live: false, migrationRequired: false,
}, todayStart))
check('昨天之前就没动过：不补', needsBackfill({
  createdAt: yesterday, lastPromptAt: yesterday, hasRow: false, live: false, migrationRequired: false,
}, todayStart), false)
check('已有行：不补', needsBackfill({
  createdAt: today, lastPromptAt: today, hasRow: true, live: false, migrationRequired: false,
}, todayStart), false)
check('活在内存里：不补（登记表自己折）', needsBackfill({
  createdAt: today, lastPromptAt: today, hasRow: false, live: true, migrationRequired: false,
}, todayStart), false)
check('需要迁移的日志：不补', needsBackfill({
  createdAt: today, lastPromptAt: today, hasRow: false, live: false, migrationRequired: true,
}, todayStart), false)

/** 造一个回填夹具：`rows` 是缓存里的已知事实，`sessions` 是持久化列表。 */
function fixture({ sessions, rows = {}, live = [], unreadable = [] }) {
  const reads = []
  const refreshed = []
  const warnings = []
  const services = {
    async list() {
      return sessions
    },
    cached(header) {
      return rows[header.id]
    },
    isLive(id) {
      return live.includes(id)
    },
    async read(id) {
      reads.push(id)
      if (unreadable.includes(id)) throw new Error(`读不了 ${id}`)
      return { header: { id }, inherited: 0, events: [] }
    },
    refresh(header, inherited, events) {
      refreshed.push({ id: header.id, inherited, events: events.length })
    },
    warn(message) {
      warnings.push(message)
    },
    now() {
      return today
    },
  }
  return { services, reads, refreshed, warnings }
}

const sessions = [
  { id: 'fresh', createdAt: today, header: { id: 'fresh' } },
  { id: 'stale', createdAt: yesterday, header: { id: 'stale' } },
  { id: 'has-row', createdAt: yesterday, header: { id: 'has-row' } },
  { id: 'live', createdAt: today, header: { id: 'live' } },
  { id: 'broken', createdAt: today, header: { id: 'broken' } },
]

console.log('--- B② 一轮回填只读该读的会话 ---')
const fixture1 = fixture({
  sessions,
  rows: {
    stale: { hasRow: false, lastPromptAt: yesterday },
    'has-row': { hasRow: true, lastPromptAt: yesterday },
    live: { hasRow: false, lastPromptAt: today },
    broken: { hasRow: false, lastPromptAt: null },
  },
  live: ['live'],
  unreadable: ['broken'],
})
const controller = new AbortController()
const report = await backfillToday(fixture1.services, controller.signal)
check('扫描全部', report.scanned, 5)
check('只读今天活跃且缺行的', fixture1.reads, ['fresh', 'broken'])
check('成功折叠并写回一个', report.refreshed, 1)
check('失败计数', report.failed, 1)
check('写回的是读到的同一会话', fixture1.refreshed, [{ id: 'fresh', inherited: 0, events: 0 }])
checkTrue('失败有告警', fixture1.warnings.length === 1 && fixture1.warnings[0].includes('broken'))

console.log('--- B③ 缓存里没有任何行时按「未知」处理，仍会补 ---')
const fixture2 = fixture({ sessions: [sessions[0]] })
await backfillToday(fixture2.services, new AbortController().signal)
check('未知元数据也要补', fixture2.reads, ['fresh'])

console.log('--- B④ 中止后不再继续 ---')
const fixture3 = fixture({ sessions })
const aborted = new AbortController()
aborted.abort()
const abortedReport = await backfillToday(fixture3.services, aborted.signal)
check('中止后不读任何会话', fixture3.reads, [])
check('中止后扫描数为 0', abortedReport.scanned, 0)

console.log('--- B⑤ 列出会话失败时只告警 ---')
const failedList = {
  async list() {
    throw new Error('存储打不开')
  },
  cached: () => undefined,
  isLive: () => false,
  read: async () => { throw new Error('不应被调用') },
  refresh: () => { throw new Error('不应被调用') },
  warn: () => {},
  now: () => today,
}
const warnings = []
failedList.warn = (message) => { warnings.push(message) }
const failedReport = await backfillToday(failedList, new AbortController().signal)
check('列表失败也返回报告', failedReport, { scanned: 0, refreshed: 0, failed: 0 })
checkTrue('列表失败有告警', warnings.length === 1 && warnings[0].includes('存储打不开'))

finish()
