/**
 * 本插件写入会话日志的两个事件载荷，形状对齐上游 `@deepseek-ai/dsh-llm-retry` 的
 * `llm/retry` 与 `llm/retry-started`。
 *
 * 为什么要与上游同形：这两个事件不是本插件私有的记录，而是「一次已排定的模型请求重试」
 * 的规范事实——会话格式校验器按它校验回合 / step / 提供方与编号连续性，客户端按它渲染
 * 「等待重试模型请求（n/m）· Xs」，token 计量按 `llm/retry-started` 关闭上一次尝试的
 * 用量槽。自造一个只属于本插件的事件既进不了模型可见面，也不会被这些消费方读到。
 *
 * 本插件不安装 `@deepseek-ai/dsh-llm-retry`（它是执行器，本插件提供自己的策略层），
 * 因此这里按公开事件的结构声明载荷；`contract.json` 把上游形状固定在构建后校验里。
 *
 * @module dsh-agent-auto-retry/events
 */
import type { LlmFailure } from '@deepseek-ai/dsh-llm'

/**
 * 一条已排定的重试（`llm/retry`）。
 *
 * `mode` 与 `maxRetries` 的两种组合与上游一致：`normal` 带预算上限，`always` 表示
 * 无上限。本插件只写 `normal`（它的重试始终有预算），保留 `always` 分支只是为了让
 * 载荷类型与上游完全一致，避免同一个事件在两处声明出不同的类型。
 */
export type AutoRetryScheduledEvent =
  | {
      readonly retryId: string
      readonly turn: number
      readonly step: number
      readonly provider: string
      readonly mode: 'normal'
      readonly policyKey: string
      readonly retry: number
      readonly maxRetries: number
      readonly delayMs: number
      readonly failure: LlmFailure
    }
  | {
      readonly retryId: string
      readonly turn: number
      readonly step: number
      readonly provider: string
      readonly mode: 'always'
      readonly policyKey: string
      readonly retry: number
      readonly delayMs: number
      readonly failure: LlmFailure
    }

/** 重试等待结束、下一次请求尝试开始前写入的转换（`llm/retry-started`）。 */
export interface AutoRetryStartedEvent {
  readonly retryId: string
  readonly turn: number
  readonly step: number
  readonly retry: number
}
