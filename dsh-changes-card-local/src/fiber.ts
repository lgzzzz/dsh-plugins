/**
 * 读改动文件卡片按钮上由 React 绑定的 `onClick`。
 *
 * 右键菜单要把「打开本轮快照 diff」交还给上游：那条动作的坐标（会话、事件序号、轮次、文件下标）
 * 只存在于 `ChangedFiles` 的闭包里，DOM 上没有可重建的读数（卡片根只有 `data-changed-files`，
 * 标题与文件行都不带序号）。按钮的 `memoizedProps.onClick` 正是 `() => { openReview(index) }`，
 * 直接调用它比先找 store、再自己拼地址更稳：不会拼错坐标，也不经过 React 的合成事件系统。
 *
 * 与 `dsh-changes-review-wrap` 的 `fiber.ts` 同一手法：fiber 上的属性名不会被压缩器改写，
 * `__reactFiber$…` 键在开发 / 生产构建里都有，因此这里只做**能力探测**——找不到就返回 null，
 * 由调用方降级（不弹菜单，保留浏览器原生右键菜单）。
 *
 * @see docs/dsh-changes-card-local.md
 */

/** React 挂在 DOM 节点上的内部属性前缀（后缀是随机串）。 */
const FIBER_PREFIX = '__reactFiber$'

/** fiber 对象中本模块用到的字段。 */
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
 * @param element - 改动文件卡片的标题 / 文件行按钮。
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
