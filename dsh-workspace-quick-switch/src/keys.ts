/**
 * 浮层的键盘与滚轮通道：纯 DOM 行为，不依赖 React。
 *
 * 两条通路各挂一份：`installPaletteKeys` 在捕获阶段接管浮层内六个键（两张浮层只认自己那个
 * store 是否打开），`installPaletteWheel` 把滚轮折算成窗口滑动（一格一行）。选中行的确认与
 * 点击共用 {@link activate}。
 */
import type { PaletteStore } from './palette.ts'

/**
 * 把选中行滚进可见区（`nearest`：已经可见的行不动）。
 *
 * 窗口够高时 10 行全部可见，这里什么都不做；窗口矮到列表内部滚动时，键盘把选中行移出
 * 视口就等于「看不见」，所以每次选中行变化后都要补一次。
 * @param option - 选中行元素；缺席（浮层未开、空候选、测试替身）时静默跳过。
 */
export function keepOptionVisible(option: Element | null | undefined): void {
  option?.scrollIntoView?.({ block: 'nearest' })
}

/** 一格滚轮事件（结构与 `WheelEvent` 兼容，测试替身也能给）。 */
export interface PaletteWheelEventLike {
  readonly deltaY: number
  /** `0` 像素、`1` 行、`2` 页（DOM_DELTA_*）；缺席按像素。 */
  readonly deltaMode?: number
  readonly ctrlKey?: boolean
}

/** 滚轮监听目标（浮层根节点结构上满足它）。 */
export interface PaletteWheelTarget {
  addEventListener(
    type: 'wheel',
    listener: (event: WheelEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void
  removeEventListener(
    type: 'wheel',
    listener: (event: WheelEvent) => void,
    options?: EventListenerOptions | boolean,
  ): void
}

/**
 * 一次滚轮折算成多少像素。
 *
 * 像素模式（触控板、多数浏览器）原样使用；行 / 页模式（部分平台的鼠标滚轮）按一行 16px、
 * 一整屏 400px 折算。幅度只用来判方向，见 {@link wheelStep}。
 * @param event - 滚轮事实。
 * @returns 纵向位移（向上为负）。
 */
export function wheelPixels(event: PaletteWheelEventLike): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * 400
  return event.deltaY
}

/**
 * 一次滚轮折算成滑几行：**一格就是一行，与幅度无关**。
 *
 * 有的鼠标一格只报十几像素、有的报到一百多，按像素折算会让前者「滚了没反应」、后者
 * 「一格跳两三行」。这里不读幅度，只看方向：非零位移一律算一行（向上为 -1）。
 * 触控板的连续事件也因此每个事件走一行 —— 手感由滚轮 / 触控板自己的节奏决定。
 * @param pixels - 这一格折算出的像素（向上为负）。
 * @returns -1 / 0 / 1。
 */
export function wheelStep(pixels: number): -1 | 0 | 1 {
  if (!Number.isFinite(pixels) || pixels === 0) return 0
  return pixels > 0 ? 1 : -1
}

/**
 * 让滚轮滑动浮层窗口（一格一行），不是滚选中行，也不整屏跳。
 *
 * 监听挂在**浮层根节点**上、`passive: false`：
 *
 *   - 指针落在浮层任何位置（面板、遮罩留白）滚轮都归浮层 —— 只挂在面板上的话，指针偏到
 *     遮罩那片留白里，滚轮就会穿到背后正文上；
 *   - 每次都 `preventDefault()`：浮层是模态的，背后的正文被遮罩盖着，不该跟着滚；
 *   - 触控板捏合在 Chrome 里报成 `ctrlKey + wheel`，那是浏览器缩放手势，原样放行；
 *   - 每一格滚轮按 {@link wheelStep} 折成一行，窗口因此是**连续**的：显示 1–10 时滚一格
 *     变成 2–11，而不是整屏跳到 11–20。
 *
 * 选中行不跟着滚轮走：高亮只由键盘与点击改；滑动把选中行带出窗口时，store 会把它贴到
 * 最近的可见边上。
 * @param root - 浮层根节点；缺席（浮层未挂载）时不装。
 * @param slide - 滑动动作，参数是行数（正数往下）。
 * @returns 卸载函数。
 */
export function installPaletteWheel(
  root: PaletteWheelTarget | null | undefined,
  slide: (rows: number) => void,
): () => void {
  if (root === null || root === undefined) return () => {}
  const onWheel = (event: WheelEvent): void => {
    // 捏合缩放在 Chrome 里报成 ctrlKey + wheel：那是浏览器缩放手势，不归浮层。
    if (event.ctrlKey === true) return
    const rows = wheelStep(wheelPixels(event))
    if (rows === 0) return
    // 浮层是模态的：滚轮一律归它，哪怕已经滑到头 —— 否则会漏到背后那层正文上。
    event.preventDefault()
    slide(rows)
  }
  root.addEventListener('wheel', onWheel, { passive: false })
  // 卸载只按 capture 匹配：`passive` 不参与「是不是同一个监听」的判定。
  return () => root.removeEventListener('wheel', onWheel, false)
}

/** 浮层内一个按键解出的动作。 */
export type PaletteAction = 'close' | 'confirm' | 'next' | 'previous' | 'page-next' | 'page-previous'

/** `paletteAction` 读到的按键事实（KeyboardEvent 结构上满足它）。 */
export interface PaletteEventLike {
  readonly key: string
  readonly repeat?: boolean
  readonly isComposing?: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly shiftKey?: boolean
  readonly metaKey?: boolean
  readonly defaultPrevented?: boolean
}

/**
 * 一次按键解码出的动作。
 *
 * 只认没有修饰键的 `Escape` / `Enter` / `↑` / `↓`（选行）与 `←` / `→`（翻页）；组合中、
 * 已被别的处理器消费、或带修饰键的按键统统放行（浮层不抢 `Ctrl+↑`、`Shift+←` 这类有主的键）。
 * @param event - 按键事实。
 * @returns 动作，或不属于浮层时的 undefined。
 */
export function paletteAction(event: PaletteEventLike): PaletteAction | undefined {
  if (event.defaultPrevented === true) return undefined
  if (event.isComposing === true) return undefined
  if (event.ctrlKey === true || event.altKey === true || event.metaKey === true || event.shiftKey === true) return undefined
  // 按住不放的重复：选择与翻页可以连按，取消与确认不行（避免一次长按连开好几个会话）。
  if (event.repeat === true && (event.key === 'Enter' || event.key === 'Escape')) return undefined
  if (event.key === 'Escape') return 'close'
  if (event.key === 'Enter') return 'confirm'
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowUp') return 'previous'
  if (event.key === 'ArrowRight') return 'page-next'
  if (event.key === 'ArrowLeft') return 'page-previous'
  return undefined
}

/** 捕获阶段的按键目标（document 结构上满足它）。 */
export interface PaletteKeyTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture?: boolean): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture?: boolean): void
}

/**
 * 确认当前选中行（Enter）。
 * @param store - 浮层状态。
 */
export function confirmActive(store: PaletteStore): void {
  activate(store, store.getSnapshot().activeIndex)
}

/**
 * 确认一行（点击或 Enter）：先把选中行定到它，再关掉浮层，最后让容器执行动作。
 *
 * 顺序是有意的：动作（新建 / 打开会话）会切走主视图，先关浮层就不会留下一个悬在切换之上的遮罩。
 * @param store - 浮层状态。
 * @param index - 被确认的行（可以是越界值，由 store 收敛）。
 */
export function activate(store: PaletteStore, index: number): void {
  store.select(index)
  const binding = store.getSnapshot().binding
  store.close()
  if (binding === null) return
  binding()
}

/**
 * 在捕获阶段接管浮层的六个键。
 *
 * 捕获监听先于任何本地控件看到按键，所以浮层一开，`Esc` / `Enter` / `↑` / `↓` / `←` / `→`
 * 就归它；关掉之后立刻回到原来的归属。浮层没开时一个键都不动（两张浮层各挂一份，只认自己
 * 那个 store 是否打开）。
 * @param store - 浮层状态。
 * @param target - 按键目标，浏览器里是 `document`。
 * @returns 卸载函数。
 */
export function installPaletteKeys(store: PaletteStore, target: PaletteKeyTarget): () => void {
  if (target === undefined || target === null) return () => {}
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!store.getSnapshot().open) return
    const action = paletteAction(event)
    if (action === undefined) return
    // 这六个键归浮层：不让页面上任何本地控件拿到同一次按键。
    event.preventDefault()
    event.stopPropagation()
    if (action === 'close') store.close()
    else if (action === 'confirm') confirmActive(store)
    else if (action === 'page-next') store.turn(1)
    else if (action === 'page-previous') store.turn(-1)
    else store.move(action === 'next' ? 1 : -1)
  }
  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}
