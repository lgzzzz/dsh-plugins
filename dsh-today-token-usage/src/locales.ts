/**
 * 本插件的 Web 字典：分区标题、每行指标的标签。
 *
 * 指标名与输入框下方「用量」按钮的详表一致（`@deepseek-ai/dsh-client-ui-chat` 的
 * `message.turnUsage.*`：未缓存输入 / 缓存读取 / 缓存写入 / 输出），缓存命中沿用 `stats.cacheHit`
 * 的说法；「请求数」是本栏自己的一项读数。
 *
 * 数值不走字典：客户端按「无单位 / K / M」三档自行格式化（见 `src/aggregate.ts`），不再带上游的
 * `tok` 后缀；`number.thousand` / `number.million` 是 `dsh-client-locale` 的 common 字典，命名空间
 * 翻译函数在自家字典找不到键时会自动落到 common，拿到的就是上游同一个 `{value}K` / `{value}M`。
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-today-token-usage'

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  'section.title': '今日 Token 用量',
  'row.total': '总用量',
  'row.requests': '请求数',
  'row.cacheHit': '缓存命中',
  'row.uncachedInput': '未缓存输入',
  'row.cacheRead': '缓存读取',
  'row.cacheWrite': '缓存写入',
  'row.output': '输出',
}

/** 本插件的 locale 键联合。 */
export type TodayTokenUsageKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  'section.title': 'Token usage today',
  'row.total': 'Total',
  'row.requests': 'Requests',
  'row.cacheHit': 'Cache hit',
  'row.uncachedInput': 'Uncached input',
  'row.cacheRead': 'Cached input',
  'row.cacheWrite': 'Cache write',
  'row.output': 'Output',
} satisfies Record<TodayTokenUsageKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 「今日 Token 用量」的文案命名空间；注册项的 `locale:` 与 `t` 座位都按它取键。 */
    'dsh-today-token-usage': TodayTokenUsageKey
  }
}
