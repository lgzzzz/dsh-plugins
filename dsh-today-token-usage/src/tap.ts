/**
 * 用量旁路：包住一次模型流，原样透传每个 chunk，并在流结束时交出用量。
 *
 * 这是「记录所有 DSH 发出的模型请求」的采集点，接在 `llm/stream` waterfall 的
 * `next()` 之后，因此看到的是 adapter 真正产出的 chunk（重试、重放、路由都在上游处理完毕）。
 *
 * 三条不可动摇的约束：
 *
 *   - **不改流**：每个 chunk 原对象原样 `yield`，不复制、不改写、不吞异常；
 *   - **一定回调一次**：正常结束、抛错、消费方提前 `return()`（例如中断回合）都会在 `finally`
 *     里回调；有几次 `usage` 块就取最后一个（与上游 `TokenUsage` 的结算读法一致）；
 *   - **绝不影响模型调用**：回调里抛出的任何错误都被吞掉，只留下旁路自己的问题。
 */

import type { FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

/** 一次模型流结束时旁路交出的东西。 */
export interface SettledStream {
  /** 流里最后一个 `usage` 块；没有回报时为 undefined。 */
  readonly usage: TokenUsage | undefined
  /** 流里最后一个 `finish` 块的原因；没收到时为 undefined。 */
  readonly finish: FinishReason | undefined
}

/**
 * 包一次模型流：透传 chunk，结算时调用 `onSettled`。
 * @param source - adapter 产出的 chunk 流。
 * @param onSettled - 结算回调；只被调用一次，且抛错会被吞掉。
 * @returns 行为与 `source` 相同、但会记录用量的流。
 */
export function tapStream(
  source: AsyncIterable<StreamChunk>,
  onSettled: (settled: SettledStream) => void,
): AsyncIterable<StreamChunk> {
  return (async function* (): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined
    let finish: FinishReason | undefined
    try {
      for await (const chunk of source) {
        if (chunk.type === 'usage') usage = chunk.usage
        else if (chunk.type === 'finish') finish = chunk.reason
        yield chunk
      }
    } finally {
      try {
        onSettled({ usage, finish })
      } catch {
        // 旁路记录失败不能反过来打断模型调用；错误在 store 内部已单独告警。
      }
    }
  })()
}
