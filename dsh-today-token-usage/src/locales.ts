/**
 * 本插件的 Web 字典：两个分区标题、每行指标的标签，以及「切换本月 / 切换今日」的按钮文案。
 *
 * 指标名与输入框下方「用量」按钮的详表一致（`@deepseek-ai/dsh-client-ui-chat` 的
 * `message.turnUsage.*`：未缓存输入 / 缓存读取 / 缓存写入 / 输出），缓存命中沿用 `stats.cacheHit`
 * 的说法；「请求数」与「费用」是本栏自己的读数。
 *
 * 两个标题分开：面板从注册项读标题，切到本月时重新注册一次换成「本月 Token 用量」（见
 * `src/registration.ts`），所以标题不是运行时插值，而是两条固定文案。
 *
 * 数值不走字典：客户端按「无单位 / K / M」三档自行格式化（见 `src/aggregate.ts`），不再带上游的
 * `tok` 后缀；`number.thousand` / `number.million` 是 `dsh-client-locale` 的 common 字典，命名空间
 * 翻译函数在自家字典找不到键时会自动落到 common，拿到的就是上游同一个 `{value}K` / `{value}M`。
 * 金额同理由 `formatCny` 统一格式化成 `¥` 文本。
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-today-token-usage'

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  'section.title': '今日 Token 用量',
  'section.monthTitle': '本月 Token 用量',
  'row.total': '总用量',
  'row.requests': '请求数',
  'row.cacheHit': '缓存命中',
  'row.uncachedInput': '未缓存输入',
  'row.cacheRead': '缓存读取',
  'row.cacheWrite': '缓存写入',
  'row.output': '输出',
  'row.cost': '费用',
  'row.switchMonth': '切换本月',
  'row.switchMonthName': '切换到本月用量',
  'row.switchToday': '切换今日',
  'row.switchTodayName': '切换到今日用量',
}

/** 本插件的 locale 键联合。 */
export type TodayTokenUsageKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  'section.title': 'Token usage today',
  'section.monthTitle': 'Token usage this month',
  'row.total': 'Total',
  'row.requests': 'Requests',
  'row.cacheHit': 'Cache hit',
  'row.uncachedInput': 'Uncached input',
  'row.cacheRead': 'Cached input',
  'row.cacheWrite': 'Cache write',
  'row.output': 'Output',
  'row.cost': 'Cost',
  'row.switchMonth': 'Switch to this month',
  'row.switchMonthName': 'Switch to usage of this month',
  'row.switchToday': 'Switch to today',
  'row.switchTodayName': 'Switch to usage of today',
} satisfies Record<TodayTokenUsageKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 「今日 Token 用量」的文案命名空间；注册项的 `locale:` 与 `t` 座位都按它取键。 */
    'dsh-today-token-usage': TodayTokenUsageKey
  }
}
