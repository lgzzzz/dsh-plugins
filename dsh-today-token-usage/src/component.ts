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
 * 行直接用会话面板给 `[data-session-panel-row]` / `[data-row-part]` 铺的通用规则：每行一个 16px 字形，
 * 标签在 content、数值在 trailing。
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

/** 一行读数：指标键（也是行上的调试标记）、标签与数值。 */
interface MetricRow {
  readonly key: 'total' | 'cache-hit' | 'uncached-input' | 'cache-read' | 'cache-write' | 'output'
  readonly label: string
  readonly value: string
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
 * 一个 16px 线框字形：所有指标行共用同一套笔画（1.2px、圆头圆角、颜色随行文字），
 * 与面板其它行的 16px 图标同尺寸，明暗主题自动跟随。
 * @param children - 字形内部的图元。
 * @returns 图标元素。
 */
function glyph(children: ReactNode) {
  return createElement(
    'svg',
    {
      width: 16,
      height: 16,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    children,
  )
}

/** 总用量：数据库/账本，与输入框下方「用量」按钮同一个字形。 */
function DatabaseGlyph() {
  return glyph([
    createElement('ellipse', { key: 'top', cx: 8, cy: 4.5, rx: 5, ry: 2 }),
    createElement('path', { key: 'body', d: 'M3 4.5v7c0 1.1 2.24 2 5 2s5-.9 5-2v-7' }),
    createElement('path', { key: 'line', d: 'M3 8c0 1.1 2.24 2 5 2s5-.9 5-2' }),
  ])
}

/** 缓存命中：靶心（命中目标的那一环）。 */
function TargetGlyph() {
  return glyph([
    createElement('circle', { key: 'outer', cx: 8, cy: 8, r: 5.5 }),
    createElement('circle', { key: 'inner', cx: 8, cy: 8, r: 2.2 }),
    createElement('circle', { key: 'hit', cx: 8, cy: 8, r: 0.6, fill: 'currentColor', stroke: 'none' }),
  ])
}

/** 未缓存输入：箭头朝下入框——从外面进模型的那一份。 */
function InputGlyph() {
  return glyph([
    createElement('path', { key: 'shaft', d: 'M8 2.5v7' }),
    createElement('path', { key: 'head', d: 'M5 6.5 8 9.5l3-3' }),
    createElement('path', { key: 'tray', d: 'M2.5 11.5v1.5c0 .55.45 1 1 1h9c.55 0 1-.45 1-1v-1.5' }),
  ])
}

/** 缓存读取：箭头从缓存柱指出——从缓存里取回的那一份。 */
function CacheReadGlyph() {
  return glyph([
    createElement('ellipse', { key: 'top', cx: 4.8, cy: 4.6, rx: 3.2, ry: 1.3 }),
    createElement('path', { key: 'body', d: 'M1.6 4.6v6.4c0 .72 1.43 1.3 3.2 1.3s3.2-.58 3.2-1.3V4.6' }),
    createElement('path', { key: 'shaft', d: 'M9.2 8h4.8' }),
    createElement('path', { key: 'head', d: 'M11.5 5.5 14 8l-2.5 2.5' }),
  ])
}

/** 缓存写入：箭头指回缓存柱——写进缓存的那一份。 */
function CacheWriteGlyph() {
  return glyph([
    createElement('ellipse', { key: 'top', cx: 4.8, cy: 4.6, rx: 3.2, ry: 1.3 }),
    createElement('path', { key: 'body', d: 'M1.6 4.6v6.4c0 .72 1.43 1.3 3.2 1.3s3.2-.58 3.2-1.3V4.6' }),
    createElement('path', { key: 'shaft', d: 'M14 8H9.2' }),
    createElement('path', { key: 'head', d: 'M11.5 5.5 9 8l2.5 2.5' }),
  ])
}

/** 输出：箭头朝上出框——离开模型的回答。 */
function OutputGlyph() {
  return glyph([
    createElement('path', { key: 'shaft', d: 'M8 10.5v-7' }),
    createElement('path', { key: 'head', d: 'M5 6.5 8 3.5l3 3' }),
    createElement('path', { key: 'tray', d: 'M2.5 11.5v1.5c0 .55.45 1 1 1h9c.55 0 1-.45 1-1v-1.5' }),
  ])
}

/** 指标 → 字形。缓存读写共用缓存柱、靠箭头方向区分；输入输出共用托盘、靠箭头方向区分。 */
const GLYPHS: Record<MetricRow['key'], () => ReactNode> = {
  total: DatabaseGlyph,
  'cache-hit': TargetGlyph,
  'uncached-input': InputGlyph,
  'cache-read': CacheReadGlyph,
  'cache-write': CacheWriteGlyph,
  output: OutputGlyph,
}

/**
 * 渲染一行指标：图标、标签、右对齐的数值。
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
      createElement('span', { 'data-row-part': 'icon', 'aria-hidden': 'true' }, createElement(GLYPHS[row.key])),
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
    { key: 'total', label: t('row.total'), value: formatCompactTokens(totals.total, t) },
  ]
  const cacheHit = formatCacheHitPercent(totals.cacheRead, totals.prompt)
  if (cacheHit !== null) {
    rows.push({ key: 'cache-hit', label: t('row.cacheHit'), value: `${cacheHit}%` })
  }
  rows.push(
    { key: 'uncached-input', label: t('row.uncachedInput'), value: formatCompactTokens(totals.uncachedInput, t) },
    { key: 'cache-read', label: t('row.cacheRead'), value: formatCompactTokens(totals.cacheRead, t) },
  )
  // 没有缓存写入的会话（多数提供方）不占一行，与上游详表的做法一致。
  if (totals.cacheWrite !== 0) {
    rows.push({ key: 'cache-write', label: t('row.cacheWrite'), value: formatCompactTokens(totals.cacheWrite, t) })
  }
  rows.push({ key: 'output', label: t('row.output'), value: formatCompactTokens(totals.output, t) })
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
