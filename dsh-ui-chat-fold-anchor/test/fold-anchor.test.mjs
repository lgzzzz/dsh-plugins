/**
 * A 纯逻辑：`compensateHidden` 的两次测量记账、修正量符号与失效判定。
 *
 * 探针是替身，所以这里验证的是「读到什么就写多少」，不含任何 DOM 语义；
 * 真实几何与时序由 client-wiring.test.mjs 与浏览器实测覆盖。
 */
import { MIN_DELTA, compensateHidden } from '../src/fold-anchor.ts'
import { check, checkSame, finish } from './helpers.mjs'

/** 一个可写的探针：pick/measure 返回预置值，写滚动位置累加进 `writes`。 */
function makeProbe({ anchor, measured }) {
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

console.log('--- A② 原生锚定已经补过时差值为 0，不再补第二遍 ---')
{
  const probe = {
    ...makeProbe({ anchor: { key: 'answer:3', top: 200 }, measured: 200 }),
    reveal: () => () => {},
    settle: () => {},
  }
  check('修正量', compensateHidden(probe), 0)
  check('没有写入', probe.writes, [])
}

console.log('--- A③ 亚像素抖动不写滚动位置 ---')
{
  const probe = {
    ...makeProbe({ anchor: { key: 'answer:3', top: 200 }, measured: 200 + MIN_DELTA / 2 }),
    reveal: () => () => {},
    settle: () => {},
  }
  check('修正量', compensateHidden(probe), 0)
  check('没有写入', probe.writes, [])
}

console.log('--- A④ 阅读线上没有可用锚点时降级为空操作 ---')
{
  const probe = {
    ...makeProbe({ anchor: null, measured: null }),
    reveal: () => () => {},
    settle: () => {},
  }
  checkSame('修正量', compensateHidden(probe), null)
  check('没有写入', probe.writes, [])
}

console.log('--- A⑤ 锚点重新测量失败时降级为空操作 ---')
{
  const probe = {
    ...makeProbe({ anchor: { key: 'answer:3', top: 200 }, measured: null }),
    reveal: () => () => {},
    settle: () => {},
  }
  checkSame('修正量', compensateHidden(probe), null)
  check('没有写入', probe.writes, [])
}

finish()
