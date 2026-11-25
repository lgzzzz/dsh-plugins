/**
 * 浏览器半部：在会话面板里注册「OpenCode Go」一栏。
 *
 * 面板的分区槽由 `@deepseek-ai/dsh-client-ui-session-panel` 声明，可能在页面加载后才就位；
 * `ctx.slots.inject` 负责等它，声明撤下时注册项随之收回。这一栏没有业务动作，只轮询宿主
 * 半部的同源路由 `GET /opencode-status/status`（主站接口不带 CORS 头，页面不能直连），
 * 所以不注入任何数据服务，也不挂样式表。
 */

import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):加载 cordis 对 `slots` / `locale` 的服务声明，以及 session-panel
// 对分区槽的 SlotMap 声明;全部是类型层,不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { OpencodeStatusSection } from './component.ts'
import { NS, en, zh } from './locales.ts'
import { SECTION_SLOT, sectionRegisterOptions } from './registration.ts'

export const name = 'dsh-opencode-status'

/** 需要的客户端服务：分区槽与字典。 */
export const inject = ['slots', 'locale']

/**
 * 注册字典与「OpenCode Go」一栏。
 * @param ctx - 浏览器半部的 Client Context。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${name}: dictionaries`)
  ctx.slots.inject(SECTION_SLOT, () => ctx.slots.register(sectionRegisterOptions(t), OpencodeStatusSection))
}
