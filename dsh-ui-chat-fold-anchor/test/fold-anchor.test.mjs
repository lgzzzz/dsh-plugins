/**
 * A 纯逻辑：`openSession` 的参照点记账、修正量符号与失效判定。
 *
 * 探针是替身，所以这里验证的是「读到什么就写多少」，不含任何 DOM 语义；
 * 真实几何与时序由 client-wiring.test.mjs 与浏览器实测覆盖。
 */
import { MIN_DELTA, compensateHidden, openSession } from '../src/fold-anchor.ts'
import { check, checkSame, checkTrue, finish } from './helpers.mjs'

/** 一个记账探针：pick/measure 返回预置值，写滚动位置累加进 `writes`。 */
function makeProbe({ anchor = null, measured = null } = {}) {
  const state = {
    anchor,
    measured,
    scrollTop: 1000,
    writes: [],
  }
  return {
    state,
    readScrollTop: () => state.scrollTop,
    writeScrollTop: (value) => {
      state.writes.push(value)
      state.scrollTop = value
    },
    pick: () => state.anchor,
    measure: (key) => (state.anchor !== null && state.anchor.key === key ? state.measured : null),
  }
}

console.log('--- A① 没有可用锚点时不建会话 ---')
{
  const probe = makeProbe()
  checkSame('openSession', openSession(probe), null)
}

console.log('--- A② 锚点上移多少就补回多少 ---')
{
  const probe = makeProbe({ anchor: { key: 'answer:3', top: 200 } })
  probe.state.measured = -100
  const session = openSession(probe)
  check('会话键', session.key, 'answer:3')
  check('修正量', session.correct(), -300)
  check('写入位置', probe.state.writes, [700])
}

console.log('--- A③ 锚点没动或只亚像素抖动时不写 ---')
{
  const probe = makeProbe({ anchor: { key: 'answer:3', top: 200 } })
  probe.state.measured = 200
  const session = openSession(probe)
  check('原地修正量', session.correct(), 0)
  probe.state.measured = 200 + MIN_DELTA / 2
  check('抖动修正量', session.correct(), 0)
  check('没有写入', probe.state.writes, [])
}

console.log('--- A④ 锚点失效后交回调用方 ---')
{
  const probe = makeProbe({ anchor: { key: 'answer:3', top: 200 } })
  probe.state.measured = null
  const session = openSession(probe)
  checkSame('失效修正', session.correct(), null)
  check('没有写入', probe.state.writes, [])
}

console.log('--- A⑤ 折叠在阅读线下方时锚点不动,修正量为 0 ---')
{
  // 折叠段整体在视口之下：锚点的视觉偏移不变，会话什么都不做。
  const probe = makeProbe({ anchor: { key: 'answer:3', top: 200 } })
  probe.state.measured = 200
  const session = openSession(probe)
  checkTrue('会话已建立', session !== null)
  check('修正量', session.correct(), 0)
  check('没有写入', probe.state.writes, [])
}

console.log('--- A⑥ 即时折叠：按折叠前/后的两次测量补差值 ---')
{
  const calls = []
  const probe = {
    scrollTop: 1000,
    reads: 0,
    readScrollTop() {
      return this.scrollTop
    },
    writeScrollTop(value) {
      calls.push(['write', value])
      this.scrollTop = value
    },
    pick: () => ({ key: 'answer:3', top: 200 }),
    measure: () => 20,
    reveal: () => {
      calls.push(['reveal'])
      return () => calls.push(['restore'])
    },
    settle: () => calls.push(['settle']),
  }
  check('修正量', compensateHidden(probe), -180)
  check('调用顺序', calls, [['reveal'], ['settle'], ['restore'], ['settle'], ['write', 820]])
  check('写入位置', probe.scrollTop, 820)
}

console.log('--- A⑦ 原生锚定已经补过时差值为 0，不再补第二遍 ---')
{
  const probe = {
    scrollTop: 820,
    writes: 0,
    readScrollTop() {
      return this.scrollTop
    },
    writeScrollTop() {
      this.writes += 1
    },
    pick: () => ({ key: 'answer:3', top: 200 }),
    // 第二次测量读到的已经是浏览器补过的位置。
    measure: () => 200,
    reveal: () => () => {},
    settle: () => {},
  }
  check('修正量', compensateHidden(probe), 0)
  check('没有写入', probe.writes, 0)
}

console.log('--- A⑧ 即时折叠里没有可用锚点时降级为空操作 ---')
{
  const probe = {
    scrollTop: 1000,
    writes: 0,
    readScrollTop() {
      return this.scrollTop
    },
    writeScrollTop() {
      this.writes += 1
    },
    pick: () => null,
    measure: () => null,
    reveal: () => () => {},
    settle: () => {},
  }
  checkSame('修正量', compensateHidden(probe), null)
  check('没有写入', probe.writes, 0)
}

finish()
