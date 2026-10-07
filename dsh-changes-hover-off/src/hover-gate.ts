/**
 * 改动文件卡片的悬停预览闸门。
 *
 * 上游 `@deepseek-ai/dsh-client-ui-deliverables` 给改动文件卡片的每个文件行包了一个
 * `HoverCard`(`openDelayMs: 500`):指针在行上停留 500ms 后,在 `<body>` 上开一个单列
 * diff 浮层;浮层内容 `ChangedFilePreview` 只在打开时挂载,所以读取对比这一动作也只在
 * 打开时发生。上游没有为这条浮层暴露任何配置项,`HoverCard` 自带的 `disabled` 也没有被传。
 *
 * 这里不改上游产物,分两层处理:
 *
 * 1. **主路径(闸门)**:`HoverCard` 的打开逻辑挂在 `onPointerEnter` 上(命中后
 *    `setTimeout(..., openDelayMs)`),而 React 18+ 把 `onPointerEnter` 由冒泡的
 *    `pointerover` 合成、委派监听挂在应用根 `<div id="root">` 上。在 `document` 捕获
 *    阶段拦下落在卡片内的事件并 `stopPropagation()`,`#root` 上的合成派发便收不到该事件 ——
 *    浮层不打开,定时器不建立,对比也不会被读取。
 * 2. **网兜(守卫)**:万一浮层仍被打开(闸门失效,或上游改走别的打开路径),`body` 上的
 *    `MutationObserver` 会在 portal 外壳进入 DOM 的那个微任务里把它置为 `display:none`;
 *    MutationObserver 回调早于绘制,所以它不会可见。网兜只隐藏、不删除 React 拥有的节点。
 *
 * 作用域只按 `[data-changed-files]` 限定:该属性只有改动文件卡片在用,所以卡片外的
 * `HoverCard`(正文图片 / 文件链接的悬停缩略图)与右栏 review tab 完全不受影响。行的
 * hover 底色是纯 CSS `:hover`,点击行打开 review 走 `click`,两者都不经过这里。
 *
 * 装卸都在 `document.documentElement` 上留一个 `data-dsh-changes-hover-off` 标记,便于在
 * Elements 面板或 Console 一行确认本插件是否真的加载并生效。
 */

/** 改动文件卡片根元素上的稳定锚点;只有这张卡片用它。 */
export const CARD_SELECTOR = '[data-changed-files]'

/** 文档根元素上的生效标记:装上闸门时写入,卸载时移除。 */
export const MARKER_ATTRIBUTE = 'data-dsh-changes-hover-off'

/** 浮层内容标记;网兜按它识别 portal 外壳。 */
export const PREVIEW_ATTRIBUTE = 'data-changes-hover-preview'

/**
 * 要拦的手势。
 *
 * `pointerover` / `mouseover` 是 React 合成 enter/leave 的来源(必需);原生
 * `pointerenter` / `mouseenter` 不冒泡但捕获阶段仍会经过 `document`,一并纳入是为了在
 * 上游改用原生 enter 处理器时仍然有效。
 */
export const HOVER_GESTURES = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter'] as const

/** 本闸门拦下的手势类型。 */
export type HoverGesture = (typeof HOVER_GESTURES)[number]

/** 可打标记的元素(生产环境是 `HTMLElement`)。 */
export interface MarkedElement {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** 可否决显示的元素(生产环境是 portal 外壳 `HTMLElement`)。 */
export interface ConcealableElement {
  style: { display: string }
  matches?(selector: string): boolean
  querySelector?(selector: string): unknown
}

/** 最小 MutationObserver 形状,便于测试替身。 */
export interface MutationObserverLike {
  observe(target: unknown, options: { childList: boolean }): void
  disconnect(): void
}

/** 最小 MutationObserver 构造器形状(生产环境是 `window.MutationObserver`)。 */
export interface MutationObserverCtor {
  new (callback: (records: readonly MutationRecordLike[]) => void): MutationObserverLike
}

/** 只读取 `addedNodes` 的变更记录形状。 */
export interface MutationRecordLike {
  readonly addedNodes: ArrayLike<unknown>
}

/** 闸门需要的文档能力;只用到捕获监听、根标记与 `body` 观察,便于测试替身。 */
export interface HoverGateDocument {
  addEventListener(type: string, listener: (event: Event) => void, capture: boolean): void
  removeEventListener(type: string, listener: (event: Event) => void, capture: boolean): void
  documentElement?: MarkedElement | null
  body?: unknown
  defaultView?: { MutationObserver?: MutationObserverCtor } | null
}

/** 鸭子类型判定「可 `closest` 的节点」,与上游捕获层同一手法,测试可传普通假元素。 */
function hasClosest(value: unknown): value is Element {
  return typeof value === 'object'
    && value !== null
    && 'closest' in value
    && typeof (value as { closest?: unknown }).closest === 'function'
}

/** 鸭子类型判定「可隐藏的 portal 外壳」。 */
function isConcealable(value: unknown): value is ConcealableElement {
  return typeof value === 'object'
    && value !== null
    && 'style' in value
    && typeof (value as { style?: unknown }).style === 'object'
    && (value as { style: unknown }).style !== null
}

/** 该外壳自身或其后代是否带浮层内容标记。 */
export function isHoverPreviewShell(node: unknown): node is ConcealableElement {
  if (!isConcealable(node)) return false
  if (typeof node.matches === 'function' && node.matches(`[${PREVIEW_ATTRIBUTE}]`)) return true
  if (typeof node.querySelector !== 'function') return false
  return node.querySelector(`[${PREVIEW_ATTRIBUTE}]`) !== null
}

/**
 * 事件组合路径上的第一个 Element;没有可用路径时退回 `event.target`。
 *
 * @returns 手势目标元素,取不到则返回 null。
 */
export function gestureElement(event: Event): Element | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const value of path) {
    if (hasClosest(value)) return value
  }
  return hasClosest(event.target) ? event.target : null
}

/** 该目标是否落在改动文件卡片内(即该手势是否属于这条浮层)。 */
export function ownsHoverGesture(element: Element | null): boolean {
  if (element === null) return false
  return element.closest(CARD_SELECTOR) !== null
}

/**
 * 命中则消费该手势:调用 `stopPropagation()`,使 React 的合成 enter 不再派发。
 *
 * @returns 是否消费了该事件。
 */
export function suppressHoverGesture(event: Event): boolean {
  if (!ownsHoverGesture(gestureElement(event))) return false
  event.stopPropagation()
  return true
}

/**
 * 安装网兜:浮层外壳一旦进入 `body` 就立即隐藏。
 *
 * 不删除节点(它由 React 拥有),只置 `display:none`;卸载时恢复原状。
 *
 * @param doc - 目标文档;缺 `MutationObserver` 或 `body` 时为空操作。
 * @returns 卸载函数。
 */
export function installHoverPreviewGuard(doc: HoverGateDocument): () => void {
  const View = doc.defaultView?.MutationObserver
  const body = doc.body
  if (View === undefined || typeof body !== 'object' || body === null) return () => {}

  const concealed: ConcealableElement[] = []
  const observer = new View((records) => {
    for (const record of records) {
      const nodes = record.addedNodes
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]
        if (!isHoverPreviewShell(node)) continue
        node.style.display = 'none'
        concealed.push(node)
      }
    }
  })
  observer.observe(body, { childList: true })

  return () => {
    observer.disconnect()
    for (const element of concealed) element.style.display = ''
    concealed.length = 0
  }
}

/**
 * 在文档捕获阶段安装闸门,并挂上网兜与生效标记。
 *
 * @param doc - 目标文档;默认取 `globalThis.document`,没有文档(非浏览器环境)时为空操作。
 * @returns 卸载函数,移除本次安装的全部监听、观察与标记。
 */
export function installHoverGate(
  doc: HoverGateDocument | undefined = typeof document === 'undefined'
    ? undefined
    : document as unknown as HoverGateDocument,
): () => void {
  if (doc === undefined) return () => {}

  const gate = (event: Event): void => {
    suppressHoverGesture(event)
  }
  for (const type of HOVER_GESTURES) doc.addEventListener(type, gate, true)
  const unguard = installHoverPreviewGuard(doc)
  doc.documentElement?.setAttribute(MARKER_ATTRIBUTE, '')

  return () => {
    for (const type of HOVER_GESTURES) doc.removeEventListener(type, gate, true)
    unguard()
    doc.documentElement?.removeAttribute(MARKER_ATTRIBUTE)
  }
}
