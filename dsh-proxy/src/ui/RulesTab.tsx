/**
 * 「规则」页签：默认出口 + 有序规则列表 + 校验 / 应用 / 重置。
 *
 * 规则的新增由模型通过工具完成，面板不提供新增表单，只调整启用、顺序与默认出口。
 * 列表顺序即匹配顺序，上移 / 下移直接改草稿数组；应用前先由 `/check` 拿诊断，
 * 与 `proxy_routing_check` 工具共用同一份后端校验。
 */

import type { Diagnostic, Routing, Rule } from './api.ts'
import { Button, Chip, Empty, Field, SelectInput, Tag } from './Controls.tsx'
import { DiagnosticList } from './Diagnostics.tsx'
import { exitText, verdictOf } from './labels.ts'
import type { ExitLabels } from './labels.ts'
import type { LocaleKey } from './locale.ts'
import { useTranslate } from './locale-context.tsx'
import css from './Panel.module.css'

/** 面板词条的翻译函数。 */
type Translate = (key: LocaleKey) => string

/**
 * 规则实际落到哪个节点上：`out` 是某个节点出口时就是这个节点，是 `proxy` 时是当前选中的节点。
 *
 * 行内统一成「策略徽标 → 规则名 → 节点名」，所以节点名永远排在规则名之后、靠这一处算出来；
 * 直连 / 拦截与「有 `proxy` 但没选节点」都返回 null，让行内不出现空的节点徽标。
 * @param rule - 规则。
 * @param labels - 出口名 → 展示名。
 * @param proxyLabel - 当前 `proxy` 出口绑定的节点展示名；没有选中节点时为 null。
 * @param t - 翻译函数。
 * @returns 节点展示名；不需要显示节点时返回 null。
 */
function exitNodeName(
  rule: Rule,
  labels: ExitLabels,
  proxyLabel: string | null,
  t: Translate,
): string | null {
  if (verdictOf(rule.out) !== 'proxy') return null
  return rule.out === 'proxy' ? proxyLabel : exitText(rule.out, labels, t)
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
  /** 出口名 → 展示名：默认出口选择框与规则行的节点徽标显示节点名字，`value` / `out` 仍是出口名。 */
  exitLabels: ExitLabels
  /** 当前 `proxy` 出口绑定的节点展示名；没有选中节点时为 null。 */
  proxyLabel: string | null
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
 * 渲染规则页签。
 * @param props - 草稿、诊断与动作回调。
 * @returns 页签内容。
 */
export function RulesTab(props: RulesTabProps) {
  const t = useTranslate()
  const { draft, dirty, busy, exits, exitLabels, proxyLabel, diagnostics, storedDiagnostics } = props

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

  // 默认出口不提供 `proxy`：它只是「当前选中节点」的别名，默认出口落到具体节点或
  // direct / block 更明确。旧规则库若已把默认出口写成 proxy，保留一个隐藏项显示真实值，
  // 否则选择框会错位到第一个选项、看起来像是改了配置。
  const defaultExits = exits.filter((exit) => exit !== 'proxy')

  return (
    <div>
      <div className={css['rulesHead']}>
        <Field label={t('rules.default')} layout="inline">
          <SelectInput
            value={draft.default}
            onChange={(event) => { update({ ...draft, default: event.target.value }) }}
          >
            {defaultExits.map((exit) => (
              <option key={exit} value={exit}>{exitText(exit, exitLabels, t)}</option>
            ))}
            {draft.default === 'proxy' ? (
              <option value="proxy" hidden>{exitText('proxy', exitLabels, t)}</option>
            ) : null}
          </SelectInput>
        </Field>
        <div className={css['rulesActions']}>
          <Button disabled={busy} onClick={props.onCheck}>{t('rules.check')}</Button>
          <Button variant="primary" disabled={busy || !dirty} onClick={props.onApply}>{t('rules.apply')}</Button>
          <Button disabled={busy || !dirty} onClick={props.onReset}>{t('rules.reset')}</Button>
          {dirty ? <Chip>{t('rules.dirty')}</Chip> : null}
        </div>
      </div>

      {draft.rules.length === 0 ? <Empty>{t('rules.empty')}</Empty> : null}
      {draft.rules.map((rule, index) => {
        // 节点名放规则名之后：出口列只显示策略（代理 / 直连 / 拦截），与实际去向分两处，顺序固定。
        const nodeName = exitNodeName(rule, exitLabels, proxyLabel, t)
        return (
          <div key={rule.id} className={css['row']} data-disabled={rule.enabled === false}>
            <input
              type="checkbox"
              checked={rule.enabled !== false}
              aria-label={t('rules.enabled')}
              onChange={(event) => {
                toggle(index, event.target.checked)
              }}
            />
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
            <Button variant="icon" title={t('rules.remove')} onClick={() => { remove(index) }}>
              X
            </Button>
            <Tag title={rule.out}>{exitText(verdictOf(rule.out), exitLabels, t)}</Tag>
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
            {nodeName === null ? null : <Tag title={rule.out}>{nodeName}</Tag>}
          </div>
        )
      })}

      <DiagnosticList diagnostics={diagnostics} />
      <DiagnosticList diagnostics={storedDiagnostics} />
    </div>
  )
}
