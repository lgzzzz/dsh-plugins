/**
 * 「规则」页签：有序规则列表 + 新增表单 + 校验 / 应用 / 重置。
 *
 * 列表顺序即匹配顺序，上移 / 下移直接改草稿数组；应用前先由 `/check` 拿诊断，
 * 与 `proxy_routing_check` 工具共用同一份后端校验。
 */

import { useState } from 'react'
import type { Diagnostic, Routing } from './api.ts'
import { Actions, Button, Chip, Empty, Field, Form, Hint, SelectInput, Tag, TextInput } from './Controls.tsx'
import { DiagnosticList } from './Diagnostics.tsx'
import { useTranslate } from './locale-context.tsx'
import css from './Panel.module.css'

/** 匹配条件里可编辑的四个维度，同时也是新增表单的字段名。 */
const MATCH_KEYS = ['domain', 'ip', 'port', 'protocol'] as const

/** 新增规则表单的本地状态；`out` 是出口名，其余是待拆分的多值文本。 */
interface RuleForm {
  id: string
  name: string
  out: string
  domain: string
  ip: string
  port: string
  protocol: string
}

/** {@link RulesTab} 的入参。 */
export interface RulesTabProps {
  /** 正在编辑的规则库。 */
  draft: Routing
  /** 草稿是否偏离服务端。 */
  dirty: boolean
  /** 是否有写操作在途。 */
  busy: boolean
  /** 可用出口名（默认出口 + 节点 tag + 内置出口）。 */
  exits: readonly string[]
  /** 本次校验 / 应用产生的诊断。 */
  diagnostics: readonly Diagnostic[]
  /** 服务端当前生效规则库的诊断。 */
  storedDiagnostics: readonly Diagnostic[]
  /** 用新草稿替换当前草稿。 */
  onChange: (next: Routing) => void
  /** 只校验。 */
  onCheck: () => void
  /** 校验并应用。 */
  onApply: () => void
  /** 丢弃改动。 */
  onReset: () => void
}

/**
 * 把「空格或逗号分隔」的一行文本拆成多值。
 * @param text - 用户输入。
 * @returns 去掉空项后的值列表。
 */
function splitField(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * 渲染规则页签。
 * @param props - 草稿、诊断与动作回调。
 * @returns 页签内容。
 */
export function RulesTab(props: RulesTabProps) {
  const t = useTranslate()
  const { draft, dirty, busy, exits, diagnostics, storedDiagnostics } = props
  const [form, setForm] = useState<RuleForm>({
    id: '', name: '', out: 'proxy', domain: '', ip: '', port: '', protocol: '',
  })

  const update = (next: Routing): void => {
    props.onChange(next)
  }

  const move = (index: number, delta: number): void => {
    const to = index + delta
    if (to < 0 || to >= draft.rules.length) return
    const rules = [...draft.rules]
    const [moved] = rules.splice(index, 1)
    if (moved === undefined) return
    rules.splice(to, 0, moved)
    update({ ...draft, rules })
  }

  const toggle = (index: number, enabled: boolean): void => {
    const rules = draft.rules.map((entry, at) => (
      at === index ? { ...entry, enabled: enabled ? undefined : false } : entry
    ))
    update({ ...draft, rules })
  }

  const remove = (index: number): void => {
    update({ ...draft, rules: draft.rules.filter((_, at) => at !== index) })
  }

  const add = (): void => {
    const match: Record<string, string[]> = {}
    for (const key of MATCH_KEYS) {
      const values = splitField(form[key])
      if (values.length > 0) match[key] = values
    }
    if (Object.keys(match).length === 0) return
    const base = form.id.trim() === '' ? `rule-${draft.rules.length + 1}` : form.id.trim()
    // 表单里手填的 id 可能撞车：追加 -2、-3 … 直到空位，避免 React key 与服务端 id 冲突。
    let id = base
    let suffix = 2
    while (draft.rules.some((rule) => rule.id === id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }
    const rule = {
      id,
      ...(form.name.trim() === '' ? {} : { name: form.name.trim() }),
      match,
      out: form.out,
    }
    update({ ...draft, rules: [...draft.rules, rule] })
    setForm({ id: '', name: '', out: form.out, domain: '', ip: '', port: '', protocol: '' })
  }

  return (
    <div>
      <Hint>{t('rules.order')}</Hint>
      {draft.rules.length === 0 ? <Empty>{t('rules.empty')}</Empty> : null}
      {draft.rules.map((rule, index) => (
        <div key={rule.id} className={css['row']} data-disabled={rule.enabled === false}>
          <span className={css['index']}>{index + 1}</span>
          <input
            type="checkbox"
            checked={rule.enabled !== false}
            aria-label={t('rules.enabled')}
            onChange={(event) => {
              toggle(index, event.target.checked)
            }}
          />
          <span className={css['ruleMain']}>
            <span className={css['ruleName']}>
              {rule.name === undefined || rule.name === '' ? rule.id : rule.name}
            </span>
            <span className={css['ruleMatch']}>
              {Object.entries(rule.match)
                .filter(([, values]) => Array.isArray(values) && values.length > 0)
                .map(([key, values]) => `${key}: ${(values ?? []).join(', ')}`)
                .join('  ·  ')}
            </span>
          </span>
          <Tag>{rule.out}</Tag>
          <Button variant="icon" title={t('rules.up')} disabled={index === 0} onClick={() => { move(index, -1) }}>
            ↑
          </Button>
          <Button
            variant="icon"
            title={t('rules.down')}
            disabled={index === draft.rules.length - 1}
            onClick={() => { move(index, 1) }}
          >
            ↓
          </Button>
          <Button variant="danger" title={t('rules.remove')} onClick={() => { remove(index) }}>
            ×
          </Button>
        </div>
      ))}

      <Form>
        <Field label={t('field.id')}>
          <TextInput
            value={form.id}
            placeholder="ai"
            onChange={(event) => { setForm({ ...form, id: event.target.value }) }}
          />
        </Field>
        <Field label={t('field.name')}>
          <TextInput
            value={form.name}
            placeholder="AI 走美国"
            onChange={(event) => { setForm({ ...form, name: event.target.value }) }}
          />
        </Field>
        <Field label={t('field.out')}>
          <SelectInput
            value={form.out}
            onChange={(event) => { setForm({ ...form, out: event.target.value }) }}
          >
            {exits.map((exit) => (
              <option key={exit} value={exit}>{exit}</option>
            ))}
          </SelectInput>
        </Field>
        <Field label={t('field.domain')}>
          <TextInput
            value={form.domain}
            placeholder="geosite:openai domain:anthropic.com"
            onChange={(event) => { setForm({ ...form, domain: event.target.value }) }}
          />
        </Field>
        <Field label={t('field.ip')}>
          <TextInput
            value={form.ip}
            placeholder="geoip:cn"
            onChange={(event) => { setForm({ ...form, ip: event.target.value }) }}
          />
        </Field>
        <Field label={t('field.port')}>
          <TextInput
            value={form.port}
            placeholder="443"
            onChange={(event) => { setForm({ ...form, port: event.target.value }) }}
          />
        </Field>
        <Field label={t('field.protocol')}>
          <TextInput
            value={form.protocol}
            placeholder="tls"
            onChange={(event) => { setForm({ ...form, protocol: event.target.value }) }}
          />
        </Field>
        <Actions>
          <Button onClick={add}>{t('rules.new')}</Button>
          <Hint space="none">{t('field.hint')}</Hint>
        </Actions>
      </Form>

      <Actions>
        <Field label={t('rules.default')} layout="inline">
          <SelectInput
            value={draft.default}
            onChange={(event) => { update({ ...draft, default: event.target.value }) }}
          >
            {exits.map((exit) => (
              <option key={exit} value={exit}>{exit}</option>
            ))}
          </SelectInput>
        </Field>
        <Button disabled={busy} onClick={props.onCheck}>{t('rules.check')}</Button>
        <Button variant="primary" disabled={busy || !dirty} onClick={props.onApply}>{t('rules.apply')}</Button>
        <Button disabled={busy || !dirty} onClick={props.onReset}>{t('rules.reset')}</Button>
        {dirty ? <Chip>{t('rules.dirty')}</Chip> : null}
      </Actions>

      <DiagnosticList diagnostics={diagnostics} />
      <DiagnosticList diagnostics={storedDiagnostics} />
    </div>
  )
}
