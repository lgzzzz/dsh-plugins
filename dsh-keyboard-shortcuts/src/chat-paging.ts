/**
 * 消息滚动口的 PageUp/PageDown 补偿，以及 Space 原生翻页屏蔽。
 *
 * 背景：Chat 把底部 sticky 的 composer 放在 `[data-conversation-scroll]` 里，滚动容器的
 * `clientHeight` 因此包含 composer；浏览器原生 PageUp/PageDown 按整个滚动口高度翻页
 * （并保留一段重叠），而用户实际能读的消息带只有 `clientHeight - composerHeight`。
 * 每按一次会多走 `composerHeight - 重叠量`，在 composer 较高或窗口较矮时尤其明显。
 *
 * 本模块在 window 捕获阶段接管落在消息滚动口内的 PageUp/PageDown，用可见消息带重算
 * 步长；Space 的原生翻页同样按整口高度，直接吞掉。输入框、按钮、终端、模态层与内层
 * 可滚动区（过程组 body、代码块、长草稿）保持原生，不抢它们的按键。
 *
 * 不注册固定行、不消费 fixed-input。命中时只 `preventDefault()`，不 `stopPropagation()`：
 * Chat 自己的 `onIntent` 仍要看到这一按，用来打断跟随动画；随后的原生滚动事件再按
 * 读者手势归属。滚动由本模块的 rAF 控制器驱动：单次翻页用 320ms 的三次 Hermite 缓动，
 * 连按在未完成的目标上继续累加，滚轮 / 触摸 / 指针 / 其它按键立即取消。
 * `prefers-reduced-motion: reduce` 或环境没有 rAF 时直接写 `scrollTop`。
 *
 * DOM 锚点 `[data-conversation-scroll]` / `[data-composer-seat]` 由
 * css-contract.json 的 conversation-scroll / composer-seat 两条契约兜住。
 */
import { modalOpen, pressElement, terminalTarget } from './capture.ts'
import { name } from './runtime.ts'
import type {Context} from '@deepseek-ai/cordis'

/** 消息滚动口；Chat 的共享 transcript 滚动容器。 */
const SCROLLER_SELECTOR = '[data-conversation-scroll]'

/** composer 的 sticky 座位；它的高度就是滚动口底部被遮住的部分。 */
const COMPOSER_SELECTOR = '[data-composer-seat]'

/** 模态 / 浮层：打开时所有翻页键都让给它们。 */
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"]'

/** Space 有自己默认动作的控件：按钮激活、输入、选择、播放器等。 */
const SPACE_OWNER_SELECTOR = [
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  'video',
  'audio',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(', ')

/** PageUp/PageDown 有自己默认动作的控件：下拉、滑块、数字输入等。 */
const PAGE_OWNER_SELECTOR = [
  'select',
  'input',
  'textarea',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(', ')

/** 原生翻页保留的重叠量：让下一页仍能看到上一页最后一段内容。 */
export const PAGE_OVERLAP = 50

/** 本模块接管的三个键。 */
export type PagingKey = 'PageUp' | 'PageDown' | 'Space'

/** 一次翻页决策的几何读数：滚动口、composer 与当前位置。 */
export interface PagingGeometry {
  readonly clientHeight: number
  readonly composerHeight: number
  readonly scrollTop: number
  readonly scrollHeight: number
}

/** 一次按键的处理结果。 */
export type PagingDecision =
  /** 写入选定的 `scrollTop`（已钳制在滚动范围内）。 */
  | { readonly type: 'page'; readonly top: number }
  /** 吞掉按键，不滚动（Space）。 */
  | { readonly type: 'block' }
  /** 不接管，交回浏览器 / 内层滚动容器。 */
  | { readonly type: 'pass' }

/**
 * 从键盘事件取出本模块负责的键；其它键返回 undefined。
 *
 * Space 同时认 `key === ' '` 与 `code === 'Space'`：前者是标准读数，后者兜住
 * 布局 / 输入法把 `key` 报成别的值的环境。
 */
export function pagingKeyFrom(event: Pick<KeyboardEvent, 'key' | 'code'>): PagingKey | undefined {
  if (event.key === 'PageUp') return 'PageUp'
  if (event.key === 'PageDown') return 'PageDown'
  if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') return 'Space'
  return undefined
}

/** 是否带修饰键；本模块只接管裸键，带修饰键的组合留给页面 / 输入控件。 */
function modified(event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): boolean {
  return event.ctrlKey || event.altKey || event.shiftKey || event.metaKey
}

/** 是否要求减少动态效果；没有 `matchMedia` 的环境按“不要求”处理。 */
function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 单次翻页动画时长（毫秒）。 */
export const PAGING_ANIMATION_MS = 320

/** 小于该位移视为已经到位，避免亚像素来回写。 */
const SETTLE_EPSILON = 0.5

/** 与上一帧写入值相差超过该像素，视为读者 / 页面自己接管了滚动。 */
const EXTERNAL_SCROLL_EPSILON = 1

/** 一帧的调度接口；测试可以注入假时钟，不需要真实 rAF。 */
export interface PagingFrameScheduler {
  now(): number
  request(callback: (time: number) => void): number
  cancel(handle: number): void
}

/** 动画控制器的可注入项；`scheduler: null` 表示强制瞬时到位。 */
export interface PagingAnimatorOptions {
  readonly scheduler?: PagingFrameScheduler | null
  readonly duration?: number
  readonly reducedMotion?: () => boolean
}

/** 浏览器默认的 rAF 调度器；没有完整 rAF 能力时返回 null，由调用方瞬时滚动。 */
function systemScheduler(): PagingFrameScheduler | null {
  const raf = globalThis.requestAnimationFrame
  const caf = globalThis.cancelAnimationFrame
  if (typeof raf !== 'function' || typeof caf !== 'function') return null
  return {
    now: () => typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now(),
    request: (callback) => raf.call(globalThis, callback),
    cancel: (handle) => caf.call(globalThis, handle),
  }
}

/** 三次 Hermite：起点位置 / 起点速度 / 终点位置，终点速度固定为 0。 */
function hermitePosition(
  from: number,
  to: number,
  velocity: number,
  progress: number,
  duration: number,
): number {
  const t = Math.max(0, Math.min(1, progress))
  const t2 = t * t
  const t3 = t2 * t
  const value = (2 * t3 - 3 * t2 + 1) * from
    + (t3 - 2 * t2 + t) * duration * velocity
    + (-2 * t3 + 3 * t2) * to
  // 连按反向时起点速度可能仍指向旧方向；钳在两端之间，避免先冲过终点再折回。
  return Math.max(Math.min(from, to), Math.min(Math.max(from, to), value))
}

/** 一段正在进行的翻页动画。 */
interface PagingSegment {
  readonly scroller: HTMLElement
  readonly from: number
  readonly to: number
  readonly velocity: number
  readonly startedAt: number
  frame: number | null
  lastWritten: number
}

/**
 * 消息滚动口的翻页动画控制器。
 *
 * 单次翻页从当前位置缓动到目标；动画未结束时再次翻页会保留当前速度并把新目标继续
 * 累加，不会从半路跳回起点。读者滚轮、触摸、指针或其它按键由调用方取消；如果滚动
 * 位置被页面自己的跟随动画改掉，下一帧也会自动停止，避免两边抢 `scrollTop`。
 */
export class PagingAnimator {
  private segment: PagingSegment | null = null
  private readonly scheduler: PagingFrameScheduler | null
  private readonly duration: number
  private readonly reducedMotion: () => boolean

  constructor(options: PagingAnimatorOptions = {}) {
    this.scheduler = options.scheduler === undefined ? systemScheduler() : options.scheduler
    this.duration = Math.max(1, options.duration ?? PAGING_ANIMATION_MS)
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion
  }

  /**
   * 下一次翻页应当基于的位置：动画未结束时是它的终点，否则是当前 `scrollTop`。
   *
   * 如果滚动口已经被读者或页面自己挪走，先取消动画，避免把旧终点当成新起点。
   */
  targetFor(scroller: HTMLElement): number {
    const segment = this.segment
    if (segment === null || segment.scroller !== scroller) return scroller.scrollTop
    if (this.drifted(segment)) {
      this.cancel()
      return scroller.scrollTop
    }
    return segment.to
  }

  /** 把滚动口从现在的位置动画到 `top`；已有动画时保留速度并改写目标。 */
  page(scroller: HTMLElement, top: number): void {
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const target = Math.max(0, Math.min(max, top))
    const current = scroller.scrollTop

    if (this.reducedMotion() || this.scheduler === null) {
      this.cancel()
      scroller.scrollTop = target
      return
    }
    if (Math.abs(target - current) < SETTLE_EPSILON) {
      this.cancel()
      return
    }

    const now = this.scheduler.now()
    let velocity = 0
    // 同一段动画保留已经排好的那一帧，避免重定向时多排一帧。
    let frame: number | null = null
    const active = this.segment
    if (active !== null && active.scroller === scroller) {
      if (this.drifted(active)) this.cancel()
      else {
        velocity = this.velocityAt(now)
        frame = active.frame
      }
    } else {
      this.cancel()
    }

    this.segment = {
      scroller,
      from: current,
      to: target,
      velocity,
      startedAt: now,
      frame,
      lastWritten: current,
    }
    this.schedule()
  }

  /** 立即停止；不写目标位置，也不留下未取消的帧。 */
  cancel(): void {
    const segment = this.segment
    this.segment = null
    if (segment !== null && segment.frame !== null) this.scheduler?.cancel(segment.frame)
  }

  /** 滚动位置是否已经被本控制器以外的写入挪走。 */
  private drifted(segment: PagingSegment): boolean {
    return Math.abs(segment.scroller.scrollTop - segment.lastWritten) > EXTERNAL_SCROLL_EPSILON
  }

  /** 当前段在 `now` 时刻的速度（像素 / 毫秒）；用于连按时保持速度连续。 */
  private velocityAt(now: number): number {
    const segment = this.segment
    if (segment === null) return 0
    const t = Math.max(0, Math.min(1, (now - segment.startedAt) / this.duration))
    const derivative = (6 * t * t - 6 * t) * segment.from
      + (3 * t * t - 4 * t + 1) * this.duration * segment.velocity
      + (-6 * t * t + 6 * t) * segment.to
    return derivative / this.duration
  }

  /** 登记下一帧；同一个动画段最多只有一个待执行帧。 */
  private schedule(): void {
    const segment = this.segment
    if (segment === null || this.scheduler === null || segment.frame !== null) return
    segment.frame = this.scheduler.request(this.step)
  }

  /** 推进一帧；rAF 时间戳与 `scheduler.now()` 使用同一时基。 */
  private readonly step = (time: number): void => {
    const segment = this.segment
    if (segment === null) return
    const now = Number.isFinite(time) ? time : this.scheduler?.now() ?? 0
    segment.frame = null

    if (this.drifted(segment)) {
      this.cancel()
      return
    }

    const elapsed = Math.max(0, now - segment.startedAt)
    const progress = Math.min(1, elapsed / this.duration)
    const max = Math.max(0, segment.scroller.scrollHeight - segment.scroller.clientHeight)
    const next = Math.max(0, Math.min(
      max,
      hermitePosition(segment.from, segment.to, segment.velocity, progress, this.duration),
    ))
    segment.scroller.scrollTop = next
    segment.lastWritten = segment.scroller.scrollTop

    if (progress >= 1) {
      this.cancel()
      return
    }
    this.schedule()
  }
}

/**
 * 按“可见消息带”计算一次翻页的位移。
 *
 * @param clientHeight - 滚动口高度（含 composer）。
 * @param composerHeight - composer 座位高度。
 * @param overlap - 保留的上下文重叠，默认 {@link PAGE_OVERLAP}。
 * @returns 步长；可见带不存在时返回 0。
 */
export function pagingStep(clientHeight: number, composerHeight: number, overlap = PAGE_OVERLAP): number {
  const band = clientHeight - composerHeight
  if (!(band > 0)) return 0
  return Math.max(1, band - Math.max(0, overlap))
}

/**
 * 一次翻页键的决策。
 *
 * `innerScrollable` 为真表示目标与滚动口之间有一个还能在该方向滚动的容器（过程组
 * body、代码块、长草稿输入框等），此时无论哪个键都交回原生：内层先滚，外层等内层
 * 到边界后的下一次按键再接管。
 */
export function decidePaging(
  key: PagingKey,
  geometry: PagingGeometry,
  innerScrollable = false,
  overlap = PAGE_OVERLAP,
): PagingDecision {
  if (innerScrollable) return { type: 'pass' }
  if (!(geometry.composerHeight > 0)) return { type: 'pass' }
  if (key === 'Space') return { type: 'block' }

  const step = pagingStep(geometry.clientHeight, geometry.composerHeight, overlap)
  if (step === 0) return { type: 'pass' }

  const direction = key === 'PageDown' ? 1 : -1
  const floor = Math.max(0, geometry.scrollHeight - geometry.clientHeight)
  const top = Math.max(0, Math.min(floor, geometry.scrollTop + direction * step))
  return top === geometry.scrollTop ? { type: 'pass' } : { type: 'page', top }
}

/** 按 `closest` 能力做鸭子类型收窄；Node 侧测试与无 DOM 环境不会碰 `Element` 全局。 */
function asElement(value: unknown): Element | null {
  return typeof value === 'object' && value !== null && typeof (value as Element).closest === 'function'
    ? value as Element
    : null
}

/**
 * 找到这次按键所属的消息滚动口。
 *
 * 顺序：目标自身最近的消息滚动口 → 当前焦点所在的滚动口 → 页面上唯一可见的滚动口。
 * 多栏同时可见且无法从焦点判定时返回 null（不猜），让原生行为保持原样。
 */
export function resolvePagingScroller(target: Element | null): HTMLElement | null {
  const direct = target?.closest<HTMLElement>(SCROLLER_SELECTOR)
  if (direct !== null && direct !== undefined) return direct

  if (typeof document === 'undefined') return null
  const active = asElement(document.activeElement)
  const viaActive = active?.closest<HTMLElement>(SCROLLER_SELECTOR)
  if (viaActive !== null && viaActive !== undefined) return viaActive

  if (typeof window === 'undefined' || typeof document.querySelectorAll !== 'function') return null
  const visible = [...document.querySelectorAll<HTMLElement>(SCROLLER_SELECTOR)].filter((element) => {
    if (typeof element.getBoundingClientRect !== 'function') return false
    const rect = element.getBoundingClientRect()
    return rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
  })
  return visible.length === 1 ? visible[0] : null
}

/**
 * 目标与滚动口之间是否有一个还能沿 `direction` 滚动的容器。
 *
 * 沿 `composedPath()` 上溯，因此跨 shadow root 也能看到内层；到达滚动口即停止。
 * `overflow-y` 只认 auto/scroll，到边界（含 1px 取整余量）不算“还能滚”，让外层接管。
 */
function innerScrollableCanConsume(
  event: KeyboardEvent,
  scroller: HTMLElement,
  direction: 1 | -1,
): boolean {
  if (typeof event.composedPath !== 'function') return false
  const path = event.composedPath()
  if (!path.includes(scroller)) return false
  if (typeof getComputedStyle !== 'function') return false

  for (const value of path) {
    if (value === scroller) break
    const element = asElement(value) as HTMLElement | null
    if (element === null) continue
    if (typeof element.scrollHeight !== 'number' || typeof element.clientHeight !== 'number') continue
    const style = getComputedStyle(element)
    if (!/(auto|scroll)/.test(style.overflowY)) continue
    const range = element.scrollHeight - element.clientHeight
    if (range <= 0) continue
    if (direction > 0 ? element.scrollTop < range - 1 : element.scrollTop > 1) return true
  }
  return false
}

/**
 * `terminalTarget` 的布尔包装：type predicate 直接进 `if` 会把 false 分支收窄成 null，
 * 这里保留调用方 `target` 的 `Element | null` 形状。
 */
function isTerminalTarget(target: Element | null): boolean {
  return target !== null && terminalTarget(target)
}

/**
 * 处理一次 keydown；命中时消费按键并把翻页交给动画控制器。
 *
 * 只在 window 捕获阶段调用。Space 命中且没有内层可滚动容器时吞掉按键但不滚动；
 * PageUp/PageDown 在到达顶部 / 底部时返回 pass，让浏览器自行处理边界与滚动链。
 * 其它按键会取消尚未完成的翻页动画，读者一接管就不再和页面抢滚动。
 */
export function handlePagingKeydown(event: KeyboardEvent, animator: PagingAnimator): void {
  if (event.type !== 'keydown') return

  const key = pagingKeyFrom(event)
  if (key === undefined) {
    animator.cancel()
    return
  }
  if (event.defaultPrevented || event.isComposing) {
    animator.cancel()
    return
  }
  if (modified(event)) {
    animator.cancel()
    return
  }

  const target = pressElement(event)
  if (isTerminalTarget(target)) {
    animator.cancel()
    return
  }
  if (target !== null) {
    if (target.closest(MODAL_SELECTOR) !== null) {
      animator.cancel()
      return
    }
    const owner = key === 'Space' ? SPACE_OWNER_SELECTOR : PAGE_OWNER_SELECTOR
    if (target.closest(owner) !== null) {
      animator.cancel()
      return
    }
  }
  if (modalOpen()) {
    animator.cancel()
    return
  }

  const scroller = resolvePagingScroller(target)
  if (scroller === null) {
    animator.cancel()
    return
  }
  const composer = scroller.querySelector<HTMLElement>(COMPOSER_SELECTOR)
  if (composer === null) {
    animator.cancel()
    return
  }
  const composerHeight = composer.offsetHeight
  if (!(composerHeight > 0)) {
    animator.cancel()
    return
  }

  const direction = key === 'PageUp' ? -1 : 1
  if (innerScrollableCanConsume(event, scroller, direction)) {
    animator.cancel()
    return
  }

  // 连按时以动画终点为基准，才能把新的一页继续叠上去，而不是从半路重新算。
  const base = animator.targetFor(scroller)
  const decision = decidePaging(key, {
    clientHeight: scroller.clientHeight,
    composerHeight,
    scrollTop: base,
    scrollHeight: scroller.scrollHeight,
  })
  if (decision.type === 'pass') {
    // 动画还没到边界时，边界这一按也要拦住原生翻页，否则浏览器会直接跳到边界，
    // 与控制器抢 scrollTop。动画结束后 base 与当前位置相等，再交回浏览器处理滚动链。
    if (base !== scroller.scrollTop) event.preventDefault()
    return
  }

  event.preventDefault()
  if (decision.type === 'block') {
    animator.cancel()
    return
  }
  animator.page(scroller, decision.top)
}

/**
 * 安装消息滚动口的翻页补偿；随插件 scope 卸载。
 *
 * 没有 `window`（Node 侧测试、SSR）时只登记一个空释放函数，不碰任何全局。滚轮、
 * 触摸与指针按下都视为读者接管，取消进行中的翻页动画；卸载时同时摘掉监听并停帧。
 */
export function installChatPaging(
  ctx: Pick<Context, 'inject'>,
  animator: PagingAnimator = new PagingAnimator(),
): void {
  // 空依赖注入：本模块不依赖任何服务，但沿 Cordis 的 scope 生命周期注册监听，
  // 这样插件卸载时监听随 scope 一起释放；也兼容测试里的假上下文（只有 scope.effect）。
  ctx.inject([], (scope) => {
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        handlePagingKeydown(event, animator)
      }
      const onGesture = (): void => {
        animator.cancel()
      }
      window.addEventListener('keydown', onKeydown, true)
      window.addEventListener('wheel', onGesture, true)
      window.addEventListener('touchstart', onGesture, true)
      window.addEventListener('pointerdown', onGesture, true)
      return () => {
        window.removeEventListener('keydown', onKeydown, true)
        window.removeEventListener('wheel', onGesture, true)
        window.removeEventListener('touchstart', onGesture, true)
        window.removeEventListener('pointerdown', onGesture, true)
        animator.cancel()
      }
    }, `${name}: chat paging`)
  })
}
