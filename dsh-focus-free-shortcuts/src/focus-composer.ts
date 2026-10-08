/**
 * `⌘⌥J`（macOS）/ `Ctrl+Alt+J`（Windows、Linux）把键盘焦点跳回输入框。
 *
 * 固定行声明的是逻辑组合 `primary+alt`：注册表在 macOS 上展开成 `meta+alt`（⌘⌥）、
 * 在 Windows/Linux 上展开成 `control+alt`（Ctrl+Alt），所以同一份声明在两端各是各的键。
 * 本插件自己注册固定行 `dsh-focus-free-shortcuts.focus-composer`（group `input`）；
 * 固定行的存在本身就是占用，按键能否路由由 `fixedRowOwns` 判断。有模态层或主视图
 * Session 不唯一时不动作。动作经 `SessionInputResolver.for(actx)` 取到的 facade 的
 * `focus()` 完成，以恢复上次的选区。
 *
 * 落在 `.xterm` 内的按键到不了 window 上的 fixed-input 监听（终端在自己的 textarea
 * 处理器里 `stopPropagation()`），因此与页面循环 / 会话导航两桥一样另装捕获阶段的
 * window `keydown`，在事件进入终端前判定。这条路径正是为终端准备的，所以放行
 * `terminal` 目标；冒泡通道仍按 `focusComposerEligible` 让位给终端，两条路径互斥。
 *
 * 契约与依赖见 docs/dsh-focus-free-shortcuts/06-boundaries-and-contracts.md。
 */
import {
  captureContext,
  captureGesture,
  composedElement,
  terminalTarget,
} from './capture.ts'
import { bindingKeycaps, fixedRowOwns } from './binding.ts'
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {
  ShortcutContext,
  ShortcutFixedCommand,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ShortcutCommandId, ShortcutPlatform} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {ISessions} from '@deepseek-ai/dsh-api-session-controller/client'
import type {IConversation, SessionInput} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {Context} from '@deepseek-ai/cordis'

/**
 * 这次按键是否可以在无 DOM 焦点时跳到输入框：非 repeat、未在输入法组合中、未被
 * defaultPrevented、无模态层、目标不在终端。`page` 与 `editable` 目标都接受。
 *
 * `terminal` 让位只对冒泡通道成立 —— 终端内的按键根本到不了那条通道，由下面
 * {@link focusComposerTerminalEligible} 的捕获路径接管。
 */
export function focusComposerEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return focusComposerTerminalEligible(gesture, context)
    && !gesture.defaultPrevented
    && context.region !== 'terminal'
}

/**
 * 捕获路径的准入：这次按键能否在终端内被本桥接管。
 *
 * 与 {@link focusComposerEligible} 的差别只有两条：终端目标在此**放行**（这条路径存在的
 * 理由就是终端内那一按），且不读 `defaultPrevented`（捕获阶段尚无处理器运行，恒为 false）。
 */
export function focusComposerTerminalEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && context.modal === null
}

/** 本桥接跟随的聚焦输入框固定行 id。 */
export const FOCUS_COMPOSER_ID: ShortcutCommandId = 'dsh-focus-free-shortcuts.focus-composer' as ShortcutCommandId

/** 固定行占用的逻辑物理组合：`primary+alt+J`（macOS 上即 `⌘⌥J`，Windows 上即 `Ctrl+Alt+J`）。 */
export const FOCUS_COMPOSER_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'KeyJ',
  modifiers: ['primary', 'alt'],
}

/** 本插件挂载的固定行：占用按键并声明动作名称与分组；键帽按平台格式化。 */
export function focusComposerCommand(platform: ShortcutPlatform): ShortcutFixedCommand {
  return {
    id: FOCUS_COMPOSER_ID,
    label: () => '聚焦输入框',
    keys: bindingKeycaps(FOCUS_COMPOSER_BINDING, platform, 'J'),
    bindings: [FOCUS_COMPOSER_BINDING],
    group: 'input',
  }
}

/** 注册聚焦输入框按键：挂载固定行并监听固定按键输入；缺少 `observeFixedInput` 时告警并退出。 */
export function installFocusComposerBridge(ctx: Context): void {
  ctx.inject(['shortcuts', 'sessions'], (scope) => {
    const shortcuts: Shortcuts = scope.shortcuts
    const sessions: ISessions = scope.sessions
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; focus-composer key not installed')
      return
    }
    // 固定行要先挂载，观察者才读得到；两者同属一个 scope，按同样顺序销毁。
    scope.effect(() => shortcuts.registerFixed(focusComposerCommand(shortcuts.platform)), `${name}: focus composer fixed row`)
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handleFocusComposerInput(shortcuts, sessions, input)
    }), `${name}: focus composer key`)
    // 终端那一半：落在 `.xterm` 内的 keydown 到不了上面的 window 监听（终端在自己的
    // textarea 处理器里停掉了它），本捕获监听早一个阶段看到它，并复用同一份判定把键盘
    // 交还输入框 —— 这正是"焦点在终端里按 ⌘⌥J / Ctrl+Alt+J"要成立的那条路。
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (!terminalTarget(element)) return
        const gesture = captureGesture(event)
        if (!focusComposerTerminalEligible(gesture, captureContext(element))) return
        const facade = focusComposerTarget(shortcuts, sessions, gesture)
        if (facade === undefined) return
        // 在终端自身处理器之前拦截：事件到此为止，xterm 既收不到该按键，也不会把它
        // 当成终端输入送进 shell。
        event.preventDefault()
        event.stopPropagation()
        facade.focus()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: focus composer terminal capture`)
  })
}

/**
 * 处理固定通道投递的一次 keydown；只有解析出输入面 facade 时才消费按键。
 */
function handleFocusComposerInput(shortcuts: Shortcuts, sessions: ISessions, input: KeydownInput): void {
  if (!focusComposerEligible(input.gesture, input.context)) return
  const facade = focusComposerTarget(shortcuts, sessions, input.gesture)
  if (facade === undefined) return
  // 先消费再动作：该按键归聚焦输入框专用，避免同时向文本字段输入字符。
  input.consume()
  facade.focus()
}

/**
 * 一次按键要聚焦的输入面 facade；任何条件不成立时返回 undefined。
 *
 * 两条投递路径（观察者与终端前的捕获拦截）共用本判定：固定行仍占用这一按、主视图
 * Session 唯一且输入框 facade 可达。准入（模态 / 长按 / 组字 / 区域）由各自的调用处判。
 */
export function focusComposerTarget(
  shortcuts: Shortcuts,
  sessions: ISessions,
  gesture: ShortcutGesture,
): SessionInput | undefined {
  if (!fixedRowOwns(shortcuts.fixedCatalog.getSnapshot(), FOCUS_COMPOSER_ID, gesture)) return undefined
  const sessionId: SessionId | undefined = mainViewSessionId(sessions.list.getSnapshot())
  if (sessionId === undefined) return undefined
  const scoped = sessions.scope(sessionId)
  if (scoped === undefined) return undefined
  const conversation: IConversation | undefined = scoped.get('conversation')
  const resolver = conversation?.input
  if (resolver === undefined || typeof resolver.for !== 'function') {
    warn('conversation input registry unavailable; composer focus not sent')
    return undefined
  }
  // scope 不是保留的 Session scope（会话正在切换）时 `for()` 会抛错，此时不聚焦。
  try {
    return resolver.for(scoped)
  } catch (error) {
    warn('composer focus target unavailable:', error)
    return undefined
  }
}