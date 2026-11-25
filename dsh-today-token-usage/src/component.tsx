/**
 * 「今日 Token 用量」一栏：会话面板里每行一项读数。
 *
 * ```
 * 总用量        326M
 * 请求数        1.3K
 * 缓存命中      99%
 * 未缓存输入    2.7M
 * 缓存读取      320M
 * 输出          1.1M
 * ```
 *
 * 数值来自宿主半部：它拦截 DSH 发出的**每一次**模型调用（主对话、子智能体、标题生成、压缩
 * 摘要、时间线报告……），按宿主本地日期累加当天用量，再经 SSE 长连接
 * （`GET /today-token-usage/stream`）**推送**给页面——这里不轮询。口径与输入框下方「用量」
 * 按钮一致（未缓存输入 + 缓存读取 + 缓存写入 + 输出、缓存命中 = 缓存读取 ÷ 输入侧三桶之和），
 * 单位按「无单位 / K / M」三档，不带上游的 `tok` 后缀。
 *
 * 行直接用会话面板给 `[data-session-panel-row]` / `[data-row-part]` 铺的通用规则：
 * 每行一个 16px 字形，标签在 content、数值在 trailing。
 */
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 空类型导入：加载 session-panel 对分区槽的声明（只影响类型）。
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { formatCacheHitPercent, formatCompactTokens, totalsOf } from './aggregate.ts'
import type { TodayTotals } from './aggregate.ts'
import type { NS } from './locales.ts'
import { subscribeTodayUsage } from './usage-client.ts'
import type { TodayUsagePayload } from './wire.ts'

/** 完整组件 props：分区槽的标准 props + 本插件字典的 `t`。 */
export type TodayUsageSectionProps =
  PropsRuntime<'conversation.session.panel.section'>
  & PropsLocale<typeof NS>

/** 一行读数：指标键（也是行上的调试标记）、标签与数值。 */
interface MetricRow {
  readonly key: 'total' | 'requests' | 'cache-hit' | 'uncached-input' | 'cache-read' | 'cache-write' | 'output'
  readonly label: string
  readonly value: string
}

/**
 * 订阅宿主推送的当天合计。
 *
 * 挂载时建立 SSE 长连接（宿主先补发当前快照），之后每条推送更新一次；卸载时关闭连接。
 * 断线由浏览器自动重连，重连后宿主再补发当前快照，所以这里不需要定时器或焦点监听。
 * @returns 最近一次收到的读数，或 undefined（还没有收到过）。
 */
function useTodayUsage(): TodayUsagePayload | undefined {
  const [payload, setPayload] = useState<TodayUsagePayload | undefined>(undefined)
  useEffect(() => subscribeTodayUsage(setPayload), [])
  return payload
}

/**
 * 一个 16px 线框字形：所有指标行共用同一套笔画（1.2px、圆头圆角、颜色随行文字），
 * 与面板其它行的 16px 图标同尺寸，明暗主题自动跟随。
 * @param props.children - 字形内部的图元。
 * @returns 图标元素。
 */
function Glyph({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** 总用量：数据库/账本，与输入框下方「用量」按钮同一个字形。 */
function DatabaseGlyph() {
  return (
    <Glyph>
      <ellipse cx={8} cy={4.5} rx={5} ry={2} />
      <path d="M3 4.5v7c0 1.1 2.24 2 5 2s5-.9 5-2v-7" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
    </Glyph>
  )
}

/** 请求数：井号——一次请求计一笔。 */
function CountGlyph() {
  return (
    <Glyph>
      <path d="M6 2.5 4.5 13.5" />
      <path d="M11.5 2.5 10 13.5" />
      <path d="M3 6h10" />
      <path d="M2.5 10h10" />
    </Glyph>
  )
}

/** 缓存命中：靶心（命中目标的那一环）。 */
function TargetGlyph() {
  return (
    <Glyph>
      <circle cx={8} cy={8} r={5.5} />
      <circle cx={8} cy={8} r={2.2} />
      <circle cx={8} cy={8} r={0.6} fill="currentColor" stroke="none" />
    </Glyph>
  )
}

/** 未缓存输入：箭头朝下入框——从外面进模型的那一份。 */
function InputGlyph() {
  return (
    <Glyph>
      <path d="M8 2.5v7" />
      <path d="M5 6.5 8 9.5l3-3" />
      <path d="M2.5 11.5v1.5c0 .55.45 1 1 1h9c.55 0 1-.45 1-1v-1.5" />
    </Glyph>
  )
}

/** 缓存读取：箭头从缓存柱指出——从缓存里取回的那一份。 */
function CacheReadGlyph() {
  return (
    <Glyph>
      <ellipse cx={4.8} cy={4.6} rx={3.2} ry={1.3} />
      <path d="M1.6 4.6v6.4c0 .72 1.43 1.3 3.2 1.3s3.2-.58 3.2-1.3V4.6" />
      <path d="M9.2 8h4.8" />
      <path d="M11.5 5.5 14 8l-2.5 2.5" />
    </Glyph>
  )
}

/** 缓存写入：箭头指回缓存柱——写进缓存的那一份。 */
function CacheWriteGlyph() {
  return (
    <Glyph>
      <ellipse cx={4.8} cy={4.6} rx={3.2} ry={1.3} />
      <path d="M1.6 4.6v6.4c0 .72 1.43 1.3 3.2 1.3s3.2-.58 3.2-1.3V4.6" />
      <path d="M14 8H9.2" />
      <path d="M11.5 5.5 9 8l2.5 2.5" />
    </Glyph>
  )
}

/** 输出：箭头朝上出框——离开模型的回答。 */
function OutputGlyph() {
  return (
    <Glyph>
      <path d="M8 10.5v-7" />
      <path d="M5 6.5 8 3.5l3 3" />
      <path d="M2.5 11.5v1.5c0 .55.45 1 1 1h9c.55 0 1-.45 1-1v-1.5" />
    </Glyph>
  )
}

/** 指标 → 字形。缓存读写共用缓存柱、靠箭头方向区分；输入输出共用托盘、靠箭头方向区分。 */
const GLYPHS: Record<MetricRow['key'], () => ReactElement> = {
  total: DatabaseGlyph,
  requests: CountGlyph,
  'cache-hit': TargetGlyph,
  'uncached-input': InputGlyph,
  'cache-read': CacheReadGlyph,
  'cache-write': CacheWriteGlyph,
  output: OutputGlyph,
}

/**
 * 渲染一行指标：图标、标签、右对齐的数值。
 * @param props.row - 指标行。
 * @returns 面板行元素。
 */
function MetricRowView({ row }: { readonly row: MetricRow }) {
  const Icon = GLYPHS[row.key]
  return (
    <div data-session-panel-row="" data-today-token-usage={row.key}>
      <span data-row-part="body">
        <span data-row-part="icon" aria-hidden="true">
          <Icon />
        </span>
        <span data-row-part="content">{row.label}</span>
      </span>
      <span data-row-part="trailing">{row.value}</span>
    </div>
  )
}

/**
 * 把合计摊成面板里的行；缓存命中与缓存写入按上游详表的规矩缺省隐藏。
 * @param totals - 当天的合计。
 * @param t - 本插件文案。
 * @returns 依次渲染的行。
 */
function rowsOf(totals: TodayTotals, t: TodayUsageSectionProps['t']): MetricRow[] {
  const rows: MetricRow[] = [
    { key: 'total', label: t('row.total'), value: formatCompactTokens(totals.total, t) },
    { key: 'requests', label: t('row.requests'), value: formatCompactTokens(totals.requests, t) },
  ]
  const cacheHit = formatCacheHitPercent(totals.cacheRead, totals.prompt)
  if (cacheHit !== null) {
    rows.push({ key: 'cache-hit', label: t('row.cacheHit'), value: `${cacheHit}%` })
  }
  rows.push(
    { key: 'uncached-input', label: t('row.uncachedInput'), value: formatCompactTokens(totals.uncachedInput, t) },
    { key: 'cache-read', label: t('row.cacheRead'), value: formatCompactTokens(totals.cacheRead, t) },
  )
  // 没有缓存写入的提供方（多数）不占一行，与上游详表的做法一致。
  if (totals.cacheWrite !== 0) {
    rows.push({ key: 'cache-write', label: t('row.cacheWrite'), value: formatCompactTokens(totals.cacheWrite, t) })
  }
  rows.push({ key: 'output', label: t('row.output'), value: formatCompactTokens(totals.output, t) })
  return rows
}

/**
 * 把一份合计渲染成面板行（纯展示，便于直接测试）。
 * @param props.totals - 当天合计。
 * @param props.t - 本插件文案。
 * @returns 依次渲染的行；合计为 0 时渲染为空。
 */
export function TodayUsageRows({ totals, t }: { totals: TodayTotals; t: TodayUsageSectionProps['t'] }): ReactNode {
  if (totals.total === 0) return null
  return <>{rowsOf(totals, t).map(row => <MetricRowView key={row.key} row={row} />)}</>
}

/**
 * 渲染「今日 Token 用量」一栏。
 *
 * 今天没有任何用量（或宿主暂时没给数据）时渲染空——面板会连标题一起隐藏，与其它分区一致。
 * @param props - 标准 props 与本插件文案；只用 `t`。
 * @returns 面板各行。
 */
export function TodayUsageSection({ t }: TodayUsageSectionProps): ReactNode {
  const payload = useTodayUsage()
  const totals = useMemo(() => (payload === undefined ? undefined : totalsOf(payload)), [payload])
  if (totals === undefined) return null
  return <TodayUsageRows totals={totals} t={t} />
}
