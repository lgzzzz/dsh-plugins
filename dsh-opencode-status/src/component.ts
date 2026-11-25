/**
 * 「OpenCode Go」一栏：会话面板里每 5 秒刷新一次的上游状态读数。
 *
 * ```
 * 模型                 deepseek-v4.1-flash
 * 状态                 降级 · 延迟
 * 首 Token             9.1 秒
 * 吞吐                 148 tok/s
 * ```
 *
 * 数据来自宿主半部的同源路由 `GET /opencode-status/status`（主站接口不带 CORS 头，页面不能
 * 直连）。宿主侧在后台保活刷新，页面一装载也开始唯一一个 5 秒轮询并把读数留在内存里，所以
 * 打开 / 切换会话时这里第一帧就能读到最近一份快照，不会先空一拍再出现。宿主取不到时保留
 * 最后一次成功读数；从未成功过则显示一行「暂时无法获取」。
 *
 * 行直接用会话面板给 `[data-session-panel-row]` / `[data-row-part]` 铺的通用规则：
 * 每行一个 16px 字形，标签在 content、读数在 trailing。
 */

import { createElement, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 空类型导入：加载 session-panel 对分区槽的声明（只影响类型）。
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import type { NS } from './locales.ts'
import { statusRows } from './rows.ts'
import type { StatusRow, StatusRowKey } from './rows.ts'
import { statusStore } from './status-store.ts'
import type { OpencodeStatusReply } from './wire.ts'

/** 完整组件 props：分区槽的标准 props + 本插件字典的 `t`。 */
export type OpencodeStatusSectionProps =
  PropsRuntime<'conversation.session.panel.section'>
  & PropsLocale<typeof NS>

/**
 * 读取共享的最近一份响应。
 *
 * 初始状态直接从模块级读数仓同步取：页面装载时后台轮询已经启动，切换会话重挂载时这里
 * 已经有一份成功读数，第一帧就有内容。之后订阅变化；轮询本身是后台任务，组件卸载不停止它。
 * 一次成功之后如果刷新失败，读数仓会保留最后一份成功读数（而不是切成错误行）——宿主自己
 * 已经会用缓存兜底上游失败，这里的失败更可能是宿主路由不可达；保留旧数据比清空整栏更有用。
 * @returns 最近一份可展示的响应，或 undefined（页面还没拿到任何响应）。
 */
function useStatusReply(): OpencodeStatusReply | undefined {
  const [reply, setReply] = useState<OpencodeStatusReply | undefined>(() => statusStore.current())
  useEffect(() => {
    // 幂等：正常情况下页面装载时已经启动；这里兜住组件比插件 apply 更早挂载的极端顺序。
    statusStore.start()
    return statusStore.subscribe(setReply)
  }, [])
  return reply
}

/**
 * 一个 16px 线框字形：所有行共用同一套笔画（1.2px、圆头圆角、颜色随行文字），
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

/** Go 服务：云——外部提供方。 */
function CloudGlyph() {
  return glyph([
    createElement('path', {
      key: 'cloud',
      d: 'M4.6 12h6.8a2.2 2.2 0 0 0 .15-4.39 3.2 3.2 0 0 0-6.12-.8A2.3 2.3 0 0 0 4.6 12Z',
    }),
  ])
}

/** 模型：六边形——一个被观测的模型条目。 */
function ModelGlyph() {
  return glyph([
    createElement('path', { key: 'outline', d: 'M8 2.2 13.1 5.1v5.8L8 13.8 2.9 10.9V5.1Z' }),
    createElement('circle', { key: 'core', cx: 8, cy: 8, r: 1.2 }),
  ])
}

/** 状态：脉冲线——服务健康的惯用画法。 */
function PulseGlyph() {
  return glyph([
    createElement('path', { key: 'line', d: 'M2.2 8h2.6l1.4-3.4L9.2 11.4 10.6 8h3.2' }),
  ])
}

/** 首 Token：时钟——等到第一个字的时长。 */
function ClockGlyph() {
  return glyph([
    createElement('circle', { key: 'face', cx: 8, cy: 8, r: 5.2 }),
    createElement('path', { key: 'hands', d: 'M8 4.8V8l2.3 1.4' }),
  ])
}

/** 吞吐：仪表盘——每秒出多少字。 */
function GaugeGlyph() {
  return glyph([
    createElement('path', { key: 'dial', d: 'M3 11.2a5 5 0 0 1 10 0' }),
    createElement('path', { key: 'needle', d: 'M8 11.2 10.6 7.6' }),
    createElement('circle', { key: 'pivot', cx: 8, cy: 11.2, r: 0.8 }),
  ])
}

/** 失败：警告三角——暂时拿不到数据。 */
function AlertGlyph() {
  return glyph([
    createElement('path', { key: 'outline', d: 'M8 2.6 14.1 13H1.9Z' }),
    createElement('path', { key: 'stem', d: 'M8 6.3v3.1' }),
    createElement('circle', { key: 'dot', cx: 8, cy: 11.4, r: 0.6, fill: 'currentColor', stroke: 'none' }),
  ])
}

/** 行 → 字形。 */
const GLYPHS: Record<StatusRowKey, () => ReactNode> = {
  service: CloudGlyph,
  model: ModelGlyph,
  status: PulseGlyph,
  ttft: ClockGlyph,
  tps: GaugeGlyph,
  error: AlertGlyph,
}

/**
 * 渲染一行读数：图标、标签、右对齐的读数。
 * @param row - 面板行。
 * @returns 面板行元素。
 */
function statusRow(row: StatusRow) {
  return createElement(
    'div',
    { key: row.key, 'data-session-panel-row': '', 'data-opencode-status': row.key },
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
 * 把一组行渲染成面板行（纯展示，便于直接测试）。
 * @param props.rows - {@link statusRows} 的输出。
 * @returns 依次渲染的行。
 */
export function StatusRows({ rows }: { readonly rows: readonly StatusRow[] }): ReactNode {
  return rows.map(statusRow)
}

/**
 * 渲染「OpenCode Go」一栏。
 *
 * 还没有任何响应时渲染空——面板会连标题一起隐藏，与其它分区一致。
 * @param props - 标准 props 与本插件文案；只用 `t`。
 * @returns 面板各行。
 */
export function OpencodeStatusSection({ t }: OpencodeStatusSectionProps): ReactNode {
  const reply = useStatusReply()
  const rows = useMemo(() => statusRows(reply, t), [reply, t])
  if (rows === null) return null
  return StatusRows({ rows })
}
