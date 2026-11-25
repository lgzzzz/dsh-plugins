/**
 * `src/reveal.ts` 的时序测试：点击 → 等状态 → 等详情 → 加高 + 滚动，以及之后的关闭、
 * 流式变高、窗口变大变小与卸载。
 *
 * `window` 用替身：只实现插件真正调用的那几个成员（监听、rAF、计算样式、ResizeObserver、
 * innerHeight）。DOM 结构与 `anchors.test.mjs` 一致，含 HoverCard 那层 `<span>`。
 * 跑全部请用 `node test/run-all.mjs`（或 `pnpm test`）。
 */
import { installJobDetailReveal } from '../src/reveal.ts'
import { check, finish, fakeElement } from './helpers.mjs'

// ---- 装置 ----------------------------------------------------------------

/** 最小 `window` 替身：rAF 可手动推进，`getComputedStyle` 读替身自己的字段。 */
function fakeWindow({ innerHeight = 1309 } = {}) {
  const listeners = new Map()
  const queue = []
  const cancelled = new Set()
  let nextId = 1
  const win = {
    innerHeight,
    /** 记录每次安装的 ResizeObserver 实例，测试手动触发回调。 */
    resizeObservers: [],
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
    /** 测试用：取出某个监听。 */
    listener(type) { return listeners.get(type) },
    requestAnimationFrame(fn) {
      const id = nextId++
      queue.push({ id, fn })
      return id
    },
    cancelAnimationFrame(id) { cancelled.add(id) },
    getComputedStyle(element) {
      const override = element.style.getPropertyValue('max-height')
      return {
        paddingTop: element.computed?.paddingTop ?? '0px',
        paddingBottom: element.computed?.paddingBottom ?? '0px',
        maxHeight: override !== '' ? override : (element.computed?.maxHeight ?? 'none'),
      }
    },
    /** 测试用：按顺序推进最多 count 帧，返回实际推进的帧数。 */
    runFrames(count) {
      let ran = 0
      while (ran < count) {
        const index = queue.findIndex(item => !cancelled.has(item.id))
        if (index === -1) break
        const [{ fn }] = queue.splice(index, 1)
        fn(0)
        ran += 1
      }
      return ran
    },
    /** 测试用：还有多少帧在等。 */
    pendingFrames() { return queue.filter(item => !cancelled.has(item.id)).length },
  }
  win.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      win.resizeObservers.push(this)
    }
    observe(element) { this.element = element }
    disconnect() { this.disconnected = true }
    /** 测试用：模拟一次尺寸变化回调。 */
    fire() { this.callback([]) }
  }
  return win
}

/** 让 child 的 parentElement 指向 parent（不登记选择器表）。 */
function connect(parent, child) {
  child.parentElement = parent
  return child
}

/**
 * 搭一棵「面板 → 列表 → 行 + 详情」的树。
 * @param {object} options
 * @param {string} options.naturalMaxHeight 上游 max-height 的计算值
 * @param {number} options.itemHeight `<li>` 的高度（行 + 详情）
 * @param {number} [options.rowTop] 行顶在视口里的位置
 * @param {number} [options.panelTop] 面板顶在视口里的位置
 * @param {string} [options.padding] 面板上下内边距
 */
function buildDom({ naturalMaxHeight = '1133px', itemHeight = 340, rowTop = 500, panelTop = 12, padding = '6px', withDetail = true } = {}) {
  const panel = fakeElement({ tag: 'aside', attributes: { 'data-session-panel': 'docked' }, rect: { top: panelTop, height: 600 } })
  panel.computed = { paddingTop: padding, paddingBottom: padding, maxHeight: naturalMaxHeight }
  const list = fakeElement({ tag: 'ul', attributes: { 'data-jobs-section': '' } })
  const item = fakeElement({ tag: 'li', rect: { top: rowTop - 10, height: itemHeight } })
  const wrapper = fakeElement({ tag: 'span' })
  const row = fakeElement({ tag: 'div', attributes: { 'data-job-row': '' }, rect: { top: rowTop, height: 28 } })
  const toggle = fakeElement({ tag: 'button', attributes: { 'aria-expanded': 'false' } })
  const stop = fakeElement({ tag: 'button', attributes: { 'aria-label': '停止任务 bash /tmp/pwa-build/setup.sh' } })
  const detail = fakeElement({ tag: 'div', rect: { top: rowTop + 30, height: itemHeight - 30 } })
  const terminal = fakeElement({ tag: 'div', attributes: { 'data-terminal': '' } })

  connect(panel, list)
  connect(list, item)
  connect(item, wrapper)
  connect(wrapper, row)
  row.attach('button[aria-expanded]', toggle)
  connect(row, stop)
  connect(item, detail)
  if (withDetail) connect(detail, terminal)

  const dom = { panel, list, item, wrapper, row, toggle, stop, detail, terminal }
  /** 模拟上游提交展开状态并挂上详情。 */
  dom.open = () => {
    dom.toggle.setAttribute('aria-expanded', 'true')
    item.children['[data-terminal]'] = terminal
  }
  /** 模拟上游收起：详情卸载、状态回到 false。 */
  dom.close = () => {
    dom.toggle.setAttribute('aria-expanded', 'false')
    delete item.children['[data-terminal]']
  }
  return dom
}

/** 派发一次点击（只经过插件挂在 window 上的捕获监听）。 */
function click(win, target) {
  win.listener('click')({ target })
}

// ---- 场景 ----------------------------------------------------------------

// 装得下：只滚动，不改 max-height。
{
  const win = fakeWindow({ innerHeight: 1309 })
  const dom = buildDom({ naturalMaxHeight: '1133px', itemHeight: 340, rowTop: 500 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  check('等一帧就认出展开', win.runFrames(1), 1)
  check('装得下时不动上游 max-height', dom.panel.style.size, 0)
  check('行顶到面板内容区起点', dom.panel.scrollTop, 500 - 12 - 6)
  dispose()
}

// 装不下：先加高到装下，再滚动。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340, rowTop: 500 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  win.runFrames(1)
  // 行 + 详情 340，加面板上下内边距 12。
  check('加高到刚好装下', dom.panel.style.getPropertyValue('max-height'), '352px')
  check('加高后照样把行顶到起点', dom.panel.scrollTop, 500 - 12 - 6)
  dispose()
}

// 视口装不下：只加到视口允许的高度。
{
  const win = fakeWindow({ innerHeight: 400 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 600, rowTop: 500 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  win.runFrames(1)
  check('加高封顶到视口', dom.panel.style.getPropertyValue('max-height'), `${400 - 12 - 12}px`)
  dispose()
}

// 点击只是收起：不加高、不滚动。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340, rowTop: 500 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  win.runFrames(1)
  const heightWhileOpen = dom.panel.style.getPropertyValue('max-height')
  const scrollWhileOpen = dom.panel.scrollTop
  click(win, dom.toggle)
  dom.close()
  win.runFrames(3)
  check('再次点击立刻撤掉加高', dom.panel.style.size, 0)
  check('滚动位置不动', dom.panel.scrollTop, scrollWhileOpen)
  check('这一轮确实加过高', heightWhileOpen !== '', true)
  check('等待循环已经停下', win.pendingFrames(), 0)
  dispose()
}

// 上游自己收起（没有点我们的监听）：尺寸变化回调负责收尾。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  win.runFrames(1)
  check('先加高', dom.panel.style.size, 1)
  dom.close()
  dom.item.rect.height = 40
  win.resizeObservers.at(-1).fire()
  check('上游收起后撤掉加高', dom.panel.style.size, 0)
  dispose()
}

// 详情流式变高：跟着加高，但不重新滚动。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340, rowTop: 500 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  win.runFrames(1)
  const scrollWhileOpen = dom.panel.scrollTop
  dom.item.rect.height = 500
  win.resizeObservers.at(-1).fire()
  check('按新的详情高度重算加高', dom.panel.style.getPropertyValue('max-height'), '512px')
  check('流式变高不重新滚动', dom.panel.scrollTop, scrollWhileOpen)
  dispose()
}

// 窗口尺寸变化：重算加高，方向上跟随视口。
{
  const win = fakeWindow({ innerHeight: 1309 })
  const dom = buildDom({ naturalMaxHeight: '1133px', itemHeight: 340 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  win.runFrames(1)
  check('大窗口下不加高', dom.panel.style.size, 0)
  win.innerHeight = 400
  dom.panel.computed.maxHeight = '200px'
  win.listener('resize')()
  check('窗口变小后补上加高', dom.panel.style.getPropertyValue('max-height'), '352px')
  win.innerHeight = 1309
  dom.panel.computed.maxHeight = '1133px'
  win.listener('resize')()
  check('窗口变回大屏后撤掉加高', dom.panel.style.size, 0)
  dispose()
}

// 点停止按钮：不算展开，什么都不做。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.stop)
  win.runFrames(2)
  check('点停止不排等待帧', win.pendingFrames(), 0)
  check('点停止不滚动', dom.panel.scrollTop, 0)
  check('点停止不加高', dom.panel.style.size, 0)
  dispose()
}

// 点开但详情一直没来：等到上限就放弃，不空转。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.toggle.setAttribute('aria-expanded', 'true')
  win.runFrames(120)
  check('等不到详情就停下', win.pendingFrames(), 0)
  check('等不到详情时不动面板', dom.panel.scrollTop, 0)
  check('等不到详情时不加高', dom.panel.style.size, 0)
  dispose()
}

// 详情晚到几帧：仍然认得出（前几帧 aria-expanded 还是 false）。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  win.runFrames(1)
  dom.open()
  win.runFrames(1)
  check('晚一帧落定也能露出详情', dom.panel.style.getPropertyValue('max-height'), '352px')
  dispose()
}

// 行被上游移除：下一帧回调收尾。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  win.runFrames(1)
  dom.row.isConnected = false
  win.resizeObservers.at(-1).fire()
  check('行没了就撤掉加高', dom.panel.style.size, 0)
  dispose()
}

// 卸载：撤监听、撤观察者、还原样式。
{
  const win = fakeWindow({ innerHeight: 800 })
  const dom = buildDom({ naturalMaxHeight: '200px', itemHeight: 340 })
  const dispose = installJobDetailReveal(win)
  click(win, dom.toggle)
  dom.open()
  win.runFrames(1)
  check('卸载前加高存在', dom.panel.style.size, 1)
  dispose()
  check('卸载时还原加高', dom.panel.style.size, 0)
  check('卸载后不再有监听', win.listener('click'), undefined)
  check('卸载时断开观察者', win.resizeObservers.at(-1).disconnected, true)
  check('卸载后不再排帧', win.pendingFrames(), 0)
}

finish()
