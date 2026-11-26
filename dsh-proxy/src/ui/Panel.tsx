/**
 * 主面板：状态条 + 四个页签 + 滚动区。
 *
 * 只有布局与事件转发；规则/节点的数据、轮询与写操作都在 {@link useProxyPanel} 里，
 * 「连接」页签的取数在 `use-traffic.ts`。对外文案统一走 {@link useTranslate}。
 */

import { useState } from 'react'
import type { PanelState } from './api.ts'
import { Button } from './Controls.tsx'
import { Banner } from './Diagnostics.tsx'
import { fill } from './locale.ts'
import type { LocaleKey } from './locale.ts'
import { useTranslate } from './locale-context.tsx'
import { LogsTab } from './LogsTab.tsx'
import { NodesTab } from './NodesTab.tsx'
import { RulesTab } from './RulesTab.tsx'
import { TrafficTab } from './TrafficTab.tsx'
import { useProxyPanel } from './use-proxy-panel.ts'
import css from './Panel.module.css'

/** 页签顺序；同时决定 `tab.<id>` 这组词条的键。 */
const TABS = ['rules', 'nodes', 'traffic', 'logs'] as const

/** 页签 id。 */
type TabId = (typeof TABS)[number]

/** 面板词条的翻译函数。 */
type Translate = (key: LocaleKey) => string

/**
 * 把内核状态折成一个短标签。
 * @param state - 内核状态枚举。
 * @param t - 翻译函数。
 * @returns 本地化标签。
 */
function stateLabel(
  state: PanelState['status']['core']['state'],
  t: Translate,
): string {
  switch (state) {
    case 'running': return t('status.running')
    case 'starting': return t('status.starting')
    case 'error': return t('status.error')
    default: return t('status.stopped')
  }
}

/** {@link StatusBar} 的入参。 */
interface StatusBarProps {
  /** 最近一次 `/state` 快照。 */
  state: PanelState
  /** 是否有写操作在途（禁用启停按钮）。 */
  busy: boolean
  /** 启动内核。 */
  onStart: () => void
  /** 停止内核。 */
  onStop: () => void
  /** 重启内核。 */
  onRestart: () => void
}

/**
 * 面板顶部的状态条：状态点、端口、规则/节点计数、内核版本，以及启停按钮。
 * @param props - 快照与启停回调。
 * @returns 状态条元素。
 */
function StatusBar({ state, busy, onStart, onStop, onRestart }: StatusBarProps) {
  const t = useTranslate()
  const core = state.status.core
  return (
    <div className={css['status']}>
      <span className={css['dot']} data-state={core.state} />
      <span className={css['state']}>{stateLabel(core.state, t)}</span>
      <span className={css['meta']}>
        <span>
          {fill(t('status.ports'), {
            socks: String(state.status.ports.socks),
            http: String(state.status.ports.http),
          })}
        </span>
        <span>{fill(t('status.rules'), { count: String(state.status.enabledRuleCount) })}</span>
        <span>{fill(t('status.nodes'), { count: String(state.status.nodeCount) })}</span>
        <span>
          {t('status.binary')}：{core.version ?? (core.binary === null ? t('status.binaryMissing') : core.binary)}
        </span>
      </span>
      <span className={css['spacer']} />
      {core.running ? (
        <>
          <Button disabled={busy} onClick={onRestart}>{t('action.restart')}</Button>
          <Button disabled={busy} onClick={onStop}>{t('action.stop')}</Button>
        </>
      ) : (
        <Button variant="primary" disabled={busy} onClick={onStart}>{t('action.start')}</Button>
      )}
    </div>
  )
}

/**
 * 渲染分流路由面板。
 * @returns 面板元素；首次取数完成前显示加载 / 错误占位。
 */
export function ProxyPanel() {
  const t = useTranslate()
  const panel = useProxyPanel(t)
  const [tab, setTab] = useState<TabId>('rules')
  const state = panel.state

  if (state === null) {
    return (
      <div className={css['panel']}>
        <div className={css['body']}>
          {panel.error === '' ? t('common.loading') : `${t('common.error')}：${panel.error}`}
        </div>
      </div>
    )
  }

  const core = state.status.core

  return (
    <div className={css['panel']}>
      <StatusBar
        state={state}
        busy={panel.busy}
        onStart={panel.start}
        onStop={panel.stop}
        onRestart={panel.restart}
      />

      <div className={css['tabs']}>
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            className={css['tab']}
            data-active={tab === entry}
            onClick={() => { setTab(entry) }}
          >
            {t(`tab.${entry}`)}
          </button>
        ))}
      </div>

      <div className={css['body']}>
        {panel.error === '' ? null : <Banner severity="error">{panel.error}</Banner>}
        {panel.message === '' ? null : <Banner>{panel.message}</Banner>}
        {core.lastError === null ? null : <Banner severity="error">{core.lastError}</Banner>}

        {tab === 'rules' ? (
          <RulesTab
            draft={panel.draft}
            dirty={panel.dirty}
            busy={panel.busy}
            exits={state.routing.exits}
            exitLabels={state.routing.exitLabels ?? {}}
            diagnostics={panel.diagnostics}
            storedDiagnostics={state.routing.diagnostics}
            onChange={panel.edit}
            onCheck={panel.check}
            onApply={panel.apply}
            onReset={panel.reset}
          />
        ) : null}
        {tab === 'nodes' ? (
          <NodesTab
            nodes={state.nodes.nodes}
            selectedNode={state.nodes.selectedNode}
            subscriptions={state.nodes.subscriptions}
            busy={panel.busy}
            onImport={panel.importSubscription}
            onSelect={panel.selectNode}
            onLatency={panel.testLatency}
          />
        ) : null}
        {tab === 'traffic' ? <TrafficTab /> : null}
        {tab === 'logs' ? <LogsTab logs={state.logs} /> : null}
      </div>
    </div>
  )
}
