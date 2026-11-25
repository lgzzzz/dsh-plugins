/**
 * 浏览器半部的全部行为：点开某一行的命令输出后，把这条任务行滚到会话面板顶部，并在详情
 * 装不下时加高面板；关掉详情立刻恢复，详情在流式变高时跟着加高。
 *
 * ## 为什么要做
 *
 * 会话面板是个 `max-height` + `overflow-y: auto` 的浮层（上游 `SessionPanel.module.css`）。
 * 后台任务分区的行可以点开命令输出：详情插在行下面，把内容撑高，于是面板出现滚动条。点开时
 * 面板的 `scrollTop` 还停在原来的位置（通常在顶部），详情落在可视区外面，得自己往下滚才看得到；
 * 而「收起」这个动作（再点一次那一行）也跟着滚出了视野。
 *
 * ## 时序
 *
 * 一次点击要走三段：
 *
 * 1. **等状态落定**：点展开按钮只是把 React 状态翻成展开，`aria-expanded` 要等这一次提交之后
 *    才变成 `"true"`。所以点击后先按帧等，前几帧还读到 `false` 是正常的（也可能这一下是「收起」）。
 * 2. **等详情挂载**：详情要等观察流的第一帧输出到达才渲染（上游 `expanded && view !== undefined`），
 *    这中间什么都测不了。等不到就放弃，不留在后台空转。
 * 3. **定位**：先按需加高 `max-height`（装不下时），再改 `scrollTop`——顺序不能反：先滚的话，
 *    面板还没有装下详情的空间，滚动会被内容长度夹住，行到不了顶部。
 *
 * 之后只用两个观察者维持状态：详情所在 `<li>` 的尺寸变化（详情挂载、流式变高、收起）重算加高，
 * 窗口尺寸变化同样重算；两者都不重新滚动，读者自己滚上去看别的内容时不会被拽回来。
 *
 * ## 与上游的边界
 *
 * 只改两样东西：面板元素的 `scrollTop` 与内联 `max-height`（只在自己加过时移除）。不换类名、
 * 不加样式表、不碰 React 状态；插件卸载时全部还原。上游把面板或任务行换掉时，`isConnected`
 * 与结构判定会认出来并安静退出，而不是继续往一个已经不在页面上的节点上写值。
 *
 * `window` 可注入：单元测试用最小替身跑同一条时序（见 test/reveal.test.mjs）。
 */

import { isRowExpanded, jobDetailOf, jobRowOf, rowToggleOf, sessionPanelOf } from './anchors.ts'
import type { JobDetailTargets } from './anchors.ts'
import { fitMaxHeight, parseMaxHeight, rowScrollTop } from './plan.ts'

/**
 * 等「点开之后详情挂载」的上限（帧）。详情要等观察流的第一帧，通常几十毫秒；按 60fps 折算
 * 这里约 1.5 秒，慢链路也够，等不到就放弃。
 */
const WAIT_FRAMES = 90

/**
 * 点击后至少等这么多帧再判定「这一下是收起」。React 在离散事件里同步提交，第一帧通常已经能读到
 * `aria-expanded="false"`；多等一帧只是给合成事件 / 过渡留余量。
 */
const SETTLE_FRAMES = 2

/**
 * 插件用到的那部分 `window`。
 *
 * 写成接口而不是直接用 `Window`：一是测试替身只需实现这几项，二是 `ResizeObserver` 在
 * `lib.dom` 里是全局构造器、并没有声明在 `Window` 接口上，直接读 `win.ResizeObserver`
 * 过不了类型检查（浏览器里它确实挂在那儿）。
 */
export interface RevealWindow {
  /** 视口高度：加高的上限按它算。 */
  readonly innerHeight: number
  /** 读计算样式：面板的内边距与上游算出的 `max-height`。 */
  getComputedStyle(element: Element): CSSStyleDeclaration
  /** 排队一帧：等 React 提交展开状态、等详情挂载。 */
  requestAnimationFrame(callback: FrameRequestCallback): number
  cancelAnimationFrame(handle: number): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void
  /** 尺寸观察者；环境不提供时退化成只算一次（打开时的加高仍然有效）。 */
  readonly ResizeObserver?: typeof ResizeObserver
}

/** 点击后还没落定的等待状态。 */
interface Pending {
  /** 被点的任务行。 */
  readonly row: Element
  /** 已经等过的帧数。 */
  frames: number
}

/** 一次已经认下来的展开：目标元素与它们唯一的尺寸观察者。 */
interface Open {
  /** 面板 / 行 / `<li>` / 详情容器。 */
  targets: JobDetailTargets
  /** 详情所在 `<li>` 的尺寸观察者；环境没有 `ResizeObserver` 时为 `undefined`。 */
  resize?: ResizeObserver
}

/**
 * 解析计算样式里的像素值。
 * @param value - 计算样式里的长度。
 * @returns 像素数；解析不出数字时按 0 处理（内边距这类可以为 0 的量）。
 */
function pixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 安装「打开命令详情就把它露出来」的行为。
 *
 * 返回卸载函数：撤掉两个监听、停掉等待、还原面板的 `max-height`。函数本身不假设自己只被安装
 * 一次之外的情况——同一页面装两次会得到两个独立的控制器，它们各自维护自己的内联样式（后装的
 * 会覆盖先装的 `max-height`），所以调用方只装一次。
 * @param win - 页面窗口；测试可传替身。
 * @returns 卸载函数。
 */
export function installJobDetailReveal(win: RevealWindow = window): () => void {
  /** 当前认下来的展开；同一时刻至多一个（上游展开状态是单选）。 */
  let open: Open | undefined
  /** 点了行、还在等状态与详情落定的那一次。 */
  let pending: Pending | undefined
  /** 等待循环的帧号；0 表示没有在等。 */
  let frame = 0
  /** 卸载后到达的回调一律不再动作。 */
  let disposed = false

  const stopWait = (): void => {
    if (frame !== 0) win.cancelAnimationFrame(frame)
    frame = 0
  }

  /** 结束当前这一轮：撤观察者，撤自己加过的 `max-height`。 */
  const end = (): void => {
    const entry = open
    if (entry === undefined) return
    open = undefined
    entry.resize?.disconnect()
    entry.targets.panel.style.removeProperty('max-height')
  }

  /**
   * 按需加高面板。先撤掉自己上一次写的 `max-height` 读回上游的原值，再决定要不要写；写回期间
   * 用保存的 `scrollTop` 还原位置——撤掉限高时面板会变矮，浏览器可能顺手夹一次滚动位置。
   * @param targets - 这一轮定位到的元素。
   */
  const applyFit = (targets: JobDetailTargets): void => {
    const { panel, item } = targets
    const before = win.getComputedStyle(panel)
    const paddingTop = pixels(before.paddingTop)
    const paddingBottom = pixels(before.paddingBottom)
    const saved = panel.scrollTop
    panel.style.removeProperty('max-height')
    // 必须重新取一次计算样式：上一次的声明里还带着我们自己写的值。
    const naturalMaxHeight = parseMaxHeight(win.getComputedStyle(panel).maxHeight, Number.POSITIVE_INFINITY)
    const height = fitMaxHeight({
      panelTop: panel.getBoundingClientRect().top,
      itemHeight: item.getBoundingClientRect().height,
      paddingTop,
      paddingBottom,
      naturalMaxHeight,
      viewportHeight: win.innerHeight,
    })
    if (height !== null) panel.style.setProperty('max-height', `${height}px`)
    panel.scrollTop = saved
  }

  /**
   * 把任务行顶到面板内容区顶部。
   * @param targets - 这一轮定位到的元素。
   */
  const scrollToRow = (targets: JobDetailTargets): void => {
    const { panel, row } = targets
    panel.scrollTop = rowScrollTop({
      panelTop: panel.getBoundingClientRect().top,
      panelBorderTop: panel.clientTop,
      paddingTop: pixels(win.getComputedStyle(panel).paddingTop),
      scrollTop: panel.scrollTop,
      rowTop: row.getBoundingClientRect().top,
    })
  }

  /**
   * 重算加高（不滚动）：详情流式变高、窗口尺寸变化时用。元素已经不成立时顺手收尾。
   */
  const refit = (): void => {
    const entry = open
    if (entry === undefined) return
    const { row, panel } = entry.targets
    if (!row.isConnected || !panel.isConnected) { end(); return }
    if (!isRowExpanded(row)) { end(); return }
    if (!entry.targets.item.isConnected || !entry.targets.detail.isConnected) {
      // `<li>` 或详情被上游换了一次（重新挂载）：按新节点继续，而不是把加高丢掉。
      const fresh = jobDetailOf(row, panel)
      if (fresh === null) { end(); return }
      entry.targets = fresh
      entry.resize?.disconnect()
      entry.resize?.observe(fresh.item)
    }
    applyFit(entry.targets)
  }

  /**
   * 认下一次展开：先定位（加高 + 滚动），再挂尺寸观察者。
   * @param targets - 详情已挂载的定位结果。
   */
  const begin = (targets: JobDetailTargets): void => {
    const entry: Open = { targets }
    open = entry
    applyFit(targets)
    scrollToRow(targets)
    const Observer = win.ResizeObserver
    if (typeof Observer === 'function') {
      const observer = new Observer(() => {
        if (open === entry) refit()
      })
      observer.observe(targets.item)
      entry.resize = observer
    }
  }

  /** 等待循环：一帧一步，等 `aria-expanded` 落定与详情挂载。 */
  const tick = (): void => {
    frame = 0
    if (disposed) return
    const waiting = pending
    if (open !== undefined || waiting === undefined) return
    waiting.frames += 1
    const panel = sessionPanelOf(waiting.row)
    if (panel === null || !waiting.row.isConnected) {
      pending = undefined
      return
    }
    const expanded = isRowExpanded(waiting.row)
    if (!expanded && waiting.frames >= SETTLE_FRAMES) {
      // 这一下是把已经展开的详情收起来，没有要露出的东西。
      pending = undefined
      return
    }
    if (expanded) {
      const targets = jobDetailOf(waiting.row, panel)
      if (targets !== null) {
        pending = undefined
        begin(targets)
        return
      }
    }
    if (waiting.frames >= WAIT_FRAMES) {
      pending = undefined
      return
    }
    frame = win.requestAnimationFrame(tick)
  }

  /**
   * 捕获阶段的点击：只认任务行里的展开按钮。点停止按钮、点详情里的复制按钮都不算。
   * @param event - 页面上的点击。
   */
  const onClick = (event: Event): void => {
    const target = event.target as Element | null
    if (target === null || typeof target.closest !== 'function') return
    if (rowToggleOf(target) === null) return
    const row = jobRowOf(target)
    if (row === null) return
    end()
    stopWait()
    pending = { row, frames: 0 }
    frame = win.requestAnimationFrame(tick)
  }

  /** 窗口尺寸变化：上游的 `max-height` 跟着变，这里重算一次加高。 */
  const onResize = (): void => { refit() }

  win.addEventListener('click', onClick, true)
  win.addEventListener('resize', onResize)

  return () => {
    disposed = true
    stopWait()
    pending = undefined
    end()
    win.removeEventListener('click', onClick, true)
    win.removeEventListener('resize', onResize)
  }
}
