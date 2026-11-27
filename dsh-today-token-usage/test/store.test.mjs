/**
 * journal 存储：追加、重启恢复、跨天 / 跨月切换、35 天清理、月度汇总落盘与重启恢复、
 * 坏行容错与存储失败降级。
 *
 * 每个用例用 `os.tmpdir()` 下的独立目录，跑完删掉；不碰用户真实的 `$DSH_HOME`。
 *
 * 运行：`node test/store.test.mjs`（或 pnpm test 跑全部）。直接 import `src/store.ts`。
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MONTH_FLUSH_DELAY_MS, createTodayStore } from '../src/store.ts'
import { RECORD_VERSION, emptyTotals, journalFileName } from '../src/journal.ts'
import { dayKey, shiftedDayKey } from '../src/wire.ts'
import { check, checkTrue, checkUsage, finish } from './helpers.mjs'

const NOW = new Date(2026, 10, 25, 15, 0, 0).getTime()
const TODAY = dayKey(NOW)

/** 临时根目录。 */
async function tempRoot(label) {
  return mkdtemp(join(tmpdir(), `dsh-today-token-usage-${label}-`))
}

/** 记一次调用的入参。 */
function usageOf(inputTokens, outputTokens, cacheReadTokens = 0, cacheWriteTokens = 0) {
  return {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    sessionId: 'session-1',
    usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
  }
}

/** 把日合计包成路由载荷：单日测试里当月累计恰好等于当天。 */
function payload(dayTotals) {
  const { day, ...totals } = dayTotals
  return { ...dayTotals, month: { month: day.slice(0, 7), ...totals } }
}

/** 读一个日文件的所有行。 */
async function readLines(path) {
  return (await readFile(path, 'utf8')).split('\n').filter(line => line.length > 0)
}

/** 一行 journal 记录（可以直接写进日文件）。 */
function journalLine({ day, time, inputTokens = 0, outputTokens = 0 }) {
  return JSON.stringify({
    v: RECORD_VERSION,
    time,
    day,
    provider: 'p',
    model: 'deepseek-v4.1-flash',
    usage: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })
}

console.log('--- S① 追加、快照、重启恢复 ---')
{
  const root = await tempRoot('restore')
  try {
    const errors = []
    const store = createTodayStore({ directory: root, now: () => NOW, onError: (m, e) => errors.push([m, e]) })
    await store.load()
    check('空目录从零开始', store.snapshot(), payload(emptyTotals(TODAY)))
    store.record({ ...usageOf(100, 20, 900, 3), purpose: 'session-title', finish: 'stop' })
    store.record(usageOf(5, 1))
    await store.dispose()
    const path = join(root, journalFileName(TODAY))
    const lines = await readLines(path)
    check('一行一个请求', lines.length, 2)
    const first = JSON.parse(lines[0])
    check('记录元数据', [first.v, first.day, first.purpose, first.finish], [RECORD_VERSION, TODAY, 'session-title', 'stop'])
    check('记录用量', first.usage, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 3 })
    checkUsage('内存合计与费用', store.snapshot(), payload({
      ...emptyTotals(TODAY),
      requests: 2,
      uncachedInputTokens: 105,
      outputTokens: 21,
      cacheReadTokens: 900,
      cacheWriteTokens: 3,
      // 本地 15:00 是周三峰时： (100×2 + 900×0.04 + 3×2 + 20×8 + 5×2 + 1×8) / 1e6
      cost: { total: 0.00042, peak: 0.00042, offPeak: 0, unpricedRequests: 0 },
    }))

    const reopened = createTodayStore({ directory: root, now: () => NOW, onError: (m, e) => errors.push([m, e]) })
    await reopened.load()
    check('重启后恢复同一个合计', reopened.snapshot(), store.snapshot())
    await reopened.dispose()
    check('没有告警', errors, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S② 跨天切换：新的一天从零开始，旧文件留着 ---')
{
  const root = await tempRoot('rollover')
  let clock = NOW
  try {
    const store = createTodayStore({ directory: root, now: () => clock })
    await store.load()
    store.record(usageOf(100, 20))
    await store.dispose()
    clock = new Date(2026, 10, 26, 0, 0, 5).getTime()
    // 当天清零，但同月的月度累计保留昨天那一笔。
    checkUsage('零点后当天清零、当月保留', store.snapshot(), {
      ...payload(emptyTotals(dayKey(clock))),
      month: {
        month: '2026-11',
        requests: 1,
        uncachedInputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: { total: 0.00036, peak: 0.00036, offPeak: 0, unpricedRequests: 0 },
      },
    })
    store.record(usageOf(7, 8))
    await store.dispose()
    check('旧文件仍在', (await readLines(join(root, journalFileName(TODAY)))).length, 1)
    check('新文件已建', (await readLines(join(root, journalFileName(dayKey(clock))))).length, 1)
    check('新一天合计', store.snapshot().requests, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S③ 保留 35 天：今天 + 前 34 天，再早的删掉 ---')
{
  const root = await tempRoot('prune')
  try {
    const days = {
      keepToday: TODAY,
      keepOldest: shiftedDayKey(NOW, -34),
      drop: shiftedDayKey(NOW, -35),
      dropOlder: shiftedDayKey(NOW, -50),
    }
    for (const day of Object.values(days)) {
      await writeFile(join(root, journalFileName(day)), '')
    }
    await writeFile(join(root, 'notes.txt'), 'keep me')
    const store = createTodayStore({ directory: root, now: () => NOW })
    await store.load()
    const names = (await readdir(root)).sort()
    check('保留今天与前 34 天，删掉更早的，其它文件不动', names, [
      'months',
      'notes.txt',
      journalFileName(days.keepOldest),
      journalFileName(days.keepToday),
    ].sort())
    await store.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S④ 坏行容错：跳过并只告警一次 ---')
{
  const root = await tempRoot('corrupt')
  try {
    const good = (inputTokens) => JSON.stringify({
      v: RECORD_VERSION,
      time: NOW,
      day: TODAY,
      provider: 'p',
      model: 'm',
      usage: { inputTokens, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    await writeFile(join(root, journalFileName(TODAY)), [
      good(10),
      '{not json}',
      good(5),
      JSON.stringify({ v: 99, day: TODAY }),
      '',
    ].join('\n'))
    const errors = []
    const store = createTodayStore({ directory: root, now: () => NOW, onError: message => errors.push(message) })
    await store.load()
    check('只累计合法行', store.snapshot().requests, 2)
    check('只告警一次', errors.length, 1)
    checkTrue('告警写明坏行', errors[0].includes('2 行无法解析') || errors[0].includes('行无法解析'))
    await store.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑤ 磁盘不可写：内存统计照常，P0 不抛 ---')
{
  const root = await tempRoot('blocked')
  try {
    const blocked = join(root, 'not-a-directory')
    await writeFile(blocked, 'file')
    const errors = []
    const store = createTodayStore({ directory: blocked, now: () => NOW, onError: message => errors.push(message) })
    await store.load()
    store.record(usageOf(10, 5))
    await store.dispose()
    check('内存合计仍然正确', store.snapshot().requests, 1)
    checkTrue('至少有创建目录告警', errors.length >= 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑥ 异常用量折成 0，不写 NaN ---')
{
  const root = await tempRoot('sanitize')
  try {
    const store = createTodayStore({ directory: root, now: () => NOW })
    await store.load()
    store.record({
      provider: 'p',
      model: 'm',
      usage: { inputTokens: Number.NaN, outputTokens: -5, cacheReadTokens: 3.9, cacheWriteTokens: 0 },
    })
    await store.dispose()
    checkUsage('合计', store.snapshot(), payload({
      ...emptyTotals(TODAY),
      requests: 1,
      cacheReadTokens: 3,
      // 模型 'm' 不在价目表里：只计 Token，计一笔未计价请求。
      cost: { total: 0, peak: 0, offPeak: 0, unpricedRequests: 1 },
    }))
    const line = JSON.parse((await readLines(join(root, journalFileName(TODAY))))[0])
    check('落盘也是规整值', line.usage, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 3, cacheWriteTokens: 0 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑦ 目录已存在时重复 load 不重复累计 ---')
{
  const root = await tempRoot('load-once')
  try {
    await mkdir(root, { recursive: true })
    const store = createTodayStore({ directory: root, now: () => NOW })
    await store.load()
    store.record(usageOf(1, 1))
    await store.dispose()
    const again = createTodayStore({ directory: root, now: () => NOW })
    await again.load()
    await again.load()
    check('load 幂等', again.snapshot().requests, 1)
    await again.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑧ 订阅：记录时推送、取消后不再推、零点换天推空读数 ---')
{
  const root = await tempRoot('subscribe')
  let clock = NOW
  try {
    const store = createTodayStore({ directory: root, now: () => clock })
    await store.load()
    const pushed = []
    const unsubscribe = store.subscribe(payload => pushed.push(payload))
    store.record(usageOf(10, 5))
    check('记录后推一次', pushed.length, 1)
    checkUsage('推的是当天读数', pushed[0], payload({
      ...emptyTotals(TODAY),
      requests: 1,
      uncachedInputTokens: 10,
      outputTokens: 5,
      cost: { total: 0.00006, peak: 0.00006, offPeak: 0, unpricedRequests: 0 },
    }))
    unsubscribe()
    store.record(usageOf(1, 1))
    check('取消后不再推', pushed.length, 1)

    const zeroDay = []
    store.subscribe(payload => zeroDay.push(payload))
    clock = new Date(2026, 10, 26, 0, 0, 5).getTime()
    const next = store.snapshot()
    // 换天但没换月：当天是空读数，月度累计保留之前两笔。
    checkUsage('零点后快照是新一天的空读数', next, {
      ...payload(emptyTotals(dayKey(clock))),
      month: {
        month: '2026-11',
        requests: 2,
        uncachedInputTokens: 11,
        outputTokens: 6,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: { total: 0.00007, peak: 0.00007, offPeak: 0, unpricedRequests: 0 },
      },
    })
    check('换天时给订阅者推了空读数', zeroDay.length, 1)
    check('推的就是新一天', zeroDay[0], next)
    await store.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑨ 跨月：上月汇总落盘、新月份从零开始 ---')
{
  const root = await tempRoot('month-rollover')
  let clock = new Date(2026, 10, 30, 15, 0, 0).getTime()
  try {
    const store = createTodayStore({ directory: root, now: () => clock })
    await store.load()
    store.record(usageOf(100, 20))
    clock = new Date(2026, 11, 1, 0, 0, 5).getTime()
    const after = store.snapshot()
    check('新月份从零开始', [after.day, after.month.month, after.month.requests], ['2026-12-01', '2026-12', 0])
    store.record(usageOf(7, 8))
    check('新月份开始累计', [store.snapshot().month.month, store.snapshot().month.requests], ['2026-12', 1])
    await store.dispose()
    const november = JSON.parse(await readFile(join(root, 'months', '2026-11.json'), 'utf8'))
    const december = JSON.parse(await readFile(join(root, 'months', '2026-12.json'), 'utf8'))
    check('十一月汇总含最后一笔', [november.month, november.totals.requests, november.checkpointDay], ['2026-11', 1, '2026-11-30'])
    check('十二月汇总', [december.month, december.totals.requests, december.checkpointDay], ['2026-12', 1, '2026-12-01'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑩ 重启后当月累计恢复（汇总 + 当天文件对账） ---')
{
  const root = await tempRoot('month-restore')
  try {
    const first = createTodayStore({ directory: root, now: () => NOW })
    await first.load()
    first.record(usageOf(100, 20))
    first.record(usageOf(5, 1))
    const before = first.snapshot().month
    await first.dispose()

    const second = createTodayStore({ directory: root, now: () => NOW })
    await second.load()
    checkUsage('当月累计恢复', second.snapshot().month, before)
    await second.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑪ 月度汇总损坏：回退为扫本月日文件重建 ---')
{
  const root = await tempRoot('month-rebuild')
  try {
    const store = createTodayStore({ directory: root, now: () => NOW })
    await store.load()
    store.record(usageOf(100, 20))
    await store.dispose()

    await writeFile(join(root, 'months', '2026-11.json'), '{broken}')
    const errors = []
    const again = createTodayStore({ directory: root, now: () => NOW, onError: message => errors.push(message) })
    await again.load()
    check('从日文件重建当月累计', [again.snapshot().month.requests, again.snapshot().month.uncachedInputTokens], [1, 100])
    check('没有额外告警（坏汇总按缺失处理）', errors, [])
    await again.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑫ 今天的日文件不见了：保留月汇总里的今天，不写回低值 ---')
{
  const root = await tempRoot('month-day-missing')
  try {
    const store = createTodayStore({ directory: root, now: () => NOW })
    await store.load()
    store.record(usageOf(100, 20))
    await store.dispose()
    const before = JSON.parse(await readFile(join(root, 'months', '2026-11.json'), 'utf8'))
    // 模拟今天的日文件被清掉 / 暂时读不出来：汇总里的今天无从核对，不能拿 0 去替换。
    await rm(join(root, journalFileName(TODAY)))
    const errors = []
    const again = createTodayStore({ directory: root, now: () => NOW, onError: message => errors.push(message) })
    await again.load()
    check('汇总里的今天保留', again.snapshot().month.requests, before.totals.requests)
    checkTrue('告警说明今天读不出来', errors.some(message => message.includes('今天的 journal 读不出来')))
    again.record(usageOf(1, 1))
    await again.dispose()
    const after = JSON.parse(await readFile(join(root, 'months', '2026-11.json'), 'utf8'))
    check('本次运行不覆盖月文件', after.totals.requests, before.totals.requests)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑬ 隔天重启：checkpoint 与今天之间那天的记录不能丢 ---')
{
  const root = await tempRoot('month-gap')
  const day24 = '2026-11-24'
  const day25 = '2026-11-25'
  const day26 = '2026-11-26'
  const costZero = { total: 0, peak: 0, offPeak: 0, unpricedRequests: 0 }
  try {
    await writeFile(join(root, journalFileName(day24)), `${journalLine({ day: day24, time: NOW - 2 * 86_400_000, inputTokens: 100 })}\n`)
    await writeFile(join(root, journalFileName(day25)), `${journalLine({ day: day25, time: NOW - 86_400_000, inputTokens: 200 })}\n`)
    // 汇总停在 11-24：11-25 那几笔只落在日文件里。
    await mkdir(join(root, 'months'), { recursive: true })
    await writeFile(join(root, 'months', '2026-11.json'), JSON.stringify({
      v: 1,
      month: '2026-11',
      totals: { requests: 1, uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: costZero },
      checkpointDay: day24,
      checkpoint: { requests: 1, uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: costZero },
    }))
    const store = createTodayStore({ directory: root, now: () => new Date(2026, 10, 26, 15, 0, 0).getTime() })
    await store.load()
    check('扫日文件补回中间那天', [store.snapshot().month.requests, store.snapshot().month.uncachedInputTokens], [2, 300])
    check('今天从零开始', store.snapshot().requests, 0)
    await store.dispose()
    const written = JSON.parse(await readFile(join(root, 'months', '2026-11.json'), 'utf8'))
    check('写回的 checkpoint 抬到今天', [written.totals.requests, written.checkpointDay], [2, day26])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- S⑭ 重建之后等过写入窗口：写回的是重建后的合计，不是空汇总 ---')
{
  const root = await tempRoot('month-rebuild-write')
  try {
    const store = createTodayStore({ directory: root, now: () => NOW })
    await store.load()
    store.record(usageOf(100, 20))
    store.record(usageOf(5, 1))
    await store.dispose()
    await writeFile(join(root, 'months', '2026-11.json'), '{broken}')
    const again = createTodayStore({ directory: root, now: () => NOW })
    await again.load()
    check('内存里重建正确', again.snapshot().month.requests, 2)
    // 等过一个节流窗口：这一步能抓出「重建后把赋值前的空汇总写出去」。
    await new Promise(resolve => { setTimeout(resolve, MONTH_FLUSH_DELAY_MS + 200) })
    const written = JSON.parse(await readFile(join(root, 'months', '2026-11.json'), 'utf8'))
    check('写回的是重建后的合计', [written.totals.requests, written.checkpointDay], [2, TODAY])
    await again.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

finish()
