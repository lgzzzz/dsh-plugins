/**
 * 用量旁路：chunk 原样透传、结算只回调一次、错误照常抛出、旁路失败不影响模型流。
 *
 * 运行：`node test/tap.test.mjs`（或 pnpm test 跑全部）。直接 import `src/tap.ts`。
 */
import { tapStream } from '../src/tap.ts'
import { check, checkTrue, finish } from './helpers.mjs'

/** 一段假流：除非 `fail`，否则按顺序产出 chunks。 */
async function* chunks(list, fail = false) {
  for (const chunk of list) yield chunk
  if (fail) throw new Error('provider exploded')
}

const USAGE = { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 } }
const USAGE_LATE = { type: 'usage', usage: { inputTokens: 20, outputTokens: 6, cacheReadTokens: 200 } }
const FINISH = { type: 'finish', reason: { kind: 'stop' } }
const TEXT = { type: 'text-delta', index: 0, text: 'hi' }

/** 消费一个流，返回收到的 chunks 与错误。 */
async function drain(stream) {
  const received = []
  try {
    for await (const chunk of stream) received.push(chunk)
    return { received, error: null }
  } catch (error) {
    return { received, error }
  }
}

console.log('--- T① 原样透传 ---')
{
  const source = [TEXT, USAGE, FINISH]
  const settled = []
  const { received, error } = await drain(tapStream(chunks(source), s => settled.push(s)))
  check('没有错误', error, null)
  checkTrue('对象身份不变', received[0] === source[0] && received[1] === source[1] && received[2] === source[2])
  check('结算一次', settled.length, 1)
  check('取最后一个 usage', settled[0].usage, USAGE.usage)
  check('取 finish 原因', settled[0].finish, { kind: 'stop' })
}

console.log('--- T② 多个 usage 块取最后一个 ---')
{
  const settled = []
  await drain(tapStream(chunks([USAGE, USAGE_LATE, FINISH]), s => settled.push(s)))
  check('结算一次', settled.length, 1)
  check('最后一个 usage', settled[0].usage.inputTokens, 20)
}

console.log('--- T③ 抛错照常抛，结算仍发生 ---')
{
  const settled = []
  const { received, error } = await drain(tapStream(chunks([USAGE], true), s => settled.push(s)))
  check('错误传出', error?.message, 'provider exploded')
  check('已收到的 chunk 仍交给消费方', received.length, 1)
  check('结算一次', settled.length, 1)
  check('带上了抛错前的 usage', settled[0].usage, USAGE.usage)
}

console.log('--- T④ 消费方提前 break 也会结算 ---')
{
  const settled = []
  const stream = tapStream(chunks([USAGE, TEXT, FINISH]), s => settled.push(s))
  for await (const chunk of stream) {
    checkTrue('只消费第一块', chunk === USAGE)
    break
  }
  check('结算一次', settled.length, 1)
  check('usage 已记录', settled[0].usage, USAGE.usage)
}

console.log('--- T⑤ 没有 usage / finish 时结算为 undefined ---')
{
  const settled = []
  await drain(tapStream(chunks([TEXT]), s => settled.push(s)))
  check('结算一次', settled.length, 1)
  check('没有 usage', settled[0].usage, undefined)
  check('没有 finish', settled[0].finish, undefined)
}

console.log('--- T⑥ 结算回调抛错不影响模型流 ---')
{
  const settled = []
  const { received, error } = await drain(tapStream(chunks([TEXT, USAGE, FINISH]), (s) => {
    settled.push(s)
    throw new Error('store failed')
  }))
  check('没有错误', error, null)
  check('chunk 全部透传', received.length, 3)
  check('结算仍被调用', settled.length, 1)
}

finish()
