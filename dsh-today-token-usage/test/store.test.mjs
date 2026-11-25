/**
 * journal 存储：追加、重启恢复、跨天切换、30 天清理、坏行容错与存储失败降级。
 *
 * 每个用例用 `os.tmpdir()` 下的独立目录，跑完删掉；不碰用户真实的 `$DSH_HOME`。
 *
 * 运行：`node test/store.test.mjs`（或 pnpm test 跑全部）。直接 import `src/store.ts`。
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTodayStore } from '../src/store.ts'
import { RECORD_VERSION, journalFileName } from '../src/journal.ts'
import { dayKey, shiftedDayKey } from '../src/wire.ts'
import { check, checkTrue, finish } from './helpers.mjs'

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

/** 读一个日文件的所有行。 */
async function readLines(path) {
  return (await readFile(path, 'utf8')).split('\n').filter(line => line.length > 0)
}

console.log('--- S① 追加、快照、重启恢复 ---')
{
  const root = await tempRoot('restore')
  try {
    const errors = []
    const store = createTodayStore({ directory: root, now: () => NOW, onError: (m, e) => errors.push([m, e]) })
    await store.load()
    check('空目录从零开始', store.snapshot(), {
      day: TODAY,
      requests: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    store.record({ ...usageOf(100, 20, 900, 3), purpose: 'session-title', finish: 'stop' })
    store.record(usageOf(5, 1))
    await store.dispose()
    const path = join(root, journalFileName(TODAY))
    const lines = await readLines(path)
    check('一行一个请求', lines.length, 2)
    const first = JSON.parse(lines[0])
    check('记录元数据', [first.v, first.day, first.purpose, first.finish], [RECORD_VERSION, TODAY, 'session-title', 'stop'])
    check('记录用量', first.usage, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheWriteTokens: 3 })
    check('内存合计', store.snapshot(), {
      day: TODAY,
      requests: 2,
      uncachedInputTokens: 105,
      outputTokens: 21,
      cacheReadTokens: 900,
      cacheWriteTokens: 3,
    })

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
    check('零点后快照清零', store.snapshot(), {
      day: dayKey(clock),
      requests: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
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

console.log('--- S③ 保留 30 天：今天 + 前 29 天，再早的删掉 ---')
{
  const root = await tempRoot('prune')
  try {
    const days = {
      keepToday: TODAY,
      keepOldest: shiftedDayKey(NOW, -29),
      drop: shiftedDayKey(NOW, -30),
      dropOlder: shiftedDayKey(NOW, -45),
    }
    for (const day of Object.values(days)) {
      await writeFile(join(root, journalFileName(day)), '')
    }
    await writeFile(join(root, 'notes.txt'), 'keep me')
    const store = createTodayStore({ directory: root, now: () => NOW })
    await store.load()
    const names = (await readdir(root)).sort()
    check('保留今天与前 29 天，删掉更早的，其它文件不动', names, [
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
    check('合计', store.snapshot(), {
      day: TODAY,
      requests: 1,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 3,
      cacheWriteTokens: 0,
    })
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
    check('推的是当天读数', pushed[0], {
      day: TODAY,
      requests: 1,
      uncachedInputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    unsubscribe()
    store.record(usageOf(1, 1))
    check('取消后不再推', pushed.length, 1)

    const zeroDay = []
    store.subscribe(payload => zeroDay.push(payload))
    clock = new Date(2026, 10, 26, 0, 0, 5).getTime()
    const next = store.snapshot()
    check('零点后快照是新一天的空读数', next, {
      day: dayKey(clock),
      requests: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    check('换天时给订阅者推了空读数', zeroDay.length, 1)
    check('推的就是新一天', zeroDay[0], next)
    await store.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

finish()
