/**
 * 「今日 Token 用量」一栏：会话面板里五行读数，每行一项指标。
 *
 * ```
 * 总用量        326M
 * 缓存命中      99%
 * 未缓存输入    2.7M
 * 缓存读取      320M
 * 输出          1.1M
 * ```
 *
 * 数值与输入框下方「用量」按钮同一口径（未缓存输入 + 缓存读取 + 缓存写入 + 输出、缓存命中 =
 * 缓存读取 ÷ 输入侧三桶之和），按今天的全部会话累加；单位按「无单位 / K / M」三档，不带上游的
 * `tok` 后缀。只读会话列表里的投影值，不读日志、不折事件——宿主半部已经把每个会话今天的那一份算好了。
 *
 * 行直接用会话面板给 `[data-session-panel-row]` / `[data-row-part]` 铺的通用规则：图标在首行，
 * 其余行留空图标位保持标签左对齐；标签在 content、数值在 trailing。
 */
import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 空类型导入：加载 ui-session 对标准 props（`useSessions` / `sessionId`）的合并，
// 以及 session-panel 对分区槽的声明；都只影响类型。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { aggregateToday, formatCacheHitPercent, formatCompactTokens } from './aggregate.ts'
import type { TodayTotals } from './aggregate.ts'
import type { NS } from './locales.ts'
import { dayKey, nextMidnight } from './wire.ts'

/** 完整组件 props：分区槽的标准 props + 本插件字典的 `t`。 */
export type TodayUsageSectionProps =
  PropsRuntime<'conversation.session.panel.section'>
  & PropsLocale<typeof NS>

/** 一行读数：指标键（也是行上的调试标记）、标签、数值与是否放图标。 */
interface MetricRow {
  readonly key: 'total' | 'cache-hit' | 'uncached-input' | 'cache-read' | 'cache-write' | 'output'
  readonly label: string
  readonly value: string
  readonly icon: boolean
}

/**
 * 本机当前的日期键，并在跨过本地零点时更新一次。
 *
 * 面板可以整夜开着：零点之后再渲染一次，昨天那一份读数才会从「今天」里退出去。
 * @returns 当前本地日期 `YYYY-MM-DD`。
 */
function useTodayKey(): string {
  const [today, setToday] = useState(() => dayKey(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      // 多等 1 秒：定时器可能比系统时钟的整点判定早一点点醒。
      const delay = Math.max(1_000, nextMidnight(Date.now()) - Date.now() + 1_000)
      timer = setTimeout(() => {
        setToday(dayKey(Date.now()))
        schedule()
      }, delay)
    }
    schedule()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
  return today
}

/**
 * 数据库/用量字形：16px 线框，颜色随行文字（与面板其它行的图标同尺寸）。
 * @returns 图标元素。
 */
function DatabaseGlyph() {
  return createElement(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      'aria-hidden': 'true',
    },
    createElement('ellipse', { cx: 8, cy: 4.5, rx: 5, ry: 2 }),
    createElement('path', { d: 'M3 4.5v7c0 1.1 2.24 2 5 2s5-.9 5-2v-7' }),
    createElement('path', { d: 'M3 8c0 1.1 2.24 2 5 2s5-.9 5-2' }),
  )
}

/**
 * 渲染一行指标：图标位（首行有字形，其余留白对齐）、标签、右对齐的数值。
 * @param row - 指标行。
 * @returns 面板行元素。
 */
function metricRow(row: MetricRow) {
  return createElement(
    'div',
    { key: row.key, 'data-session-panel-row': '', 'data-today-token-usage': row.key },
    createElement(
      'span',
      { 'data-row-part': 'body' },
      createElement(
        'span',
        { 'data-row-part': 'icon', 'aria-hidden': 'true' },
        row.icon ? createElement(DatabaseGlyph) : null,
      ),
      createElement('span', { 'data-row-part': 'content' }, row.label),
    ),
    createElement('span', { 'data-row-part': 'trailing' }, row.value),
  )
}

/**
 * 把汇总值摊成面板里的行；缓存命中与缓存写入按上游详表的规矩缺省隐藏。
 * @param totals - 今天的汇总值。
 * @param t - 本插件文案。
 * @returns 依次渲染的行。
 */
function rowsOf(totals: TodayTotals, t: TodayUsageSectionProps['t']): MetricRow[] {
  const rows: MetricRow[] = [
    { key: 'total', label: t('row.total'), value: formatCompactTokens(totals.total, t), icon: true },
  ]
  const cacheHit = formatCacheHitPercent(totals.cacheRead, totals.prompt)
  if (cacheHit !== null) {
    rows.push({ key: 'cache-hit', label: t('row.cacheHit'), value: `${cacheHit}%`, icon: false })
  }
  rows.push(
    { key: 'uncached-input', label: t('row.uncachedInput'), value: formatCompactTokens(totals.uncachedInput, t), icon: false },
    { key: 'cache-read', label: t('row.cacheRead'), value: formatCompactTokens(totals.cacheRead, t), icon: false },
  )
  // 没有缓存写入的会话（多数提供方）不占一行，与上游详表的做法一致。
  if (totals.cacheWrite !== 0) {
    rows.push({ key: 'cache-write', label: t('row.cacheWrite'), value: formatCompactTokens(totals.cacheWrite, t), icon: false })
  }
  rows.push({ key: 'output', label: t('row.output'), value: formatCompactTokens(totals.output, t), icon: false })
  return rows
}

/**
 * 渲染「今日 Token 用量」一栏。
 *
 * 今天没有任何用量时渲染空——面板会连标题一起隐藏，与其它分区一致。
 * @param props - 会话列表选择器与本插件文案。
 * @returns 五行读数。
 */
export function TodayUsageSection({ useSessions, t }: TodayUsageSectionProps): ReactNode {
  const today = useTodayKey()
  const byId = useSessions((state: SessionListState) => state.byId)
  const projections = useSessions((state: SessionListState) => state.projectionsBySession)
  const totals = useMemo(
    () => aggregateToday({ byId, projectionsBySession: projections }, today),
    [byId, projections, today],
  )
  if (totals === undefined) return null
  return rowsOf(totals, t).map(metricRow)
}
