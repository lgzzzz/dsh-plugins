/**
 * 官方命令目标表与固定键匹配。
 *
 * 为什么走固定行而不是可配置绑定：Web/Linux 的官方快捷键校验（`isWebBindingAllowed`）
 * 只放行极少数组合，`Ctrl+Alt+N` 这类组合会被标成 `unsupported-browser`，写不进官方
 * 可配置绑定。固定行（`registerFixed`）不做这层校验，因此这是在不改官方校验规则的前提下
 * 让这些组合可用的唯一公开入口。动作执行仍交给官方命令注册表（`registry.invoke`）。
 *
 * 固定行只「占用」按键；真正的动作由 `src/fixed-keys.ts` 在固定输入 / 终端捕获里调用官方
 * 命令的 `resolve()` / `run()`，本模块不实现任何业务动作。
 */

/** 本插件会触发的官方命令 id。 */
export type OfficialCommandId =
  | 'session.new'
  | 'sidebar.left.toggle'
  | 'workspace.openLocal'
  | 'sidebar.right.toggle'
  | 'workspace.files'
  | 'terminal.new'
  | 'pane.fullscreen.toggle'
  | 'page.close'

/** 逻辑绑定：`primary` 由官方服务按设备展开成 `meta`（macOS）或 `control`。 */
export interface LogicalBinding {
  readonly code: string
  readonly modifiers: readonly ['primary', 'alt']
}

/** 一条目标：官方命令 id 与要占用的逻辑组合。 */
export interface TargetSpec {
  readonly id: OfficialCommandId
  readonly binding: LogicalBinding
}

/** 八条目标绑定；顺序与需求列表一致。 */
export const TARGETS: readonly TargetSpec[] = [
  {
    id: 'session.new',
    binding: { code: 'KeyN', modifiers: ['primary', 'alt'] },
  },
  {
    id: 'sidebar.left.toggle',
    binding: { code: 'KeyB', modifiers: ['primary', 'alt'] },
  },
  {
    id: 'workspace.openLocal',
    binding: { code: 'KeyP', modifiers: ['primary', 'alt'] },
  },
  {
    id: 'sidebar.right.toggle',
    binding: { code: 'KeyO', modifiers: ['primary', 'alt'] },
  },
  {
    id: 'workspace.files',
    binding: { code: 'Backslash', modifiers: ['primary', 'alt'] },
  },
  {
    id: 'terminal.new',
    binding: { code: 'KeyL', modifiers: ['primary', 'alt'] },
  },
  {
    id: 'pane.fullscreen.toggle',
    binding: { code: 'Enter', modifiers: ['primary', 'alt'] },
  },
  {
    id: 'page.close',
    binding: { code: 'Comma', modifiers: ['primary', 'alt'] },
  },
]

/** 接收输入的设备平台；与官方快捷键服务的 `platform` 同值。 */
export type ShortcutPlatform = 'macos' | 'windows' | 'linux'

/** 一次按键的物理事实；浏览器事件与固定输入读数都满足它。 */
export interface Gesture {
  readonly code: string
  readonly secondCode?: string
  readonly control?: boolean
  readonly alt?: boolean
  readonly shift?: boolean
  readonly meta?: boolean
  readonly repeat?: boolean
  readonly composing?: boolean
  readonly defaultPrevented?: boolean
}

/** 固定行 id：与官方命令 id 区分开，避免 `registerFixed` 的重复 id 检查。 */
export function fixedIdOf(target: TargetSpec): string {
  return `dsh-keyboard-shortcuts.${target.id}`
}

/** 固定行声明：逻辑 `primary+alt`，由官方注册表按平台展开。 */
export function bindingOf(target: TargetSpec): LogicalBinding {
  return { code: target.binding.code, modifiers: ['primary', 'alt'] }
}

/** 固定行在给定平台上的键帽标签。 */
export function keycaps(target: TargetSpec, platform: ShortcutPlatform): string[] {
  return platform === 'macos'
    ? ['⌘', '⌥', target.binding.code === 'Enter' ? 'Enter' : keycapOf(target.binding.code)]
    : ['Ctrl', 'Alt', target.binding.code === 'Enter' ? 'Enter' : keycapOf(target.binding.code)]
}

/** 物理码到可读键帽（只覆盖本插件的八个码）。 */
function keycapOf(code: string): string {
  if (code === 'Backslash') return '\\'
  if (code === 'Comma') return ','
  return code.startsWith('Key') ? code.slice(3) : code
}

/**
 * 这次按键是否命中本插件的固定组合。
 *
 * 修饰键必须恰好是 `primary+alt`：macOS 认 `meta+alt`，其它平台认 `control+alt`；
 * 多按或少按 Shift/Meta/Control 都不命中。长按、组字、已消费由调用处另行判断。
 */
export function targetForGesture(
  platform: ShortcutPlatform,
  gesture: Gesture,
): TargetSpec | undefined {
  if (gesture.secondCode !== undefined) return undefined
  if (gesture.alt !== true || gesture.shift === true) return undefined
  if (platform === 'macos') {
    if (gesture.meta !== true || gesture.control === true) return undefined
  } else if (gesture.control !== true || gesture.meta === true) {
    return undefined
  }
  return TARGETS.find((target) => target.binding.code === gesture.code)
}

/** 目标表里的官方命令 id；测试与诊断用。 */
export function targetIds(): OfficialCommandId[] {
  return TARGETS.map((target) => target.id)
}
