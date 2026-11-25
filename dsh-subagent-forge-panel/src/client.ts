/**
 * 浏览器半部：在「环境」分栏里挂一个守卫，让子智能体会话的 Git 与变更请求行直接不显示。
 *
 * 两个前置服务缺一不可：`slots`（行槽，守卫借它拿到会话作用域与一个挂载点）、
 * `forgeChanges`（forge 面板的公开面）。后者是「forge 是否装着」的开关：forge 不在时面板
 * 根本不存在，守卫没有可隐藏的东西，也就不注册；forge 被卸下时注册项随作用域一起收回。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):加载 cordis 对 `slots` 的服务声明,以及
// session-panel 对行槽的 SlotMap 声明;全部是类型层,不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { ForgePanelGuard } from './guard.tsx'
import { ROW_SLOT, rowRegisterOptions } from './registration.ts'
import { ensureStyles } from './styles.ts'

export const name = 'dsh-subagent-forge-panel'

/** 需要的客户端服务：行槽，以及 forge 面板的公开面（判定 forge 是否装着）。 */
export const inject = ['slots', 'forgeChanges']

/**
 * 挂样式与守卫。
 *
 * @param ctx - 浏览器半部的 Client Context。
 */
export function apply(ctx: Context): void {
  if (typeof document !== 'undefined') ensureStyles(document)
  ctx.slots.inject(ROW_SLOT, () => ctx.slots.register(rowRegisterOptions(), ForgePanelGuard))
}
