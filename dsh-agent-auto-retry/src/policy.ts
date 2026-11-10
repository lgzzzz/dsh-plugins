/**
 * 自动重试策略：纯函数，不碰任何服务。
 *
 * 一个失败要不要重试、等多久，全部由这里裁决：
 *
 *   - `isRetryable`：失败码是否值得再来一次（永久性失败码排在通配 `'*'` 之前）；
 *   - `localDelay`：本地指数退避 + 对称抖动，上限 `maxDelayMs`；
 *   - `planDelay`：优先服从提供方的 `Retry-After`，超过 `maxRetryAfterMs` 才放弃；
 *   - `policyKeyOf`：把策略折成一个稳定字符串，写进 `llm/retry` 事件的 `policyKey`。
 *
 * 判定与延时的边界见 docs/dsh-agent-auto-retry.md。
 *
 * @module dsh-agent-auto-retry/policy
 */
import type { LlmFailure } from '@deepseek-ai/dsh-llm'

/** 已解析、不可变的自动重试策略。 */
export interface AutoRetryPolicy {
  /** 同一个 step 内本插件最多追加几次重试；`0` 表示关闭。 */
  readonly maxRetries: number
  /** 允许重试的失败码；含通配 `'*'` 时匹配任何非永久性失败码。 */
  readonly retryableCodes: readonly string[]
  /** 永远不值得重试的失败码；即便 `retryableCodes` 含 `'*'` 也排除。 */
  readonly permanentCodes: readonly string[]
  /** 本地退避首次等待的上限基准（毫秒）。 */
  readonly initialDelayMs: number
  /** 本地退避单次等待的上限（毫秒）。 */
  readonly maxDelayMs: number
  /** 对称抖动幅度，`0`–`1`；实际等待在 `1 ± jitterRatio` 区间内。 */
  readonly jitterRatio: number
  /** 愿意服从的提供方 `Retry-After` 上限（毫秒）；超过它就放弃这次重试。 */
  readonly maxRetryAfterMs: number
}

/** 默认在同一 step 内追加的重试次数。 */
export const DEFAULT_MAX_RETRIES = 5
/** 默认本地退避的首个基准等待。 */
export const DEFAULT_INITIAL_DELAY_MS = 2_000
/** 默认本地退避的单次上限。 */
export const DEFAULT_MAX_DELAY_MS = 60_000
/** 默认抖动幅度。 */
export const DEFAULT_JITTER_RATIO = 0.2
/** 默认愿意服从的提供方建议等待上限。 */
export const DEFAULT_MAX_RETRY_AFTER_MS = 300_000
/** 默认重试除永久性失败之外的所有模型请求失败。 */
export const DEFAULT_RETRYABLE_CODES: readonly string[] = ['*']

/**
 * 单个定时器的上限（毫秒）。
 *
 * `setTimeout` 超过它会把延迟折成 1ms——一次本该等一小时的退避会立刻变成立即重试，
 * 所以配置与生成出来的等待都夹在这个值以内。
 */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * 默认的永久性失败码：重试只会重复同样的失败。
 *
 * 认证、凭据、配额、请求格式、内容能力、上下文超限与需先卸载图片这几类都由别的边界负责，
 * 原样再来一次不会改变结果：上下文超限与图片卸载由 compaction 插件在自己的预算内恢复，
 * 认证 / 配额要用户先改配置或充值，请求格式类则是请求本身不合法。
 */
export const DEFAULT_PERMANENT_CODES: readonly string[] = [
  'ABORTED',
  'AUTH',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'ACCOUNT_SIGN_IN_REQUIRED',
  'ACCOUNT_SIGNED_OUT',
  'QUOTA',
  'ACCOUNT_QUOTA',
  'INVALID_REQUEST',
  'INVALID_ARGS',
  'UNSUPPORTED_CONTENT',
  'UNSUPPORTED_REASONING_EFFORT',
  'INVALID_MODEL_CONTEXT',
  'INVALID_REPLAY_STATE',
  'REQUEST_EXTENSION',
  'CONTEXT_WINDOW_EXCEEDED',
  'IMAGE_OFFLOAD_REQUIRED',
  'NO_ADAPTER',
]

/** 默认策略：有界的退避重试，覆盖所有非永久性失败。 */
export const DEFAULT_POLICY: AutoRetryPolicy = {
  maxRetries: DEFAULT_MAX_RETRIES,
  retryableCodes: DEFAULT_RETRYABLE_CODES,
  permanentCodes: DEFAULT_PERMANENT_CODES,
  initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
  maxDelayMs: DEFAULT_MAX_DELAY_MS,
  jitterRatio: DEFAULT_JITTER_RATIO,
  maxRetryAfterMs: DEFAULT_MAX_RETRY_AFTER_MS,
}

/** 配置里允许出现的键；其余一律报错，避免拼错的键被静默忽略。 */
const KNOWN_KEYS: readonly string[] = [
  'maxRetries',
  'retryableCodes',
  'permanentCodes',
  'initialDelayMs',
  'maxDelayMs',
  'jitterRatio',
  'maxRetryAfterMs',
]

/** 一次等待计划：等多久，或为什么放弃。 */
export type DelayPlan =
  | { readonly kind: 'wait'; readonly delayMs: number }
  | { readonly kind: 'give-up'; readonly reason: 'retry-after' }

/**
 * 解析并校验插件配置；缺省字段取默认值，未知键或非法值抛出带字段名的错误。
 * @param raw - cordis 交给插件的原始配置（`undefined` 表示没有配置块）。
 * @returns 完整、不可变的策略。
 * @throws 配置里有未知键或字段值越界时。
 */
export function normalizePolicy(raw: unknown): AutoRetryPolicy {
  if (raw === undefined || raw === null) return DEFAULT_POLICY
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('dsh-agent-auto-retry: 配置必须是一个对象')
  }
  const source = raw as Record<string, unknown>
  for (const key of Object.keys(source)) {
    if (!KNOWN_KEYS.includes(key)) {
      throw new Error(`dsh-agent-auto-retry: 未知配置项 "${key}"（可用：${KNOWN_KEYS.join('、')}）`)
    }
  }
  return {
    maxRetries: readInteger(source, 'maxRetries', DEFAULT_MAX_RETRIES, 0),
    retryableCodes: readCodes(source, 'retryableCodes', DEFAULT_RETRYABLE_CODES),
    permanentCodes: readCodes(source, 'permanentCodes', DEFAULT_PERMANENT_CODES),
    initialDelayMs: readNumber(source, 'initialDelayMs', DEFAULT_INITIAL_DELAY_MS, 1, MAX_TIMER_DELAY_MS),
    maxDelayMs: readNumber(source, 'maxDelayMs', DEFAULT_MAX_DELAY_MS, 1, MAX_TIMER_DELAY_MS),
    jitterRatio: readNumber(source, 'jitterRatio', DEFAULT_JITTER_RATIO, 0, 1),
    maxRetryAfterMs: readNumber(source, 'maxRetryAfterMs', DEFAULT_MAX_RETRY_AFTER_MS, 1, MAX_TIMER_DELAY_MS),
  }
}

/**
 * 这个失败码是否值得重试。
 *
 * 永久性失败码先于通配判定：即便 {@link AutoRetryPolicy.retryableCodes} 是 `['*']`，
 * 认证失败之类也不会被重试。空列表表示什么都不重试。
 * @param policy - 已解析的策略。
 * @param code - 规范化失败码（`LlmFailure.code`）。
 * @returns 值得再来一次时为 true。
 */
export function isRetryable(policy: AutoRetryPolicy, code: string): boolean {
  if (policy.permanentCodes.includes(code)) return false
  if (policy.retryableCodes.includes('*')) return true
  return policy.retryableCodes.includes(code)
}

/**
 * 本地指数退避：第 `retry` 次重试的等待时长，带对称抖动，不超过 `maxDelayMs`。
 * @param policy - 已解析的策略。
 * @param retry - 本 step 内的重试序号，从 1 开始。
 * @param random - 返回 `[0, 1)` 的随机源；测试可注入固定值。
 * @returns 本次等待的毫秒数；不超过 `maxDelayMs`。
 */
export function localDelay(policy: AutoRetryPolicy, retry: number, random: () => number): number {
  const exponent = Math.min(retry - 1, 1024)
  const exponential = Math.min(policy.initialDelayMs * 2 ** exponent, policy.maxDelayMs)
  const jitter = 1 - policy.jitterRatio + 2 * policy.jitterRatio * random()
  return Math.min(exponential * jitter, policy.maxDelayMs)
}

/**
 * 决定这次重试等多久。
 *
 * 提供方给了有效的 `Retry-After` 且不超过 `maxRetryAfterMs` 时按它等（它比本地猜测更可信）；
 * 超过上限就放弃——让回合如实报错，而不是把请求压到比提供方要求更短的间隔里再打一次。
 * @param policy - 已解析的策略。
 * @param failure - 本次失败的规范化事实。
 * @param retry - 本 step 内的重试序号，从 1 开始。
 * @param random - 返回 `[0, 1)` 的随机源。
 * @returns 等待计划。
 */
export function planDelay(
  policy: AutoRetryPolicy,
  failure: Pick<LlmFailure, 'providerRetryAfterMs'>,
  retry: number,
  random: () => number,
): DelayPlan {
  const hint = failure.providerRetryAfterMs
  if (hint !== undefined && Number.isFinite(hint) && hint > 0) {
    if (hint > policy.maxRetryAfterMs) return { kind: 'give-up', reason: 'retry-after' }
    return { kind: 'wait', delayMs: Math.min(hint, MAX_TIMER_DELAY_MS) }
  }
  return { kind: 'wait', delayMs: Math.min(localDelay(policy, retry, random), MAX_TIMER_DELAY_MS) }
}

/**
 * 把策略折成 `llm/retry` 事件的 `policyKey`。
 *
 * 键里带本插件的固定前缀，因此与提供方自己的 `retryPolicy` 键永不相同：同一个 step 里
 * 两套策略各自是一条独立的重试链，编号都从 1 开始，互不干扰（会话格式校验器按
 * `(turn, step, provider, policyKey)` 认链）。
 * @param policy - 已解析的策略。
 * @returns 稳定、可比较的字符串。
 */
export function policyKeyOf(policy: AutoRetryPolicy): string {
  return JSON.stringify([
    'dsh-agent-auto-retry',
    policy.maxRetries,
    [...policy.retryableCodes].sort(),
    [...policy.permanentCodes].sort(),
    policy.initialDelayMs,
    policy.maxDelayMs,
    policy.jitterRatio,
    policy.maxRetryAfterMs,
  ])
}

/** 读一个非负整数字段。 */
function readInteger(source: Record<string, unknown>, key: string, fallback: number, min: number): number {
  const value = source[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new Error(`dsh-agent-auto-retry: 配置项 "${key}" 必须是不小于 ${min} 的整数`)
  }
  return value
}

/** 读一个有限数值字段。 */
function readNumber(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = source[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`dsh-agent-auto-retry: 配置项 "${key}" 必须是 ${min}–${max} 之间的有限数值`)
  }
  return value
}

/** 读一个非空字符串数组字段。 */
function readCodes(source: Record<string, unknown>, key: string, fallback: readonly string[]): readonly string[] {
  const value = source[key]
  if (value === undefined) return fallback
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`dsh-agent-auto-retry: 配置项 "${key}" 必须是非空字符串组成的数组`)
  }
  return Object.freeze([...value])
}
