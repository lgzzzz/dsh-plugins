/**
 * 从 React fiber 上取按钮的 `onClick`，或向上找某个组件那一份 props。
 *
 * 上游没有为审查标签页的分栏 / 换行开关暴露 store 句柄或配置项：`split` 与 `wrap` 只存在
 * `@deepseek-ai/dsh-client-ui-deliverables` 私有的 per-session review store 里，唯一的写入口
 * 是工具栏按钮的 `onClick`（`actions.toggledSplit(tab.id)` / `actions.toggledWrap(tab.id)`）。
 * 这条闭包里同时握着正确的 `actions` 与 `tab.id`，所以直接调用它比先找 store、再自己拼
 * tab id 更稳：不会写错标签页，也不经过 React 的合成事件系统——它只是在当前 fiber 上取一个
 * 函数调用。
 *
 * 评论框同理：行内评论（`ReviewComposer`）只有 props 上的 `close` / `actions.addToInput` /
 * `t` 这几个句柄，DOM 上没有别的出口，所以用 `findAncestorProps` 从 section 向上认组件那一份
 * props（宿主 fiber 的 props 是 DOM 属性，真正的那份在上一层组件 fiber 上）。
 *
 * 为什么不用 `button.click()`：按钮的 onClick 在 store 的 bucket 还没 seed 出来时会抛
 * `no review state for tab …`（bucket 由 `ReviewTab` 的 `useEffect` 在首帧之后写入）。
 * 合成点击让这个异常穿过 React 的事件派发，会被槽位的 `SlotErrorBoundary` 接住；直接调用
 * 则可以把它收在调用方的 try/catch 里，下一帧再试。
 *
 * fiber 上的 `memoizedProps` 是 React 内部结构（属性名不会被压缩器改写，`__reactFiber$…`
 * 键在开发 / 生产构建里都有），因此这里只做**能力探测**：找不到就返回 null，由调用方降级。
 * 上游没有公开这个结构（cordis 的 `Fiber` 是插件生命周期实例，不是 React fiber），
 * 下面的 `FiberLike` 因此保留为本地测试接缝。
 *
 * @see docs/dsh-changes-behavior.md
 */

/** React 挂在 DOM 节点上的内部属性前缀（后缀是随机串）。 */
const FIBER_PREFIX = '__reactFiber$'

/** 从宿主元素向上最多看几层 fiber 找组件 props；评论框的 section 到 `ReviewComposer` 只隔一层。 */
export const MAX_ANCESTOR_DEPTH = 16

/** fiber 对象中本模块用到的字段（React 内部结构，上游无公开类型，测试接缝）。 */
interface FiberLike {
  readonly memoizedProps?: unknown
  /** 父 fiber；宿主元素的直接上一层就是渲染它的组件 fiber。 */
  readonly return?: unknown
}

/** 一个可被 `Object.keys` 读取的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 读取元素上的 fiber；没有（非 React 节点 / 假 DOM）时返回 null。 */
function fiberOf(element: unknown): FiberLike | null {
  if (!isRecord(element)) return null
  for (const key of Object.keys(element)) {
    if (!key.startsWith(FIBER_PREFIX)) continue
    const fiber = element[key]
    if (isRecord(fiber)) return fiber as FiberLike
  }
  return null
}

/**
 * 取一个 React 宿主元素上的 `onClick`。
 * @param element - 工具栏按钮（或任意 React 宿主元素）。
 * @returns 可调用的 handler，或 null（不是 React 节点 / 没有 onClick）。
 */
export function findClickHandler(element: unknown): (() => void) | null {
  const fiber = fiberOf(element)
  if (fiber === null) return null
  const props = fiber.memoizedProps
  if (!isRecord(props)) return null
  const handler = props.onClick
  return typeof handler === 'function' ? (handler as () => void) : null
}

/**
 * 从宿主元素向上找第一个满足条件的组件 props。
 *
 * 先看元素自己的 fiber（宿主 fiber 的 props 就是 DOM 属性），再沿 `return` 上溯；评论框的
 * section 是 `ReviewComposer` 直接返回的根节点，所以第二层就是它。
 *
 * @param element - 组件子树里的 React 宿主元素。
 * @param matches - 判定一份 props 是不是目标组件的那份。
 * @param limit - 最多上溯的层数；超出即返回 null，不在 React 没把握的结构上继续摸。
 * @returns 命中的 props 对象，或 null（不是 React 节点 / 上溯超限 / 没有命中）。
 */
export function findAncestorProps(
  element: unknown,
  matches: (props: Record<string, unknown>) => boolean,
  limit: number = MAX_ANCESTOR_DEPTH,
): Record<string, unknown> | null {
  let fiber = fiberOf(element)
  for (let depth = 0; fiber !== null && depth < limit; depth += 1) {
    const props = fiber.memoizedProps
    if (isRecord(props) && matches(props)) return props
    fiber = isRecord(fiber.return) ? (fiber.return as FiberLike) : null
  }
  return null
}
