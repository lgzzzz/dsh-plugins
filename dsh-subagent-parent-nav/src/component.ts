/**
 * 「主智能体」一栏：子智能体会话的会话面板里，按从上到下的上级链列出主智能体与各级上级。
 *
 * 每行一个按钮：状态点报告该会话是否在运行，点一行就把主视图切到那个会话并收起面板浮层。
 * 根会话没有上级，整节渲染为空——面板会连标题一起隐藏，所以根会话的面板与现在完全一样。
 */
import { createElement, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// 空类型导入(不引入任何名字):加载 ui-session 对标准 props 的合并
// (`useSession` / `useSessions` / `sessionId`)与 session-panel 对分区槽的 SlotMap 声明。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { ancestorRows, type AncestorRow } from './lineage.ts'
import type { NS } from './locales.ts'
import { CLASS } from './styles.ts'

/** 注册项 `inject` 交出的业务面。 */
export interface SubagentParentInjected {
  /**
   * 把主视图切到该会话。
   * @returns 是否成功；成功时调用方才收起面板浮层。
   */
  readonly open: (sessionId: SessionId) => boolean
}

/** 完整组件 props：分区槽的标准 props + 注入面 + 本插件字典的 `t`。 */
export type SubagentParentSectionProps =
  PropsRuntime<'conversation.session.panel.section'>
  & InjectFace<SubagentParentInjected>
  & PropsLocale<typeof NS>

/** 行尾的跳转箭头：与产品 chevron 同一路径、同一 14px 字形，只作视觉提示。 */
function Arrow() {
  return createElement(
    'svg',
    { width: 14, height: 14, viewBox: '1 1 14 14', fill: 'none', 'aria-hidden': 'true' },
    createElement('path', {
      d: 'M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4',
      stroke: 'currentColor',
      strokeWidth: 1,
    }),
  )
}

/**
 * 一行上级：状态点、标题、角色标签与跳转箭头。
 *
 * 直接返回元素而不是组件：这里没有状态与生命周期，平铺调用让产物测试能按元素树断言。
 *
 * @param props - 这一行的数据、是否显示角色标签、点击回调与文案。
 * @returns 列表项。
 */
function ancestorItem({ row, showRole, onOpen, t }: {
  readonly row: AncestorRow
  readonly showRole: boolean
  readonly onOpen: (sessionId: SessionId) => void
  readonly t: SubagentParentSectionProps['t']
}) {
  const label = row.running ? t('row.jumpRunning', { title: row.title }) : t('row.jump', { title: row.title })
  return createElement(
    'li',
    { key: row.sessionId, className: CLASS.item },
    createElement(
      'button',
      {
        type: 'button',
        className: CLASS.row,
        // 标题可能被省略号截断，原生 title 是面板窄行里成本最低的看全名方式。
        title: row.title,
        'aria-label': label,
        ...(row.running ? { 'data-running': '' } : {}),
        onClick: () => { onOpen(row.sessionId) },
      },
      createElement(
        'span',
        { className: CLASS.dotSlot, 'aria-hidden': 'true' },
        createElement('span', { className: CLASS.dot }),
      ),
      createElement('span', { className: CLASS.title }, row.title),
      showRole && !row.root
        ? createElement('span', { className: CLASS.role }, t('row.parent'))
        : null,
      createElement('span', { className: CLASS.arrow, 'aria-hidden': 'true' }, createElement(Arrow)),
    ),
  )
}

/**
 * 渲染「主智能体」一栏。
 *
 * @param props - 当前会话、会话列表选择器、面板归属值、跳转动作与本地化文案。
 * @returns 上级链列表；没有上级时渲染空。
 */
export function SubagentParentSection({
  sessionId, useSession, useSessions, dismissOverlay, open, t,
}: SubagentParentSectionProps): ReactNode {
  const address = useSession((snapshot: SessionSnapshot) => snapshot.subagent?.address ?? null)
  const summaries = useSessions((state: SessionListState) => state.byId)
  const projections = useSessions((state: SessionListState) => state.projectionsBySession)
  const rows = useMemo(
    () => ancestorRows({ sessionId, address, summaries, projections }),
    [sessionId, address, summaries, projections],
  )
  if (rows.length === 0) return null
  const jump = (target: SessionId): void => {
    // 跳转失败时面板留在原地：关掉浮层却不换会话，只会让人以为点丢了。
    if (open(target)) dismissOverlay()
  }
  return createElement(
    'ul',
    // 面板的列表样式是 `list-style: none`，Safari / VoiceOver 会因此丢掉列表语义，显式补回。
    { className: CLASS.list, role: 'list', 'data-subagent-parent-nav': '' },
    rows.map(row => ancestorItem({ row, showRole: rows.length > 1, onOpen: jump, t })),
  )
}
