/**
 * 月度汇总：当月累计、汇总文件编解码、重启对账，以及 `months/` 的落盘与重建。
 *
 * 每个落盘用例用 `os.tmpdir()` 下的独立目录，跑完删掉；不碰用户真实的 `$DSH_HOME`。
 *
 * 运行：`node test/month.test.mjs`（或 pnpm test 跑全部）。
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  addRecordToMonth,
  emptyMonth,
  encodeMonthSummary,
  monthKeyOf,
  monthSummaryOf,
  parseMonthSummary,
  checkpointOf,
  replaceCheckpointDay,
} from '../src/month.ts'
import {
  monthFileName,
  monthPath,
  readMonthSummary,
  rebuildMonthFromFiles,
  writeMonthSummary,
} from '../src/month-store.ts'
import { RECORD_VERSION, emptyTotals, journalFileName } from '../src/journal.ts'
import { dayKey } from '../src/wire.ts'
import { check, checkTrue, checkUsage, finish } from './helpers.mjs'

const DAY = '2026-11-25'
const MONTH = '2026-11'
const PEAK = new Date(2026, 10, 25, 10, 0, 0).getTime()

/** 一条记录。 */
function record(usage, { time = PEAK, day = DAY, model = 'deepseek-v4.1-flash' } = {}) {
  return {
    v: RECORD_VERSION,
    time,
    day,
    provider: 'opencode-go',
    model,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...usage },
  }
}

console.log('--- M① 月份键与零值 ---')
check('日期键前 7 位', monthKeyOf('2026-11-25'), MONTH)
check('零值', emptyMonth(MONTH), {
  month: MONTH,
  requests: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: { total: 0, peak: 0, offPeak: 0, unpricedRequests: 0 },
})

console.log('--- M② 当月累计：与当天同一套计价 ---')
{
  let totals = emptyMonth(MONTH)
  totals = addRecordToMonth(totals, record({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 900 }))
  totals = addRecordToMonth(totals, record({ inputTokens: 5, outputTokens: 1 }))
  checkUsage('四桶、请求数与费用', totals, {
    month: MONTH,
    requests: 2,
    uncachedInputTokens: 105,
    outputTokens: 21,
    cacheReadTokens: 900,
    cacheWriteTokens: 0,
    // 峰时：(100×2 + 900×0.04 + 20×8) + (5×2 + 1×8) 元/百万
    cost: { total: 0.000414, peak: 0.000414, offPeak: 0, unpricedRequests: 0 },
  })
  const unknown = addRecordToMonth(emptyMonth(MONTH), record({ outputTokens: 1 }, { model: 'mystery' }))
  check('未知模型计未计价', [unknown.cost.total, unknown.cost.unpricedRequests], [0, 1])
}

console.log('--- M③ 汇总文件：编码 / 解析往返 ---')
{
  const totals = addRecordToMonth(emptyMonth(MONTH), record({ inputTokens: 100, outputTokens: 20 }))
  const day = { ...emptyTotals(DAY), requests: 1, uncachedInputTokens: 100, outputTokens: 20, cost: totals.cost }
  const summary = monthSummaryOf(totals, DAY, day)
  check('往返一致', parseMonthSummary(encodeMonthSummary(summary)), summary)
  check('单行 JSON', encodeMonthSummary(summary).includes('\n'), false)
}

console.log('--- M④ 汇总文件：损坏或版本不符一律拒绝 ---')
{
  const good = {
    v: 1,
    month: MONTH,
    totals: { requests: 1, uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, cost: { total: 0.1, peak: 0.1, offPeak: 0, unpricedRequests: 0 } },
    checkpointDay: DAY,
  }
  const broken = [
    '',
    'not json',
    JSON.stringify({ ...good, v: 2 }),
    JSON.stringify({ ...good, month: '2026-13' }),
    JSON.stringify({ ...good, totals: { ...good.totals, requests: -1 } }),
    JSON.stringify({ ...good, totals: { ...good.totals, cost: { total: 'x' } } }),
    JSON.stringify({ ...good, checkpointDay: '11-25' }),
    JSON.stringify({ ...good, checkpoint: { requests: 1 } }),
  ]
  check('全部拒绝', broken.map(text => parseMonthSummary(text)), broken.map(() => undefined))
}

console.log('--- M⑤ 同一天重启：把 checkpoint 那天换成 journal 里的全量 ---')
{
  // 汇总里写入了今天的前 100 个 token；journal 今天文件其实是 300 个。
  let totals = emptyMonth(MONTH)
  totals = addRecordToMonth(totals, record({ inputTokens: 100 }))
  const checkpoint = { ...emptyTotals(DAY), requests: 1, uncachedInputTokens: 100, cost: totals.cost }
  const summary = monthSummaryOf(totals, DAY, checkpoint)
  const today = { ...emptyTotals(DAY), requests: 1, uncachedInputTokens: 300, cost: priceOf(300) }
  const read = checkpointOf(summary)
  check('checkpoint 可用', [read?.day, read?.buckets.uncachedInputTokens], [DAY, 100])
  checkUsage('换成 journal 今天文件里的全量', replaceCheckpointDay(summary, read, today), {
    month: MONTH,
    requests: 1,
    uncachedInputTokens: 300,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: priceOf(300),
  })
}

console.log('--- M⑥ checkpoint 早于今天：只给出 checkpoint，差额由调用方决定不用 ---')
{
  let totals = emptyMonth(MONTH)
  totals = addRecordToMonth(totals, record({ inputTokens: 100, time: new Date(2026, 10, 24, 15, 0, 0).getTime() }, { day: '2026-11-24' }))
  const checkpoint = { ...emptyTotals('2026-11-24'), requests: 1, uncachedInputTokens: 100, cost: totals.cost }
  const summary = monthSummaryOf(totals, '2026-11-24', checkpoint)
  check('checkpoint 仍可用', checkpointOf(summary)?.day, '2026-11-24')
  // 差额法只能替换一天，今天与 checkpoint 之间若还隔了整天就补不回来；store 在这里改走日文件重建。
  checkTrue('调用方能看出它早于今天', checkpointOf(summary)?.day !== DAY)
}

console.log('--- M⑦ 没有 checkpoint / checkpoint 落在别的月份：都不可用 ---')
{
  let totals = emptyMonth(MONTH)
  totals = addRecordToMonth(totals, record({ inputTokens: 100 }))
  const bare = { ...monthSummaryOf(totals, DAY, emptyTotals(DAY)) }
  delete bare.checkpoint
  delete bare.checkpointDay
  check('没有 checkpoint', checkpointOf(bare), undefined)
  const foreign = { ...monthSummaryOf(totals, DAY, emptyTotals('2026-10-31')) }
  check('checkpoint 不在本月', checkpointOf({ ...foreign, checkpointDay: '2026-10-31' }), undefined)
}

console.log('--- M⑧ 落盘：写、读、原子替换 ---')
{
  const root = await mkdtemp(join(tmpdir(), 'dsh-today-token-usage-month-'))
  try {
    const totals = addRecordToMonth(emptyMonth(MONTH), record({ inputTokens: 100 }))
    const summary = monthSummaryOf(totals, DAY, emptyTotals(DAY))
    await writeMonthSummary(root, summary)
    check('读回一致', await readMonthSummary(root, MONTH), summary)
    check('文件名', monthFileName(MONTH), '2026-11.json')
    check('路径', monthPath(root, MONTH), join(root, 'months', '2026-11.json'))
    const names = await readdir(join(root, 'months'))
    check('没有留下临时文件', names, [monthFileName(MONTH)])
    check('缺失的月份', await readMonthSummary(root, '2026-10'), undefined)
    await writeFile(monthPath(root, MONTH), '{broken}')
    check('损坏的文件按缺失处理', await readMonthSummary(root, MONTH), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- M⑨ 从日文件重建整月 ---')
{
  const root = await mkdtemp(join(tmpdir(), 'dsh-today-token-usage-month-rebuild-'))
  try {
    const line = (day, inputTokens) => JSON.stringify(record({ inputTokens }, { day })) + '\n'
    await writeFile(join(root, journalFileName('2026-11-03')), line('2026-11-03', 100))
    await writeFile(join(root, journalFileName('2026-11-24')), line('2026-11-24', 200) + line('2026-11-24', 50))
    await writeFile(join(root, journalFileName('2026-11-25')), line('2026-11-25', 300))
    await writeFile(join(root, journalFileName('2026-10-31')), line('2026-10-31', 999)) // 别的月份
    await writeFile(join(root, 'notes.txt'), 'ignore me')
    const rebuilt = await rebuildMonthFromFiles(root, MONTH)
    check('只算本月', rebuilt.totals.requests, 4)
    check('四个日文件里的三笔 + 两笔 + 一笔', rebuilt.totals.uncachedInputTokens, 650)
    checkUsage('费用同口径', rebuilt.totals, {
      month: MONTH,
      requests: 4,
      uncachedInputTokens: 650,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: priceOf(650),
    })
    check('没有坏行', [rebuilt.skippedLines, rebuilt.unreadableFiles], [0, 0])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('--- M⑩ 跨天合计的月份键 ---')
check('今天在十一月', monthKeyOf(dayKey(PEAK)), MONTH)
check('月底最后一天', monthKeyOf('2026-11-30'), MONTH)
checkTrue('月末与次月不同', monthKeyOf('2026-11-30') !== monthKeyOf('2026-12-01'))

finish()

/**
 * 峰时 1M 未命中输入的单价是 2 元；这里按 token 数折出费用，避免测试里重复价格表。
 * @param {number} tokens - 未缓存输入 token。
 * @returns {object} 费用拆分。
 */
function priceOf(tokens) {
  const total = (tokens * 2) / 1_000_000
  return { total, peak: total, offPeak: 0, unpricedRequests: 0 }
}
