/**
 * 滚动与加高的纯计算：只吃数字，不碰 DOM，便于逐条测。
 *
 * 两个决定分别答两个问题：
 *
 * - {@link rowScrollTop}：把任务行顶到面板内容区顶部时，面板的 `scrollTop` 应该是多少；
 * - {@link fitMaxHeight}：详情在本面板里装不下时，`max-height` 要提到多少；装得下就不动上游。
 *
 * 几个口径：
 *
 * - 「详情要占的空间」用 `<li>`（行 + 详情）的高度，行顶到内容区起点后，下面正好是它；
 * - 面板自己的内边距要算进去：行在内容区起点，详情在它下面，面板底边还要留出下内边距；
 * - 加高只到「详情装得下」为止，并且不超过视口：面板顶边距视口顶部有 12px，底部同样留
 *   {@link BOTTOM_INSET}，超出这部分的加高没有意义（详情仍然看不全，反而把输入区整个盖住）。
 */

/** 面板底边与视口底边之间保留的间距（px）：与面板自己距视口顶部的 12px 对称。 */
export const BOTTOM_INSET = 12

/** 比较浮点高度时的容差：小于半像素的差别不值得改写 `max-height`。 */
const EPSILON = 0.5

/** {@link fitMaxHeight} 的输入。 */
export interface FitInput {
  /** 面板顶边距视口顶部的距离（px）。 */
  readonly panelTop: number
  /** 详情要占的垂直空间：`<li>` 的高度，含行、详情与两者之间的外边距。 */
  readonly itemHeight: number
  /** 面板的上内边距（px）。 */
  readonly paddingTop: number
  /** 面板的下内边距（px）。 */
  readonly paddingBottom: number
  /** 上游给面板算出的 `max-height`（px）；上游是 `none` 时传 `Number.POSITIVE_INFINITY`。 */
  readonly naturalMaxHeight: number
  /** 视口高度（px）。 */
  readonly viewportHeight: number
}

/** {@link rowScrollTop} 的输入。 */
export interface ScrollInput {
  /** 面板顶边距视口顶部的距离（px）。 */
  readonly panelTop: number
  /** 面板的上边框宽度（px）。 */
  readonly panelBorderTop: number
  /** 面板的上内边距（px）。 */
  readonly paddingTop: number
  /** 面板当前的 `scrollTop`（px）。 */
  readonly scrollTop: number
  /** 任务行顶边距视口顶部的距离（px）。 */
  readonly rowTop: number
}

/**
 * 把任务行顶到面板内容区顶部需要的 `scrollTop`。
 *
 * 先把行的位置换算到面板的滚动内容里（视口坐标 → 内容坐标），再减掉上内边距，让行落在内容区
 * 起点而不是压在面板顶边的圆角上。滚不到（内容不够长）时取 0，浏览器自己会再按
 * `scrollHeight - clientHeight` 夹一次。
 * @param input - 面板与任务行的实测几何。
 * @returns 目标 `scrollTop`（px）。
 */
export function rowScrollTop(input: ScrollInput): number {
  const rowOffset = input.rowTop - input.panelTop + input.scrollTop - input.panelBorderTop
  return Math.max(0, rowOffset - input.paddingTop)
}

/**
 * 详情装不下时要给的 `max-height`。
 *
 * 「装不下」= 行顶到内容区起点后，行 + 详情 + 上下内边距比上游给的 `max-height` 还高；此时把
 * 面板加高到刚好装下（视口放不下就加高到视口允许的最大值）。装得下、或视口本身比上游的
 * `max-height` 还挤时返回 `null`，表示不动上游（加高只会更糟）。
 * @param input - 面板与详情的实测几何。
 * @returns 新的 `max-height`（px）；`null` 表示保持上游。
 */
export function fitMaxHeight(input: FitInput): number | null {
  const needed = input.itemHeight + input.paddingTop + input.paddingBottom
  const room = Math.max(0, input.viewportHeight - input.panelTop - BOTTOM_INSET)
  const cap = Math.min(needed, room)
  if (needed <= input.naturalMaxHeight + EPSILON) return null
  if (cap <= input.naturalMaxHeight + EPSILON) return null
  return cap
}

/**
 * 解析 `getComputedStyle(panel).maxHeight`。
 *
 * 上游是 `calc(var(--dsh-conversation-viewport-height) - var(--dsh-composer-height) - 24px)`，
 * 计算后的值在浏览器里已经解析成 px；`none`（没有上限）交给调用方用 `Infinity` 兜底。
 * @param value - 计算样式里的 `maxHeight`。
 * @param fallback - 解析不出数字时用的值。
 * @returns 像素高度。
 */
export function parseMaxHeight(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
