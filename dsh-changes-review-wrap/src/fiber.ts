/**
 * 换行按钮的 React onClick。
 *
 * 上游没有为审查标签页的换行开关暴露 store 句柄或配置项：`wrap` 只存在
 * `@deepseek-ai/dsh-client-ui-deliverables` 私有的 per-session review store 里，唯一的写入口
 * 是换行按钮的 `onClick: () => actions.toggledWrap(tab.id)`。这条闭包里同时握着正确的
 * `actions` 与 `tab.id`，所以直接调用它比先找 store、再自己拼 tab id 更稳：不会写错标签页，
 * 也不经过 React 的合成事件系统——它只是在当前 fiber 上取一个函数调用。
 *
 * 为什么不用 `button.click()`：按钮的 onClick 在 store 的 bucket 还没 seed 出来时会抛
 * `no review state for tab …`（bucket 由 `ReviewTab` 的 `useEffect` 在首帧之后写入）。
 * 合成点击让这个异常穿过 React 的事件派发，会被槽位的 `SlotErrorBoundary` 接住；直接调用
 * 则可以把它收在本插件的 try/catch 里，下一帧再试。
 *
 * fiber 上的 `memoizedProps` 是 React 内部结构（属性名不会被压缩器改写，`__reactFiber$…`
 * 键在开发 / 生产构建里都有），因此这里只做**能力探测**：找不到就返回 null，由调用方降级。
 * 上游没有公开这个结构（cordis 的 `Fiber` 是插件生命周期实例，不是 React fiber），
 * 下面的 `FiberLike` 因此保留为本地测试接缝。
 *
 * @see docs/dsh-changes-review-wrap.md
 */

/** React 挂在 DOM 节点上的内部属性前缀（后缀是随机串）。 */
const FIBER_PREFIX = '__reactFiber$'

/** fiber 对象中本模块用到的字段（React 内部结构，上游无公开类型，测试接缝）。 */
interface FiberLike {
  readonly memoizedProps?: unknown
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
 * @param element - 换行按钮（或任意 React 宿主元素）。
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
