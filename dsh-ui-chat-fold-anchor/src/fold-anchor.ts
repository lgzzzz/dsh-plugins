/**
 * 折叠滚动补偿的纯逻辑。
 *
 * ui-chat 在折叠动画开始时把滚动口的原生滚动锚定关掉（内联 `overflow-anchor: none`），
 * 动画结束后再交还。原生锚定一关，被折叠掉的那段高度就没人补：阅读位置整体上移被折叠的
 * 高度，折叠量大时直接移出视口。本模块在「锚定被关掉的那段时间」里替它补——把窗口打开
 * 那一刻阅读线上的行当锚点，之后每次布局变化都把它拉回原来的位置。
 *
 * 修正量只看锚点自己的视觉偏移，不看内容总高：折叠发生在阅读线**下方**时锚点不动，
 * 修正量天然为 0，不会去干扰 ui-chat 想做的「下面那段收上去」。
 *
 * 全部 DOM 读写都收在 `AnchorProbe` 后面，所以这里的记账（参照点、修正量、失效判定）
 * 能在假探针上直接测；上游锚点、边界与验证方式见 docs/dsh-ui-chat-fold-anchor.md。
 */

/** 一条可作锚点的行：稳定键 + 相对滚动口顶边的像素偏移。 */
export interface Anchor {
  /** 行的 `data-chat-anchor-key`，重新定位同一条行时用。 */
  readonly key: string
  /** 行顶边相对滚动口顶边的偏移。 */
  readonly top: number
}

/** 补偿会话需要的最小 DOM 能力，由客户端半部按真实滚动口实现。 */
export interface AnchorProbe {
  /** 当前滚动位置。 */
  readScrollTop(): number
  /** 写入滚动位置；超出滚动范围时由浏览器夹取。 */
  writeScrollTop(value: number): void
  /** 取阅读线上最近一条可作锚点的行；没有可用行时返回 null。 */
  pick(): Anchor | null
  /** 按稳定键重测同一条行；它已被折叠、卸载或清空时返回 null。 */
  measure(key: string): number | null
}

/** 小于这个偏移视为亚像素抖动，不写滚动位置。 */
export const MIN_DELTA = 0.5

/** 一次折叠窗口的补偿会话。 */
export interface FoldSession {
  /** 参照行在 `data-chat-anchor-key` 上的键。 */
  readonly key: string
  /**
   * 把锚点拉回窗口打开时的位置。
   *
   * @returns 本次写入的滚动量（像素，已含 `MIN_DELTA` 内的 0）；锚点已不可测时返回 null，
   * 调用方应就此结束会话，把位置交回 ui-chat 自己的策略。
   */
  correct(): number | null
}

/**
 * 打开一次补偿会话。
 *
 * @param probe - 读写滚动位置并测量锚点。
 * @returns 折叠窗口内的会话；阅读线上没有可用行时返回 null（降级为空操作）。
 */
export function openSession(probe: AnchorProbe): FoldSession | null {
  const anchor = probe.pick()
  if (anchor === null) return null
  return {
    key: anchor.key,
    correct(): number | null {
      const top = probe.measure(anchor.key)
      if (top === null) return null
      const delta = top - anchor.top
      if (Math.abs(delta) < MIN_DELTA) return 0
      probe.writeScrollTop(probe.readScrollTop() + delta)
      return delta
    },
  }
}

/** 即时折叠（一次布局变化就完成）用的探针：多出「把本批刚隐藏的元素显回来」与「强制布局」。 */
export interface HiddenBatchProbe extends AnchorProbe {
  /**
   * 把本批刚被隐藏的元素改回隐藏前的样子。
   *
   * @returns 复原函数：把 `hidden` 按原值写回去。
   */
  reveal(): () => void
  /** 强制一次布局，让紧接着的测量读到当前 DOM 的几何。 */
  settle(): void
}

/**
 * 补偿一批刚被隐藏的行（ui-chat 不带折叠动画时的折叠路径）。
 *
 * 浏览器原生滚动锚定只在它自己绘制流程里补位置，而它是否可用由浏览器决定、是否开启由上游
 * 决定；本函数不猜这些，而是直接把折叠前的几何量出来：先把本批元素显回来、量一次阅读线锚点，
 * 再按原样隐藏、量第二次。两次之差就是要补的滚动量——原生锚定若已经自己补过，第二次测量
 * 读到的就已经是补过的位置，差值自然为 0，不会重复补。
 *
 * @param probe - 读写滚动位置、显隐本批元素并测量锚点。
 * @returns 本次写入的滚动量；阅读线上没有可用行、锚点不可测时返回 null（降级为空操作）。
 */
export function compensateHidden(probe: HiddenBatchProbe): number | null {
  const restore = probe.reveal()
  probe.settle()
  const anchor = probe.pick()
  const before = anchor?.top ?? null
  restore()
  probe.settle()
  if (anchor === null || before === null) return null
  const after = probe.measure(anchor.key)
  if (after === null) return null
  const delta = after - before
  if (Math.abs(delta) < MIN_DELTA) return 0
  probe.writeScrollTop(probe.readScrollTop() + delta)
  return delta
}
