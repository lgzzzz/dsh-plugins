/**
 * 从 React fiber 上取按钮的 `onClick` 与函数组件的宽度 state setter。
 *
 * 上游没有为审查标签页的分栏 / 换行开关暴露 store 句柄或配置项：`split` 与 `wrap` 只存在
 * `@deepseek-ai/dsh-client-ui-deliverables` 私有的 per-session review store 里，唯一的写入口
 * 是工具栏按钮的 `onClick`（`actions.toggledSplit(tab.id)` / `actions.toggledWrap(tab.id)`）。
 * 这条闭包里同时握着正确的 `actions` 与 `tab.id`，所以直接调用它比先找 store、再自己拼
 * tab id 更稳：不会写错标签页，也不经过 React 的合成事件系统——它只是在当前 fiber 上取一个
 * 函数调用。
 *
 * 文件树宽度同理：上游只把宽度放在 `FileTreePane` 的 `useState` 里，没有 store 或持久化
 * 入口。取到同一个 state 的 dispatch 后调用它，效果等于用户拖动分隔条，`onWidth` /
 * 工具栏 `--forge-tree-width` 都照常走。
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

/** fiber 对象中本模块用到的字段（React 内部结构，上游无公开类型，测试接缝）。 */
interface FiberLike {
  readonly tag?: number
  readonly memoizedProps?: unknown
  readonly memoizedState?: unknown
  readonly return?: FiberLike | null
}

/** 函数组件 fiber 的 `tag`；宿主元素是 5，`memo` 包装是 14。 */
const FUNCTION_COMPONENT = 0

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

/** 最近函数组件 fiber 上第一个数字 state 的 setter。 */
function firstNumberStateSetter(fiber: FiberLike): ((value: number) => void) | null {
  let hook = fiber.memoizedState
  for (let count = 0; isRecord(hook) && count < 64; count += 1) {
    const state = hook.memoizedState
    const queue = hook.queue
    if (typeof state === 'number' && isRecord(queue) && typeof queue.dispatch === 'function') {
      return queue.dispatch as (value: number) => void
    }
    hook = hook.next
  }
  return null
}

/**
 * 取 `FileTreePane` 宽度 state 的 setter。
 *
 * `FileTreePane` 的 `const [width, setWidth] = useState(240)` 是它的前两个 `useRef` 之后的
 * 第一个数字 state；调用这个 setter 等于把宽度写回组件，后续 `onWidth` 与工具栏
 * `--forge-tree-width` 都会照常更新。宿主 fiber（分隔条本身、外层 div）与函数组件 fiber 的
 * `memoizedState` 都可能是对象，所以先按 `tag` 找到最近的函数组件，再沿 hook 链表找第一个
 * `memoizedState` 为数字且带 `queue.dispatch` 的 hook。
 *
 * 只认最近的函数组件，并且用该组件的 props 再确认一次身份：`onWidth` 是函数、
 * `position` 是上游的三种取值之一。继续向上找会碰到 `ChangesTab` 自己的数字 state
 * （`treeWidth` 等），写错 state 只会更新工具栏列宽而不改文件树。找不到时返回 null，由调用方降级。
 *
 * @param element - 分隔条（或函数组件渲染出的任意宿主元素）。
 * @returns 可调用的 setter，或 null。
 */
export function findFileTreeWidthSetter(element: unknown): ((value: number) => void) | null {
  let fiber = fiberOf(element)
  while (fiber !== null && fiber.tag !== FUNCTION_COMPONENT) fiber = fiber.return ?? null
  if (fiber === null) return null
  const props = fiber.memoizedProps
  if (!isRecord(props) || typeof props.onWidth !== 'function') return null
  const position = props.position
  if (position !== 'left' && position !== 'right' && position !== 'hidden') return null
  return firstNumberStateSetter(fiber)
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
