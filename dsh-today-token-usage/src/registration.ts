/**
 * 「今日 Token 用量」一栏的注册契约：槽键、注册 id、排序与选项构造。
 *
 * 分区标题由面板从注册项读，不是组件自己画的：视图切到本月时，宿主半部会用同一份选项重新注册
 * 一次（见 `src/client.ts`），标题随之变成「本月 Token 用量」。标题用 thunk 而不是字符串，切换
 * 语言时面板会就地重读，不必重新注册。
 *
 * 独立成纯模块，测试可以直接 import，不必拉进 React 或浏览器环境。
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { getUsageView } from './view.ts'

/** 会话面板的分区槽：每一节自带标题与正文，正文渲染为空的那节连标题一起隐藏。 */
export const SECTION_SLOT = 'conversation.session.panel.section'

/** 本插件在面板里的分区 id，与上游 `environment` / `subagents` 等区分开。 */
export const SECTION_ID = 'today-usage'

/**
 * 排在「后台任务」（`order: 300`）之后：这是一条全局读数，不抢按会话展开的分区的位置。
 *
 * 用 310 而不是 300：同 `order` 时面板按注册先后排，而切换视图会重新注册一次——和「后台任务」
 * 并列的话，每切一次这一栏就会跟它换一次位置。
 */
export const SECTION_ORDER = 310

/** 交给 `slots.register()` 的注册选项（本插件自己的注册契约）。 */
export interface SectionRegisterOptions {
  /** 目标槽键。 */
  readonly name: typeof SECTION_SLOT
  /** 注册 id。 */
  readonly id: string
  /** 槽内显示顺序。 */
  readonly order: number
  /** 分区标题；按当前视图与语言现取，切换视图 / 语言后不必重新注册。 */
  readonly label: () => string
  /** 本插件字典命名空间。 */
  readonly locale: typeof NS
}

/**
 * 构造 `slots.register()` 的选项。
 *
 * 同一次会话里注册项会被重新注册（切换今日 / 本月），id 与 order 保持不变：读者拖过分区顺序后
 * 顺序按 id 记住，换标题不会把它挪位置。
 * @param t - 本插件命名空间的翻译函数。
 * @returns 注册选项。
 */
export function sectionRegisterOptions(t: TranslateNS<typeof NS>): SectionRegisterOptions {
  return {
    name: SECTION_SLOT,
    id: SECTION_ID,
    order: SECTION_ORDER,
    label: () => t(getUsageView() === 'month' ? 'section.monthTitle' : 'section.title'),
    locale: NS,
  }
}
