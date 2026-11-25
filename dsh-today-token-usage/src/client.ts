/**
 * 浏览器半部：在会话面板里注册「今日 Token 用量」一栏。
 *
 * 面板的分区槽由 `@deepseek-ai/dsh-client-ui-session-panel` 声明，可能在页面加载后才就位；
 * `ctx.slots.inject` 负责等它，声明撤下时注册项随之收回。这一栏没有业务动作，只订阅宿主半部的
 * 同源 SSE 推送（`GET /today-token-usage/stream`），所以不注入任何数据服务，也不再挂样式表。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):加载 cordis 对 `slots` / `locale` 的服务声明，以及 session-panel
// 对分区槽的 SlotMap 声明;全部是类型层,不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { TodayUsageSection } from './component.tsx'

// 纯展示的行组件从入口再导出：产物测试（render.test.mjs）按真实 bundle 加载后用真 React 渲染。
export { TodayUsageRows } from './component.tsx'
import { NS, en, zh } from './locales.ts'
import { SECTION_SLOT, sectionRegisterOptions } from './registration.ts'

export const name = 'dsh-today-token-usage'

/** 需要的客户端服务：分区槽与字典。 */
export const inject = ['slots', 'locale']

/**
 * 注册字典与「今日 Token 用量」一栏。
 * @param ctx - 浏览器半部的 Client Context。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${name}: dictionaries`)
  ctx.slots.inject(SECTION_SLOT, () => ctx.slots.register(sectionRegisterOptions(t), TodayUsageSection))
}
