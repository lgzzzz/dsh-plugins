/**
 * 消息滚动口翻页补偿：纯几何决策、rAF 动画与 window 捕获监听的行为。
 *
 * 纯函数覆盖“可见消息带”步长、边界钳制、Space 屏蔽与内层滚动让位；动画测试用可手动
 * 推进的假 rAF 覆盖单次缓动、连按累加、反向、取消与 reduced-motion；行为测试用假
 * document / window 装配真正的 `installChatPaging`，确认命中时只 preventDefault、
 * 不 stopPropagation，且输入框 / 按钮 / 终端 / 模态 / 多栏 / 内层滚动都保持原生。
 */
import {
  check,
  checkTrue,
  FakeElement,
  fakeKeyEvent,
  finish,
  withWindowDom,
} from './focus-helpers.mjs'
import {
  PAGE_OVERLAP,
  PAGING_ANIMATION_MS,
  PagingAnimator,
  decidePaging,
  installChatPaging,
  pagingKeyFrom,
  pagingStep,
} from '../src/chat-paging.ts'

/** 可手动推进的假 rAF：`advance` 只跑当前已排队的那批帧。 */
function fakeScheduler() {
  let time = 0
  let nextId = 0
  const frames = new Map()
  return {
    now: () => time,
    request(callback) {
      nextId += 1
      frames.set(nextId, callback)
      return nextId
    },
    cancel(handle) {
      frames.delete(handle)
    },
    get pending() {
      return frames.size
    },
    advance(ms) {
      time += ms
      const batch = [...frames.values()]
      frames.clear()
      for (const callback of batch) callback(time)
    },
    runToEnd(step = 16) {
      let guard = 0
      while (frames.size > 0 && guard < 100) {
        this.advance(step)
        guard += 1
      }
      return time
    },
  }
}

/** 只带滚动几何的假滚动口。 */
function fakeScroller({ scrollTop = 1500, clientHeight = 824, scrollHeight = 3149 } = {}) {
  const scroller = new FakeElement('div')
  scroller.clientHeight = clientHeight
  scroller.scrollHeight = scrollHeight
  scroller.scrollTop = scrollTop
  return scroller
}

console.log('--- P① 键与步长 ---')
{
  check('PageUp 识别', pagingKeyFrom({ key: 'PageUp', code: 'PageUp' }), 'PageUp')
  check('PageDown 识别', pagingKeyFrom({ key: 'PageDown', code: 'PageDown' }), 'PageDown')
  check('Space key 识别', pagingKeyFrom({ key: ' ', code: 'Space' }), 'Space')
  check('Space code 识别', pagingKeyFrom({ key: 'Unidentified', code: 'Space' }), 'Space')
  check('其它键不识别', pagingKeyFrom({ key: 'Escape', code: 'Escape' }), undefined)
  check('默认重叠量', PAGE_OVERLAP, 50)

  check('1440×900 可见带步长', pagingStep(824, 128), 646)
  check('1280×720 可见带步长', pagingStep(644, 128), 466)
  check('800×600 可见带步长', pagingStep(524, 128), 346)
  check('小窗口仍按可见带', pagingStep(337, 128), 159)
  check('可见带小于重叠量时至少 1px', pagingStep(100, 80), 1)
  check('composer 占满滚动口时不翻页', pagingStep(100, 120), 0)
  check('自定义重叠量', pagingStep(824, 128, 0), 696)
}

console.log('--- P② 决策：翻页 / 屏蔽 / 让位 ---')
{
  const geometry = { clientHeight: 824, composerHeight: 128, scrollTop: 1500, scrollHeight: 3149 }
  check('PageDown 从可见带下一页', decidePaging('PageDown', geometry), { type: 'page', top: 2146 })
  check('PageUp 从可见带上一页', decidePaging('PageUp', { ...geometry, scrollTop: 2146 }), { type: 'page', top: 1500 })
  check('PageDown 到底钳制', decidePaging('PageDown', { ...geometry, scrollTop: 2300 }), { type: 'page', top: 2325 })
  check('PageDown 已在底部让位', decidePaging('PageDown', { ...geometry, scrollTop: 2325 }), { type: 'pass' })
  check('PageUp 已在顶部让位', decidePaging('PageUp', { ...geometry, scrollTop: 0 }), { type: 'pass' })
  check('Space 直接屏蔽', decidePaging('Space', geometry), { type: 'block' })
  check('内层还能滚时 PageDown 让位', decidePaging('PageDown', geometry, true), { type: 'pass' })
  check('内层还能滚时 Space 让位', decidePaging('Space', geometry, true), { type: 'pass' })
  check('没有 composer 高度时 PageDown 让位', decidePaging('PageDown', { ...geometry, composerHeight: 0 }), { type: 'pass' })
  check('没有 composer 高度时 Space 也让位', decidePaging('Space', { ...geometry, composerHeight: 0 }), { type: 'pass' })
}

console.log('--- P③ rAF 翻页动画 ---')
{
  check('动画时长', PAGING_ANIMATION_MS, 320)

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const scroller = fakeScroller()
    let nativeSmooth = 0
    scroller.scrollTo = () => {
      nativeSmooth += 1
    }
    animator.page(scroller, 2146)
    check('动画启动不瞬移', scroller.scrollTop, 1500)
    check('动画只排一帧', clock.pending, 1)
    check('不再调用原生平滑滚动', nativeSmooth, 0)

    clock.advance(80)
    const at80 = scroller.scrollTop
    checkTrue('80ms 已离开起点', at80 > 1500)
    checkTrue('80ms 尚未到终点', at80 < 2146)
    const samples = [at80]
    while (clock.pending > 0) {
      clock.advance(16)
      samples.push(scroller.scrollTop)
    }
    check('动画精确到终点', scroller.scrollTop, 2146)
    checkTrue('动画单调前进', samples.every((value, index) => index === 0 || value >= samples[index - 1]))
    check('动画结束后不再排帧', clock.pending, 0)
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const scroller = fakeScroller({ scrollHeight: 5000 })
    animator.page(scroller, 2146)
    clock.advance(80)
    const before = scroller.scrollTop
    check('动画中的目标仍是第一页终点', animator.targetFor(scroller), 2146)

    animator.page(scroller, 2792)
    check('连按不把当前位置跳回起点', scroller.scrollTop, before)
    check('连按复用同一帧', clock.pending, 1)
    check('连按把新目标叠加上去', animator.targetFor(scroller), 2792)

    const samples = [scroller.scrollTop]
    while (clock.pending > 0) {
      clock.advance(16)
      samples.push(scroller.scrollTop)
    }
    check('连按到累加后的终点', scroller.scrollTop, 2792)
    checkTrue('连按过程不回退', samples.every((value, index) => index === 0 || value >= samples[index - 1]))
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const scroller = fakeScroller({ scrollHeight: 5000 })
    animator.page(scroller, 2146)
    clock.advance(80)
    const before = scroller.scrollTop
    animator.page(scroller, 500)
    check('反向连按不先跳走', scroller.scrollTop, before)

    let lowest = before
    let highest = before
    while (clock.pending > 0) {
      clock.advance(16)
      lowest = Math.min(lowest, scroller.scrollTop)
      highest = Math.max(highest, scroller.scrollTop)
    }
    check('反向动画到新终点', scroller.scrollTop, 500)
    check('反向过程不越过两端', [lowest >= 500, highest <= before], [true, true])
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const scroller = fakeScroller()
    animator.page(scroller, 2146)
    clock.advance(80)
    const stopped = scroller.scrollTop
    animator.cancel()
    check('取消后没有待执行帧', clock.pending, 0)
    clock.advance(200)
    check('取消后位置停住', scroller.scrollTop, stopped)
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const scroller = fakeScroller()
    animator.page(scroller, 2146)
    clock.advance(80)
    scroller.scrollTop = 1700
    clock.advance(16)
    check('外部写入会取消动画', clock.pending, 0)
    check('外部位置不被覆盖', scroller.scrollTop, 1700)
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock, reducedMotion: () => true })
    const scroller = fakeScroller()
    animator.page(scroller, 2146)
    check('减少动态效果瞬时到位', scroller.scrollTop, 2146)
    check('减少动态效果不排帧', clock.pending, 0)
  }

  {
    const animator = new PagingAnimator({ scheduler: null })
    const scroller = fakeScroller()
    animator.page(scroller, 2146)
    check('没有 rAF 时瞬时到位', scroller.scrollTop, 2146)
    check('没有 rAF 时不留下目标', animator.targetFor(scroller), 2146)
  }
}

console.log('--- P④ window 捕获监听 ---')
{
  /** 标准单滚动口场景：824 高、composer 128、内容 3149；可注入动画与更高的内容。 */
  function fixture({
    composer = true,
    composerHeight = 128,
    scrollTop = 1500,
    scrollHeight = 3149,
    animator,
  } = {}) {
    const root = new FakeElement('div')
    const scroller = root.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
    scroller.clientHeight = 824
    scroller.scrollHeight = scrollHeight
    scroller.scrollTop = scrollTop
    scroller.getBoundingClientRect = () => ({ top: 76, bottom: 900, height: 824 })
    const seat = composer ? scroller.append(new FakeElement('div', { 'data-composer-seat': '' })) : null
    if (seat !== null) seat.offsetHeight = composerHeight
    const message = scroller.append(new FakeElement('div', { 'data-chat-flow-kind': 'user' }))
    const dom = withWindowDom({ root, activeElement: message })
    dom.window.innerHeight = 900
    const cleanups = []
    installChatPaging({
      inject(_deps, callback) {
        callback({
          effect(execute) {
            const dispose = execute()
            cleanups.push(dispose)
            return { dispose }
          },
        })
      },
    }, animator)
    return {
      ...dom,
      root,
      scroller,
      seat,
      message,
      dispose() {
        for (const cleanup of cleanups.reverse()) cleanup?.()
        dom.restore()
      },
    }
  }

  /** 派发一次捕获阶段的 keydown；返回事件读数。 */
  function press(dom, key, path, overrides = {}) {
    const event = fakeKeyEvent({
      key,
      code: key === ' ' ? 'Space' : key,
      path,
      ...overrides,
    })
    if (overrides.defaultPrevented === true) event.defaultPrevented = true
    dom.window.emit(event, 'capture')
    return event
  }

  {
    const dom = fixture()
    try {
      const event = press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      check('PageDown 消费按键', event.prevented, 1)
      check('PageDown 不 stopPropagation', event.stopped, 0)
      check('PageDown 落在可见带下一页', dom.scroller.scrollTop, 2146)

      const up = press(dom, 'PageUp', [dom.message, dom.scroller, dom.root])
      check('PageUp 消费按键', up.prevented, 1)
      check('PageUp 落在可见带上一页', dom.scroller.scrollTop, 1500)
    } finally {
      dom.dispose()
    }
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const dom = fixture({ animator })
    const native = []
    dom.scroller.scrollTo = (options) => native.push(options)
    try {
      const event = press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      check('rAF 翻页消费按键', event.prevented, 1)
      check('rAF 翻页不瞬移', dom.scroller.scrollTop, 1500)
      check('rAF 翻页已排帧', clock.pending, 1)
      check('rAF 翻页不走原生 smooth', native, [])

      clock.advance(80)
      checkTrue('rAF 翻页中途已移动', dom.scroller.scrollTop > 1500)
      clock.runToEnd()
      check('rAF 翻页落在可见带下一页', dom.scroller.scrollTop, 2146)
    } finally {
      dom.dispose()
    }
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const dom = fixture({ animator, scrollHeight: 5000 })
    try {
      press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      clock.advance(80)
      const before = dom.scroller.scrollTop
      press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      check('连按后的目标继续累加', animator.targetFor(dom.scroller), 2792)
      check('连按不把当前位置跳回起点', dom.scroller.scrollTop, before)
      clock.runToEnd()
      check('连按后落到第二页', dom.scroller.scrollTop, 2792)
    } finally {
      dom.dispose()
    }
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const dom = fixture({ animator, scrollTop: 2300 })
    try {
      press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      clock.advance(80)
      const atEdge = press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      check('动画到边界时仍拦住原生翻页', atEdge.prevented, 1)
      check('动画到边界时不再叠新目标', animator.targetFor(dom.scroller), 2325)
      check('动画到边界时保留原帧', clock.pending, 1)
      clock.runToEnd()
      check('动画到边界后停在底部', dom.scroller.scrollTop, 2325)
    } finally {
      dom.dispose()
    }
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const dom = fixture({ animator })
    try {
      press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      clock.advance(80)
      const stopped = dom.scroller.scrollTop
      dom.window.emitType('wheel', { type: 'wheel' })
      check('滚轮取消待执行帧', clock.pending, 0)
      clock.advance(160)
      check('滚轮取消后位置停住', dom.scroller.scrollTop, stopped)
    } finally {
      dom.dispose()
    }
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const dom = fixture({ animator })
    try {
      press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      clock.advance(80)
      const stopped = dom.scroller.scrollTop
      const space = press(dom, ' ', [dom.message, dom.scroller, dom.root])
      check('Space 取消动画仍吞键', space.prevented, 1)
      check('Space 取消动画待执行帧', clock.pending, 0)
      clock.advance(160)
      check('Space 取消后位置停住', dom.scroller.scrollTop, stopped)
    } finally {
      dom.dispose()
    }
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock })
    const dom = fixture({ animator })
    try {
      press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      clock.advance(80)
      const stopped = dom.scroller.scrollTop
      const escape = press(dom, 'Escape', [dom.message, dom.scroller, dom.root])
      check('其它按键不消费', escape.prevented, 0)
      check('其它按键取消动画', clock.pending, 0)
      clock.advance(160)
      check('其它按键取消后位置停住', dom.scroller.scrollTop, stopped)
    } finally {
      dom.dispose()
    }
  }

  {
    const clock = fakeScheduler()
    const animator = new PagingAnimator({ scheduler: clock, reducedMotion: () => true })
    const dom = fixture({ animator })
    try {
      press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      check('减少动态效果时直接到位', dom.scroller.scrollTop, 2146)
      check('减少动态效果不排帧', clock.pending, 0)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture()
    try {
      const event = press(dom, ' ', [dom.message, dom.scroller, dom.root])
      check('Space 被吞掉', event.prevented, 1)
      check('Space 不滚动', dom.scroller.scrollTop, 1500)

      const button = dom.scroller.append(new FakeElement('button'))
      const buttonEvent = press(dom, ' ', [button, dom.scroller, dom.root])
      check('按钮上的 Space 让位', buttonEvent.prevented, 0)
      const selectEvent = press(dom, 'PageDown', [button, dom.scroller, dom.root])
      check('按钮上的 PageDown 仍接管', selectEvent.prevented, 1)
      const textarea = dom.scroller.append(new FakeElement('textarea'))
      check('textarea 上的 PageDown 让位', press(dom, 'PageDown', [textarea, dom.scroller, dom.root]).prevented, 0)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture()
    try {
      const editable = dom.seat.append(new FakeElement('div', { contenteditable: 'true' }))
      const space = press(dom, ' ', [editable, dom.seat, dom.scroller, dom.root])
      check('composer 里的 Space 不拦', space.prevented, 0)
      check('composer 里的 Space 不滚动', dom.scroller.scrollTop, 1500)

      const page = press(dom, 'PageDown', [editable, dom.seat, dom.scroller, dom.root])
      check('composer 里的 PageDown 按可见带翻页', page.prevented, 1)
      check('composer 里的 PageDown 步长', dom.scroller.scrollTop, 2146)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture()
    try {
      check('Ctrl+PageDown 让位', press(dom, 'PageDown', [dom.message, dom.scroller, dom.root], { ctrlKey: true }).prevented, 0)
      check('Shift+PageUp 让位', press(dom, 'PageUp', [dom.message, dom.scroller, dom.root], { shiftKey: true }).prevented, 0)
      check('组字中的 PageDown 让位', press(dom, 'PageDown', [dom.message, dom.scroller, dom.root], { isComposing: true }).prevented, 0)
      check('已被消费的 PageDown 让位', press(dom, 'PageDown', [dom.message, dom.scroller, dom.root], { defaultPrevented: true }).prevented, 0)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture({ scrollTop: 2325 })
    try {
      check('已在底部时 PageDown 让位给原生', press(dom, 'PageDown', [dom.message, dom.scroller, dom.root]).prevented, 0)
      check('底部位置不变', dom.scroller.scrollTop, 2325)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture({ composer: false })
    try {
      check('没有 composer 座位时不接管', press(dom, 'PageDown', [dom.message, dom.scroller, dom.root]).prevented, 0)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture({ composerHeight: 0 })
    try {
      check('composer 高度为 0 时不接管', press(dom, 'PageDown', [dom.message, dom.scroller, dom.root]).prevented, 0)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture()
    try {
      const terminal = dom.scroller.append(new FakeElement('div', { class: 'xterm' }))
      check('终端内 PageDown 让位', press(dom, 'PageDown', [terminal, dom.scroller, dom.root]).prevented, 0)
      const modal = dom.root.append(new FakeElement('div', { role: 'dialog', 'aria-modal': 'true' }))
      check('模态打开时 PageDown 让位', press(dom, 'PageDown', [modal, dom.root]).prevented, 0)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture()
    const previous = globalThis.getComputedStyle
    globalThis.getComputedStyle = (element) => ({ overflowY: element.scrollable === true ? 'auto' : 'visible' })
    try {
      const inner = dom.scroller.append(new FakeElement('div'))
      inner.scrollable = true
      inner.scrollHeight = 1000
      inner.clientHeight = 300
      inner.scrollTop = 0
      const target = inner.append(new FakeElement('div'))
      check('内层还能滚时 PageDown 让位', press(dom, 'PageDown', [target, inner, dom.scroller, dom.root]).prevented, 0)
      check('外层不滚动', dom.scroller.scrollTop, 1500)

      inner.scrollTop = 700
      const atBoundary = press(dom, 'PageDown', [target, inner, dom.scroller, dom.root])
      check('内层到底后外层接管', atBoundary.prevented, 1)
      check('外层按可见带翻页', dom.scroller.scrollTop, 2146)
    } finally {
      dom.dispose()
      if (previous === undefined) delete globalThis.getComputedStyle
      else globalThis.getComputedStyle = previous
    }
  }

  {
    const dom = fixture()
    try {
      // 目标不在滚动口内、焦点也在根上：只有一个可见滚动口时用回退解析。
      const event = press(dom, 'PageDown', [dom.root])
      check('body 类目标回退到唯一滚动口', event.prevented, 1)
      check('回退后按可见带翻页', dom.scroller.scrollTop, 2146)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture()
    try {
      const second = dom.root.append(new FakeElement('div', { 'data-conversation-scroll': '' }))
      second.clientHeight = 824
      second.scrollHeight = 3149
      second.scrollTop = 1500
      second.getBoundingClientRect = () => ({ top: 76, bottom: 900, height: 824 })
      const seat = second.append(new FakeElement('div', { 'data-composer-seat': '' }))
      seat.offsetHeight = 128
      globalThis.document.activeElement = dom.root
      check('多栏且无法判定焦点时让位', press(dom, 'PageDown', [dom.root]).prevented, 0)
    } finally {
      dom.dispose()
    }
  }

  {
    const dom = fixture()
    try {
      // 直接触发 effect 的清理：fixture 的 dispose 已持有全部清理函数。
      dom.dispose()
      const event = press(dom, 'PageDown', [dom.message, dom.scroller, dom.root])
      check('卸载后不再接管', event.prevented, 0)
    } finally {
      // dispose 已执行；withWindowDom 已还原，这里不再重复。
    }
  }
}

finish()
