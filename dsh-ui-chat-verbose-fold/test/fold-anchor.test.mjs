/**
 * A 纯逻辑：`compensateHidden` 的两次测量记账、修正量符号与失效判定。
 *
 * 探针是替身，所以这里验证的是「读到什么就写多少」，不含任何 DOM 语义；
 * 真实几何与时序由 `scroll-anchor.test.mjs` 与浏览器实测覆盖。
 */
import { MIN_DELTA, compensateHidden } from '../src/fold-anchor.ts'
import { check, checkSame, finish } from './helpers.mjs'

/**
 * 一个可写的探针：pick/measure 返回预置值，写滚动位置累加进 `writes`。
 *
 * @param options - 阅读线锚点、复原后重测到的位置与无锚点回退修正量。
 */
function makeProbe({ anchor, measured, fallback = null }) {
  return {
    scrollTop: 1000,
    writes: [],
    readScrollTop() {
      return this.scrollTop
    },
    writeScrollTop(value) {
      this.writes.push(value)
      this.scrollTop = value
    },
    pick: () => anchor,
    measure: () => measured,
    fallbackDelta: () => fallback,
    reveal: () => () => {},
    settle: () => {},
  }
}

console.log('--- A① 按折叠前后的两次测量补差值 ---')
{
  const calls = []
  const probe = {
    scrollTop: 1000,
    readScrollTop() {
      return this.scrollTop
    },
    writeScrollTop(value) {
      calls.push(['write', value])
      this.scrollTop = value
    },
    pick: () => ({ key: 'answer:3', top: 200 }),
    measure: () => 20,
    fallbackDelta: () => null,
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

console.log('--- A② 内容下移时写正修正量 ---')
{
  const probe = {
    ...makeProbe({ anchor: { key: 'answer:3', top: 200 }, measured: 260 }),
  }
  check('修正量', compensateHidden(probe), 60)
  check('写入位置', probe.scrollTop, 1060)
}

console.log('--- A③ 原生锚定已经补过时差值为 0，不再补第二遍 ---')
{
  const probe = {
    ...makeProbe({ anchor: { key: 'answer:3', top: 200 }, measured: 200 }),
  }
  check('修正量', compensateHidden(probe), 0)
  check('没有写入', probe.writes, [])
}

console.log('--- A④ 亚像素抖动不写滚动位置 ---')
{
  const probe = {
    ...makeProbe({ anchor: { key: 'answer:3', top: 200 }, measured: 200 + MIN_DELTA / 2 }),
  }
  check('修正量', compensateHidden(probe), 0)
  check('没有写入', probe.writes, [])
}

console.log('--- A⑤ 没有可用锚点时复原后询问用户消息回退，回退也缺席才放弃 ---')
{
  const calls = []
  const probe = {
    scrollTop: 1000,
    writes: [],
    readScrollTop() {
      return this.scrollTop
    },
    writeScrollTop(value) {
      this.writes.push(value)
      this.scrollTop = value
    },
    pick: () => null,
    measure: () => {
      calls.push('measure')
      return null
    },
    fallbackDelta: () => {
      calls.push('fallback')
      return null
    },
    reveal: () => {
      calls.push('reveal')
      return () => calls.push('restore')
    },
    settle: () => calls.push('settle'),
  }
  checkSame('修正量', compensateHidden(probe), null)
  check('没有写入', probe.writes, [])
  check('复原后测量折叠后的回退落点', calls, ['reveal', 'settle', 'restore', 'settle', 'fallback'])
}

console.log('--- A⑥ 锚点重新测量失败时降级为空操作，不走用户消息回退 ---')
{
  const calls = []
  const probe = {
    ...makeProbe({ anchor: { key: 'answer:3', top: 200 }, measured: null }),
    fallbackDelta: () => {
      calls.push('fallback')
      return -100
    },
  }
  checkSame('修正量', compensateHidden(probe), null)
  check('没有写入', probe.writes, [])
  check('没有回退', calls, [])
}

console.log('--- A⑦ 没有可见锚点时按用户消息回退量写回滚动位置 ---')
{
  const calls = []
  const probe = {
    scrollTop: 1000,
    writes: [],
    readScrollTop() {
      return this.scrollTop
    },
    writeScrollTop(value) {
      this.writes.push(value)
      this.scrollTop = value
    },
    pick: () => null,
    measure: () => null,
    fallbackDelta: () => {
      calls.push('fallback')
      return -201
    },
    reveal: () => {
      calls.push('reveal')
      return () => calls.push('restore')
    },
    settle: () => calls.push('settle'),
  }
  check('回退修正量', compensateHidden(probe), -201)
  check('写入位置', probe.scrollTop, 799)
  check('顺序', calls, ['reveal', 'settle', 'restore', 'settle', 'fallback'])
}

console.log('--- A⑧ 用户消息回退量是亚像素抖动时不写 ---')
{
  const probe = {
    ...makeProbe({ anchor: null, measured: null, fallback: MIN_DELTA / 2 }),
  }
  check('修正量', compensateHidden(probe), 0)
  check('没有写入', probe.writes, [])
}

finish()
