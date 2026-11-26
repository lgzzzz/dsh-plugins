/**
 * 「连接」页签：内核访问日志的结构化视图。
 *
 * 每条记录一行：时间、入站、目的、分类徽标与实际出口。过滤在服务端做，所以汇总覆盖
 * 整个环形窗口，而不是只统计当前页。数据与副作用在 {@link useTraffic} 里。
 */

import type { TrafficEntry, TrafficView, TrafficVerdict } from './api.ts'
import { Button, Empty, Hint, SelectInput, TextInput } from './Controls.tsx'
import { fill } from './locale.ts'
import type { LocaleKey } from './locale.ts'
import { useTranslate } from './locale-context.tsx'
import { useTraffic } from './use-traffic.ts'
import css from './Panel.module.css'

/** 分类徽标的文案键。 */
const VERDICT_KEYS: Record<TrafficVerdict, LocaleKey> = {
  proxy: 'traffic.verdict.proxy',
  direct: 'traffic.verdict.direct',
  block: 'traffic.verdict.block',
}

/**
 * 渲染一行连接记录。
 * @param props.entry - 一条连接。
 * @returns 行元素。
 */
function TrafficRow({ entry }: { entry: TrafficEntry }) {
  const t = useTranslate()
  return (
    <div className={css['trafficRow']}>
      <span className={css['trafficTime']}>{new Date(entry.time).toLocaleTimeString()}</span>
      <span className={css['trafficInbound']}>{entry.inbound}</span>
      <span className={css['trafficDest']} title={`${entry.source} → ${entry.out}`}>
        <span>
          {entry.host}
          {entry.port === null ? '' : `:${entry.port}`}
        </span>
        {entry.path === undefined ? null : <span className={css['trafficPath']}>{` ${entry.path}`}</span>}
      </span>
      <span className={css['verdict']} data-verdict={entry.verdict}>{t(VERDICT_KEYS[entry.verdict])}</span>
      <span className={css['trafficOut']} title={entry.out}>{entry.outLabel}</span>
    </div>
  )
}

/**
 * 过滤框非空且有命中时，给一句直接结论：全代理 / 全直连 / 全拦截。
 * @param view - 当前快照。
 * @param host - 过滤框原文。
 * @param t - 翻译函数。
 * @returns 结论文本；条件不成立时为 null。
 */
function conclusionOf(view: TrafficView, host: string, t: (key: LocaleKey) => string): string | null {
  if (host === '' || view.summary.matched === 0) return null
  const { matched, proxied, direct, blocked } = view.summary
  if (proxied === matched) {
    // 命中项可能来自不同节点：只有一个出口时才把节点名写进结论。
    const outs = Object.keys(view.summary.byOut)
    const exit = outs.length === 1 ? (view.entries.find((entry) => entry.out === outs[0])?.outLabel ?? outs[0]) : ''
    return exit === ''
      ? fill(t('traffic.conclusionProxyAny'), { host, count: String(matched) })
      : fill(t('traffic.conclusionProxy'), { host, count: String(matched), exit })
  }
  if (direct === matched) return fill(t('traffic.conclusionDirect'), { host, count: String(matched) })
  if (blocked === matched) return fill(t('traffic.conclusionBlocked'), { host, count: String(matched) })
  return null
}

/**
 * 渲染「连接」页签。
 * @returns 页签内容。
 */
export function TrafficTab() {
  const t = useTranslate()
  const traffic = useTraffic()
  const view = traffic.view
  const conclusion = view === null ? null : conclusionOf(view, traffic.host.trim(), t)

  return (
    <div>
      <div className={css['trafficBar']}>
        <TextInput
          className={css['trafficFilter']}
          value={traffic.host}
          placeholder={t('traffic.filterHost')}
          aria-label={t('traffic.filterHost')}
          onChange={(event) => { traffic.setHost(event.target.value) }}
        />
        <SelectInput
          className={css['trafficSelect']}
          value={traffic.verdict}
          aria-label={t('traffic.verdictLabel')}
          onChange={(event) => { traffic.setVerdict(event.target.value as TrafficVerdict | '') }}
        >
          <option value="">{t('traffic.filterAll')}</option>
          <option value="proxy">{t('traffic.verdict.proxy')}</option>
          <option value="direct">{t('traffic.verdict.direct')}</option>
          <option value="block">{t('traffic.verdict.block')}</option>
        </SelectInput>
        <Button onClick={traffic.togglePause}>
          {traffic.paused ? t('traffic.resume') : t('traffic.pause')}
        </Button>
        {view === null ? null : (
          <span className={css['trafficSummary']}>
            {fill(t('traffic.summary'), {
              count: String(view.summary.matched),
              proxy: String(view.summary.proxied),
              direct: String(view.summary.direct),
              block: String(view.summary.blocked),
            })}
          </span>
        )}
      </div>

      {view === null
        ? (traffic.loading ? <Hint space="spaced">{t('common.loading')}</Hint> : null)
        : (view.live ? null : <Hint space="spaced">{view.reason ?? t('traffic.stopped')}</Hint>)}
      {traffic.error === '' ? null : <Hint space="spaced">{`${t('common.error')}：${traffic.error}`}</Hint>}
      {view === null ? null : view.warnings.map((warning) => <Hint key={warning} space="spaced">{warning}</Hint>)}
      {conclusion === null ? null : <Hint>{conclusion}</Hint>}

      {view === null || view.entries.length === 0 ? (
        <Empty>{traffic.host === '' && traffic.verdict === '' ? t('traffic.empty') : t('traffic.noMatch')}</Empty>
      ) : (
        <div className={css['traffic']}>
          {view.entries.map((entry, index) => (
            <TrafficRow key={`${entry.time}-${entry.source}-${index}`} entry={entry} />
          ))}
        </div>
      )}

      <Hint space="note">{t('traffic.hint')}</Hint>
    </div>
  )
}
