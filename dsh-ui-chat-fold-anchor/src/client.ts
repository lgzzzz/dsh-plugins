/**
 * 浏览器半部：折叠把阅读位置顶走时，把它补回原处。
 *
 * ui-chat 有两条折叠路径，本插件各认一条信号，都不改 ui-chat 的状态：
 *
 * - **折叠动画**（`createFlowMotion`）开始时把滚动口的原生滚动锚定关掉
 *   （`scroller.style.overflowAnchor = "none"`，动画结束写回 `""`）；锚定一关，折叠掉的高度
 *   就没人补。这条内联样式是本插件认的**折叠窗口**：窗口打开时记下阅读线上的锚点，
 *   窗口内每次布局变化都把它拉回原处，窗口关闭时补最后一次。
 * - **即时折叠**（不带动画，例如减少动态效果或未开动画时机）直接给行加 `hidden`。
 *   本插件在属性变化里把这一批行临时显回来量一次折叠前的几何，再按原样隐藏量第二次，
 *   两次之差就是要补的量；原生锚定若已自己补过，第二次测量读到的就是补过的位置，差值为 0。
 *
 * 两条路径都只认「阅读线上的行」，所以折叠发生在阅读线下方时修正量天然为 0；
 * 尾随输出时折叠结束的落点由 ui-chat 的跟随策略决定，本插件在收尾那次修正上让位。
 *
 * 上游锚点、已知边界与验证方式见 docs/dsh-ui-chat-fold-anchor.md。
 */
import { compensateHidden, openSession } from './fold-anchor.ts'
import type { Anchor, AnchorProbe, FoldSession, HiddenBatchProbe } from './fold-anchor.ts'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-ui-chat-fold-anchor'

/** 折叠窗口写在滚动口内联样式上的属性与值。 */
export const FOLD_SIGNAL_PROPERTY = 'overflowAnchor'
export const FOLD_SIGNAL_VALUE = 'none'

/** 折叠动画进行中的元素；折叠中的行几何不稳定，不做锚点。 */
export const COLLAPSING_SELECTOR = '[data-chat-motion="collapse"]'

/** 承载行的流程列的属性；占位元素的前一个兄弟节点就是它。 */
export const COLUMN_ATTRIBUTE = 'data-chat-flow'

/** 可作锚点的行（ui-chat 给每条流程行与过程组根都打了这个键）。 */
export const ANCHOR_ATTRIBUTE = 'data-chat-anchor-key'

/** 已折叠/已隐藏的行；`hidden="until-found"` 也算。 */
export const HIDDEN_SELECTOR = '[hidden]'

/** 即时折叠写在这条属性上（取值可能是 `until-found`，复原时按原值写回）。 */
export const HIDDEN_ATTRIBUTE = 'hidden'

/** 聊天列表尾部的占位元素：它的父元素就是承载行的列表。 */
export const SPACER_SELECTOR = '[data-chat-turn-spacer]'

/** 承载行的流程列；它紧挨在占位元素之前。 */
export const COLUMN_SELECTOR = '[data-chat-flow]'

/** 共享滚动模式下承载聊天的外层滚动口。 */
export const CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]'

/** 尾随输出标记：它的存在表示落点由 ui-chat 的跟随策略接管。 */
export const FOLLOWING_TAIL_SELECTOR = '[data-chat-following-tail]'

/** 阅读线取在滚动口顶边下方 1px（与 ui-chat 的 `capturePosition` 同取法）。 */
export const READING_LINE_OFFSET = 1

/** 重新发现滚动口的最小间隔（毫秒）：流式输出时子节点变动密集，不必每批都扫。 */
export const DISCOVERY_THROTTLE_MS = 500

/**
 * 把元素读成带 `dataset` / `style` 的 HTMLElement。
 *
 * 不用 `instanceof HTMLElement` 判定：测试替身里没有这个构造器，而真实 DOM 里
 * `querySelectorAll` 返回的流程行必然是这个类型。
 */
function asHtml(element: Element): HTMLElement {
  return element as HTMLElement
}

/** 行的稳定键；没有该属性的行不参与锚定。 */
function anchorKey(row: Element): string | null {
  const key = asHtml(row).dataset.chatAnchorKey
  return key === undefined ? null : key
}

/** 行是否已被折叠、或正落在折叠动画里（自身折叠，或子树里有元素在折叠）。 */
function unstable(row: Element): boolean {
  return row.closest(COLLAPSING_SELECTOR) !== null || row.querySelector(COLLAPSING_SELECTOR) !== null
}

/** 行是否已被隐藏（含 `hidden="until-found"`）。 */
function hidden(row: Element): boolean {
  return row.closest(HIDDEN_SELECTOR) !== null
}

/** 一个滚动口上的补偿器：认折叠窗口，在布局变化之后、绘制之前把锚点拉回原处。 */
export class FoldAnchorViewport {
  /** 承载行的聊天列表。 */
  private readonly list: Element
  /** 真正滚动的元素：共享滚动模式是外层会话滚动口，否则是列表本身。 */
  private readonly scroller: Element
  /**
   * 承载行的流程列（紧挨在占位元素之前）。
   *
   * 折叠动画改的是列内某个盒子的高度，所以列尺寸一定跟着变；ResizeObserver 的回调在布局
   * 之后、绘制之前，正好是原生滚动锚定补滚动位置的那一步——比下一帧再补少一次可见跳动。
   */
  private readonly column: Element | null
  /** 认折叠窗口的观察。 */
  private readonly styles: MutationObserver
  /** 认即时折叠的观察（列表子树的 `hidden` 属性）。 */
  private readonly hiddens: MutationObserver
  /** 认布局变化的观察。 */
  private readonly sizes: ResizeObserver
  /** 折叠窗口内的会话；窗口外为 null。 */
  private session: FoldSession | null = null
  /**
   * 本个折叠窗口接管过的元素。
   *
   * 它们收尾时也会写 `hidden`，那时位置已经由窗口补过，不能再按折叠前的几何补一次；
   * 集合在每次窗口打开时重建，所以上一个窗口留下的元素不会挡住它日后的一次即时折叠。
   */
  private handled = new WeakSet<Element>()
  /** 即时折叠期间被临时显回来、随后又要隐藏的一整批元素；选锚点时要整批跳过。 */
  private readonly folded = new Set<Element>()

  /**
   * @param spacer - 列表尾部的占位元素，列表与流程列都由它定位。
   * @param scroller - 承载该列表的滚动口（与 ui-chat 的 `viewport.attach` 同取法）。
   */
  constructor(spacer: Element, scroller: Element) {
    this.list = spacer.parentElement ?? scroller
    this.scroller = scroller
    const sibling = spacer.previousElementSibling
    this.column = sibling !== null && sibling.matches(COLUMN_SELECTOR) ? sibling : this.list.querySelector(COLUMN_SELECTOR)
    this.styles = new MutationObserver(this.onStyle)
    this.hiddens = new MutationObserver(this.onHidden)
    this.sizes = new ResizeObserver(this.onSize)
  }

  /** 观察三条信号：滚动口的内联 `style`、列表子树的 `hidden`、流程列的尺寸。 */
  observe(): void {
    this.styles.observe(this.scroller, { attributes: true, attributeFilter: ['style'] })
    this.observeHidden()
    if (this.column !== null) this.sizes.observe(this.column)
  }

  /** 断开观察并结束窗口。 */
  dispose(): void {
    this.styles.disconnect()
    this.hiddens.disconnect()
    this.sizes.disconnect()
    this.session = null
  }

  /** 单独登记 `hidden` 观察：补偿期间要临时断开，免得把自己写回的值当成新的一批折叠加进来。 */
  private observeHidden(): void {
    this.hiddens.observe(this.list, { attributes: true, attributeFilter: [HIDDEN_ATTRIBUTE], attributeOldValue: true, subtree: true })
  }

  /** 滚动口样式变化：内容变动的样式一律忽略，只在折叠窗口的开/关上动手。 */
  private onStyle = (): void => {
    if (asHtml(this.scroller).style[FOLD_SIGNAL_PROPERTY] === FOLD_SIGNAL_VALUE) {
      // 窗口内再次折叠时重开会话没有副作用：已有会话时这里什么都不做。
      if (this.session === null) this.open()
      return
    }
    this.close()
  }

  /**
   * 布局变化（折叠动画的每一帧都算）：把锚点拉回窗口打开时的位置。
   *
   * 锚点被折叠掉或卸载时结束会话——那说明在看的这段内容本身要消失，位置交回 ui-chat 自己的策略。
   */
  private onSize = (): void => {
    if (this.session === null) return
    if (this.session.correct() === null) this.session = null
  }

  /**
   * 即时折叠：一批行刚被加上 `hidden`。
   *
   * 只认「从无到有」的 `hidden`（展开不补位置），并跳过折叠窗口已经接管过的元素——它们
   * 收尾时也会写 `hidden`，那时位置已经由窗口补过，再按折叠前几何补一次会补两遍。
   */
  private onHidden = (records: MutationRecord[]): void => {
    const batch: Element[] = []
    for (const record of records) {
      const element = record.target as Element
      if (record.oldValue !== null || this.handled.has(element)) continue
      if (!batch.includes(element)) batch.push(element)
    }
    if (batch.length === 0) return
    this.hiddens.disconnect()
    try {
      compensateHidden(this.hiddenProbe(batch))
    } finally {
      this.folded.clear()
      this.observeHidden()
    }
  }

  /** 折叠窗口打开：以当前阅读线上最近的一条稳定行为锚点。 */
  private open(): void {
    this.handled = new WeakSet<Element>()
    this.markCollapsing()
    this.session = openSession(this.probe())
  }

  /** 记账当前正在折叠的元素：它们收尾写 `hidden` 时要绕开即时折叠路径。 */
  private markCollapsing(): void {
    for (const element of this.list.querySelectorAll(COLLAPSING_SELECTOR)) this.handled.add(element)
  }

  /** 折叠窗口关闭：窗口内的最后一次布局变化补一次，之后停手。 */
  private close(): void {
    const session = this.session
    if (session === null) return
    this.session = null
    // 尾随输出时由 ui-chat 在折叠结束时平滑回到底部，这里再补一次会把它拽回来。
    if (this.followingTail()) return
    session.correct()
  }

  /** 当前是否尾随输出：标记在聊天根上，可能是滚动口本身、祖先或后代。 */
  private followingTail(): boolean {
    return this.scroller.closest(FOLLOWING_TAIL_SELECTOR) !== null
      || this.scroller.querySelector(FOLLOWING_TAIL_SELECTOR) !== null
  }

  /** 折叠窗口内每次布局变化用的探针。 */
  private probe(): AnchorProbe {
    return {
      readScrollTop: () => this.scroller.scrollTop,
      writeScrollTop: (value) => {
        this.scroller.scrollTop = value
      },
      pick: () => this.pick(),
      measure: (key) => this.measure(key),
    }
  }

  /** 即时折叠补偿用的探针：多出「临时显回本批元素」与「强制布局」。 */
  private hiddenProbe(batch: Element[]): HiddenBatchProbe {
    const entries = batch.map((element) => ({
      element,
      value: element.getAttribute(HIDDEN_ATTRIBUTE) ?? '',
    }))
    return {
      ...this.probe(),
      reveal: () => {
        // 整批记账：这批元素马上又要隐藏，选锚点时必须整批排除，否则会锚到一条
        // 自己马上要隐藏的行上——重新测量时它已 `hidden`，measure 返回 null，整次补偿被放弃。
        this.folded.clear()
        for (const { element } of entries) {
          element.removeAttribute(HIDDEN_ATTRIBUTE)
          this.folded.add(element)
        }
        return () => {
          for (const { element, value } of entries) element.setAttribute(HIDDEN_ATTRIBUTE, value)
        }
      },
      settle: () => {
        // 读一次几何就强制了一次布局：折叠前后的两次测量各自读到当时的 DOM。
        void this.scroller.getBoundingClientRect()
      },
    }
  }

  /**
   * 本行是否属于「马上又要隐藏」的那一批（自身是批元素，或子树里含有批元素——过程组根就是这样）。
   *
   * 两个方向都要查：过程组根自己是可作锚点的行，而批元素是它的后代。
   */
  private isFolded(row: Element): boolean {
    if (this.folded.size === 0) return false
    if (this.folded.has(row)) return true
    for (const element of this.folded) {
      if (row.contains(element) || element.contains(row)) return true
    }
    return false
  }

  /**
   * 取阅读线上最近一条可作锚点的行。
   *
   * 跳过已隐藏的行、正落在折叠动画里的行（自身折叠或子树里有折叠元素——过程组根就是这样，
   * 它的折叠体在收，根自己的顶边不动，拿它当锚点救不了阅读位置），以及**本批正在被即时
   * 折叠掉的行**（补偿期间它们被临时显回来，看起来可用，但马上又要隐藏；拿它们当锚点会在
   * 重新测量时失效，整次补偿被放弃）。
   *
   * 于是锚点落在这批折掉的段**下方**第一条仍在的行上，折叠收上去的空间从上方补回。
   */
  private pick(): Anchor | null {
    const scrollerTop = this.scroller.getBoundingClientRect().top
    for (const row of this.list.querySelectorAll(`[${ANCHOR_ATTRIBUTE}]`)) {
      if (hidden(row) || unstable(row) || this.isFolded(row)) continue
      const key = anchorKey(row)
      const rect = row.getBoundingClientRect()
      if (key === null || rect.height === 0) continue
      if (rect.bottom > scrollerTop + READING_LINE_OFFSET) return { key, top: rect.top - scrollerTop }
    }
    return null
  }

  /** 按稳定键重测同一条行；它已被折叠、卸载或清空时返回 null。 */
  private measure(key: string): number | null {
    for (const row of this.list.querySelectorAll(`[${ANCHOR_ATTRIBUTE}]`)) {
      if (anchorKey(row) !== key) continue
      if (hidden(row) || unstable(row)) return null
      const rect = row.getBoundingClientRect()
      if (rect.height === 0) return null
      return rect.top - this.scroller.getBoundingClientRect().top
    }
    return null
  }
}

/** 一次运行期：按 DOM 契约发现聊天滚动口，给每个滚动口挂一个补偿器。 */
export interface FoldAnchorRuntime {
  /** 立刻按 DOM 扫一遍滚动口。 */
  discover(): void
  /** 断开全部观察。 */
  dispose(): void
}

/**
 * 建立运行期。
 *
 * 滚动口用聊天列表的占位元素（`[data-chat-turn-spacer]`）反查，所以不依赖任何 ui-chat
 * 的 JS 形状；列表随会话挂载/卸载，因此用 `childList` 观察限频重扫，并及时回收已断开的滚动口。
 *
 * @param doc - 页面文档；测试替身传入假 document。
 * @returns 运行期句柄。
 */
export function createRuntime(doc: Document): FoldAnchorRuntime {
  const viewports = new Map<Element, FoldAnchorViewport>()
  let lastDiscovery = 0

  const discover = (): void => {
    for (const spacer of doc.querySelectorAll(SPACER_SELECTOR)) {
      const scroller = spacer.closest(CONVERSATION_SCROLL_SELECTOR) ?? spacer.parentElement
      if (scroller === null || viewports.has(scroller)) continue
      const viewport = new FoldAnchorViewport(spacer, scroller)
      viewport.observe()
      viewports.set(scroller, viewport)
    }
    for (const [scroller, viewport] of [...viewports]) {
      if (scroller.isConnected) continue
      viewport.dispose()
      viewports.delete(scroller)
    }
  }

  const observer = new MutationObserver(() => {
    const now = Date.now()
    if (now - lastDiscovery < DISCOVERY_THROTTLE_MS) return
    lastDiscovery = now
    discover()
  })
  if (doc.body !== null) observer.observe(doc.body, { childList: true, subtree: true })
  discover()

  return {
    discover,
    dispose(): void {
      observer.disconnect()
      for (const viewport of viewports.values()) viewport.dispose()
      viewports.clear()
    },
  }
}

/**
 * 在客户端上下文里装上补偿器。
 *
 * 没有 DOM 的环境（构建产物在 Node 里被装配）直接返回：本插件是纯浏览器补丁，
 * 不碰任何 cordis 服务，也不注册槽位。
 *
 * @param ctx - 客户端插件上下文；存在 `effect` 时用它挂清理。
 */
export function apply(ctx: Context): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  if (typeof ResizeObserver !== 'function') return
  const runtime = createRuntime(document)
  if (typeof ctx.effect === 'function') ctx.effect(() => () => runtime.dispose(), 'ui-chat 折叠滚动补偿')
}
