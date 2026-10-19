/**
 * `⌘⌥.`（macOS）/ `Ctrl+Alt+.`（Windows、Linux）折叠当前会话里已展开的工作步骤。
 *
 * 工作步骤在上游有两层开合：外层是轮次过程 `[data-turn-process]`（“已完成，用时 …”
 * 整块）与过程组标题 `[data-process-activity]`（“执行了命令、已读取文件”），内层是
 * 单步详情（工具行 / 思考行 / 命令输出，`[data-disclosure-row]`、`[data-expandable]`）。
 * 一次按键先收所有展开的外层，把整段过程一起收起；没有外层展开项时，才退到内层详情，
 * 覆盖“完全展开”模式与手动展开的详情。
 *
 * 折叠动作与点击这些标题完全一致：合成一次 click，让上游自己的 `useDisclosure()` /
 * 轮次过程 store 收口，本插件不复制状态。上游的标题点击会先 `focus()` 自己，快捷键路径
 * 不需要抢走 composer / 终端里的键盘，所以点击期间临时把目标元素的 `focus()` 置空，
 * 结束后恢复原属性（不是改原型）。
 *
 * 落在 `.xterm` 内的按键到不了固定输入通道（终端在自己的 textarea 处理器里
 * `stopPropagation()`），因此与其它桥一样另装捕获阶段的 window `keydown`，在事件进入
 * 终端前判定并吞掉。两条路径共用同一份准入与目标收集。
 *
 * 上游锚点与已知边界见 docs/dsh-keyboard-shortcuts.md 与
 * docs/dsh-keyboard-shortcuts/03-fixed-input-and-pane-keys.md。
 */
import { captureContext, captureGesture, composedElement, terminalTarget } from './capture.ts'
import { bindingKeycaps, fixedRowOwns } from './binding.ts'
import { isKeydown, name, warn, type KeydownInput } from './runtime.ts'
import type {
  ShortcutContext,
  ShortcutFixedCommand,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutCommandId, ShortcutPlatform } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type { Context } from '@deepseek-ai/cordis'

/** 本桥挂载并跟随的固定行 id。 */
export const COLLAPSE_STEPS_ID: ShortcutCommandId = 'dsh-keyboard-shortcuts.collapse-steps' as ShortcutCommandId

/** `primary+alt+.`（macOS 上即 `⌘⌥.`，Windows/Linux 上即 `Ctrl+Alt+.`）。 */
export const COLLAPSE_STEPS_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'Period',
  modifiers: ['primary', 'alt'],
}

/** 本插件挂载的固定行：占用按键并声明动作；键帽按平台格式化。 */
export function collapseStepsCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: COLLAPSE_STEPS_ID,
    label: () => '折叠中间步骤',
    keys: bindingKeycaps(COLLAPSE_STEPS_BINDING, platform, '.'),
    bindings: [COLLAPSE_STEPS_BINDING],
    group: 'application',
  }
}

/**
 * 这次按键能否执行折叠：不处理长按、输入法组合、已被前面的处理器消费的按键；
 * 模态层打开时让给弹窗。
 */
export function collapseStepsEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && context.modal === null
}

/** 轮次级过程控制：`data-turn-process` 只出现在它的开合按钮上。 */
const TURN_PROCESS_SELECTOR = '[data-turn-process]'

/** 过程组标题：`data-process-activity` 只出现在组标题按钮上。 */
const PROCESS_GROUP_SELECTOR = '[data-process-activity]'

/** 单步详情：思考行 / 工具行用前者，命令输出用后者。 */
const STEP_DETAIL_SELECTORS = ['[data-disclosure-row]', '[data-expandable]'] as const

/**
 * 单步详情必须落在这几类容器里：过程组，或过程组之外的 `tool-call` / `assistant-step` /
 * `turn-process` 流节点（“完全展开”模式没有过程组）。只认 `data-expandable` 会把
 * 系统提示词、上下文注入和提问卡片也误收进来。
 */
const STEP_DETAIL_SCOPE = [
  '[data-step-process]',
  '[data-chat-flow-kind="tool-call"]',
  '[data-chat-flow-kind="assistant-step"]',
  '[data-chat-flow-kind="turn-process"]',
].join(', ')

/** 是否处于展开态。 */
function isExpanded(element: Element): boolean {
  return element.getAttribute('aria-expanded') === 'true'
}

/** 是否被上游标记为不可操作（轮次级过程在运行中 / 无内容时是 disabled）。 */
function isDisabled(element: Element): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return true
  return (element as { disabled?: unknown }).disabled === true
}

/** 收集当前展开的轮次级过程与过程组标题。 */
function openOuterSteps(root: ParentNode): Element[] {
  const found = new Set<Element>()
  for (const element of root.querySelectorAll(TURN_PROCESS_SELECTOR)) {
    if (isExpanded(element) && !isDisabled(element)) found.add(element)
  }
  for (const element of root.querySelectorAll(PROCESS_GROUP_SELECTOR)) {
    if (element.closest('[data-step-process]') === null) continue
    if (isExpanded(element) && !isDisabled(element)) found.add(element)
  }
  return [...found]
}

/** 收集展开的单步详情（过程组内，或“完全展开”模式下直接挂在工具 / 助手步骤下）。 */
function openStepDetails(root: ParentNode): Element[] {
  const found = new Set<Element>()
  for (const selector of STEP_DETAIL_SELECTORS) {
    for (const element of root.querySelectorAll(selector)) {
      if (!isExpanded(element) || isDisabled(element)) continue
      if (element.closest(STEP_DETAIL_SCOPE) === null) continue
      found.add(element)
    }
  }
  return [...found]
}

/**
 * 一次按键要折叠的目标。外层有展开项时只返回外层，避免整段收起的同一按又把
 * 隐藏的单步详情逐个点一遍；外层已经收起后再按，才落到单步详情。
 */
export function collapseStepTargets(root: ParentNode): Element[] {
  const outer = openOuterSteps(root)
  return outer.length > 0 ? outer : openStepDetails(root)
}

/**
 * 当前主会话的滚动口（可多个）。优先取 `main.conversation` 槽位内的那份；槽位标记
 * 缺席时只在全文档恰好有一个滚动口时使用它，避免误折右栏里的会话。
 */
export function conversationRoots(): ParentNode[] {
  if (typeof document === 'undefined') return []
  const scrolls = [...document.querySelectorAll('[data-conversation-scroll]')]
  const scoped = scrolls.filter((element) => element.closest('[data-slot="main.conversation"]') !== null)
  if (scoped.length > 0) return scoped
  return scrolls.length === 1 ? scrolls : []
}

/** 当前主会话里本次要折叠的目标，已按 DOM 去重。 */
export function currentCollapseTargets(): Element[] {
  const seen = new Set<Element>()
  for (const root of conversationRoots()) {
    for (const target of collapseStepTargets(root)) seen.add(target)
  }
  return [...seen]
}

/**
 * 点击一个目标，同时不让上游处理器把键盘抢走。
 *
 * 上游标题的 click 处理器会先 `currentTarget.focus()`；快捷键不是鼠标点击，
 * 焦点应该留在原处。临时把元素自身的 `focus` 覆盖成空函数，点击结束后按原样
 * 恢复：原本没有自有属性的删掉，原本有的写回原值。
 * @returns 目标是否有可调用的 `click()`。
 */
function clickWithoutFocus(element: Element): boolean {
  const clickable = element as Element & {
    click?: () => void
    focus?: (...args: unknown[]) => void
  }
  if (typeof clickable.click !== 'function') return false
  const hadOwnFocus = Object.prototype.hasOwnProperty.call(clickable, 'focus')
  const originalFocus = clickable.focus
  if (typeof originalFocus === 'function') {
    clickable.focus = () => {}
  }
  try {
    clickable.click()
    return true
  } finally {
    if (typeof originalFocus === 'function') {
      if (hadOwnFocus) clickable.focus = originalFocus
      else delete clickable.focus
    }
  }
}

/** 依次点击目标；返回实际尝试折叠的个数。 */
export function collapseSteps(targets: readonly Element[]): number {
  let collapsed = 0
  for (const target of targets) {
    try {
      if (clickWithoutFocus(target)) collapsed += 1
    } catch (error) {
      warn('折叠工作步骤失败：', error)
    }
  }
  return collapsed
}

/** 折叠当前主会话里能折叠的展开项；返回折了几个。 */
export function collapseCurrentConversation(): number {
  return collapseSteps(currentCollapseTargets())
}

/** 固定通道投递的一次 keydown：只有确实有目标可折时才消费。 */
function handleCollapseStepsInput(shortcuts: Shortcuts, input: KeydownInput): void {
  if (!collapseStepsEligible(input.gesture, input.context)) return
  if (!fixedRowOwns(shortcuts.fixedCatalog.getSnapshot(), COLLAPSE_STEPS_ID, input.gesture)) return
  const targets = currentCollapseTargets()
  if (targets.length === 0) return
  // 先消费再动作：避免该按键再被页面内的输入控件处理。
  input.consume()
  collapseSteps(targets)
}

/** 桥接折叠中间步骤键：固定行 + 固定输入 + 终端捕获。 */
export function installCollapseStepsBridge(ctx: Context): void {
  ctx.inject(['shortcuts'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; collapse-steps key not installed')
      return
    }
    // 固定行先挂载，观察者才读得到；两者同在一个 scope，按同序销毁。
    scope.effect(
      () => shortcuts.registerFixed(collapseStepsCommand(shortcuts.platform)),
      `${name}: collapse steps fixed row`,
    )
    scope.effect(
      () => shortcuts.observeFixedInput((input) => {
        if (!isKeydown(input)) return
        handleCollapseStepsInput(shortcuts, input)
      }),
      `${name}: collapse steps key`,
    )
    // 终端那一半：xterm 会截断冒泡，捕获阶段在这里先看到按键。命中且有目标可折时，
    // 阻止事件进入终端，再走同一份收集与点击逻辑。
    scope.effect(() => {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return () => {}
      }
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (!terminalTarget(element)) return
        const gesture = captureGesture(event)
        if (!collapseStepsEligible(gesture, captureContext(element))) return
        if (!fixedRowOwns(shortcuts.fixedCatalog.getSnapshot(), COLLAPSE_STEPS_ID, gesture)) return
        const targets = currentCollapseTargets()
        if (targets.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        collapseSteps(targets)
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: collapse steps terminal capture`)
  })
}
