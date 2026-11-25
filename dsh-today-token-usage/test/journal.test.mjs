/**
 * journal 词汇：记录编解码、损坏行容错、当天合计与文件名约定。
 *
 * 运行：`node test/journal.test.mjs`（或 pnpm test 跑全部）。直接 import `src/journal.ts`。
 */
import {
  RECORD_VERSION,
  RETENTION_DAYS,
  addRecord,
  dayOfJournalFileName,
  emptyTotals,
  encodeRecord,
  journalFileName,
  parseRecordLine,
  sanitizeCount,
  sanitizeUsage,
  totalsFromRecords,
} from '../src/journal.ts'
import { dayKey, nextLocalMidnight, shiftedDayKey } from '../src/wire.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const DAY = '2026-11-25'

/** 一条合法记录。 */
function record(overrides = {}) {
  return {
    v: RECORD_VERSION,
    time: new Date(2026, 10, 25, 15, 0, 0).getTime(),
    day: DAY,
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    sessionId: 'session-1',
    purpose: 'session-title',
    finish: 'stop',
    usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 3 },
    ...overrides,
  }
}

console.log('--- J① 编码 / 解析往返 ---')
const encoded = encodeRecord(record())
checkTrue('单行 JSON', !encoded.includes('\n'))
check('往返一致', parseRecordLine(encoded, DAY), record())
check('去掉首尾空白也能解析', parseRecordLine(`  ${encoded}  `, DAY), record())
check('可选字段缺席', parseRecordLine(JSON.stringify({
  v: RECORD_VERSION,
  time: 1,
  day: DAY,
  provider: 'p',
  model: 'm',
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
}), DAY), {
  v: RECORD_VERSION,
  time: 1,
  day: DAY,
  provider: 'p',
  model: 'm',
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
})
check('保留可选存档字段', parseRecordLine(JSON.stringify(record({
  reasoningEffort: 'max',
  usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 2, totalTokens: 10 },
})), DAY).usage.totalTokens, 10)

console.log('--- J② 损坏行一律跳过 ---')
const broken = [
  '',
  '   ',
  'not json',
  '[]',
  JSON.stringify({ ...record(), v: 2 }),
  JSON.stringify({ ...record(), day: '2026-11-24' }),
  JSON.stringify({ ...record(), time: 'now' }),
  JSON.stringify({ ...record(), provider: '' }),
  JSON.stringify({ ...record(), usage: null }),
  JSON.stringify({ ...record(), usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 } }),
  JSON.stringify({ ...record(), usage: { inputTokens: -1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 } }),
  JSON.stringify({ ...record(), usage: { inputTokens: 1.5, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 } }),
  JSON.stringify({ ...record(), usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 'many' } }),
]
check('全部返回 undefined', broken.map(line => parseRecordLine(line, DAY)), broken.map(() => undefined))

console.log('--- J③ 当天合计与四个桶 ---')
const totals = totalsFromRecords(DAY, [
  record({ usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 3 } }),
  record({ usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 200, cacheWriteTokens: 0, reasoningTokens: 1, totalTokens: 9999 } }),
])
check('一条记录计一次请求', totals, {
  day: DAY,
  requests: 2,
  uncachedInputTokens: 105,
  outputTokens: 21,
  cacheReadTokens: 1_100,
  cacheWriteTokens: 3,
})
check('空列表是零值', totalsFromRecords(DAY, []), emptyTotals(DAY))
const one = addRecord(emptyTotals(DAY), record({ usage: { inputTokens: 7, outputTokens: 8, cacheReadTokens: 9, cacheWriteTokens: 10 } }))
check('addRecord 不改入参', one.requests === 1 && emptyTotals(DAY).requests === 0, true)

console.log('--- J④ 文件名约定 ---')
check('文件名', journalFileName(DAY), 'requests-2026-11-25.jsonl')
check('反解文件名', dayOfJournalFileName(journalFileName(DAY)), DAY)
check('不认识的文件名', [
  dayOfJournalFileName('requests-2026-11-25.json'),
  dayOfJournalFileName('other.jsonl'),
  dayOfJournalFileName('requests-2026-1-5.jsonl'),
], [undefined, undefined, undefined])
check('保留期 30 天', RETENTION_DAYS, 30)

console.log('--- J⑤ 用量规整 ---')
check('缺失用量', sanitizeUsage(undefined), undefined)
check('异常数值折成 0', sanitizeUsage({ inputTokens: Number.NaN, outputTokens: -3, cacheReadTokens: 1.9, cacheWriteTokens: Number.POSITIVE_INFINITY }), {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 1,
  cacheWriteTokens: 0,
})
check('正常值', sanitizeUsage({ inputTokens: 3, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 6 }), {
  inputTokens: 3,
  outputTokens: 4,
  cacheReadTokens: 5,
  cacheWriteTokens: 6,
})
check('标量规整', [sanitizeCount(Number.NaN), sanitizeCount(-1), sanitizeCount(2.7), sanitizeCount('3')], [0, 0, 2, 0])

console.log('--- J⑥ 日期键与偏移 ---')
const noon = new Date(2026, 10, 25, 12, 0, 0).getTime()
check('日期键', dayKey(noon), '2026-11-25')
check('往前 29 天', shiftedDayKey(noon, -29), '2026-10-27')
check('往后 1 天', shiftedDayKey(noon, 1), '2026-11-26')
check('下一个本地零点', dayKey(nextLocalMidnight(noon)), '2026-11-26')
check('零点之后再取零点就是次日', dayKey(nextLocalMidnight(nextLocalMidnight(noon))), '2026-11-27')

finish()
