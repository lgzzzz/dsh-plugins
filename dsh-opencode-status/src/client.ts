/**
 * 浏览器半部：在会话面板里注册「OpenCode Go」一栏。
 *
 * 面板的分区槽由 `@deepseek-ai/dsh-client-ui-session-panel` 声明，可能在页面加载后才就位；
 * `ctx.slots.inject` 负责等它，声明撤下时注册项随之收回。这一栏没有业务动作，只轮询宿主
 * 半部的同源路由 `GET /opencode-status/status`（主站接口不带 CORS 头，页面不能直连），
 * 所以不注入任何数据服务，也不挂样式表。
 *
 * 轮询在页面装载时就启动（早于任何会话面板挂载），读数存在 {@link statusStore} 的模块内存里：
 * 用户打开 / 切换会话时，组件第一帧就能同步读到最近一份快照，面板不会先空一拍再出现。
 */

import type { Context } from '@deepseek-ai/cordis'
// 空类型导入(不引入任何名字):加载 cordis 对 `slots` / `locale` 的服务声明，以及 session-panel
// 对分区槽的 SlotMap 声明;全部是类型层,不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { OpencodeStatusSection } from './component.tsx'

// 纯展示的行组件从入口再导出：产物测试（render.test.mjs）按真实 bundle 加载后用真 React 渲染。
export { StatusRows } from './component.tsx'
import { NS, en, zh } from './locales.ts'
import { SECTION_SLOT, sectionRegisterOptions } from './registration.ts'
import { statusStore } from './status-store.ts'

export const name = 'dsh-opencode-status'

/** 需要的客户端服务：分区槽与字典。 */
export const inject = ['slots', 'locale']

/**
 * 注册字典、「OpenCode Go」一栏，并启动页面级后台轮询。
 * @param ctx - 浏览器半部的 Client Context。
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${name}: dictionaries`)
  ctx.effect(() => {
    // 只有浏览器页面需要（也才能）发同源请求；测试 / SSR 里没有 window 时安静跳过。
    if (typeof window === 'undefined') return () => {}
    statusStore.start()
    return () => statusStore.stop()
  }, `${name}: background polling`)
  ctx.slots.inject(SECTION_SLOT, () => ctx.slots.register(sectionRegisterOptions(t), OpencodeStatusSection))
}
