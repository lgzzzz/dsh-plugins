/**
 * 收起过程行时的滚动补偿记账。
 *
 * ui-chat 在「回答结束后」这条即时折叠路径上只给行写 `hidden="until-found"`，
 * 布局一次到位，位置交给浏览器的原生滚动锚定。浏览器选中的锚点可能正是本批
 * 被隐藏的行：锚点随折叠一起消失时，原生锚定对这次布局变化不生效，阅读线上方
 * 的高度当场消失，正在看的内容整体上移。
 *
 * 本模块按折叠前后的几何差把这段高度补回来：先把本批元素显回、量一次阅读线锚点，
 * 再按原样隐藏、量第二次，差值写回滚动位置。原生锚定若已经补过，第二次测量读到
 * 的就是补过的位置，差值为 0，不重复写；折叠发生在阅读线下方时锚点不动，差值也
 * 天然为 0。
 *
 * 全部 DOM 读写都收在 `HiddenBatchProbe` 后面，所以这里的记账（参照点、修正量、
 * 失效判定）能在假探针上直接测；DOM 适配与上游锚点见 `scroll-anchor.ts`。
 */

/** 一条可作锚点的行：稳定键 + 相对滚动口顶边的像素偏移。 */
export interface Anchor {
  /** 行的 `data-chat-anchor-key`，重新定位同一条行时用。 */
  readonly key: string
  /** 行顶边相对滚动口顶边的偏移。 */
  readonly top: number
}

/** 补偿一批刚被隐藏的行所需的全部 DOM 能力，由 `FoldAnchorViewport` 实现。 */
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
 * 补偿一批刚被隐藏的行。
 *
 * 两次测量读到的是同一个锚点行在「本批显回」与「本批复原」两个状态下的视觉位置：
 * 上方内容收掉多少，锚点就上移多少，差值取负写回 `scrollTop`。这个顺序同时把
 * 原生锚定的工作让开——浏览器已经补过的部分不会进入差值。
 *
 * @param probe - 读写滚动位置、显隐本批元素并测量锚点。
 * @returns 本次写入的滚动量；没有可用锚点或锚点不可测时返回 null（降级为空操作）。
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
