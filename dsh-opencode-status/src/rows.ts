/**
 * 浏览器半部的排版：把一份宿主快照摊成会话面板里的行。
 *
 * 行集合（最多五行）：
 *
 * ```
 * Go 服务      降级 · 延迟     ← 只在整体服务状态与模型状态不同时出现
 * 模型         deepseek-v4.1-flash
 * 状态         降级 · 延迟
 * 首 Token     9.1 秒
 * 吞吐         148 tok/s
 * ```
 *
 * 缺数据时保留可诊断的那几行：模型不在快照里就画「模型 + 未找到」，宿主抓取失败就画
 * 「状态 + 暂时无法获取」；还没拿到第一份响应的挂载瞬间返回 null，整节（含标题）隐藏，
 * 与面板其它分区一致。纯函数，不依赖 React。
 */

import type { OpencodeStatusReply } from './wire.ts'
import { MODEL_ID } from './wire.ts'
import { formatSeconds, formatTps, statusValue, type StatusTranslate } from './format.ts'

/** 行的身份：既做 React key，也做 `data-opencode-status` 调试标记与字形选择。 */
export type StatusRowKey = 'service' | 'model' | 'status' | 'ttft' | 'tps' | 'error'

/** 面板里的一行：标签（content）与右对齐的读数（trailing）。 */
export interface StatusRow {
  readonly key: StatusRowKey
  readonly label: string
  readonly value: string
}

/**
 * 把一份宿主响应摊成面板行。
 * @param reply - 最近一份宿主响应；还没收到时为 undefined。
 * @param t - 本插件翻译函数。
 * @returns 依次渲染的行；还没收到第一份响应时返回 null。
 */
export function statusRows(
  reply: OpencodeStatusReply | undefined,
  t: StatusTranslate,
): StatusRow[] | null {
  if (reply === undefined) return null

  if (!reply.ok) {
    return [{ key: 'error', label: t('row.status'), value: t('status.unavailable') }]
  }

  const rows: StatusRow[] = []
  const { service, model } = reply

  // 服务状态只在它与模型状态不同时占一行：两者一致时模型行已经说明问题，不重复。
  if (service !== null && (model === null || service.status !== model.status || service.reason !== model.reason)) {
    rows.push({ key: 'service', label: t('row.service'), value: statusValue(service.status, service.reason, t) })
  }

  if (model === null) {
    rows.push({ key: 'model', label: t('row.model'), value: MODEL_ID })
    rows.push({ key: 'status', label: t('row.status'), value: t('model.missing') })
  } else {
    rows.push({ key: 'model', label: t('row.model'), value: model.id })
    rows.push({ key: 'status', label: t('row.status'), value: statusValue(model.status, model.reason, t) })
    if (model.ttftMs !== null) {
      rows.push({ key: 'ttft', label: t('row.ttft'), value: t('value.seconds', { value: formatSeconds(model.ttftMs) }) })
    }
    if (model.tps !== null) {
      rows.push({ key: 'tps', label: t('row.tps'), value: t('value.tps', { value: formatTps(model.tps) }) })
    }
  }

  return rows
}
