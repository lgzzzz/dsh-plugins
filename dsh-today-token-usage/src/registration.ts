/**
 * 「今日 Token 用量」一栏的注册契约：槽键、注册 id、排序与选项构造。
 *
 * 独立成纯模块，测试可以直接 import，不必拉进 React 或浏览器环境。
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'

/** 会话面板的分区槽：每一节自带标题与正文，正文渲染为空的那节连标题一起隐藏。 */
export const SECTION_SLOT = 'conversation.session.panel.section'

/** 本插件在面板里的分区 id，与上游 `environment` / `subagents` 等区分开。 */
export const SECTION_ID = 'today-usage'

/** 排在最后：这是一条全局读数，不抢「改动请求」「子智能体」这些按会话展开的分区的位置。 */
export const SECTION_ORDER = 300

/** 交给 `slots.register()` 的注册选项（本插件自己的注册契约）。 */
export interface SectionRegisterOptions {
  /** 目标槽键。 */
  readonly name: typeof SECTION_SLOT
  /** 注册 id。 */
  readonly id: string
  /** 槽内显示顺序。 */
  readonly order: number
  /** 分区标题；按当前语言现取，切换语言后不必重新注册。 */
  readonly label: () => string
  /** 本插件字典命名空间。 */
  readonly locale: typeof NS
}

/**
 * 构造 `slots.register()` 的选项。
 * @param t - 本插件命名空间的翻译函数。
 * @returns 注册选项。
 */
export function sectionRegisterOptions(t: TranslateNS<typeof NS>): SectionRegisterOptions {
  return {
    name: SECTION_SLOT,
    id: SECTION_ID,
    order: SECTION_ORDER,
    label: () => t('section.title'),
    locale: NS,
  }
}
