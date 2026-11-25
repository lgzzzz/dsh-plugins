/**
 * 浏览器半部：「分流路由」面板。
 *
 * 两个注册点：侧栏图标（`sidebar.panellist`，id `proxy`）与主面板（`main`，key `proxy`）。
 * 取数全部走 `/proxy-api/*`（同源 cookie），状态每 2 秒轮询一次，页面隐藏时暂停。
 */

import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
// 仅类型：把 `ctx.slots` / `ctx.locale` 与 `main` / `sidebar.panellist` 的槽契约带进程序。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

const PANEL_ID = 'proxy'
const LOCALE_NS = 'proxy.panel'

export const inject = ['slots', 'locale']

/* ------------------------------------------------------------------ 词条 */

const ZH: Record<string, string> = {
  panel: '分流路由',
  'status.running': '运行中',
  'status.stopped': '未运行',
  'status.starting': '启动中',
  'status.error': '出错',
  'status.ports': 'SOCKS {socks} · HTTP {http}',
  'status.rules': '{count} 条规则',
  'status.nodes': '{count} 个节点',
  'status.binary': '内核',
  'status.binaryMissing': '未找到 xray',
  'status.noNode': '未选节点',
  'action.start': '启动',
  'action.stop': '停止',
  'action.restart': '重启',
  'tab.rules': '规则',
  'tab.nodes': '节点',
  'tab.simulate': '模拟',
  'tab.logs': '日志',
  'rules.empty': '还没有规则，所有流量走兜底出口。',
  'rules.default': '兜底出口',
  'rules.new': '新增规则',
  'rules.check': '校验',
  'rules.apply': '应用',
  'rules.reset': '重置',
  'rules.dirty': '有未应用的改动',
  'rules.order': '拖动顺序即匹配顺序：上面先命中。',
  'rules.enabled': '启用',
  'rules.up': '上移',
  'rules.down': '下移',
  'rules.remove': '删除',
  'field.id': 'id',
  'field.name': '名字',
  'field.out': '出口',
  'field.domain': '域名',
  'field.ip': 'IP',
  'field.port': '端口',
  'field.protocol': '协议',
  'field.hint': '多个值用空格或逗号分隔；留空表示不限制。',
  'nodes.empty': '还没有节点。导入订阅后，规则里就能用节点 tag 当出口。',
  'nodes.import': '导入订阅',
  'nodes.url': '订阅地址',
  'nodes.name': '名字（可选）',
  'nodes.select': '选为默认',
  'nodes.selected': '已选中',
  'nodes.latency': '测延迟',
  'nodes.protocol': '协议',
  'nodes.subscriptions': '订阅',
  'simulate.domain': '域名',
  'simulate.ip': 'IP',
  'simulate.port': '端口',
  'simulate.network': '网络',
  'simulate.run': '试一下',
  'simulate.matched': '命中',
  'simulate.fallback': '没有规则命中，走兜底出口',
  'simulate.indeterminate': '无法判定',
  'simulate.uncertain': '可能抢先命中',
  'simulate.uncertainNote': '结论不是必然：前面的规则可能抢先命中。',
  'simulate.opaque': '需要 geo 数据',
  'simulate.missing': '缺少输入',
  'simulate.skipped': '跳过',
  'simulate.warnings': '注意',
  'simulate.assumptions': '前提',
  'logs.empty': '还没有日志。',
  'logs.hint': '内核启动、规则应用与失败都记在这里。',
  'message.saved': '已保存',
  'message.checkOk': '校验通过',
  'message.checkFailed': '校验未通过',
  'common.loading': '加载中…',
  'common.error': '出错了',
  'common.retry': '重试',
  'common.none': '无',
}

const EN: Record<string, string> = {
  panel: 'Split routing',
  'status.running': 'Running',
  'status.stopped': 'Stopped',
  'status.starting': 'Starting',
  'status.error': 'Error',
  'status.ports': 'SOCKS {socks} · HTTP {http}',
  'status.rules': '{count} rules',
  'status.nodes': '{count} nodes',
  'status.binary': 'Kernel',
  'status.binaryMissing': 'xray not found',
  'status.noNode': 'No node selected',
  'action.start': 'Start',
  'action.stop': 'Stop',
  'action.restart': 'Restart',
  'tab.rules': 'Rules',
  'tab.nodes': 'Nodes',
  'tab.simulate': 'Simulate',
  'tab.logs': 'Logs',
  'rules.empty': 'No rules yet; everything uses the fallback exit.',
  'rules.default': 'Fallback exit',
  'rules.new': 'New rule',
  'rules.check': 'Check',
  'rules.apply': 'Apply',
  'rules.reset': 'Reset',
  'rules.dirty': 'Unapplied changes',
  'rules.order': 'Order is matching order: the first match wins.',
  'rules.enabled': 'Enabled',
  'rules.up': 'Move up',
  'rules.down': 'Move down',
  'rules.remove': 'Delete',
  'field.id': 'id',
  'field.name': 'Name',
  'field.out': 'Exit',
  'field.domain': 'Domains',
  'field.ip': 'IPs',
  'field.port': 'Ports',
  'field.protocol': 'Protocols',
  'field.hint': 'Separate values with spaces or commas; leave empty for no constraint.',
  'nodes.empty': 'No nodes yet. Import a subscription to use node tags as exits.',
  'nodes.import': 'Import subscription',
  'nodes.url': 'Subscription URL',
  'nodes.name': 'Name (optional)',
  'nodes.select': 'Make default',
  'nodes.selected': 'Selected',
  'nodes.latency': 'Test latency',
  'nodes.protocol': 'Protocol',
  'nodes.subscriptions': 'Subscriptions',
  'simulate.domain': 'Domain',
  'simulate.ip': 'IP',
  'simulate.port': 'Port',
  'simulate.network': 'Network',
  'simulate.run': 'Simulate',
  'simulate.matched': 'Matched',
  'simulate.fallback': 'Nothing matched; the fallback exit is used',
  'simulate.indeterminate': 'Indeterminate',
  'simulate.uncertain': 'Could match first',
  'simulate.uncertainNote': 'Not certain: an earlier rule may match first.',
  'simulate.opaque': 'needs geo data',
  'simulate.missing': 'missing input',
  'simulate.skipped': 'Skipped',
  'simulate.warnings': 'Caveats',
  'simulate.assumptions': 'Assumptions',
  'logs.empty': 'No log lines yet.',
  'logs.hint': 'Kernel start, rule application, and failures are recorded here.',
  'message.saved': 'Saved',
  'message.checkOk': 'Check passed',
  'message.checkFailed': 'Check failed',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong',
  'common.retry': 'Retry',
  'common.none': 'none',
}

/* ------------------------------------------------------------------ 样式 */

const CSS = `
.proxy-panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.proxy-status{display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none;flex-wrap:wrap}
.proxy-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}
.proxy-dot[data-state=running]{background:var(--dsw-alias-state-success-primary)}
.proxy-dot[data-state=starting]{background:var(--dsw-alias-state-warn-primary)}
.proxy-dot[data-state=error]{background:var(--dsw-alias-state-error-primary)}
.proxy-state{font-size:13px;font-weight:500}
.proxy-meta{font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;gap:12px;flex-wrap:wrap}
.proxy-spacer{flex:1}
.proxy-tabs{display:flex;gap:20px;padding:0 20px;border-bottom:.5px solid var(--dsw-alias-border-l2);flex:none}
.proxy-tab{background:none;border:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:10px 0;cursor:pointer;border-bottom:2px solid transparent}
.proxy-tab[data-active=true]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary)}
.proxy-body{flex:1;min-height:0;overflow:auto;padding:16px 20px 32px}
.proxy-hint{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0 0 12px}
.proxy-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;margin-bottom:6px;background:var(--dsw-alias-bg-layer-1)}
.proxy-row[data-disabled=true]{opacity:.55}
.proxy-index{font-size:11px;color:var(--dsw-alias-label-secondary);width:18px;flex:none;text-align:right}
.proxy-rule-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.proxy-rule-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.proxy-rule-match{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.proxy-tag{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);flex:none}
.proxy-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.proxy-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l1)}
.proxy-btn:disabled{opacity:.5;cursor:default}
.proxy-btn[data-kind=primary]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.proxy-btn[data-kind=danger]{color:var(--dsw-alias-state-error-primary)}
.proxy-btn[data-kind=icon]{padding:2px 6px;background:none;border:none;color:var(--dsw-alias-label-secondary)}
.proxy-form{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;padding:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.proxy-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:120px;flex:1}
.proxy-input{font:inherit;font-size:13px;padding:5px 8px;border-radius:6px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);min-width:0}
.proxy-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px}
.proxy-diag{font-size:12px;margin:6px 0;padding:8px 10px;border-radius:6px;border-left:3px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-1);white-space:pre-wrap;overflow-wrap:anywhere}
.proxy-diag[data-severity=error]{border-left-color:var(--dsw-alias-state-error-primary)}
.proxy-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px;margin-top:12px;background:var(--dsw-alias-bg-layer-1);font-size:13px;line-height:1.7}
.proxy-kv{display:flex;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.proxy-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.proxy-logs{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}
.proxy-empty{font-size:13px;color:var(--dsw-alias-label-secondary);padding:24px 0;text-align:center}
`

/* ------------------------------------------------------------------ 取数 */

interface LogLine {
  time: number
  source: string
  text: string
}

interface Diagnostic {
  severity: 'error' | 'warning'
  code: string
  path: string
  message: string
  ruleId?: string
}

interface Rule {
  id: string
  name?: string
  enabled?: boolean
  match: Record<string, string[] | undefined>
  out: string
}

interface Routing {
  default: string
  rules: Rule[]
}

interface ExplainResult {
  matched: { id: string; name?: string; out: string; position: number } | null
  uncertain: { id: string; name?: string; out: string; position: number; kind: 'opaque' | 'missing'; reason: string }[]
  skipped: { id: string; name?: string; out: string; position: number; reason: string }[]
  fallbackOut: string
  certain: boolean
  warnings: string[]
  assumptions: string[]
}

interface PanelState {
  status: {
    core: {
      state: 'stopped' | 'starting' | 'running' | 'error'
      running: boolean
      binary: string | null
      version: string | null
      lastError: string | null
    }
    ruleCount: number
    enabledRuleCount: number
    nodeCount: number
    selectedNode: { id: string; tag: string; name: string } | null
    exits: string[]
    geo: { dir: string; hasGeosite: boolean; hasGeoip: boolean }
    ports: { socks: number; http: number }
    note: string
  }
  routing: { default: string; rules: Rule[]; exits: string[]; diagnostics: Diagnostic[] }
  nodes: { nodes: { id: string; name: string; tag: string; protocol: string; server: string; port: number }[]; selectedNode: string | null; subscriptions: { id: string; name: string; source: string; nodeCount: number }[] }
  logs: LogLine[]
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/proxy-api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const text = await response.text()
  const payload: unknown = text === '' ? {} : JSON.parse(text)
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload ? String((payload as { error: unknown }).error) : `HTTP ${response.status}`
    throw new Error(message)
  }
  return payload as T
}

/* ------------------------------------------------------------------ 小组件 */

function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null
  return (
    <>
      {diagnostics.map((entry, index) => (
        <div key={`${entry.code}-${index}`} className="proxy-diag" data-severity={entry.severity}>
          {entry.severity === 'error' ? '错误' : '提示'} · {entry.path}
          {'\n'}
          {entry.message}
        </div>
      ))}
    </>
  )
}

function splitField(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/* ------------------------------------------------------------------ 规则 tab */

function RulesTab(props: {
  t: (key: string) => string
  state: PanelState
  draft: Routing
  dirty: boolean
  busy: boolean
  diagnostics: Diagnostic[]
  onChange: (next: Routing) => void
  onCheck: () => void
  onApply: () => void
  onReset: () => void
}) {
  const { t, draft, dirty, busy, diagnostics } = props
  const [form, setForm] = React.useState({ id: '', name: '', out: 'proxy', domain: '', ip: '', port: '', protocol: '' })
  const exits = props.state.routing.exits
  const update = (next: Routing) => props.onChange(next)

  const move = (index: number, delta: number) => {
    const to = index + delta
    if (to < 0 || to >= draft.rules.length) return
    const rules = [...draft.rules]
    const [moved] = rules.splice(index, 1)
    if (moved === undefined) return
    rules.splice(to, 0, moved)
    update({ ...draft, rules })
  }

  const add = () => {
    const match: Record<string, string[]> = {}
    for (const key of ['domain', 'ip', 'port', 'protocol'] as const) {
      const values = splitField(form[key])
      if (values.length > 0) match[key] = values
    }
    if (Object.keys(match).length === 0) return
    const base = form.id.trim() === '' ? `rule-${draft.rules.length + 1}` : form.id.trim()
    let id = base
    let suffix = 2
    while (draft.rules.some((rule) => rule.id === id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }
    const rule: Rule = { id, ...(form.name.trim() === '' ? {} : { name: form.name.trim() }), match, out: form.out }
    update({ ...draft, rules: [...draft.rules, rule] })
    setForm({ id: '', name: '', out: form.out, domain: '', ip: '', port: '', protocol: '' })
  }

  return (
    <div>
      <p className="proxy-hint">{t('rules.order')}</p>
      {draft.rules.length === 0 ? <div className="proxy-empty">{t('rules.empty')}</div> : null}
      {draft.rules.map((rule, index) => (
        <div key={rule.id} className="proxy-row" data-disabled={rule.enabled === false}>
          <span className="proxy-index">{index + 1}</span>
          <input
            type="checkbox"
            checked={rule.enabled !== false}
            aria-label={t('rules.enabled')}
            onChange={(event) => {
              const rules = draft.rules.map((entry, at) =>
                at === index ? { ...entry, enabled: event.target.checked ? undefined : false } : entry,
              )
              update({ ...draft, rules })
            }}
          />
          <span className="proxy-rule-main">
            <span className="proxy-rule-name">{rule.name === undefined || rule.name === '' ? rule.id : rule.name}</span>
            <span className="proxy-rule-match">
              {Object.entries(rule.match)
                .filter(([, values]) => Array.isArray(values) && values.length > 0)
                .map(([key, values]) => `${key}: ${(values ?? []).join(', ')}`)
                .join('  ·  ')}
            </span>
          </span>
          <span className="proxy-tag">{rule.out}</span>
          <button type="button" className="proxy-btn" data-kind="icon" title={t('rules.up')} disabled={index === 0} onClick={() => move(index, -1)}>
            ↑
          </button>
          <button type="button" className="proxy-btn" data-kind="icon" title={t('rules.down')} disabled={index === draft.rules.length - 1} onClick={() => move(index, 1)}>
            ↓
          </button>
          <button
            type="button"
            className="proxy-btn"
            data-kind="danger"
            title={t('rules.remove')}
            onClick={() => update({ ...draft, rules: draft.rules.filter((_, at) => at !== index) })}
          >
            ×
          </button>
        </div>
      ))}

      <div className="proxy-form">
        <label className="proxy-field">
          {t('field.id')}
          <input className="proxy-input" value={form.id} placeholder="ai" onChange={(event) => setForm({ ...form, id: event.target.value })} />
        </label>
        <label className="proxy-field">
          {t('field.name')}
          <input className="proxy-input" value={form.name} placeholder="AI 走美国" onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label className="proxy-field">
          {t('field.out')}
          <select className="proxy-input" value={form.out} onChange={(event) => setForm({ ...form, out: event.target.value })}>
            {exits.map((exit) => (
              <option key={exit} value={exit}>
                {exit}
              </option>
            ))}
          </select>
        </label>
        <label className="proxy-field">
          {t('field.domain')}
          <input className="proxy-input" value={form.domain} placeholder="geosite:openai domain:anthropic.com" onChange={(event) => setForm({ ...form, domain: event.target.value })} />
        </label>
        <label className="proxy-field">
          {t('field.ip')}
          <input className="proxy-input" value={form.ip} placeholder="geoip:cn" onChange={(event) => setForm({ ...form, ip: event.target.value })} />
        </label>
        <label className="proxy-field">
          {t('field.port')}
          <input className="proxy-input" value={form.port} placeholder="443" onChange={(event) => setForm({ ...form, port: event.target.value })} />
        </label>
        <label className="proxy-field">
          {t('field.protocol')}
          <input className="proxy-input" value={form.protocol} placeholder="tls" onChange={(event) => setForm({ ...form, protocol: event.target.value })} />
        </label>
        <div className="proxy-actions">
          <button type="button" className="proxy-btn" onClick={add}>
            {t('rules.new')}
          </button>
          <span className="proxy-hint" style={{ margin: 0 }}>
            {t('field.hint')}
          </span>
        </div>
      </div>

      <div className="proxy-actions">
        <label className="proxy-field" style={{ flex: '0 0 200px' }}>
          {t('rules.default')}
          <select className="proxy-input" value={draft.default} onChange={(event) => update({ ...draft, default: event.target.value })}>
            {exits.map((exit) => (
              <option key={exit} value={exit}>
                {exit}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="proxy-btn" disabled={busy} onClick={props.onCheck}>
          {t('rules.check')}
        </button>
        <button type="button" className="proxy-btn" data-kind="primary" disabled={busy || !dirty} onClick={props.onApply}>
          {t('rules.apply')}
        </button>
        <button type="button" className="proxy-btn" disabled={busy || !dirty} onClick={props.onReset}>
          {t('rules.reset')}
        </button>
        {dirty ? <span className="proxy-chip">{t('rules.dirty')}</span> : null}
      </div>

      <DiagnosticList diagnostics={diagnostics} />
      <DiagnosticList diagnostics={props.state.routing.diagnostics} />
    </div>
  )
}

/* ------------------------------------------------------------------ 节点 tab */

function NodesTab(props: {
  t: (key: string) => string
  state: PanelState
  busy: boolean
  onImport: (url: string, name: string) => void
  onSelect: (id: string) => void
  onLatency: () => void
}) {
  const { t, state } = props
  const [url, setUrl] = React.useState('')
  const [name, setName] = React.useState('')

  return (
    <div>
      <div className="proxy-form">
        <label className="proxy-field" style={{ flex: '2 1 260px' }}>
          {t('nodes.url')}
          <input className="proxy-input" value={url} placeholder="https://example.com/sub?token=…" onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="proxy-field">
          {t('nodes.name')}
          <input className="proxy-input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="proxy-actions">
          <button
            type="button"
            className="proxy-btn"
            data-kind="primary"
            disabled={props.busy || url.trim() === ''}
            onClick={() => {
              props.onImport(url.trim(), name.trim())
              setUrl('')
            }}
          >
            {t('nodes.import')}
          </button>
          <button type="button" className="proxy-btn" disabled={props.busy || state.nodes.nodes.length === 0} onClick={props.onLatency}>
            {t('nodes.latency')}
          </button>
        </div>
      </div>

      {state.nodes.nodes.length === 0 ? <div className="proxy-empty">{t('nodes.empty')}</div> : null}
      {state.nodes.nodes.map((node) => (
        <div key={node.id} className="proxy-row">
          <span className="proxy-tag">{node.tag}</span>
          <span className="proxy-rule-main">
            <span className="proxy-rule-name">{node.name}</span>
            <span className="proxy-rule-match">
              {node.protocol} · {node.server}:{node.port}
            </span>
          </span>
          {state.nodes.selectedNode === node.id ? (
            <span className="proxy-chip">{t('nodes.selected')}</span>
          ) : (
            <button type="button" className="proxy-btn" onClick={() => props.onSelect(node.id)}>
              {t('nodes.select')}
            </button>
          )}
        </div>
      ))}

      {state.nodes.subscriptions.length > 0 ? (
        <p className="proxy-hint" style={{ marginTop: 16 }}>
          {t('nodes.subscriptions')}：
          {state.nodes.subscriptions.map((record) => `${record.name}（${record.nodeCount}）`).join('、')}
        </p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ 模拟 tab */

function SimulateTab(props: { t: (key: string) => string; busy: boolean; onExplain: (flow: Record<string, unknown>) => Promise<ExplainResult> }) {
  const { t } = props
  const [flow, setFlow] = React.useState({ domain: '', ip: '', port: '', network: '' })
  const [result, setResult] = React.useState<ExplainResult | null>(null)
  const [error, setError] = React.useState('')

  const run = async () => {
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      if (flow.domain.trim() !== '') payload['domain'] = flow.domain.trim()
      if (flow.ip.trim() !== '') payload['ip'] = flow.ip.trim()
      if (flow.port.trim() !== '') payload['port'] = Number(flow.port.trim())
      if (flow.network !== '') payload['network'] = flow.network
      setResult(await props.onExplain(payload))
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  return (
    <div>
      <div className="proxy-form">
        <label className="proxy-field">
          {t('simulate.domain')}
          <input className="proxy-input" value={flow.domain} placeholder="api.openai.com" onChange={(event) => setFlow({ ...flow, domain: event.target.value })} />
        </label>
        <label className="proxy-field">
          {t('simulate.ip')}
          <input className="proxy-input" value={flow.ip} placeholder="1.2.3.4" onChange={(event) => setFlow({ ...flow, ip: event.target.value })} />
        </label>
        <label className="proxy-field">
          {t('simulate.port')}
          <input className="proxy-input" value={flow.port} placeholder="443" onChange={(event) => setFlow({ ...flow, port: event.target.value })} />
        </label>
        <label className="proxy-field">
          {t('simulate.network')}
          <select className="proxy-input" value={flow.network} onChange={(event) => setFlow({ ...flow, network: event.target.value })}>
            <option value="">—</option>
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </select>
        </label>
        <div className="proxy-actions">
          <button type="button" className="proxy-btn" data-kind="primary" disabled={props.busy} onClick={() => void run()}>
            {t('simulate.run')}
          </button>
        </div>
      </div>

      {error === '' ? null : <div className="proxy-diag" data-severity="error">{error}</div>}

      {result === null ? null : (
        <div className="proxy-card">
          {result.matched === null ? null : (
            <div>
              {t('simulate.matched')}：#{result.matched.id}
              {result.matched.name === undefined ? '' : `（${result.matched.name}）`} → <strong>{result.matched.out}</strong>
            </div>
          )}
          {result.matched !== null && !result.certain ? (
            <div className="proxy-rule-match">{t('simulate.uncertainNote')}</div>
          ) : null}
          {result.matched === null ? (
            <div>
              {result.uncertain.length === 0 ? `${t('simulate.fallback')} → ` : `${t('simulate.indeterminate')} → `}
              <strong>{result.uncertain.length === 0 ? result.fallbackOut : result.uncertain[0]?.id}</strong>
            </div>
          ) : null}
          {result.uncertain.length === 0 ? null : (
            <div style={{ marginTop: 8 }}>
              <div className="proxy-kv">{t('simulate.uncertain')}</div>
              {result.uncertain.map((entry) => (
                <div key={`${entry.position}-${entry.id}`} className="proxy-rule-match">
                  #{entry.id} → {entry.out}（{entry.kind === 'opaque' ? t('simulate.opaque') : t('simulate.missing')}）{entry.reason}
                </div>
              ))}
            </div>
          )}

          {result.skipped.length === 0 ? null : (
            <div style={{ marginTop: 8 }}>
              <div className="proxy-kv">{t('simulate.skipped')}</div>
              {result.skipped.map((entry) => (
                <div key={`${entry.position}-${entry.id}`} className="proxy-rule-match">
                  #{entry.id} → {entry.reason}
                </div>
              ))}
            </div>
          )}
          {result.warnings.length === 0 ? null : (
            <div style={{ marginTop: 8 }}>
              <div className="proxy-kv">{t('simulate.warnings')}</div>
              {result.warnings.map((line) => (
                <div key={line} className="proxy-rule-match">
                  {line}
                </div>
              ))}
            </div>
          )}
          {result.assumptions.length === 0 ? null : (
            <div style={{ marginTop: 8 }}>
              <div className="proxy-kv">{t('simulate.assumptions')}</div>
              {result.assumptions.map((line) => (
                <div key={line} className="proxy-rule-match">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ 面板 */

function LogsTab({ t, state }: { t: (key: string) => string; state: PanelState }) {
  if (state.logs.length === 0) {
    return (
      <div>
        <p className="proxy-hint">{t('logs.hint')}</p>
        <div className="proxy-empty">{t('logs.empty')}</div>
      </div>
    )
  }
  return (
    <div className="proxy-logs">
      {state.logs.map((line, index) => (
        <div key={`${line.time}-${index}`}>
          {new Date(line.time).toLocaleTimeString()} [{line.source}] {line.text}
        </div>
      ))}
    </div>
  )
}

function ProxyPanel({ t }: { t: (key: string) => string }) {
  const [state, setState] = React.useState<PanelState | null>(null)
  const [draft, setDraft] = React.useState<Routing>({ default: 'proxy', rules: [] })
  const [dirty, setDirty] = React.useState(false)
  const [tab, setTab] = React.useState<'rules' | 'nodes' | 'simulate' | 'logs'>('rules')
  const [busy, setBusy] = React.useState(false)
  const [diagnostics, setDiagnostics] = React.useState<Diagnostic[]>([])
  const [message, setMessage] = React.useState('')
  const [error, setError] = React.useState('')

  const dirtyRef = React.useRef(false)
  React.useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const refresh = React.useCallback(async () => {
    try {
      const next = await api<PanelState>('/state')
      setState(next)
      setDraft((current) => (dirtyRef.current ? current : { default: next.routing.default, rules: next.routing.rules }))
      setError('')
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const run = async (action: () => Promise<string>) => {
    setBusy(true)
    setError('')
    try {
      setMessage(await action())
      await refresh()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (state === null) {
    return <div className="proxy-panel"><div className="proxy-body">{error === '' ? t('common.loading') : `${t('common.error')}：${error}`}</div></div>
  }

  const core = state.status.core
  const stateLabel = core.state === 'running' ? t('status.running') : core.state === 'starting' ? t('status.starting') : core.state === 'error' ? t('status.error') : t('status.stopped')

  const check = () =>
    run(async () => {
      const result = await api<{ valid: boolean; diagnostics: Diagnostic[] }>('/check', { mode: 'replace', routing: draft })
      setDiagnostics(result.diagnostics)
      return result.valid ? t('message.checkOk') : t('message.checkFailed')
    })

  const apply = () =>
    run(async () => {
      const result = await api<{ saved: boolean; applied: boolean; diagnostics: Diagnostic[]; message: string }>('/write', {
        mode: 'replace',
        routing: draft,
        reason: '面板编辑',
      })
      setDiagnostics(result.diagnostics)
      if (result.saved) {
        setDirty(false)
        const next = await api<PanelState>('/state')
        setDraft({ default: next.routing.default, rules: next.routing.rules })
      }
      return result.message
    })

  return (
    <div className="proxy-panel">
      <div className="proxy-status">
        <span className="proxy-dot" data-state={core.state} />
        <span className="proxy-state">{stateLabel}</span>
        <span className="proxy-meta">
          <span>{t('status.ports').replace('{socks}', String(state.status.ports.socks)).replace('{http}', String(state.status.ports.http))}</span>
          <span>{t('status.rules').replace('{count}', String(state.status.enabledRuleCount))}</span>
          <span>{t('status.nodes').replace('{count}', String(state.status.nodeCount))}</span>
          <span>
            {t('status.binary')}：{core.version ?? (core.binary === null ? t('status.binaryMissing') : core.binary)}
          </span>
          <span>{state.status.selectedNode === null ? t('status.noNode') : `→ ${state.status.selectedNode.tag}`}</span>
        </span>
        <span className="proxy-spacer" />
        {core.running ? (
          <>
            <button type="button" className="proxy-btn" disabled={busy} onClick={() => void run(async () => (await api<{ message: string }>('/core', { action: 'restart' })).message)}>
              {t('action.restart')}
            </button>
            <button type="button" className="proxy-btn" disabled={busy} onClick={() => void run(async () => (await api<{ message: string }>('/core', { action: 'stop' })).message)}>
              {t('action.stop')}
            </button>
          </>
        ) : (
          <button type="button" className="proxy-btn" data-kind="primary" disabled={busy} onClick={() => void run(async () => (await api<{ message: string }>('/core', { action: 'start' })).message)}>
            {t('action.start')}
          </button>
        )}
      </div>

      <div className="proxy-tabs">
        {(['rules', 'nodes', 'simulate', 'logs'] as const).map((entry) => (
          <button key={entry} type="button" className="proxy-tab" data-active={tab === entry} onClick={() => setTab(entry)}>
            {t(`tab.${entry}`)}
          </button>
        ))}
      </div>

      <div className="proxy-body">
        {error === '' ? null : <div className="proxy-diag" data-severity="error">{error}</div>}
        {message === '' ? null : <div className="proxy-diag">{message}</div>}
        {core.lastError === null ? null : <div className="proxy-diag" data-severity="error">{core.lastError}</div>}

        {tab === 'rules' ? (
          <RulesTab
            t={t}
            state={state}
            draft={draft}
            dirty={dirty}
            busy={busy}
            diagnostics={diagnostics}
            onChange={(next) => {
              setDraft(next)
              setDirty(true)
            }}
            onCheck={() => void check()}
            onApply={() => void apply()}
            onReset={() => {
              setDraft({ default: state.routing.default, rules: state.routing.rules })
              setDirty(false)
              setDiagnostics([])
            }}
          />
        ) : null}
        {tab === 'nodes' ? (
          <NodesTab
            t={t}
            state={state}
            busy={busy}
            onImport={(url, name) =>
              void run(async () => (await api<{ message: string }>('/subscription', { url, ...(name === '' ? {} : { name }) })).message)
            }
            onSelect={(id) => void run(async () => (await api<{ message: string }>('/select', { id })).message)}
            onLatency={() => void run(async () => (await api<{ message: string }>('/latency', {})).message)}
          />
        ) : null}
        {tab === 'simulate' ? <SimulateTab t={t} busy={busy} onExplain={(flow) => api<ExplainResult>('/explain', flow)} /> : null}
        {tab === 'logs' ? <LogsTab t={t} state={state} /> : null}

        <p className="proxy-hint" style={{ marginTop: 24 }}>
          {state.status.note}
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 侧栏图标 */

function ProxyIcon({ size }: { size: number; active: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.5 18h8.5" />
        <path d="M14 18c4.6 0 4.4-8 9-8h4.5" />
        <path d="M14 18c4.6 0 4.4 8 9 8h4.5" />
      </g>
      <g fill="currentColor">
        <circle cx="29.6" cy="10" r="2.6" />
        <circle cx="29.6" cy="26" r="2.6" />
      </g>
    </svg>
  )
}

/* ------------------------------------------------------------------ 注册 */

/**
 * 客户端半部：注册样式、侧栏入口与主面板。
 * @param ctx - 客户端 Context，携带 `slots` 与 `locale`。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'dsh-proxy'
    tag.textContent = CSS
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, 'dsh-proxy: styles')

  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'zh', ZH), 'dsh-proxy: zh dictionary')
  ctx.effect(() => ctx.locale.register(LOCALE_NS, 'en', EN), 'dsh-proxy: en dictionary')
  const translate = ctx.locale.bind(LOCALE_NS)
  const t = (key: string): string => translate(key)

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            label: () => t('panel'),
          },
          ProxyIcon,
        ),
      ),
    'dsh-proxy: sidebar entry',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          () => <ProxyPanel t={t} />,
        ),
      ),
    'dsh-proxy: main panel',
  )
}
