/**
 * `todayTokenUsage` 投影定义：状态 schema、wire 视图 schema 与登记用的常量对象。
 *
 * 状态是纯 JSON（会被投影缓存的 `(sessionId, key, ver, seq, val)` 行存档），schema 用 strict：
 * 字段形状一变就必须同时把 `stateVersion` 加一，存档里的旧状态会被丢弃并整段重折。
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session/types'
import type { FoldState } from './fold.ts'
import { applyFold, initFold, viewOf } from './fold.ts'
import { PROJECTION_KEY } from './wire.ts'

/** 四个 Token 桶的 schema（非负整数；与 provider 上报的用量一致）。 */
const bucketsSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

/** wire 视图 schema：日期键 + 四个桶。 */
export const todayTokenUsageViewSchema = z.object({
  day: z.string().max(10),
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

/** 折叠状态 schema：继承前缀长度、当前日期桶、替换槽。 */
const foldStateSchema = z.object({
  inherited: z.number().int().nonnegative(),
  current: todayTokenUsageViewSchema.nullable(),
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    day: z.string().max(10),
    buckets: bucketsSchema,
  }).strict().nullable(),
}).strict()

/**
 * 登记进 `ctx.sessionProjections` 的单元定义。
 *
 * `wire` 不是 summary 排除项，所以列表行就带着它（冷会话读持久化缓存里的那一行）；
 * 客户端只累加 `day` 等于自己今天的会话。
 */
export const todayTokenUsageProjection = {
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: foldStateSchema,
  init: (_header: SessionHeader, inheritedEventCount: SessionLogOffset) => initFold(inheritedEventCount),
  apply: applyFold,
  wire: {
    viewSchema: todayTokenUsageViewSchema,
    view: viewOf,
  },
} satisfies ProjectionDefinition<typeof PROJECTION_KEY, FoldState>
