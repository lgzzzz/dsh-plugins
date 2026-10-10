/**
 * 折叠滚动补偿的纯逻辑。
 *
 * ui-chat 收起过程组时只给行加上 `hidden`（取值 `until-found`），不给任何滚动位置补偿：
 * 位置交给浏览器的原生滚动锚定。浏览器不支持 `overflow-anchor`（Safari）或该能力被关掉时，
 * 被折叠掉的高度就没人补——阅读位置整体上移，折叠量大时直接移出视口。本模块按折叠前后的
 * 几何差把它补回来：先把本批元素显回、量一次阅读线锚点，再按原样隐藏、量第二次，差值写回滚动位置。
 *
 * 修正量只看锚点自己的视觉偏移，不看内容总高：折叠发生在阅读线**下方**时锚点不动，
 * 修正量天然为 0，不会去干扰 ui-chat 想做的「下面那段收上去」。
 *
 * 全部 DOM 读写都收在 `HiddenBatchProbe` 后面，所以这里的记账（参照点、修正量、失效判定）
 * 能在假探针上直接测；上游锚点、边界与验证方式见 docs/dsh-ui-chat-fold-anchor.md。
 */

/** 一条可作锚点的行：稳定键 + 相对滚动口顶边的像素偏移。 */
export interface Anchor {
  /** 行的 `data-chat-anchor-key`，重新定位同一条行时用。 */
  readonly key: string
  /** 行顶边相对滚动口顶边的偏移。 */
  readonly top: number
}

/** 补偿一批刚被隐藏的行所需的全部 DOM 能力，由客户端半部按真实滚动口实现。 */
export interface HiddenBatchProbe {
  /** 当前滚动位置。 */
  readScrollTop(): number
  /** 写入滚动位置；超出滚动范围时由浏览器夹取。 */
  writeScrollTop(value: number): void
  /** 取阅读线上最近一条可作锚点的行；没有可用行时返回 null。 */
  pick(): Anchor | null
  /** 按稳定键重测同一条行；它已被折叠、卸载或清空时返回 null。 */
  measure(key: string): number | null
  /**
   * 把本批刚被隐藏的元素改回隐藏前的样子。
   *
   * @returns 复原函数：把 `hidden` 按原值写回去。
   */
  reveal(): () => void
  /** 强制一次布局，让紧接着的测量读到当前 DOM 的几何。 */
  settle(): void
}

/** 小于这个偏移视为亚像素抖动，不写滚动位置。 */
export const MIN_DELTA = 0.5

/**
 * 补偿一批刚被隐藏的行（ui-chat 的折叠路径）。
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
