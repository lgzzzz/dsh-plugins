/**
 * 「今日 Token 用量」一栏：会话面板里每行一项读数，第一行是「切换本月 / 切换今日」。
 *
 * ```
 * 今日 Token 用量            ← 分区标题，由面板画
 * 切换本月              ›
 * 总用量                326M
 * 请求数                1.3K
 * 缓存命中              99%
 * 未缓存输入            2.7M
 * 缓存读取              320M
 * 输出                  1.1M
 * 费用                  ¥4.61
 * ```
 *
 * 点第一行换到当月累计：分区标题变成「本月 Token 用量」，第一行变成「切换今日」，下面的指标行
 * 与今日同一套（费用同样只显示总额）。标题画在面板的标题行里、不在这一节内部，所以换标题靠重新
 * 注册分区（见 `src/client.ts` 与 `src/registration.ts`）；视图本身存在 `src/view.ts`，重建这一节
 * 不会把视图重置回今日。
 *
 * 切换行贴着分区标题放在最上面：标题右侧的 trailing 位在悬停时会被拖拽手柄替换，放控件点不到。
 * 面板只显示「今天」与「本月」两种数据；过去的月份由宿主落盘保存，本期不读取、不展示。
 *
 * 数值来自宿主半部：它拦截 DSH 发出的**每一次**模型调用（主对话、子智能体、标题生成、压缩
 * 摘要、时间线报告……），按宿主本地日期累加当天与当月用量，再经 SSE 长连接
 * （`GET /today-token-usage/stream`）**推送**给页面——这里不轮询、不额外发请求。口径与输入框
 * 下方「用量」按钮一致（未缓存输入 + 缓存读取 + 缓存写入 + 输出、缓存命中 = 缓存读取 ÷ 输入侧
 * 三桶之和），单位按「无单位 / K / M」三档，不带上游的 `tok` 后缀。
 *
 * 费用也由宿主算好（逐笔按模型与峰谷计价，见 `src/pricing.ts`），这里只做 `¥` 格式化，
 * 不在浏览器里放第二份价目表。
 *
 * 行直接用会话面板给 `[data-session-panel-row]` / `[data-row-part]` 铺的通用规则：
 * 每行一个 16px 字形，标签在 content、数值在 trailing；可点的行把 body 写成 `<button>`，
 * 面板会把按压区域铺满整行。
 */
import { createElement, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 空类型导入：加载 session-panel 对分区槽的声明（只影响类型）。
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import {
  formatCacheHitPercent,
  formatCompactTokens,
  formatCny,
  monthTotalsOf,
  totalsOf,
} from './aggregate.ts'
import type { TodayTotals } from './aggregate.ts'
import type { NS } from './locales.ts'
import { readTodayUsageSnapshot, subscribeSharedTodayUsage } from './usage-client.ts'
import type { TodayUsagePayload } from './wire.ts'
import { getUsageView, setUsageView, subscribeUsageView } from './view.ts'

/** 完整组件 props：分区槽的标准 props + 本插件字典的 `t`。 */
export type TodayUsageSectionProps =
  PropsRuntime<'conversation.session.panel.section'>
  & PropsLocale<typeof NS>

/** 行左侧的字形名。 */
type GlyphName =
  | 'total'
  | 'requests'
  | 'cache-hit'
  | 'uncached-input'
  | 'cache-read'
  | 'cache-write'
  | 'output'
  | 'cost'
  | 'switch'

/** 一行读数：字形、标签、可选的右侧数值、可选的整行按钮。 */
interface MetricRow {
  /** 行上的调试标记（`data-today-token-usage`），也是 React key。 */
  readonly key: string
  readonly icon: GlyphName
  readonly label: string
  /** 右侧数值；缺省表示这一行没有 trailing。 */
  readonly value?: string
  /** 整行作为按钮时的无障碍名与动作。 */
  readonly button?: { readonly ariaLabel: string; readonly onClick: () => void }
}

/**
 * 订阅宿主推送的当天合计。
 *
 * 连接是全页共用的（见 `src/usage-client.ts`）：本组件挂载时取订，卸载时取订，最后一个订阅者
 * 离开才关连接；最近一帧缓存在模块里，切换视图重建这一节时先用缓存渲染，不会空一屏。
 * 断线由浏览器自动重连，重连后宿主再补发当前快照。
 * @returns 最近一次收到的读数，或 undefined（这一页还没有收到过）。
 */
function useTodayUsage(): TodayUsagePayload | undefined {
  return useSyncExternalStore(subscribeSharedTodayUsage, readTodayUsageSnapshot, readTodayUsageSnapshot)
}

/**
 * 订阅「今日 / 本月」视图。
 * @returns 当前视图。
 */
function useUsageView(): 'today' | 'month' {
  return useSyncExternalStore(subscribeUsageView, getUsageView, getUsageView)
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

/** 请求数：井号——一次请求计一笔。 */
function CountGlyph() {
  return glyph([
    createElement('path', { key: 'left', d: 'M6 2.5 4.5 13.5' }),
    createElement('path', { key: 'right', d: 'M11.5 2.5 10 13.5' }),
    createElement('path', { key: 'top', d: 'M3 6h10' }),
    createElement('path', { key: 'bottom', d: 'M2.5 10h10' }),
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

/** 费用：人民币符号（两撇 + 竖 + 两横）。 */
function YenGlyph() {
  return glyph([
    createElement('path', { key: 'arms', d: 'M5.2 3.6 8 7.2l2.8-3.6' }),
    createElement('path', { key: 'stem', d: 'M8 7.2v5.6' }),
    createElement('path', { key: 'upper', d: 'M5.6 8.8h4.8' }),
    createElement('path', { key: 'lower', d: 'M5.6 11.2h4.8' }),
  ])
}

/**
 * 切换视图：一上一下两支相反的箭头——今日与本月是同一条读数的两个视图。
 *
 * 「切换本月」与「切换今日」共用这一个字形：切换时图标不动，只换分区标题与行文字。
 */
function SwitchGlyph() {
  return glyph([
    createElement('path', { key: 'forward', d: 'M2.8 5.6h9.2' }),
    createElement('path', { key: 'forwardHead', d: 'M9.6 3.4 11.8 5.6 9.6 7.8' }),
    createElement('path', { key: 'backward', d: 'M13.2 10.4H4' }),
    createElement('path', { key: 'backwardHead', d: 'M6.4 8.2 4.2 10.4 6.4 12.6' }),
  ])
}

/** 指标 → 字形。缓存读写共用缓存柱、靠箭头方向区分；输入输出共用托盘、靠箭头方向区分。 */
const GLYPHS: Record<GlyphName, () => ReactNode> = {
  total: DatabaseGlyph,
  requests: CountGlyph,
  'cache-hit': TargetGlyph,
  'uncached-input': InputGlyph,
  'cache-read': CacheReadGlyph,
  'cache-write': CacheWriteGlyph,
  output: OutputGlyph,
  cost: YenGlyph,
  switch: SwitchGlyph,
}

/**
 * 渲染一行指标：图标、标签、右对齐的数值；给了 `button` 时整行可点。
 * @param row - 指标行。
 * @returns 面板行元素。
 */
function metricRow(row: MetricRow) {
  const icon = createElement('span', { 'data-row-part': 'icon', 'aria-hidden': 'true' }, createElement(GLYPHS[row.icon]))
  const text = createElement('span', { 'data-row-part': 'content' }, row.label)
  const body = row.button === undefined
    ? createElement('span', { 'data-row-part': 'body' }, icon, text)
    : createElement(
      'button',
      {
        type: 'button',
        'data-row-part': 'body',
        'aria-label': row.button.ariaLabel,
        onClick: row.button.onClick,
      },
      icon,
      text,
    )
  return createElement(
    'div',
    { key: row.key, 'data-session-panel-row': '', 'data-today-token-usage': row.key },
    body,
    row.value === undefined ? null : createElement('span', { 'data-row-part': 'trailing' }, row.value),
  )
}

/**
 * 把当天 / 当月的合计摊成面板里的指标行；缓存命中与缓存写入按上游详表的规矩缺省隐藏。
 *
 * 费用行只显示实付总额（含缓存命中的低价部分），不拆峰谷；峰谷单价只影响金额本身。
 * @param totals - 当天或当月的合计。
 * @param t - 本插件文案。
 * @returns 依次渲染的指标行（不含切换行）。
 */
function metricsOf(totals: TodayTotals, t: TodayUsageSectionProps['t']): MetricRow[] {
  const rows: MetricRow[] = [
    { key: 'total', icon: 'total', label: t('row.total'), value: formatCompactTokens(totals.total, t) },
    { key: 'requests', icon: 'requests', label: t('row.requests'), value: formatCompactTokens(totals.requests, t) },
  ]
  const cacheHit = formatCacheHitPercent(totals.cacheRead, totals.prompt)
  if (cacheHit !== null) {
    rows.push({ key: 'cache-hit', icon: 'cache-hit', label: t('row.cacheHit'), value: `${cacheHit}%` })
  }
  rows.push(
    { key: 'uncached-input', icon: 'uncached-input', label: t('row.uncachedInput'), value: formatCompactTokens(totals.uncachedInput, t) },
    { key: 'cache-read', icon: 'cache-read', label: t('row.cacheRead'), value: formatCompactTokens(totals.cacheRead, t) },
  )
  // 没有缓存写入的提供方（多数）不占一行，与上游详表的做法一致。
  if (totals.cacheWrite !== 0) {
    rows.push({ key: 'cache-write', icon: 'cache-write', label: t('row.cacheWrite'), value: formatCompactTokens(totals.cacheWrite, t) })
  }
  rows.push({ key: 'output', icon: 'output', label: t('row.output'), value: formatCompactTokens(totals.output, t) })

  const { cost } = totals
  rows.push({
    key: 'cost',
    icon: 'cost',
    label: t('row.cost'),
    // 只显示总费用；全部模型都没有价目表时显示「—」，不把「没有计价」写成「免费」。
    value: cost.total > 0 || cost.unpricedRequests === 0 ? formatCny(cost.total) : '—',
  })
  return rows
}

/**
 * 把当天合计渲染成今日视图（纯展示，便于直接测试）。
 * @param props.totals - 当天合计。
 * @param props.t - 本插件文案。
 * @param props.onSwitchMonth - 「切换本月」行的点击动作。
 * @returns 依次渲染的行；合计为 0 时渲染为空。
 */
export function TodayUsageRows({ totals, t, onSwitchMonth }: {
  totals: TodayTotals
  t: TodayUsageSectionProps['t']
  onSwitchMonth: () => void
}): ReactNode {
  if (totals.total === 0) return null
  const rows: MetricRow[] = [
    {
      key: 'switch-month',
      icon: 'switch',
      label: t('row.switchMonth'),
      button: { ariaLabel: t('row.switchMonthName'), onClick: onSwitchMonth },
    },
    ...metricsOf(totals, t),
  ]
  return rows.map(metricRow)
}

/**
 * 把当月累计渲染成本月视图（纯展示，便于直接测试）。
 *
 * 与今日视图只差第一行：「切换今日」。月份写在分区标题里（「本月 Token 用量」），不再占一行。
 * @param props.totals - 当月合计。
 * @param props.t - 本插件文案。
 * @param props.onSwitchToday - 「切换今日」行的点击动作。
 * @returns 依次渲染的行；当月用量为 0 时渲染为空。
 */
export function MonthUsageRows({ totals, t, onSwitchToday }: {
  totals: TodayTotals
  t: TodayUsageSectionProps['t']
  onSwitchToday: () => void
}): ReactNode {
  if (totals.total === 0) return null
  const rows: MetricRow[] = [
    {
      key: 'switch-today',
      icon: 'switch',
      label: t('row.switchToday'),
      button: { ariaLabel: t('row.switchTodayName'), onClick: onSwitchToday },
    },
    ...metricsOf(totals, t),
  ]
  return rows.map(metricRow)
}

/**
 * 渲染「今日 Token 用量」一栏，并在「今日 / 本月」两个视图之间切换。
 *
 * 今天没有任何用量（或宿主暂时没给数据）时渲染空——面板会连标题一起隐藏，与其它分区一致。
 * 两个视图共用同一条 SSE 载荷，切换只是本地状态，不发请求；标题由面板按注册项画，切换时由
 * `src/client.ts` 重新注册换掉。
 * @param props - 标准 props 与本插件文案；只用 `t`。
 * @returns 面板各行。
 */
export function TodayUsageSection({ t }: TodayUsageSectionProps): ReactNode {
  const payload = useTodayUsage()
  const view = useUsageView()
  if (payload === undefined) return null
  if (view === 'month') {
    const month = monthTotalsOf(payload.month)
    if (month === undefined) return null
    return MonthUsageRows({ totals: month, t, onSwitchToday: () => setUsageView('today') })
  }
  const totals = totalsOf(payload)
  if (totals === undefined) return null
  return TodayUsageRows({ totals, t, onSwitchMonth: () => setUsageView('month') })
}
