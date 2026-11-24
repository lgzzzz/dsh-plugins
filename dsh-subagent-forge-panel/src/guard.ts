/**
 * 子智能体会话里的「不显示」守卫：让 forge 的 Git 与变更请求行直接不出现。
 *
 * 上游 forge 的连接行只在它的面板流断开时出现；子智能体会话的流**必然**断开
 * （Host 的普通会话路由拒绝 `header.origin === 'subagent'` 的身份，`follow` 在第一帧状态
 * 之前就结束），于是那一行连同「重试」一直挂在面板里，点几次也不会成功。
 *
 * 本组件不显示任何内容：子会话里它渲染一个 `hidden` 的零尺寸标记元素，`useEffect` 拿它当作
 * 定位点，给最近的 `[data-session-panel-section]` 打上标记（见 `src/mark.ts`），样式表据此在
 * 该分区里隐藏 `[data-forge-connection]`（见 `src/styles.ts`）。标记元素本身 `display: none`，
 * 不占行、不进无障碍树。
 *
 * 普通会话上整行渲染为空，面板与没有本插件时完全一致。
 */
import { createElement, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 空类型导入(不引入任何名字):加载 ui-session 对标准 props 的合并
// (`useSession` / `useSessions` / `sessionId`)与 session-panel 对行槽的 SlotMap 声明。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client'
import { isSubagentSession } from './detect.ts'
import { markSectionOfRow } from './mark.ts'

/** 完整组件 props：行槽的标准 props（本组件不渲染可见内容，因此不需要字典）。 */
export type ForgePanelGuardProps = PropsRuntime<'conversation.session.panel.environment.row'>

/**
 * 在子智能体会话里隐藏 forge 的连接行。
 *
 * @param props - 当前会话与会话快照 / 列表选择器。
 * @returns 子智能体会话里一个不可见的标记元素；普通会话渲染为空。
 */
export function ForgePanelGuard({ sessionId, useSession, useSessions }: ForgePanelGuardProps): ReactNode {
  const address = useSession((snapshot: SessionSnapshot) => snapshot.subagent?.address ?? null)
  // 取原始值而不是列表行本身：行对象在列表刷新时可能是新引用，选它会带来无谓的重渲染。
  const origin = useSessions((state: SessionListState) => state.byId[sessionId]?.origin)
  const subagent = isSubagentSession({ sessionId, address, origin })
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!subagent) return undefined
    return markSectionOfRow(ref.current)
  }, [subagent, sessionId])
  if (!subagent) return null
  return createElement('span', {
    ref,
    // React 对布尔属性只认布尔值：字符串 '' 会被当成 false 丢掉。
    hidden: true,
    'aria-hidden': 'true',
    'data-forge-subagent-guard': '',
  })
}
