/**
 * 浏览器半部：在会话面板里注册「主智能体」一栏。
 *
 * 面板的分区槽由 `@deepseek-ai/dsh-client-ui-session-panel` 声明，可能在页面加载后
 * 才就位；`ctx.slots.inject` 负责等它，声明撤下时注册项随之收回。
 * 「切到某个会话」走 `ctx.uiWorkspace.openSession(sessionId)`：与点「子智能体」一行、
 * 点标题栏血缘面包屑是同一条主视图导航。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):加载 cordis 对 `slots` / `locale` / `uiWorkspace` 的
// 服务声明,以及 session-panel 对分区槽的 SlotMap 声明;全部是类型层,不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SubagentParentSection } from './component.tsx'
import { NS, en, zh } from './locales.ts'
import { SECTION_SLOT, sectionRegisterOptions } from './registration.ts'
import { ensureStyles } from './styles.ts'

export const name = 'dsh-subagent-parent-nav'

/** 需要的客户端服务：分区槽、字典，以及「切到某个会话」的主视图导航。 */
export const inject = ['slots', 'locale', 'uiWorkspace']

/** 跳转失败时的告警前缀。 */
const WARN_PREFIX = '[dsh-subagent-parent-nav]'

/**
 * 把主视图切到某个上级会话；失败只在控制台告警，不把异常抛回 React 的事件处理。
 *
 * @param ctx - 浏览器半部的 Client Context。
 * @param sessionId - 要打开的上级会话。
 * @returns 是否切换成功；失败时调用方不收起面板浮层。
 */
function openAncestor(ctx: Context, sessionId: SessionId): boolean {
  try {
    ctx.uiWorkspace.openSession(sessionId)
    return true
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`${WARN_PREFIX} 无法切换到上级会话 ${sessionId}：${message}`)
    return false
  }
}

/**
 * 注册字典、样式与「主智能体」一栏。
 *
 * @param ctx - 浏览器半部的 Client Context。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${name}: dictionaries`)
  if (typeof document !== 'undefined') ensureStyles(document)
  ctx.slots.inject(SECTION_SLOT, () => ctx.slots.register(
    sectionRegisterOptions(t, (sessionId: SessionId) => openAncestor(ctx, sessionId)),
    SubagentParentSection,
  ))
}
