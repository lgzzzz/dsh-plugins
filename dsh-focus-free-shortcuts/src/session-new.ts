/**
 * 内置命令 `session.new`（新建会话）的终端那一半。
 *
 * `session.new` 是 Workspace browser 贡献的**可配置命令**，Web 上的默认键位是
 * `primary+alt+N`（macOS `⌘⌥N`、Windows/Linux `Ctrl+Alt+N`；桌面端仍是 `primary+N`），
 * 归属区域只有 `page` 与 `editable`。它平时走 DOM 通道就够了，焦点在终端里却不行：
 * 终端在自己的 textarea 处理器里对经手的按键 `preventDefault()+stopPropagation()`，
 * 事件到不了 window 上的键盘适配器，这一按既不新建会话、也不报错。
 *
 * 本桥补的就是这一格：在 window **捕获阶段**另挂一个 `keydown` 监听，只对会落进
 * `.xterm` 的按键拦下，命中即吞掉并调用 `uiWorkspace.startSession()` —— 与内置
 * `run()` 是同一个动词（不带参数 = 沿用当前 / 最近的工作区），既不新建一套语义，也不
 * 抢占页面 / 文本控件里的那一按（那两处仍由内置命令自己处理）。
 *
 * 键位不硬编码：本桥读 **生效目录**里 `session.new` 的当前绑定，所以用户改绑 / 解绑 /
 * 冲突时立刻跟随（与 `page-close.ts` 跟随 `page.close` 同一条约定）。本桥不注册固定行、
 * 也不开固定输入观察者 —— 它只在终端这条内置命令够不着的缝上补一刀。
 *
 * 契约与依赖见 docs/dsh-focus-free-shortcuts/06-boundaries-and-contracts.md。
 */
import {
  captureContext,
  captureGesture,
  composedElement,
  terminalTarget,
} from './capture.ts'
import { bindingMatches, enabledBinding } from './binding.ts'
import { name, warn } from './runtime.ts'
import type {
  ShortcutCatalogEntry,
  ShortcutContext,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ShortcutCommandId} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {Context} from '@deepseek-ai/cordis'

/** 本桥跟随的内置"新建会话"命令 id。 */
export const SESSION_NEW_ID: ShortcutCommandId = 'session.new' as ShortcutCommandId

/**
 * 会话创建面：上游 `UiWorkspace` 的公开面里本桥唯一要用的动词。
 *
 * 该服务由 Workspace browser 所在的上游客户端包提供。本插件不为它多拉一个类型依赖，
 * 只按这份结构读取 `scope.get('uiWorkspace')`；该服务由注入列表声明，因此读取时它必然
 * 已经激活 —— 形状不符（上游改了方法名）时才告警一次并整体不安装。
 */
export interface SessionCreator {
  /**
   * 走一次"新建会话"流程并导航到那个会话（不带参数 = 沿用当前 / 最近的工作区），
   * 与内置 `session.new` 的 `run()` 是同一个操作。
   * @param workspaceId - 显式目标工作区；省略即沿用当前 / 最近的工作区。
   */
  startSession(workspaceId?: string): void
}

/**
 * 捕获路径的准入：这次按键能否在终端内被本桥接管。
 *
 * 非长按重复、未在输入法组合中、无模态层。区域不参与判定 —— 调用处已经确认目标落在
 * `.xterm` 内，那正是本桥存在的理由；`defaultPrevented` 也不读，捕获阶段尚无处理器运行。
 */
export function sessionNewEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && context.modal === null
}

/**
 * 这一按是否恰好命中 `session.new` 当前生效的键位。
 *
 * 行不在目录里、被解绑、有 issue 或存在冲突时 `enabledBinding` 返回 undefined，本桥
 * 随即让位（与页面关闭桥跟随 `page.close` 的规矩一致）。
 */
export function sessionNewPress(
  rows: readonly ShortcutCatalogEntry[],
  gesture: ShortcutGesture,
): boolean {
  const binding = enabledBinding(rows, SESSION_NEW_ID)
  return binding !== undefined && bindingMatches(binding, gesture)
}

/**
 * 桥接内置 `session.new` 的终端那一半。
 *
 * 只装捕获阶段的 window `keydown`：页面 / 文本控件里的这一按仍由内置命令自己处理，
 * 本桥不注册固定行、不消费 DOM 通道上的任何按键，所以两条路互不重叠、一次按键最多
 * 只新建一个会话。
 */
export function installSessionNewBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'uiWorkspace'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    // 会话创建面由 Workspace browser 提供；没有它就没有可执行的动作。
    const workspace: SessionCreator | undefined = scope.get('uiWorkspace')
    if (workspace === undefined || typeof workspace.startSession !== 'function') {
      warn('uiWorkspace service unavailable; session.new key not bridged into the terminal')
      return
    }
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (!terminalTarget(element)) return
        const gesture = captureGesture(event)
        if (!sessionNewEligible(gesture, captureContext(element))) return
        if (!sessionNewPress(shortcuts.catalog.getSnapshot(), gesture)) return
        // 在终端自身处理器之前拦截：事件到此为止，xterm 既收不到这一按，也不会把它
        // 当成终端输入送进 shell。
        event.preventDefault()
        event.stopPropagation()
        workspace.startSession()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: session new terminal capture`)
  })
}
