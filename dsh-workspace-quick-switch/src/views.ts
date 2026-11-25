/**
 * 浮层文案与 DOM 标记：两张浮层共用同一套组件，差异只在标题、空态、确认提示与根标记上。
 *
 * 文案由 locale 翻译函数现算；`WORKSPACE_VIEW` / `SESSION_VIEW` 是简体中文默认值，测试与
 * locale 服务缺席时使用。
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, translateZh, type PaletteLocaleNS } from './locales.ts'
import { PAGE_SIZE, type PaletteView } from './palette.ts'

/** 工作区浮层根节点的 DOM 标记（人工排查与自动化验证都读它）。 */
export const PALETTE_ROOT_ATTR = 'data-workspace-quick-switch'

/** 工作区浮层里一行候选的 DOM 标记。 */
export const PALETTE_OPTION_ATTR = 'data-workspace-quick-switch-option'

/** 会话浮层根节点的 DOM 标记。 */
export const SESSION_ROOT_ATTR = 'data-session-quick-switch'

/** 会话浮层里一行候选的 DOM 标记。 */
export const SESSION_OPTION_ATTR = 'data-session-quick-switch-option'

/** 本插件的翻译座位。 */
export type PaletteTranslate = TranslateNS<PaletteLocaleNS>

/**
 * 工作区浮层的文案：按左侧栏 Workspace 分组的顺序列出工作区，确认动作是新建会话。
 *
 * @param t - 本插件字典的翻译函数。
 * @returns 槽位注册与组件共用的静态文案。
 */
export function workspaceView(t: PaletteTranslate = translateZh): PaletteView {
  return {
    id: NS,
    domId: NS,
    rootAttr: PALETTE_ROOT_ATTR,
    title: t('workspaceTitle'),
    unit: t('workspaceUnit'),
    emptyCount: t('workspaceEmptyCount'),
    emptyHint: t('workspaceEmptyHint'),
    listLabel: t('workspaceListLabel'),
    enterHint: t('workspaceEnterHint'),
  }
}

/**
 * 会话浮层的文案：候选顺序照抄左侧栏「单列表 + 最近更新 + 隐藏已归档」，确认动作是打开会话。
 *
 * @param t - 本插件字典的翻译函数。
 * @returns 槽位注册与组件共用的静态文案。
 */
export function sessionView(t: PaletteTranslate = translateZh): PaletteView {
  return {
    id: `${NS}.session-switch`,
    domId: `${NS}-session`,
    rootAttr: SESSION_ROOT_ATTR,
    title: t('sessionTitle'),
    unit: t('sessionUnit'),
    emptyCount: t('sessionEmptyCount'),
    emptyHint: t('sessionEmptyHint'),
    listLabel: t('sessionListLabel'),
    enterHint: t('sessionEnterHint'),
  }
}

/** 工作区浮层的简体中文文案（默认值）。 */
export const WORKSPACE_VIEW = workspaceView()

/** 会话浮层的简体中文文案（默认值）。 */
export const SESSION_VIEW = sessionView()

/**
 * 标题右侧的计数文案：一屏装得下时报总数，否则报当前看到的行范围。
 *
 * @param view - 这张浮层的文案（决定计数单位）。
 * @param total - 候选总数。
 * @param offset - 窗口第一行的下标（0 起）。
 * @param t - 本插件字典的翻译函数。
 * @returns 「3 个工作区」或「30 个工作区 · 显示 1–10」。
 */
export function countLabel(
  view: PaletteView,
  total: number,
  offset: number,
  t: PaletteTranslate = translateZh,
): string {
  if (total <= PAGE_SIZE) return `${total} ${view.unit}`
  const from = offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)
  return t('countRange', { total, unit: view.unit, from, to })
}

/**
 * 一行候选项的 DOM id（与 `aria-activedescendant` 配对，滚进可见区也按它定位）。
 *
 * @param view - 这张浮层的文案（决定 id 前缀，两张浮层的行 id 因此不会撞车）。
 * @param index - 候选在整个列表里的下标。
 * @returns DOM id。
 */
export function optionDomId(view: PaletteView, index: number): string {
  return `${view.domId}-option-${index}`
}
