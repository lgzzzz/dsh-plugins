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
import { failureMessage, messageOf, shouldRender, type RemoteResult } from './logic.ts'
import { CLASS } from './styles.ts'

/** 会话快照里本控件用到的字段。 */
export interface HeroSessionSnapshot {
  /** 子代理血缘；根会话为 null。 */
  readonly subagent: unknown
}

/** 会话目录行里本控件用到的字段。 */
export interface HeroSessionRow {
  /** `'subagent'` 表示这一行来自子代理会话。 */
  readonly origin?: string
}

/** 槽位标准 props 中本控件使用的读值钩子。 */
export interface HeroToggleHooks {
  readonly useSession: <T>(selector: (snapshot: HeroSessionSnapshot) => T) => T
  readonly useSessions: <T>(selector: (
    state: { readonly byId: Readonly<Record<string, HeroSessionRow | undefined>> },
  ) => T) => T
  readonly useProjection: (key: 'agentTeam') => { readonly enabled: boolean } | undefined
}

/** 注册项 `inject` 交出的会话绑定。 */
export interface HeroToggleInjected {
  readonly setEnabled: (enabled: boolean) => Promise<RemoteResult>
}

/** 完整组件 props：标准 props + 注入面 + 本插件字典的 `t`。 */
export interface HeroToggleProps extends HeroToggleHooks, HeroToggleInjected {
  readonly sessionId: string
  readonly t: (key: string, params?: Record<string, string | number>) => string
}

/**
 * 渲染「团队协作」开关。
 *
 * @param props - 会话身份、投影读值、写入回调与本地化文案。
 * @returns 开关；子代理会话或投影缺席时不渲染。
 */
export function TeamModeHeroToggle(props: HeroToggleProps): ReactNode {
  const { sessionId, useSession, useSessions, useProjection, setEnabled, t } = props
  const addressedChild = useSession(snapshot => snapshot.subagent !== null)
  const listedChild = useSessions(state => state.byId[sessionId]?.origin === 'subagent')
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
