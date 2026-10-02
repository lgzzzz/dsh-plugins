/**
 * D Escape 序列:`src/stop-sequence.ts` 的 `createStopSequence` / `sameStopToken`
 * —— 两按窗口、同一代际、reset、以及注入时钟与真实计时器两条路径。
 *
 * 运行:`node test/decide-stop-sequence.test.mjs`(或 pnpm test 跑全部)。
 */
import { createStopSequence, sameStopToken } from '../src/stop-sequence.ts'
import { check, checkTrue, finish, sleep } from './helpers.mjs'

console.log('--- D① 两按窗口与同一代际 ---')
{
  const bindingA = { id: 'binding-a' }
  const bindingB = { id: 'binding-b' }
  const tokenA = { sessionId: 's1', binding: bindingA }
  let clock = 1000
  const sequence = createStopSequence({ intervalMs: 500, now: () => clock })
  check('第一按不算停止', sequence.press(tokenA), false)
  check('窗口内同一代际的第二按成立', sequence.press({ sessionId: 's1', binding: bindingA }), true)
  check('停止后状态清空(下一按重新开始)', sequence.press(tokenA), false)
  clock = 2000
  check('超过窗口的第一按', sequence.press(tokenA), false)
  clock = 2600
  check('超时后第二按只是新的第一按', sequence.press(tokenA), false)
  check('不同会话的第二按不算停止', sequence.press({ sessionId: 's2', binding: bindingA }), false)
  check('同会话同代际的第二按成立', sequence.press({ sessionId: 's2', binding: bindingA }), true)
  checkTrue('同一 token 判定成立', sameStopToken(tokenA, { sessionId: 's1', binding: bindingA }))
  check('换 binding 代际不成立', sameStopToken(tokenA, { sessionId: 's1', binding: bindingB }), false)
  check('换会话不成立', sameStopToken(tokenA, { sessionId: 's2', binding: bindingA }), false)
  sequence.reset()
  check('reset 后需重新两按', sequence.press(tokenA), false)
  sequence.reset()
}
{
  const sequence = createStopSequence({ intervalMs: 20 })
  const token = { sessionId: 's1', binding: {} }
  check('真实计时器:第一按', sequence.press(token), false)
  await sleep(35)
  check('真实计时器:超时后第二按不算停止', sequence.press(token), false)
  sequence.reset()
}
{
  const sequence = createStopSequence({ intervalMs: 500 })
  sequence.press({ sessionId: 's1', binding: {} })
  check('不同会话的第二按不算停止', sequence.press({ sessionId: 's2', binding: {} }), false)
  sequence.reset()
}

finish()
