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
 * @param options - 阅读线锚点与复原后重测到的位置。
 */
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

console.log('--- A⑤ 阅读线上没有可用锚点时只复原，不做第二次测量 ---')
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
    reveal: () => {
      calls.push('reveal')
      return () => calls.push('restore')
    },
    settle: () => calls.push('settle'),
  }
  checkSame('修正量', compensateHidden(probe), null)
  check('没有写入', probe.writes, [])
  check('显回、测量一次后直接复原', calls, ['reveal', 'settle', 'restore'])
}

console.log('--- A⑥ 锚点重新测量失败时降级为空操作 ---')
{
  const probe = {
    ...makeProbe({ anchor: { key: 'answer:3', top: 200 }, measured: null }),
  }
  checkSame('修正量', compensateHidden(probe), null)
  check('没有写入', probe.writes, [])
}

finish()
