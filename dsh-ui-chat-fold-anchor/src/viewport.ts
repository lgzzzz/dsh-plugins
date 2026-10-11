/**
 * 浏览器半部的 DOM 适配层：把一次折叠掉的高度从滚动口的阅读位置补回来。
 *
 * 入口 `apply()` 在 `client.ts`，本文件是它的全部实现与上游契约取值。
 *
 * ui-chat 收起过程组时（`useFlowHidden` 的 `commit()`）只给行加上 `hidden`（取值
 * `until-found`），布局一次到位，位置交给浏览器的原生滚动锚定；浏览器不支持
 * `overflow-anchor`（Safari）或该能力被关掉时，折叠掉的高度就没人补。本插件在 `hidden`
 * 属性变化的微任务里把这一批行临时显回来量一次折叠前的几何，再按原样隐藏量第二次，
 * 两次之差就是要补的量；原生锚定若已自己补过，第二次测量读到的就是补过的位置，差值为 0。
 *
 * 只认「阅读线上的行」，所以折叠发生在阅读线下方时修正量天然为 0。
 *
 * 修正量的记账在 `fold-anchor.ts`（纯逻辑，不碰 DOM）；上游锚点、已知边界与验证方式见
 * docs/dsh-ui-chat-fold-anchor.md。
 */
import { compensateHidden } from './fold-anchor.ts'
import type { Anchor, HiddenBatchProbe } from './fold-anchor.ts'

/** 可作锚点的行（ui-chat 给每条流程行与过程组根都打了这个键）。 */
export const ANCHOR_ATTRIBUTE = 'data-chat-anchor-key'

/** 已折叠/已隐藏的行；`hidden="until-found"` 也算。 */
export const HIDDEN_SELECTOR = '[hidden]'

/** 即时折叠写在这条属性上（取值可能是 `until-found`，复原时按原值写回）。 */
export const HIDDEN_ATTRIBUTE = 'hidden'

/**
 * 承载聊天的外层会话滚动口：一个这样的元素就是一个补偿器。
 *
 * 它同时是折叠信号的观察根与锚点行的查找根，所以插件不必先找聊天列表、再往上反查滚动口。
 */
export const CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]'

/** 阅读线取在滚动口顶边下方 1px（与 ui-chat 的 `capturePosition` 同取法）。 */
export const READING_LINE_OFFSET = 1

/** 重新发现滚动口的最小间隔（毫秒）：流式输出时子节点变动密集，不必每批都扫。 */
export const DISCOVERY_THROTTLE_MS = 500

/**
 * 把元素读成带 `dataset` 的 HTMLElement。
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

/** 行是否已被隐藏（含 `hidden="until-found"`）。 */
function hidden(row: Element): boolean {
  return row.closest(HIDDEN_SELECTOR) !== null
}

/** 一个滚动口上的补偿器：认即时折叠写下的 `hidden`，在属性变化的微任务里补回阅读位置。 */
export class FoldAnchorViewport {
  /** 承载聊天、真正滚动的元素：观察、测量与写回都落在它身上。 */
  private readonly scroller: Element
  /** 认即时折叠的观察（滚动口子树的 `hidden` 属性）。 */
  private readonly hiddens: MutationObserver
  /** 即时折叠期间被临时显回来、随后又要隐藏的一整批元素；选锚点时要整批跳过。 */
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
  }

  /** 补偿期间要临时断开观察，免得把自己写回的值当成新的一批折叠加进来。 */
  private observeHidden(): void {
    this.hiddens.observe(this.scroller, { attributes: true, attributeFilter: [HIDDEN_ATTRIBUTE], attributeOldValue: true, subtree: true })
  }

  /**
   * 即时折叠：一批行刚被加上 `hidden`。
   *
   * 只认「从无到有」的 `hidden`（展开不补位置）。
   */
  private onHidden = (records: MutationRecord[]): void => {
    const batch: Element[] = []
    for (const record of records) {
      const element = record.target as Element
      if (record.oldValue !== null) continue
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
   * 跳过已隐藏的行，以及**本批正在被即时折叠掉的行**（补偿期间它们被临时显回来，看起来可用，
   * 但马上又要隐藏；拿它们当锚点会在重新测量时失效，整次补偿被放弃）。
   *
   * 于是锚点落在这批折掉的段**下方**第一条仍在的行上，折叠收上去的空间从上方补回。
   */
  private pick(): Anchor | null {
    const scrollerTop = this.scroller.getBoundingClientRect().top
    for (const row of this.scroller.querySelectorAll(`[${ANCHOR_ATTRIBUTE}]`)) {
      if (hidden(row) || this.isFolded(row)) continue
      const key = anchorKey(row)
      const rect = row.getBoundingClientRect()
      if (key === null || rect.height === 0) continue
      if (rect.bottom > scrollerTop + READING_LINE_OFFSET) return { key, top: rect.top - scrollerTop }
    }
    return null
  }

  /** 按稳定键重测同一条行；它已被折叠、卸载或清空时返回 null。 */
  private measure(key: string): number | null {
    for (const row of this.scroller.querySelectorAll(`[${ANCHOR_ATTRIBUTE}]`)) {
      if (anchorKey(row) !== key) continue
      if (hidden(row)) return null
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
 * 只支持共享滚动模式：一个 `[data-conversation-scroll]` 会话滚动口就是一个补偿器——它既是
 * 折叠信号的观察根，也是选锚点、读写 `scrollTop` 的滚动口。所以发现就是直接枚举这类元素，
 * 不必先找到聊天列表或尾部占位元素再往上反查，也就不依赖 ui-chat 的任何 JS 形状。
 *
 * 滚动口随会话挂载/卸载，因此用 `childList` 观察限频重扫，并及时回收已断开的滚动口。
 *
 * @param doc - 页面文档；测试替身传入假 document。
 * @returns 运行期句柄。
 */
export function createRuntime(doc: Document): FoldAnchorRuntime {
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
