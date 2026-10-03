/**
 * 快捷键分组 4：`Ctrl+Alt+J` 把键盘焦点跳回输入框。
 *
 * 本插件自己注册固定行 `dsh-focus-free-shortcuts.focus-composer`（group `input`），
 * 固定行的存在本身就是占用。按键能否路由由 `fixedRowOwns` 判断；有模态层、目标在
 * 终端或主视图 Session 不唯一时不做动作。动作经 `SessionInputResolver.for(actx)`
 * 取到的 facade 的 `focus()` 完成，以恢复上次的选区。
 */
import { fixedRowOwns } from './binding.ts'
import { isKeydown, mainViewSessionId, name, warn, type KeydownInput, type SessionId } from './runtime.ts'
import type {
  ShortcutContext,
  ShortcutFixedCommand,
  ShortcutGesture,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {ShortcutCommandId} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {ISessions} from '@deepseek-ai/dsh-api-session-controller/client'
import type {IConversation, SessionInput} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {Context} from '@deepseek-ai/cordis'

/**
 * 这次按键是否可以在无 DOM 焦点时跳到输入框：非 repeat、未在输入法组合中、未被
 * defaultPrevented、无模态层、目标不在终端。`page` 与 `editable` 目标都接受。
 */
export function focusComposerEligible(gesture: ShortcutGesture, context: ShortcutContext): boolean {
  return !gesture.repeat
    && !gesture.composing
    && !gesture.defaultPrevented
    && context.modal === null
    && context.region !== 'terminal'
}

/** 本桥接跟随的聚焦输入框固定行 id。 */
export const FOCUS_COMPOSER_ID: ShortcutCommandId = 'dsh-focus-free-shortcuts.focus-composer' as ShortcutCommandId

/** 固定行占用的唯一物理组合：`Ctrl+Alt+J`。 */
export const FOCUS_COMPOSER_BINDING: ShortcutFixedCommand['bindings'][number] = {
  code: 'KeyJ',
  modifiers: ['control', 'alt'],
}

/** 本插件挂载的固定行：占用按键并声明动作名称与分组。 */
export const FOCUS_COMPOSER_COMMAND: ShortcutFixedCommand = {
  id: FOCUS_COMPOSER_ID,
  label: () => '聚焦输入框',
  keys: ['Ctrl', 'Alt', 'J'],
  bindings: [FOCUS_COMPOSER_BINDING],
  group: 'input',
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
    scope.effect(() => shortcuts.registerFixed(FOCUS_COMPOSER_COMMAND), `${name}: focus composer fixed row`)
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return
      handleFocusComposerInput(shortcuts, sessions, input)
    }), `${name}: focus composer key`)
  })
}

/**
 * 处理一次针对聚焦输入框固定行的 keydown：先确认按键合格、固定行仍占用它、主视图
 * Session 唯一且输入框 facade 可达，全部成立后才消费按键并执行 `focus()`。
 */
function handleFocusComposerInput(shortcuts: Shortcuts, sessions: ISessions, input: KeydownInput): void {
  const gesture: ShortcutGesture = input.gesture
  const context = input.context
  if (!focusComposerEligible(gesture, context)) return
  const rows = shortcuts.fixedCatalog.getSnapshot()
  if (!fixedRowOwns(rows, FOCUS_COMPOSER_ID, gesture)) return
  const sessionId: SessionId | undefined = mainViewSessionId(sessions.list.getSnapshot())
  if (sessionId === undefined) return
  const scoped = sessions.scope(sessionId)
  if (scoped === undefined) return
  const conversation: IConversation | undefined = scoped.get('conversation')
  const resolver = conversation?.input
  if (resolver === undefined || typeof resolver.for !== 'function') {
    warn('conversation input registry unavailable; composer focus not sent')
    return
  }
  // scope 不是保留的 Session scope（会话正在切换）时 `for()` 会抛错，此时不聚焦。
  let facade: SessionInput
  try {
    facade = resolver.for(scoped)
  } catch (error) {
    warn('composer focus target unavailable:', error)
    return
  }
  // 先消费再动作：该按键归聚焦输入框专用，避免同时向文本字段输入字符。
  input.consume()
  facade.focus()
}