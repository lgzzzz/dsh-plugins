/**
 * 从 DOM 元素沿 React fiber 父链读取上游 Chat 渲染器的开合状态与写入口。
 *
 * 上游没有为「不折叠整轮、但保留过程组」暴露配置或 store 句柄：`createChatStore()` 的
 * 结果只在 `@deepseek-ai/dsh-client-ui-chat` 的 apply 作用域里，插件拿不到；唯一能改
 * `turnProcessOpen()` 判定的是 per-session Chat store 里的 `{ turn, answerStep, collapsed }`
 * 记录。这个记录只有 `actions.setTurnProcessOpen(turn, answerStep, open)` 能写。
 *
 * 两条真实可用的路径（都在 0.2.1-rc.2 的 GUI 上验证过）：
 *
 * 1. 标题按钮的祖先 `TurnProcessNodeView` 的 props 里有 `turnProcess`：
 *    `{ spec, foldable, hasContent, open, setOpen }`。`setOpen(true)` 与点击标题等价，
 *    但它在 `alwaysOpen` 时是 no-op（运行中的轮次不会写记录）。
 * 2. 更上层的 `ChatNodeSeat` / `ChatFlow` 的 props 里有 `actions`，也就是
 *    `conversation.chat.flow` 槽位的 store handle 暴露的绑定动作：
 *    `setTurnProcessOpen(turn, answerStep, open)`。它绕过 `alwaysOpen`，运行中也能预写。
 *
 * 两者都不是公开 API。fiber 上的 `memoizedProps` / `return` 是 React 的内部结构（属性名
 * 不会被压缩器改写，`__reactFiber$…` 键在开发/生产构建里都有），因此这里只做**能力探测**：
 * 找不到就返回 null，由调用方降级；不抛错、不缓存跨元素的结果。
 *
 * @see docs/dsh-turn-process-open.md
 */

/** React 挂在 DOM 节点上的内部属性前缀（后缀是随机串）。 */
const FIBER_PREFIX = '__reactFiber$'

/** 父链最多走多深；正常标题到 ChatFlow 只有十几层，超过它一定是结构变了。 */
const MAX_DEPTH = 64

/** 一个 Turn process owner 的可用字段（上游 `TurnProcessOwnerProps` 的子集）。 */
export interface TurnProcessHandle {
  /** 轮次序号。 */
  readonly turn: number
  /** 当前回答代次；缺失按 0 处理，与上游 `spec.answerStep ?? 0` 一致。 */
  readonly answerStep: number
  /** 上游的 `setOpen(open)`；`alwaysOpen` 时是 no-op。 */
  readonly setOpen: ((open: boolean) => void) | undefined
}

/** store handle 暴露的绑定动作：`(turn, answerStep, open)`。 */
export type SetTurnProcessOpen = (turn: number, answerStep: number, open: boolean) => void

/** fiber 对象中本模块用到的字段。 */
interface FiberLike {
  readonly return?: FiberLike | null
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
 * 沿父链找第一份满足 `read` 的 props。
 * @param element - DOM 元素。
 * @param read - 从一份 props 取候选值；返回 null 表示不是目标。
 * @returns 候选值，或 null。
 */
function walkProps<T>(element: unknown, read: (props: Record<string, unknown>) => T | null): T | null {
  let fiber = fiberOf(element)
  for (let depth = 0; fiber !== null && depth < MAX_DEPTH; depth += 1) {
    const props = fiber.memoizedProps
    if (isRecord(props)) {
      const found = read(props)
      if (found !== null) return found
    }
    fiber = isRecord(fiber.return) ? (fiber.return as FiberLike) : null
  }
  return null
}

/** 从 `turnProcess` prop 读出 handle；形状不对时返回 null。 */
function readHandle(value: unknown): TurnProcessHandle | null {
  if (!isRecord(value)) return null
  const spec = value.spec
  if (!isRecord(spec)) return null
  const turn = spec.turn
  if (typeof turn !== 'number' || !Number.isFinite(turn)) return null
  const answerStep = typeof spec.answerStep === 'number' && Number.isFinite(spec.answerStep) ? spec.answerStep : 0
  const setOpen = typeof value.setOpen === 'function' ? (value.setOpen as (open: boolean) => void) : undefined
  return { turn, answerStep, setOpen }
}

/**
 * 找标题按钮所属轮次的 `turnProcess` handle。
 * @param element - `[data-turn-process]` 标题按钮（或它的任意后代）。
 * @returns handle，或 null。
 */
export function findTurnProcess(element: unknown): TurnProcessHandle | null {
  return walkProps(element, (props) => readHandle(props.turnProcess))
}

/**
 * 找 store handle 暴露的绑定动作 `setTurnProcessOpen`。
 *
 * 上游把它挂在 `ChatNodeSeat` / `ChatFlow` 的 props.actions 上；最近的祖先即可，
 * 同一份 store 的 action（不会串会话）。
 * @param element - `[data-turn-process]` 标题按钮（或它的任意后代）。
 * @returns 可调用的绑定动作，或 null。
 */
export function findTurnProcessActions(element: unknown): SetTurnProcessOpen | null {
  return walkProps(element, (props) => {
    const actions = props.actions
    if (!isRecord(actions)) return null
    const action = actions.setTurnProcessOpen
    if (typeof action !== 'function') return null
    return ((turn: number, answerStep: number, open: boolean) => {
      ;(action as (a: number, b: number, c: boolean) => void).call(actions, turn, answerStep, open)
    }) satisfies SetTurnProcessOpen
  })
}
