/**
 * 固定行的键帽与归属判定：纯函数、不碰 DOM。
 *
 * 折叠键与本仓库其它自挂固定键走同一套规则：固定行声明逻辑 `primary`，注册表按平台
 * 落成 macOS 的 `meta` 或其它平台的 `control`；按键命中时只有固定行确实占着这一按
 * 才由本插件处理。
 */
import type {
  ShortcutFixedCatalogEntry,
  ShortcutGesture,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {NormalizedBinding, ShortcutModifier, ShortcutPlatform} from '@deepseek-ai/dsh-client-shortcuts/protocol'

/** 一个规范化修饰键名，取值同注册表发布的名字。 */
export type ModifierName = NormalizedBinding['modifiers'][number]

/** 修饰键规范顺序，同时也是键帽顺序（`normalizeBinding`）。 */
export const MODIFIER_ORDER = ['control', 'alt', 'shift', 'meta'] as const satisfies readonly ModifierName[]

/** 物理修饰键在各平台上的键帽符号；与官方 `presentBinding` 同一套。 */
const MODIFIER_KEYCAPS: Record<ModifierName, Record<ShortcutPlatform, string>> = {
  control: { macos: '⌃', windows: 'Ctrl', linux: 'Ctrl' },
  alt: { macos: '⌥', windows: 'Alt', linux: 'Alt' },
  shift: { macos: '⇧', windows: 'Shift', linux: 'Shift' },
  meta: { macos: '⌘', windows: 'Meta', linux: 'Meta' },
}

/** 逻辑主修饰键 `primary` 在给定平台上展开成的物理修饰键。 */
export function primaryModifier(platform: ShortcutPlatform): 'meta' | 'control' {
  return platform === 'macos' ? 'meta' : 'control'
}

/**
 * 固定行显示的键帽：把声明里的逻辑修饰键按平台展开，再接上调用处给的键名。
 * @param binding - 固定行声明的物理组合（修饰键可含逻辑 `primary`）。
 * @param platform - 接收输入的设备平台。
 * @param keycap - 非修饰键部分的显示名，如 `.`。
 * @returns 该平台上按声明顺序排列的键帽。
 */
export function bindingKeycaps(
  binding: { readonly modifiers: readonly ShortcutModifier[] },
  platform: ShortcutPlatform,
  keycap: string,
): string[] {
  return [
    ...binding.modifiers.map((modifier) => MODIFIER_KEYCAPS[
      modifier === 'primary' ? primaryModifier(platform) : modifier
    ][platform]),
    keycap,
  ]
}

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
