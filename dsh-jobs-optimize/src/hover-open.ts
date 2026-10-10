/**
 * 悬停开合状态机：把指针进出与点击翻译成上游控件自己的开合动作。
 *
 * 上游控件的开合真值只存在于 DOM 上——触发器是 `button[aria-expanded]`，它的值就是组件私有的
 * `open` 状态；本状态机改变它只有一条路径：点击触发器（上游 `onClick` 做
 * `setOpen(current => !current)`，见 contract.json 的 trigger-toggle）。因此本状态机不镜像任何
 * 状态：每次开/合之前重读 `aria-expanded`，读到的值和目标一致就空操作。合成 click 会冒泡到
 * React 的委派根容器，因此等价于用户点了一下触发器。
 *
 * **三个行为与上游子代理控件逐一对齐**（`dsh-client-ui-subagent` 的头部计数控件）：
 *
 * 1. 指针进入后 `HOVER_OPEN_DELAY_MS` 展开；
 * 2. 指针离开后 `HOVER_CLOSE_DELAY_MS` 折叠；
 * 3. 点击把它钉住：**已展开时点击也不折叠**，只把控件钉住——上游子代理控件的 onClick 是
 *    `pinnedRef.current = true; if (!open) changeOpen(true)`，从不折叠。钉住后指针离开不再
 *    折叠，关闭只剩两条路径：点击控件外部，或按 Escape。
 *
 * 第 3 条要求拦下「已展开时的那次点击」：上游后台任务控件的 onClick 是无条件 toggle，放它过去
 * 就会把菜单关掉。调用方用包装层的 React `onClickCapture` 把点击交给 `click()`，捕获派发早于
 * 上游 onClick 的冒泡派发，因此已展开时 `stopPropagation()` 就能让这次点击到不了上游的
 * onClick。
 *
 * **指针进出由调用方按 React 的 enter/leave 语义喂进来**（`enter()` / `leave()`）：菜单被上游
 * `createPortal` 到 `document.body`（见 contract.json 的 menu-portal），落在包装层的 DOM 子树
 * 之外，按「`relatedTarget` 是否在包装层内」判定会把「指针移进菜单」当成离开、排上折叠；React
 * 的 enter/leave 按 **React 树**（而不是 DOM 树）算边界，portal 内容仍算在渲染它的组件之内，
 * 因此触发器与菜单是同一个进出区域。
 *
 * **pin 语义**：合成 click 的 `isTrusted` 为 `false`，用它区分「用户点的」和「我们点的」。
 * 外部 `pointerdown` 关闭（上游的 `useDismissOnOutsidePointer`，合成 click 不派发 pointerdown，
 * 所以两者不冲突）与 Escape 关闭都不经过本状态机，因此进入时若读到控件已关闭就必须复位 pin，
 * 否则会出现「点外部关闭后再也关不掉」的粘滞。
 *
 * 上游锚点、已知边界与验证方式见 docs/dsh-jobs-optimize.md。
 */

/** 指针进入后延迟多久展开（与上游子代理控件同值，两枚 chip 的手感因此一致）。 */
export const HOVER_OPEN_DELAY_MS = 150

/** 指针离开后延迟多久折叠（同上）。 */
export const HOVER_CLOSE_DELAY_MS = 120

/**
 * 触发器选择器：宿主里第一个带 `aria-expanded` 的按钮。
 *
 * 菜单里的行展开按钮与「已结束」分组开关也带同一属性，但它们随菜单被 portal 到 `document.body`，
 * 不在宿主内，因此 `querySelector` 命中的就是触发器。
 */
export const TRIGGER_SELECTOR = 'button[aria-expanded]'

/** 承载开合真值的属性名。 */
export const EXPANDED_ATTRIBUTE = 'aria-expanded'

/** 触发器的可见行为：读开合真值、判归属、被点击。 */
export interface TriggerLike {
  getAttribute(name: string): string | null
  contains(node: unknown): boolean
  click(): void
}

/** 交给 `click()` 的一次点击；由调用方从 React 的 `onClickCapture` 转写而来。 */
export interface HoverClickEvent {
  readonly target?: unknown
  readonly isTrusted?: boolean
  /** 拦下这次点击，使上游的 `onClick` 收不到它（已展开时的点击用它保持展开）。 */
  stopPropagation?(): void
}

/** 承装包装层的宿主：只用来定位触发器（进出判定由调用方的 React enter/leave 负责）。 */
export interface HoverHost {
  querySelector(selector: string): TriggerLike | null
}

/** 本状态机用到的定时器能力，便于测试注入假实现。 */
export interface HoverTimer {
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(handle: number): void
}

const DEFAULT_TIMER: HoverTimer = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle)
  },
}

/** 一次悬停接管；`dispose()` 清掉待触发定时器，此后三个入口都成为空操作。 */
export interface HoverOpenController {
  /** 是否处于「用户点击打开、离开也不折叠」的钉住状态。 */
  readonly pinned: boolean
  /** React 的 `onMouseEnter`：指针进入包装层或它的 portal 子树。 */
  enter(): void
  /** React 的 `onMouseLeave`：指针离开包装层及其 portal 子树。 */
  leave(): void
  /** React 的 `onClickCapture`：受信任的触发器点击把它钉住。 */
  click(event: HoverClickEvent): void
  dispose(): void
}

/**
 * 在一个宿主上接管后台任务控件的指针进出与点击。
 *
 * @param host - `display: contents` 包装层；用它定位触发器，因此上游在无任务时返回
 *   `null`（内部触发器整体消失又重建）不会让接管失效。
 * @param timer - 定时器实现；默认用全局定时器。
 * @returns 控制器；`dispose()` 之后不再有任何开合动作。
 */
export function createHoverOpen(host: HoverHost, timer: HoverTimer = DEFAULT_TIMER): HoverOpenController {
  let openTimer: number | undefined
  let closeTimer: number | undefined
  let pinned = false
  let disposed = false

  const trigger = (): TriggerLike | null => host.querySelector(TRIGGER_SELECTOR)
  const expanded = (): boolean => trigger()?.getAttribute(EXPANDED_ATTRIBUTE) === 'true'

  const cancelOpen = (): void => {
    if (openTimer === undefined) return
    timer.clearTimeout(openTimer)
    openTimer = undefined
  }
  const cancelClose = (): void => {
    if (closeTimer === undefined) return
    timer.clearTimeout(closeTimer)
    closeTimer = undefined
  }

  /** 把控件拨到 `want`；触发器不在或已经是 `want` 时返回 false。 */
  const setOpen = (want: boolean): boolean => {
    const node = trigger()
    if (node === null) return false
    if ((node.getAttribute(EXPANDED_ATTRIBUTE) === 'true') === want) return false
    node.click()
    return true
  }

  const enter = (): void => {
    if (disposed) return
    cancelOpen()
    cancelClose()
    if (!expanded()) pinned = false
    if (expanded()) return
    openTimer = timer.setTimeout(() => {
      openTimer = undefined
      setOpen(true)
    }, HOVER_OPEN_DELAY_MS)
  }

  const leave = (): void => {
    if (disposed) return
    cancelOpen()
    if (pinned || closeTimer !== undefined) return
    closeTimer = timer.setTimeout(() => {
      closeTimer = undefined
      setOpen(false)
    }, HOVER_CLOSE_DELAY_MS)
  }

  const click = (event: HoverClickEvent): void => {
    if (disposed) return
    if (event.isTrusted !== true) return
    const node = trigger()
    if (node === null) return
    if (event.target !== node && !node.contains(event.target)) return
    cancelOpen()
    cancelClose()
    // 与上游子代理控件一致：点击只把它钉住，从不折叠。已展开时上游的 onClick 会把它关掉，
    // 因此在捕获阶段拦下这次点击（捕获早于 React 在委派根容器上的冒泡派发，所以这里读到的
    // 仍是点击前的开合值）。
    if (expanded()) event.stopPropagation?.()
    pinned = true
  }

  return {
    get pinned(): boolean {
      return pinned
    },
    enter,
    leave,
    click,
    dispose(): void {
      disposed = true
      cancelOpen()
      cancelClose()
    },
  }
}
