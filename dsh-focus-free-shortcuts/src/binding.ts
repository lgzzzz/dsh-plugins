/** 手势与绑定匹配：纯函数、不碰 DOM，两个快捷键目录都用这里的规则判断按键归属。 */
import type {
  ShortcutCatalogEntry,
  ShortcutFixedCatalogEntry,
  ShortcutGesture,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {NormalizedBinding} from '@deepseek-ai/dsh-client-shortcuts/protocol'

/** 一个规范化修饰键名，取值同注册表发布的名字。 */
export type ModifierName = NormalizedBinding['modifiers'][number]

/** 修饰键规范顺序，同时也是键帽顺序（`normalizeBinding`）。 */
export const MODIFIER_ORDER = ['control', 'alt', 'shift', 'meta'] as const satisfies readonly ModifierName[]

/** 一次手势实际按下的修饰键，按 `MODIFIER_ORDER` 排序返回。 */
export function modifiersOf(gesture: ShortcutGesture): ModifierName[] {
  return MODIFIER_ORDER.filter((name) => gesture[name])
}

/** 判断一次手势是否恰好等于该绑定；双键组合一律不匹配，修饰键按无序集合比较。 */
export function bindingMatches(binding: NormalizedBinding, gesture: ShortcutGesture): boolean {
  if (binding.code !== gesture.code) return false
  if (binding.secondCode !== undefined || gesture.secondCode !== undefined) return false
  const held = modifiersOf(gesture)
  if (binding.modifiers.length !== held.length) return false
  return binding.modifiers.every((name) => held.includes(name))
}

/** 命令当前占用的绑定；行不存在、binding 为 null、有 issue 或存在冲突时返回 undefined。 */
export function enabledBinding(
  rows: readonly ShortcutCatalogEntry[],
  id: string,
): NormalizedBinding | undefined {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return undefined
  if (row.binding === null || row.issue !== null || row.conflicts.length > 0) return undefined
  return row.binding
}

/** 已挂载的固定行是否占用了这次按键：在行的 `bindings` 里逐个匹配，行不存在则返回 false。 */
export function fixedRowOwns(
  rows: readonly ShortcutFixedCatalogEntry[],
  id: string,
  gesture: ShortcutGesture,
): boolean {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) return false
  return row.bindings.some((binding) => bindingMatches(binding, gesture))
}
