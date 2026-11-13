/**
 * 新会话行里的「团队协作」开关。
 *
 * 状态来自会话的 `agentTeam` 投影，写入走注册项交进来的
 * `remote.agentTeams.setEnabled(sessionId, enabled)`；不做乐观更新，
 * 点击后只加 pending 锁，等投影自己追上。
 *
 * 只对根会话渲染：子代理会话里 Host 会以 `TEAM_LEAD_REQUIRED` 拒绝写入。
 * 这里不复制模型菜单的「停用确认」弹窗——本控件只在首轮前的 hero 行出现，
 * 上游的确认条件（`modelSelection.lastUsed !== null`）正常路径不会成立；
 * 菜单里的原入口仍保留，会话中停用走上游那一条。
 */
import { createElement, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { GlobalStandardProps, SessionStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
// 空类型导入(不引入任何名字):加载 ui-session 对标准 props 的合并
// (`useSession` / `useProjection` / `useSessions`) 与 ui-conversation 的 `agentTeam`
// 投影键声明,不产生运行时导入。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-agent-team/types'
import { failureMessage, messageOf, shouldRender } from './logic.ts'
import type { HeroLocaleNS } from './locales.ts'
import { CLASS } from './styles.ts'

/**
 * 槽位标准 props 中本控件使用的读值钩子。
 *
 * 直接取上游标准 props 的命名座位:Session 生命周期选择器、会话目录选择器与
 * projection 读取座位都由 ui-session / ui-slots 声明,本插件不再本地复写
 * `HeroSessionSnapshot` / `HeroSessionRow` 之类的行列形状。
 */
export type HeroToggleHooks = Pick<
  SessionStandardProps & GlobalStandardProps,
  'useSession' | 'useSessions' | 'useProjection'
>

/** 注册项 `inject` 交出的会话绑定。 */
export interface HeroToggleInjected {
  readonly setEnabled: (enabled: boolean) => Promise<RemoteResult<void>>
}

/** 完整组件 props：标准 props + 注入面 + 本插件字典的 `t`。 */
export interface HeroToggleProps extends HeroToggleHooks, HeroToggleInjected {
  readonly sessionId: SessionId
  readonly t: TranslateNS<HeroLocaleNS>
}

/**
 * 渲染「团队协作」开关。
 *
 * @param props - 会话身份、投影读值、写入回调与本地化文案。
 * @returns 开关；子代理会话或投影缺席时不渲染。
 */
export function TeamModeHeroToggle(props: HeroToggleProps): ReactNode {
  const { sessionId, useSession, useSessions, useProjection, setEnabled, t } = props
  const addressedChild = useSession((snapshot: SessionSnapshot) => snapshot.subagent !== null)
  const listedChild = useSessions(
    (state: SessionListState) => state.byId[sessionId]?.origin === 'subagent',
  )
  const projection = useProjection('agentTeam')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (projection === undefined
    || !shouldRender({ addressedChild, listedChild, hasProjection: true })) return null

  const enabled = projection.enabled
  const change = (): void => {
    if (pending) return
    setPending(true)
    setError(null)
    void setEnabled(!enabled).then(
      (result) => {
        const failure = failureMessage(result)
        if (failure === null) return
        setError(failure)
        console.warn(`[dsh-agent-team-hero-toggle] 保存团队协作设置失败：${failure}`)
      },
      (cause: unknown) => {
        const message = messageOf(cause)
        setError(message)
        console.warn(`[dsh-agent-team-hero-toggle] 保存团队协作设置失败：${message}`)
      },
    ).finally(() => { setPending(false) })
  }

  const failureText = error === null ? null : t('failed', { message: error })
  return createElement(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': enabled,
      'aria-label': t('ariaLabel'),
      title: failureText ?? t('description'),
      className: CLASS.chip,
      disabled: pending,
      'data-error': failureText === null ? undefined : '',
      onClick: change,
    },
    createElement(
      'span',
      { className: CLASS.track, 'aria-hidden': 'true' },
      createElement('span', { className: CLASS.thumb }),
    ),
    createElement('span', null, t('label')),
    failureText === null
      ? null
      : createElement('span', { className: CLASS.error, role: 'img', 'aria-label': failureText }, '!'),
  )
}
