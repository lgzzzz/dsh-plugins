/**
 * 本插件的 Web 字典：分区标题、每行指标的标签、状态与原因的译文、时间与数值的单位。
 *
 * 只翻译「词汇」，不翻译数据：模型 id、未知的状态码/原因码都按上游原样显示，避免把新出现的
 * 状态静默改写成别的意思。秒与吞吐的单位放在这里，数值本身由 `src/format.ts` 生成。
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-opencode-status'

/** 简体中文字典，同时是键的源集合。 */
export const zh = {
  'section.title': 'OpenCode Go',
  'row.service': 'Go 服务',
  'row.model': '模型',
  'row.status': '状态',
  'row.ttft': '首 Token',
  'row.tps': '吞吐',
  'model.missing': '未找到',
  'status.unavailable': '暂时无法获取',
  'status.operational': '正常',
  'status.degraded': '降级',
  'status.unknown': '未知',
  'reason.availability': '可用性',
  'reason.errors': '错误',
  'reason.latency': '延迟',
  'reason.monitoring': '监控中',
  'reason.upstream': '上游异常',
  'value.seconds': '{value} 秒',
  'value.tps': '{value} tok/s',
}

/** 本插件的 locale 键联合。 */
export type OpencodeStatusKey = keyof typeof zh

/** 英文字典，按中文键集合校验。 */
export const en = {
  'section.title': 'OpenCode Go',
  'row.service': 'Go service',
  'row.model': 'Model',
  'row.status': 'Status',
  'row.ttft': 'First token',
  'row.tps': 'Throughput',
  'model.missing': 'Not found',
  'status.unavailable': 'Unavailable',
  'status.operational': 'Operational',
  'status.degraded': 'Degraded',
  'status.unknown': 'Unknown',
  'reason.availability': 'Availability',
  'reason.errors': 'Errors',
  'reason.latency': 'Latency',
  'reason.monitoring': 'Monitoring',
  'reason.upstream': 'Upstream',
  'value.seconds': '{value}s',
  'value.tps': '{value} tok/s',
} satisfies Record<OpencodeStatusKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 「OpenCode Go」一栏的文案命名空间；注册项的 `locale:` 与 `t` 座位都按它取键。 */
    'dsh-opencode-status': OpencodeStatusKey
  }
}
