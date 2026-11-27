/**
 * 浏览器半部：在会话面板里注册「今日 Token 用量」一栏。
 *
 * 面板的分区槽由 `@deepseek-ai/dsh-client-ui-session-panel` 声明，可能在页面加载后才就位；
 * `ctx.slots.inject` 负责等它，声明撤下时注册项随之收回。这一栏没有业务动作，只订阅宿主半部的
 * 同源 SSE 推送（`GET /today-token-usage/stream`），所以不注入任何数据服务，也不再挂样式表。
 *
 * 分区标题由面板从注册项读，注册后改不了，所以切换「今日 / 本月」时用同一份选项重新注册一次：
 * id 与 order 不变（读者拖过的分区顺序按 id 记住），只有标题 thunk 读到新视图。面板按注册项
 * 身份给正文铺 key，重新注册会重建这一节；视图存在 `src/view.ts`、读数缓存在
 * `src/usage-client.ts`，重建不会丢视图，也不会空一帧。
 */
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):加载 cordis 对 `slots` / `locale` 的服务声明，以及 session-panel
// 对分区槽的 SlotMap 声明;全部是类型层,不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { TodayUsageSection } from './component.ts'
import { NS, en, zh } from './locales.ts'
import { SECTION_SLOT, sectionRegisterOptions } from './registration.ts'
import { subscribeUsageView } from './view.ts'

export const name = 'dsh-today-token-usage'

/** 需要的客户端服务：分区槽与字典。 */
export const inject = ['slots', 'locale']

/**
 * 注册字典与「今日 Token 用量」一栏。
 *
 * 视图每变一次就重注册一次分区，让面板的标题跟上（今日 Token 用量 / 本月 Token 用量）。
 * @param ctx - 浏览器半部的 Client Context。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${name}: dictionaries`)
  ctx.slots.inject(SECTION_SLOT, () => {
    let registration = ctx.slots.register(sectionRegisterOptions(t), TodayUsageSection)
    const unsubscribe = subscribeUsageView(() => {
      // 同一 id 不许同时挂两份：先收回旧的，再按新标题注册。
      registration()
      registration = ctx.slots.register(sectionRegisterOptions(t), TodayUsageSection)
    })
    return () => {
      unsubscribe()
      registration()
    }
  })
}
