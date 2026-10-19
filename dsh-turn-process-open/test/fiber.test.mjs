/**
 * fiber 读取：父链顺序、形状守卫、深度上限与两条写入口。
 *
 * 这里只构造假 fiber 链，不碰真实 React；数组里每个 props 对应一个祖先组件。
 */
import { findTurnProcess, findTurnProcessActions } from '../src/fiber.ts'
import { attachFiber, check, checkTrue, finish, FakeElement } from './helpers.mjs'

console.log('--- F① 最近的 turnProcess handle ---')
{
  const header = new FakeElement('button', { 'data-turn-process': '3' })
  const setOpen = () => {}
  attachFiber(header, { turnProcess: { spec: { turn: 3, answerStep: 2 }, setOpen } })
  check('turn', findTurnProcess(header)?.turn, 3)
  check('answerStep', findTurnProcess(header)?.answerStep, 2)
  checkTrue('setOpen 被保留', typeof findTurnProcess(header)?.setOpen === 'function')
}

console.log('--- F② 多个候选：取最近的一个 ---')
{
  const header = new FakeElement('button')
  attachFiber(
    header,
    { turnProcess: { spec: { turn: 9, answerStep: 1 } } },
    { turnProcess: { spec: { turn: 2, answerStep: 0 } } },
  )
  check('最近祖先优先', findTurnProcess(header)?.turn, 9)
}

console.log('--- F③ 形状守卫：不是 handle 的一律跳过 ---')
{
  for (const [label, props] of [
    ['turnProcess 不是对象', { turnProcess: 'nope' }],
    ['spec 不是对象', { turnProcess: { spec: null } }],
    ['turn 不是数字', { turnProcess: { spec: { turn: '3' } } }],
    ['turn 是 NaN', { turnProcess: { spec: { turn: Number.NaN } } }],
    ['props 不是对象', null],
  ]) {
    const header = new FakeElement('button')
    attachFiber(header, props)
    check(`${label} → null`, findTurnProcess(header), null)
  }
  const header = new FakeElement('button')
  attachFiber(header)
  check('没有 fiber → null', findTurnProcess(new FakeElement('button')), null)
  check('不是对象 → null', findTurnProcess(null), null)
}

console.log('--- F④ answerStep 缺失 / setOpen 非函数 ---')
{
  const header = new FakeElement('button')
  attachFiber(header, { turnProcess: { spec: { turn: 4 }, setOpen: 42 } })
  check('answerStep 缺失按 0', findTurnProcess(header)?.answerStep, 0)
  check('setOpen 非函数 → undefined', findTurnProcess(header)?.setOpen, undefined)
}

console.log('--- F⑤ 深度上限 ---')
{
  const header = new FakeElement('button')
  const chain = Array.from({ length: 80 }, () => ({}))
  chain[79] = { turnProcess: { spec: { turn: 1 } } }
  attachFiber(header, ...chain)
  check('超过 64 层不再找', findTurnProcess(header), null)
}

console.log('--- F⑥ actions.setTurnProcessOpen：绑定动作按三参调用 ---')
{
  const calls = []
  const header = new FakeElement('button')
  attachFiber(header, { actions: { setTurnProcessOpen: (...args) => calls.push(args) } })
  const action = findTurnProcessActions(header)
  checkTrue('找到动作', typeof action === 'function')
  action?.(5, 1, true)
  check('调用参数', calls, [[5, 1, true]])
}

console.log('--- F⑦ actions 的守卫 ---')
{
  for (const [label, props] of [
    ['actions 不是对象', { actions: 'nope' }],
    ['setTurnProcessOpen 不是函数', { actions: { setTurnProcessOpen: 1 } }],
    ['没有 actions', {}],
  ]) {
    const header = new FakeElement('button')
    attachFiber(header, props)
    check(`${label} → null`, findTurnProcessActions(header), null)
  }
}

finish()
