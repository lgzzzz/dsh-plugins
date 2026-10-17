/**
 * 收起过程行时的滚动补偿记账。
 *
 * ui-chat 在「回答结束后」这条即时折叠路径上只给行写 `hidden="until-found"`，
 * 布局一次到位，位置交给浏览器的原生滚动锚定。浏览器选中的锚点可能正是本批
 * 被隐藏的行：锚点随折叠一起消失时，原生锚定对这次布局变化不生效，阅读线上方
 * 的高度当场消失，正在看的内容整体上移。
 *
 * 本模块按折叠前后的几何差把这段高度补回来：有可见锚点时，先把本批元素显回、量一次，
 * 再按原样隐藏、量第二次，差值写回滚动位置；没有可见锚点时，改为复原本批元素后把
 * 最后一条用户消息对齐到阅读线下方，给读者一个确定的落点。原生锚定若已经补过，
 * 第二次测量读到的就是补过的位置，差值为 0，不重复写；折叠发生在阅读线下方时锚点
 * 不动，差值也天然为 0。
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
  /** 按 DOM 顺序取阅读线上第一条可作锚点、且与视口相交的行；没有可用行时返回 null。 */
  pick(): Anchor | null
  /** 按稳定键重测同一条行；它已被折叠、卸载或清空时返回 null。 */
  measure(key: string): number | null
  /**
   * 没有可见锚点时，把最后一条用户消息对齐到阅读线下方的修正量。
   *
   * 只在 `pick()` 返回 null 后调用，且读取的是本批复原后的几何。
   *
   * @returns 需要加到当前 `scrollTop` 上的像素量；没有可对齐的用户消息时返回 null。
   */
  fallbackDelta(): number | null
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
 * 没有与视口相交的锚点时，不钉视口外的行，改为在复原本批元素后把最后一条用户
 * 消息对齐到阅读线下方：视口被折叠段占满时，至少回到本轮用户输入的起点，而不是
 * 留在折叠段中间的任意位置。找不到可用锚点、也找不到可对齐的用户消息时返回 null，
 * 本次不写滚动位置。
 *
 * @param probe - 读写滚动位置、显隐本批元素、测量锚点并给出回退修正量。
 * @returns 本次写入的滚动量；没有任何可用落点或锚点不可测时返回 null（空操作）。
 */
export function compensateHidden(probe: HiddenBatchProbe): number | null {
  const restore = probe.reveal()
  probe.settle()
  const anchor = probe.pick()
  if (anchor === null) {
    restore()
    probe.settle()
    const fallback = probe.fallbackDelta()
    return fallback === null ? null : applyDelta(probe, fallback)
  }
  const before = anchor.top
  restore()
  probe.settle()
  const after = probe.measure(anchor.key)
  if (after === null) return null
  return applyDelta(probe, after - before)
}

/**
 * 把一次测量得到的修正量写回滚动位置。
 *
 * @param probe - 提供当前滚动位置与写入口。
 * @param delta - 需要加到 `scrollTop` 上的像素量。
 * @returns 实际采用的修正量；亚像素抖动返回 0 且不写。
 */
function applyDelta(probe: HiddenBatchProbe, delta: number): number {
  if (Math.abs(delta) < MIN_DELTA) return 0
  probe.writeScrollTop(probe.readScrollTop() + delta)
  return delta
}
