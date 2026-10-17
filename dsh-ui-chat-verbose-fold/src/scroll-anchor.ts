/**
 * 收起中间过程行时的阅读位置补偿（DOM 适配层）。
 *
 * 入口是 `client.ts` 的 `apply()`；本文件把 ui-chat 的折叠信号翻译成
 * `fold-anchor.ts` 能理解的探针：
 *
 * - 折叠信号：`[data-chat-flow]` 流程列里的行从「无 `hidden`」变成「有 `hidden`」。
 *   「回答结束后」的即时折叠就是这种写法；「下次有新消息时」的动画折叠由
 *   ui-chat 自己的 `foldDriver` 补偿，本文件用 `[data-chat-motion]` 跳过。
 * - 滚动口：`[data-conversation-scroll]` 共享滚动口。一个滚动口一个补偿器；
 *   它同时是 `hidden` 的观察根、锚点行的查找根和 `scrollTop` 的写回目标。
 * - 锚点行：`[data-chat-anchor-key]`。阅读线取滚动口顶边下方 1px，与 ui-chat
 *   `capturePosition()` 的取法一致；本批正在隐藏的行及其祖先/后代整批排除，
 *   并且锚点必须与视口相交——首条幸存行完全落在视口下方时不算锚点。所以锚点落在
 *   折叠段下方第一条仍在、且至少有一部分可见的行上。
 * - 回退落点：没有这样的锚点时，取 `[data-chat-flow-kind="user"]` 中最后一条
 *   可见行，把它的顶边对到阅读线下方。视口被折叠段占满时，读者至少回到本轮
 *   用户输入的起点。
 *
 * 跟底（`[data-chat-following-tail]`）时跳过：此时上游要把视口钉在底部，补阅读
 * 位置反而会把读者拉离底部。没有共享滚动口、没有可见锚点且没有可对齐的用户消息，
 * 或锚点不可测时都降级为空操作；上游契约由 `contract.json` / `check-css.mjs`
 * 显式校验。
 *
 * 上游锚点与验证方式见 docs/dsh-ui-chat-verbose-fold/04-reading-anchor.md。
 */
import { compensateHidden } from './fold-anchor.ts'
import type { Anchor, HiddenBatchProbe } from './fold-anchor.ts'

/** 可作锚点的行（ui-chat 给每条流程行与过程组根都打了这个键）。 */
export const ANCHOR_ATTRIBUTE = 'data-chat-anchor-key'

/** 锚点行的选择器。 */
export const ANCHOR_SELECTOR = `[${ANCHOR_ATTRIBUTE}]`

/** 已折叠/已隐藏的行；`hidden="until-found"` 也算。 */
export const HIDDEN_SELECTOR = '[hidden]'

/** 即时折叠写在这条属性上（取值可能是 `until-found`，复原时按原值写回）。 */
export const HIDDEN_ATTRIBUTE = 'hidden'

/** 承载聊天的外层会话滚动口；一个这样的元素就是一个补偿器。 */
export const CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]'

/** ui-chat 的流程列；只补偿列内的折叠，忽略输入区等无关的 `hidden`。 */
export const CHAT_FLOW_SELECTOR = '[data-chat-flow]'

/** 用户发送的消息行；没有可见锚点时回退到其中最后一条。 */
export const USER_MESSAGE_SELECTOR = '[data-chat-flow-kind="user"]'

/** 视口正处于「跟随底部」状态；此时让上游保持贴底，不补阅读位置。 */
export const FOLLOWING_TAIL_SELECTOR = '[data-chat-following-tail]'

/** ui-chat 的动画折叠作用域；这段高度由上游 foldDriver 自己补偿。 */
export const MOTION_SCOPE_SELECTOR = '[data-chat-motion]'

/** 阅读线取在滚动口顶边下方 1px（与 ui-chat `capturePosition()` 同取法）。 */
export const READING_LINE_OFFSET = 1

/** 重新发现滚动口的最小间隔（毫秒）：流式输出时子节点变动密集，不必每批都扫。 */
export const DISCOVERY_THROTTLE_MS = 500

/** 把元素读成带 `dataset` 的 HTMLElement；不依赖全局 HTMLElement 构造器。 */
function asHtml(element: Element): HTMLElement {
  return element as HTMLElement
}

/** 行的稳定键；没有该属性的行不参与锚定。 */
function anchorKey(row: Element): string | null {
  const key = asHtml(row).dataset.chatAnchorKey
  return key === undefined ? null : key
}

/** 行是否已被隐藏（含 `hidden="until-found"`）。 */
function hidden(row: Element): boolean {
  return row.closest(HIDDEN_SELECTOR) !== null
}

/** 行自身、后代或祖先是否带锚点键；不携带锚点的 `hidden` 与流程折叠无关。 */
function holdsAnchor(element: Element): boolean {
  return element.matches(ANCHOR_SELECTOR)
    || element.querySelector(ANCHOR_SELECTOR) !== null
    || element.closest(ANCHOR_SELECTOR) !== null
}

/**
 * 本次 `hidden` 变化是否应当进入补偿批次。
 *
 * 只认流程列内的锚点相关行；跟底与动画折叠由上游负责。
 */
function foldCandidate(element: Element): boolean {
  if (!element.isConnected) return false
  if (element.closest(FOLLOWING_TAIL_SELECTOR) !== null) return false
  if (element.closest(MOTION_SCOPE_SELECTOR) !== null) return false
  if (element.closest(CHAT_FLOW_SELECTOR) === null) return false
  return holdsAnchor(element)
}

/** 一个滚动口上的补偿器：认即时折叠写下的 `hidden`，在属性变化的微任务里补回阅读位置。 */
export class FoldAnchorViewport {
  /** 承载聊天、真正滚动的元素：观察、测量与写回都落在它身上。 */
  private readonly scroller: Element
  /** 认即时折叠的观察（滚动口子树的 `hidden` 属性）。 */
  private readonly hiddens: MutationObserver
  /** 补偿期间被临时显回来、随后又要隐藏的一整批元素；选锚点时要整批跳过。 */
  private readonly folded = new Set<Element>()

  /** @param scroller - 承载聊天的外层会话滚动口。 */
  constructor(scroller: Element) {
    this.scroller = scroller
    this.hiddens = new MutationObserver(this.onHidden)
  }

  /** 观察滚动口子树的 `hidden` 属性。 */
  observe(): void {
    this.observeHidden()
  }

  /** 断开观察。 */
  dispose(): void {
    this.hiddens.disconnect()
    this.folded.clear()
  }

  /** 补偿期间要临时断开观察，免得把自己写回的值当成新的一批折叠加进来。 */
  private observeHidden(): void {
    this.hiddens.observe(this.scroller, {
      attributes: true,
      attributeFilter: [HIDDEN_ATTRIBUTE],
      attributeOldValue: true,
      subtree: true,
    })
  }

  /**
   * 即时折叠：一批行刚被加上 `hidden`。
   *
   * 只认「从无到有」的 `hidden`（展开不补位置）。批次为空时什么都不做；
   * 否则先断开观察，补偿完再按原根重新观察。
   */
  private onHidden = (records: MutationRecord[]): void => {
    const batch: Element[] = []
    for (const record of records) {
      if (record.oldValue !== null) continue
      const element = record.target as Element
      if (!foldCandidate(element)) continue
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

  /** 即时折叠补偿用的探针：多出「临时显回本批元素」与「强制布局」。 */
  private hiddenProbe(batch: Element[]): HiddenBatchProbe {
    const entries = batch.map((element) => ({
      element,
      value: element.getAttribute(HIDDEN_ATTRIBUTE) ?? '',
    }))
    return {
      readScrollTop: () => this.scroller.scrollTop,
      writeScrollTop: (value) => {
        this.scroller.scrollTop = value
      },
      pick: () => this.pick(),
      measure: (key) => this.measure(key),
      fallbackDelta: () => this.fallbackDelta(),
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
   * 按 DOM 顺序取阅读线上第一条可作锚点、且与视口相交的行。
   *
   * 跳过已隐藏的行、本批正在被即时折叠掉的行，以及完全落在视口下方的行。于是
   * 锚点落在这批折掉的段下方第一条仍在、且至少有一部分可见的行上，折叠收上去的
   * 空间从上方补回。整屏都被本批占满时没有这样的行，改由 `fallbackDelta()` 钉住
   * 最后一条用户消息——否则钉住视口外的一条行，等于把视口往回滚一整段折叠高度。
   */
  private pick(): Anchor | null {
    const scrollerTop = this.scroller.getBoundingClientRect().top
    // clientHeight 不含边框与横向滚动条，正好是滚动口内容可视区的下边界。
    const viewportBottom = scrollerTop + asHtml(this.scroller).clientHeight
    for (const row of this.scroller.querySelectorAll(ANCHOR_SELECTOR)) {
      if (hidden(row) || this.isFolded(row)) continue
      const key = anchorKey(row)
      if (key === null) continue
      const rect = row.getBoundingClientRect()
      if (rect.height === 0) continue
      if (rect.bottom <= scrollerTop + READING_LINE_OFFSET) continue
      if (rect.top >= viewportBottom) continue
      return { key, top: rect.top - scrollerTop }
    }
    return null
  }

  /** 按稳定键重测同一条行；它已被折叠、卸载或清空时返回 null。 */
  private measure(key: string): number | null {
    const scrollerTop = this.scroller.getBoundingClientRect().top
    for (const row of this.scroller.querySelectorAll(ANCHOR_SELECTOR)) {
      if (anchorKey(row) !== key) continue
      if (hidden(row)) return null
      const rect = row.getBoundingClientRect()
      if (rect.height === 0) return null
      return rect.top - scrollerTop
    }
    return null
  }

  /**
   * 没有可见锚点时的回退落点：最后一条用户消息相对阅读线的偏移。
   *
   * 从后往前找 `[data-chat-flow-kind="user"]`，跳过已隐藏和高度为 0 的行，取
   * 最后一条可用行。它可能落在视口上方（视口被本批折叠段占满的常见形状），
   * 也可能在下方；修正量会把它的顶边对到滚动口顶边下方 1px 的阅读线上。
   */
  private fallbackDelta(): number | null {
    const scrollerTop = this.scroller.getBoundingClientRect().top
    const rows = Array.from(this.scroller.querySelectorAll(USER_MESSAGE_SELECTOR))
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (hidden(row)) continue
      const rect = row.getBoundingClientRect()
      if (rect.height === 0) continue
      return rect.top - scrollerTop - READING_LINE_OFFSET
    }
    return null
  }
}

/** 一次运行期：按 DOM 契约发现滚动口，给每个滚动口挂一个补偿器。 */
export interface ScrollAnchorRuntime {
  /** 立刻按 DOM 扫一遍滚动口。 */
  discover(): void
  /** 断开全部观察。 */
  dispose(): void
}

/**
 * 建立运行期。
 *
 * 滚动口随会话挂载/卸载，因此用 `childList` 观察文档子树、限频重扫；已经断开的
 * 滚动口及时回收。初始扫描同步执行，插件比会话视图晚挂载时也能立刻接上。
 *
 * @param doc - 页面文档；测试替身传入假 document。
 * @returns 运行期句柄。
 */
export function createScrollAnchorRuntime(doc: Document): ScrollAnchorRuntime {
  const viewports = new Map<Element, FoldAnchorViewport>()
  let lastDiscovery = 0

  const discover = (): void => {
    for (const scroller of doc.querySelectorAll(CONVERSATION_SCROLL_SELECTOR)) {
      if (viewports.has(scroller)) continue
      const viewport = new FoldAnchorViewport(scroller)
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
  const observationRoot = doc.body ?? doc.documentElement
  if (observationRoot !== null) observer.observe(observationRoot, { childList: true, subtree: true })
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
