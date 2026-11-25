/**
 * 浮层文案与 DOM 标记：快捷菜单与思考等级共用一套组件，差异只在标题、空态与确认提示。
 *
 * 文案由 locale 翻译函数现算；`MODEL_VIEW` / `EFFORT_VIEW` 是简体中文默认值，测试与
 * locale 服务缺席时使用。
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, translateZh, type ModelLocaleNS } from './locales.ts'
import { PAGE_SIZE, type PaletteRow, type PaletteView } from './palette.ts'
import { actionRowCount } from './actions.ts'

/** 浮层根节点的 DOM 标记（人工排查与自动化验证都读它）。 */
export const PALETTE_ROOT_ATTR = 'data-model-quick-switch'

/** 浮层里一行候选的 DOM 标记。 */
export const PALETTE_OPTION_ATTR = 'data-model-quick-switch-option'

/** 设置页根节点的 DOM 标记。 */
export const SETTINGS_ROOT_ATTR = 'data-model-quick-switch-settings'

/** 本插件的翻译座位。 */
export type ModelTranslate = TranslateNS<ModelLocaleNS>

/**
 * 快捷菜单的文案。
 * @param t - 本插件字典的翻译函数。
 * @returns 槽位注册与组件共用的静态文案。
 */
export function modelView(t: ModelTranslate = translateZh): PaletteView {
  return {
    id: NS,
    domId: NS,
    rootAttr: PALETTE_ROOT_ATTR,
    title: t('modelTitle'),
    unit: t('modelUnit'),
    emptyCount: t('modelEmptyCount'),
    emptyHint: t('modelEmptyHint'),
    listLabel: t('modelListLabel'),
    enterHint: t('modelEnterHint'),
  }
}

/**
 * 思考等级浮层的文案。
 * @param t - 本插件字典的翻译函数。
 * @returns 第二步的静态文案。
 */
export function effortView(t: ModelTranslate = translateZh): PaletteView {
  return {
    id: `${NS}.effort`,
    domId: `${NS}-effort`,
    rootAttr: PALETTE_ROOT_ATTR,
    title: t('effortTitle'),
    unit: t('effortUnit'),
    emptyCount: t('effortEmptyCount'),
    emptyHint: t('effortEmptyHint'),
    listLabel: t('effortListLabel'),
    enterHint: t('effortEnterHint'),
  }
}

/** 快捷菜单的简体中文文案（默认值）。 */
export const MODEL_VIEW = modelView()

/** 思考等级浮层的简体中文文案（默认值）。 */
export const EFFORT_VIEW = effortView()

/**
 * 标题右侧的计数文案：一屏装得下时报总数，否则报当前看到的行范围。
 * @param view - 浮层文案。
 * @param total - 候选总数。
 * @param offset - 窗口起点。
 * @param t - 本插件字典的翻译函数。
 * @returns 一行计数文案。
 */
export function countLabel(
  view: PaletteView,
  total: number,
  offset: number,
  t: ModelTranslate = translateZh,
): string {
  if (total <= PAGE_SIZE) return `${total} ${view.unit}`
  const from = offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)
  return t('countRange', { total, unit: view.unit, from, to })
}

/**
 * 快捷菜单标题右侧的计数：把模型与操作分开报。
 *
 * 没有操作行时保持原行为（含「显示 a–b」的窗口提示）；有操作行时只报「n 个模型 · m 个操作」，
 * 不把两行操作算进模型数。
 * @param view - 浮层文案。
 * @param entries - 全部候选。
 * @param offset - 窗口起点。
 * @param t - 本插件字典的翻译函数。
 * @returns 一行计数文案。
 */
export function paletteCountLabel(
  view: PaletteView,
  entries: readonly PaletteRow[],
  offset: number,
  t: ModelTranslate = translateZh,
): string {
  const actions = actionRowCount(entries)
  if (actions === 0) return countLabel(view, entries.length, offset, t)
  const models = entries.length - actions
  return t('countActions', { models, unit: view.unit, actions })
}

/**
 * 一行候选项的 DOM id（与 `aria-activedescendant` 配对，滚进可见区也按它定位）。
 * @param view - 浮层文案。
 * @param index - 候选在整个列表里的下标。
 * @returns DOM id。
 */
export function optionDomId(view: PaletteView, index: number): string {
  return `${view.domId}-option-${index}`
}
