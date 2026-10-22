/**
 * 浏览器半部的共用运行时：插件名、固定输入里的 keydown 分支与诊断前缀。
 *
 * 折叠中间步骤的桥接与锁定器同属一个插件，固定行注册、按键观察与告警都从这里取名字。
 */
import type {ShortcutFixedInput} from '@deepseek-ai/dsh-client-shortcuts/client'

/** 插件 id：模块表 id、诊断前缀与固定输入标签都用它。 */
export const name = 'dsh-turn-process-open'

/** 注册表发布的固定输入中的一次 keydown。 */
export type KeydownInput = Extract<ShortcutFixedInput, { type: 'keydown' }>

/** 输出一行带插件前缀的诊断信息。 */
export function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

/** 收窄固定输入联合类型，调用处不必各自断言。 */
export function isKeydown(input: ShortcutFixedInput): input is KeydownInput {
  return input.type === 'keydown'
}
