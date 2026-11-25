/**
 * 「模拟」页签：填一条流量，问后端它会命中哪条规则。
 *
 * 结论分三种：命中（`matched`）、没有命中而走默认出口、以及「无法判定」——
 * 后者说明前面的规则需要 geo 数据或缺少输入，命中不是必然。界面必须把
 * `uncertain` 一并展示，否则用户会把「可能」读成「一定」。
 */

import { useState } from 'react'
import { describeError } from './api.ts'
import type { ExplainResult } from './api.ts'
import { Actions, Button, Field, Form, SelectInput, TextInput } from './Controls.tsx'
import { Banner } from './Diagnostics.tsx'
import { useTranslate } from './locale-context.tsx'
import ctl from './Controls.module.css'
import css from './Panel.module.css'

/** {@link SimulateTab} 的入参。 */
export interface SimulateTabProps {
  /** 是否有其他写操作在途（仿真本身不占用它）。 */
  busy: boolean
  /** 把一条流量描述交给后端仿真。 */
  onExplain: (flow: Record<string, unknown>) => Promise<ExplainResult>
}

/** 仿真表单的本地状态。 */
interface FlowForm {
  domain: string
  ip: string
  port: string
  network: string
}

/**
 * 渲染模拟页签。
 * @param props - 忙碌标记与仿真回调。
 * @returns 页签内容。
 */
export function SimulateTab(props: SimulateTabProps) {
  const t = useTranslate()
  const [flow, setFlow] = useState<FlowForm>({ domain: '', ip: '', port: '', network: '' })
  const [result, setResult] = useState<ExplainResult | null>(null)
  const [error, setError] = useState('')

  const run = async (): Promise<void> => {
    setError('')
    try {
      const payload: Record<string, unknown> = {}
      if (flow.domain.trim() !== '') payload['domain'] = flow.domain.trim()
      if (flow.ip.trim() !== '') payload['ip'] = flow.ip.trim()
      if (flow.port.trim() !== '') payload['port'] = Number(flow.port.trim())
      if (flow.network !== '') payload['network'] = flow.network
      setResult(await props.onExplain(payload))
    } catch (caught) {
      setError(describeError(caught))
    }
  }

  return (
    <div>
      <Form>
        <Field label={t('simulate.domain')}>
          <TextInput
            value={flow.domain}
            placeholder="api.openai.com"
            onChange={(event) => { setFlow({ ...flow, domain: event.target.value }) }}
          />
        </Field>
        <Field label={t('simulate.ip')}>
          <TextInput
            value={flow.ip}
            placeholder="1.2.3.4"
            onChange={(event) => { setFlow({ ...flow, ip: event.target.value }) }}
          />
        </Field>
        <Field label={t('simulate.port')}>
          <TextInput
            value={flow.port}
            placeholder="443"
            onChange={(event) => { setFlow({ ...flow, port: event.target.value }) }}
          />
        </Field>
        <Field label={t('simulate.network')}>
          <SelectInput
            value={flow.network}
            onChange={(event) => { setFlow({ ...flow, network: event.target.value }) }}
          >
            <option value="">—</option>
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </SelectInput>
        </Field>
        <Actions>
          <Button variant="primary" disabled={props.busy} onClick={() => { void run() }}>
            {t('simulate.run')}
          </Button>
        </Actions>
      </Form>

      {error === '' ? null : <Banner severity="error">{error}</Banner>}

      {result === null ? null : (
        <div className={ctl['card']}>
          {result.matched === null ? null : (
            <div>
              {t('simulate.matched')}：#{result.matched.id}
              {result.matched.name === undefined ? '' : `（${result.matched.name}）`} →{' '}
              <strong>{result.matched.outLabel ?? result.matched.out}</strong>
            </div>
          )}
          {result.matched !== null && !result.certain ? (
            <div className={css['ruleMatch']}>{t('simulate.uncertainNote')}</div>
          ) : null}
          {result.matched === null ? (
            <div>
              {result.uncertain.length === 0 ? `${t('simulate.fallback')} → ` : `${t('simulate.indeterminate')} → `}
              <strong>
                {result.uncertain.length === 0
                  ? (result.fallbackOutLabel ?? result.fallbackOut)
                  : result.uncertain[0]?.id}
              </strong>
            </div>
          ) : null}
          {result.uncertain.length === 0 ? null : (
            <div className={css['section']}>
              <div className={ctl['kv']}>{t('simulate.uncertain')}</div>
              {result.uncertain.map((entry) => (
                <div key={`${entry.position}-${entry.id}`} className={css['ruleMatch']}>
                  #{entry.id} → {entry.outLabel ?? entry.out}（{entry.kind === 'opaque' ? t('simulate.opaque') : t('simulate.missing')}）{entry.reason}
                </div>
              ))}
            </div>
          )}

          {result.skipped.length === 0 ? null : (
            <div className={css['section']}>
              <div className={ctl['kv']}>{t('simulate.skipped')}</div>
              {result.skipped.map((entry) => (
                <div key={`${entry.position}-${entry.id}`} className={css['ruleMatch']}>
                  #{entry.id} → {entry.reason}
                </div>
              ))}
            </div>
          )}
          {result.warnings.length === 0 ? null : (
            <div className={css['section']}>
              <div className={ctl['kv']}>{t('simulate.warnings')}</div>
              {result.warnings.map((line) => (
                <div key={line} className={css['ruleMatch']}>{line}</div>
              ))}
            </div>
          )}
          {result.assumptions.length === 0 ? null : (
            <div className={css['section']}>
              <div className={ctl['kv']}>{t('simulate.assumptions')}</div>
              {result.assumptions.map((line) => (
                <div key={line} className={css['ruleMatch']}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
