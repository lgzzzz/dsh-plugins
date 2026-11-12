/**
 * hero 开关的注册契约：槽键、注册 id、排序与选项构造。
 *
 * 独立成纯模块，测试可以直接 import，不必拉进 React 或浏览器环境。
 */
import type { HeroToggleInjected } from './component.ts'

/** 新会话行右侧的插件选项槽（forge 的「新建工作树」也在这里）。 */
export const HERO_OPTIONS_SLOT = 'conversation.hero.options'

/** 本插件在 hero 行里的注册 id；与上游菜单项的 `agent-team` 区分开。 */
export const HERO_OPTIONS_ID = 'agent-team.hero'

/** 排在工作树（默认 order 0）右侧。 */
export const HERO_OPTIONS_ORDER = 10

/**
 * 构造 `slots.register()` 的选项。
 *
 * @param locale - 本插件字典命名空间。
 * @param inject - 按会话给出写入回调的注入面。
 * @returns 注册选项。
 */
export function heroRegisterOptions(
  locale: string,
  inject: (sessionId: string) => HeroToggleInjected,
): Record<string, unknown> {
  return {
    name: HERO_OPTIONS_SLOT,
    id: HERO_OPTIONS_ID,
    order: HERO_OPTIONS_ORDER,
    locale,
    inject,
  }
}
