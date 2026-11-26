/**
 * 「节点」页签：导入订阅、列出节点库存、测一轮延迟。
 *
 * 节点地址与端口照原样显示；凭据（UUID / 密码）不在界面出现 —— 后端也不会送过来。
 * 默认出口与每条规则走哪个节点都在「规则」页签里选，这里只报告库存。
 */

import { useState } from 'react'
import type { NodeSummary, SubscriptionSummary } from './api.ts'
import { Actions, Button, Empty, Field, Form, Hint, TextInput } from './Controls.tsx'
import { nodeLabelOf } from './labels.ts'
import { useTranslate } from './locale-context.tsx'
import css from './Panel.module.css'

/** {@link NodesTab} 的入参。 */
export interface NodesTabProps {
  /** 当前库存里的节点。 */
  nodes: readonly NodeSummary[]
  /** 已导入的订阅来源。 */
  subscriptions: readonly SubscriptionSummary[]
  /** 是否有写操作在途。 */
  busy: boolean
  /** 导入一条订阅。 */
  onImport: (url: string, name: string) => void
  /** 对全部节点测延迟。 */
  onLatency: () => void
}

/**
 * 渲染节点页签。
 * @param props - 节点库存、订阅与动作回调。
 * @returns 页签内容。
 */
export function NodesTab(props: NodesTabProps) {
  const t = useTranslate()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')

  return (
    <div>
      <Form>
        <Field label={t('nodes.url')} span="wide">
          <TextInput
            value={url}
            placeholder="https://example.com/sub?token=…"
            onChange={(event) => { setUrl(event.target.value) }}
          />
        </Field>
        <Field label={t('nodes.name')}>
          <TextInput
            value={name}
            onChange={(event) => { setName(event.target.value) }}
          />
        </Field>
        <Actions>
          <Button
            variant="primary"
            disabled={props.busy || url.trim() === ''}
            onClick={() => {
              props.onImport(url.trim(), name.trim())
              setUrl('')
            }}
          >
            {t('nodes.import')}
          </Button>
          <Button
            disabled={props.busy || props.nodes.length === 0}
            onClick={props.onLatency}
          >
            {t('nodes.latency')}
          </Button>
        </Actions>
      </Form>

      {props.nodes.length === 0 ? <Empty>{t('nodes.empty')}</Empty> : null}
      {props.nodes.map((node) => (
        <div key={node.id} className={css['row']}>
          <span className={css['ruleMain']}>
            <span className={css['ruleName']}>{nodeLabelOf(node)}</span>
            <span className={css['ruleMatch']}>
              {node.protocol} · {node.server}:{node.port}
            </span>
          </span>
        </div>
      ))}

      {props.subscriptions.length > 0 ? (
        <Hint space="spaced">
          {t('nodes.subscriptions')}：
          {props.subscriptions.map((record) => `${record.name}（${record.nodeCount}）`).join('、')}
        </Hint>
      ) : null}
    </div>
  )
}
