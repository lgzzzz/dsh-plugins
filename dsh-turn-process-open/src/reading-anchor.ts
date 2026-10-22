/**
 * 折叠工作步骤后的阅读位置补偿。
 *
 * 阅读线取会话显示区（`[data-conversation-scroll]`）的上边界下 1px。折叠前先记下阅读线以下
 * 每一行（聊天流节点、过程组、单步详情行）的位置；折叠后这些行里第一个仍然可见的就是锚点
 * ——也就是从阅读线向前遇到的第一个不会被折叠掉的行。
 *
 * - 锚点折叠前在视口内：把滚动位置补到它折叠前的屏幕位置，阅读位置不动；
 * - 锚点折叠前在视口外（原本还在视口下方）：把它本身放到阅读线下 3px。整屏都被折叠内容
 *   占满时，读者从折叠段结束的地方继续，而不是把视图拉回折叠段内部。
 *
 * 只读 DOM 几何，不写上游状态，也不改消息数据。两种情况不做补偿：一是上游正在跑折叠动画
 * （`[data-chat-motion="collapse"|"reveal"]`），由它自己的帧补偿接管；二是会话处于跟随尾部
 * （`[data-chat-following-tail]`），此时应当留在底部。
 */

/** 聊天流里的一行：节点行与过程组行。 */
const CHAT_FLOW_ROW_SELECTOR = '[data-chat-flow-key]'

/** 阅读行：聊天流节点之外，还认单步详情自己的一行。 */
const READING_ROW_SELECTOR = `${CHAT_FLOW_ROW_SELECTOR}, [data-disclosure-row], [data-expandable]`

/**
 * 单步详情必须落在这几类容器里：过程组，或过程组之外的 `tool-call` / `assistant-step` /
 * `turn-process` 流节点（“完全展开”模式没有过程组）。只认 `data-expandable` 会把
 * 系统提示词、上下文注入和提问卡片也误收进来。
 */
export const STEP_DETAIL_SCOPE = [
  '[data-step-process]',
  '[data-chat-flow-kind="tool-call"]',
  '[data-chat-flow-kind="assistant-step"]',
  '[data-chat-flow-kind="turn-process"]',
].join(', ')

/** 阅读线以下的一行及其折叠前的位置（`top` 为视口坐标，单位 px）。 */
export interface ReadingRow {
  readonly element: Element
  readonly top: number
}

/** 折叠前采集的阅读位置；折叠后用同一份数据补偿。 */
export interface ReadingPlan {
  readonly scroller: Element
  /** 阅读线的视口坐标（滚动口上边界 + 1px）。 */
  readonly line: number
  /** 可见消息带的下边界（composer 顶；没有 composer 时是滚动口底）。 */
  readonly bottom: number
  /** 阅读线以下、折叠前可见的行，按文档顺序。 */
  readonly rows: readonly ReadingRow[]
}

/** 锚点原本在视口外时，其顶部与阅读线的间距（px）。 */
const FORWARD_GAP = 3

/** 补偿结果，便于测试与诊断。 */
export type ReadingAdjustment = 'anchor' | 'forward' | 'none'

/** 一份只读的 DOM 盒子。 */
interface Box {
  readonly top: number
  readonly bottom: number
  readonly height: number
}

/** 读一个元素的盒子；假 DOM / 已卸载元素读不到几何时返回 null。 */
function readBox(element: Element): Box | null {
  if (typeof element.getBoundingClientRect !== 'function') return null
  let rect: DOMRect
  try {
    rect = element.getBoundingClientRect()
  } catch {
    return null
  }
  if (rect === null || typeof rect !== 'object') return null
  const top = rect.top
  const height = rect.height
  if (!Number.isFinite(top) || !Number.isFinite(height)) return null
  const bottom = Number.isFinite(rect.bottom) ? rect.bottom : top + height
  return { top, bottom, height }
}

/** 这一行此刻是否真的占着可见空间（没被折叠隐藏、也没被虚拟化）。 */
function shown(element: Element): boolean {
  if (element.closest('[hidden]') !== null) return false
  const box = readBox(element)
  return box !== null && box.height > 0.5
}

/** 聊天流节点与单步详情行；过程组外偶然出现的可展开控件不算。 */
function isReadingRow(element: Element): boolean {
  return element.hasAttribute('data-chat-flow-key') || element.closest(STEP_DETAIL_SCOPE) !== null
}

/** 上游是否正在用帧补偿跑折叠动画。 */
function hasFoldMotion(scroller: Element): boolean {
  return scroller.querySelector('[data-chat-motion="collapse"], [data-chat-motion="reveal"]') !== null
}

/** 会话是否在跟随尾部；跟随尾部时折叠应留在底部。 */
function followsTail(scroller: Element): boolean {
  return scroller.querySelector('[data-chat-following-tail]') !== null
}

/** 写滚动位置，按滚动范围夹紧；变化不足半像素时不动。 */
function adjustScroll(scroller: Element, delta: number): void {
  if (!Number.isFinite(delta)) return
  const current = scroller.scrollTop
  if (!Number.isFinite(current)) return
  const target = current + delta
  const max = scroller.scrollHeight - scroller.clientHeight
  const next = Number.isFinite(max) ? Math.min(Math.max(target, 0), Math.max(max, 0)) : Math.max(target, 0)
  if (Math.abs(next - current) < 0.5) return
  scroller.scrollTop = next
}

/**
 * 在点击折叠目标之前采集阅读位置。
 *
 * 行按文档顺序保存；折叠后 `applyReadingAnchor` 取其中第一个仍然可见的行。
 * 几何读不到（假 DOM、已卸载的滚动口）时返回 null，调用方照常折叠、不做补偿。
 *
 * @param scroller - 主会话滚动口。
 * @returns 折叠前的阅读位置，或 null。
 */
export function planReadingAnchor(scroller: Element): ReadingPlan | null {
  const viewport = readBox(scroller)
  if (viewport === null) return null
  const borderTop = Number.isFinite(scroller.clientTop) ? scroller.clientTop : 0
  const line = viewport.top + borderTop + 1
  const height = Number.isFinite(scroller.clientHeight) ? scroller.clientHeight : viewport.height
  let bottom = viewport.top + height
  const seat = scroller.querySelector('[data-composer-seat]')
  if (seat !== null) {
    const seatBox = readBox(seat)
    if (seatBox !== null) bottom = Math.min(bottom, seatBox.top)
  }
  if (!(bottom > line)) bottom = Math.max(line, viewport.bottom)
  const rows: ReadingRow[] = []
  for (const element of scroller.querySelectorAll(READING_ROW_SELECTOR)) {
    if (!isReadingRow(element) || !shown(element)) continue
    const box = readBox(element)
    if (box === null || box.top <= line) continue
    rows.push({ element, top: box.top })
  }
  return { scroller, line, bottom, rows }
}

/**
 * 折叠之后保持阅读位置。
 *
 * - 第一个仍可见的锚点折叠前在视口内：把它的屏幕位置补回折叠前；
 * - 锚点折叠前在视口外：把它本身放到阅读线下 3px；
 * - 没有锚点、点击没有改变布局、上游动画在跑或会话跟随尾部：不动。
 *
 * @param plan - `planReadingAnchor` 在点击前采集的数据。
 * @returns 实际走了哪条分支。
 */
export function applyReadingAnchor(plan: ReadingPlan): ReadingAdjustment {
  const scroller = plan.scroller
  if (hasFoldMotion(scroller) || followsTail(scroller)) return 'none'
  let anchor: ReadingRow | null = null
  for (const row of plan.rows) {
    if (!shown(row.element)) continue
    anchor = row
    break
  }
  if (anchor === null) return 'none'
  const anchorBox = readBox(anchor.element)
  if (anchorBox === null) return 'none'
  if (anchor.top < plan.bottom) {
    adjustScroll(scroller, anchorBox.top - anchor.top)
    return 'anchor'
  }
  // 目标点击没有改变布局时，锚点仍在原位；不要因为它原本在视口外就把它拉上来。
  if (Math.abs(anchorBox.top - anchor.top) < 0.5) return 'none'
  adjustScroll(scroller, anchorBox.top - (plan.line + FORWARD_GAP))
  return 'forward'
}
