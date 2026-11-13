/**
 * 捕获层用得上的最小 DOM 形状。
 *
 * 生产环境是 `Element` / `Event` / `Document`，测试里是假替身；这里只声明本插件真正读写的成员，
 * 让行为可以在 Node 里直接跑，不必引入 DOM 实现。上游没有对应的公开类型（这些是捕获层的
 * 测试接缝），因此保留本地声明。
 *
 * @see docs/dsh-changes-behavior.md
 */

/** 可被 `closest` / 属性读取 / 取矩形的最小元素形状。 */
export interface ElementLike {
  /** 标签名（小写），用于测试替身判断 `button` / `li`。生产元素上没有这个字段也不会被读。 */
  readonly tag?: string
  /** 原生按钮的禁用态。 */
  readonly disabled?: boolean
  closest?(selector: string): ElementLike | null
  hasAttribute?(attribute: string): boolean
  getAttribute?(attribute: string): string | null
  getBoundingClientRect?(): { readonly left: number; readonly bottom: number }
}

/** 一次点击事件里本插件用到的字段。 */
export interface EventLike {
  readonly target?: unknown
  readonly defaultPrevented?: boolean
  composedPath?(): unknown[]
  preventDefault(): void
  stopPropagation(): void
}

/** 可打标记的文档根元素。 */
export interface MarkedElement {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

/** 本插件需要的文档能力：三个捕获监听、读根元素写生效标记、查右栏面板。 */
export interface DocumentLike {
  readonly body?: ElementLike | null
  readonly documentElement?: MarkedElement | null
  /** 文档所属 window；读视口宽度用（窄窗口自动全屏）。 */
  readonly defaultView?: unknown
  addEventListener(type: string, listener: (event: EventLike) => void, capture: boolean): void
  removeEventListener(type: string, listener: (event: EventLike) => void, capture: boolean): void
  /** 查面板根等元素；测试替身提供同样的最小实现。 */
  querySelectorAll?(selectors: string): ArrayLike<ElementLike>
}

/** 鸭子类型判定「可 `closest` 的节点」，与仓库内其它捕获层同一手法。 */
export function hasClosest(value: unknown): value is ElementLike {
  return typeof value === 'object'
    && value !== null
    && 'closest' in value
    && typeof (value as { closest?: unknown }).closest === 'function'
}

/**
 * 事件派发的第一个元素；没有可用路径时退回 `event.target`。
 * @param event - 一次点击事件。
 * @returns 事件目标元素，取不到则返回 null。
 */
export function clickElement(event: EventLike): ElementLike | null {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  for (const value of path) {
    if (hasClosest(value)) return value
  }
  return hasClosest(event.target) ? event.target : null
}
