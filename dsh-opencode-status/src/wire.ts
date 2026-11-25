/**
 * 本插件的共享词汇：上游 status 接口、宿主同源路由、抓取结果形状与浏览器侧的响应守卫。
 *
 * 上游 `https://opencode.ai/status/api/status` 不带任何 CORS 头，页面（`http://127.0.0.1:3080`）
 * 不能直连，所以取数在宿主半部完成：宿主把 90KB 的整页快照收窄成 {@link OpencodeStatusSnapshot}
 * ——只留 `components` 里 `service: 'go'` 那一条的服务状态，以及它的 `breakdown` / `models` 里
 * `id: 'deepseek-v4.1-flash'` 那一条的模型状态与速度。浏览器半部只认这一份小载荷。
 *
 * 纯模块：只有类型与纯函数，宿主（Node）与浏览器（bundle）两侧都能直接加载，测试也可以。
 */

/** 宿主同源路由的绝对路径：浏览器轮询它，一次拿一份快照。 */
export const STATUS_PATH = '/opencode-status/status'

/** 上游 status 快照接口。 */
export const UPSTREAM_STATUS_URL = 'https://opencode.ai/status/api/status'

/** 上游 `components[].service` 里要读的服务键。 */
export const SERVICE_ID = 'go'

/** 该服务下要读的模型 id（上游用点号与连字符拼写，不是 `deepseekv4.1flash`）。 */
export const MODEL_ID = 'deepseek-v4.1-flash'

/** 上游某个服务的当前状态。 */
export interface OpencodeServiceView {
  /** 服务键，恒为 {@link SERVICE_ID}。 */
  readonly id: string
  /** `operational` / `degraded` / `unknown` 等上游原值；缺字段时为 `unknown`。 */
  readonly status: string
  /** 降级原因原值（`none` / `latency` / `errors` / `availability` / `monitoring` / `upstream`）；缺字段时为空串。 */
  readonly reason: string
}

/** 上游某个服务的某个模型的当前读数。 */
export interface OpencodeModelView {
  /** 模型 id，恒为 {@link MODEL_ID}。 */
  readonly id: string
  /** 模型状态原值；上游没给时为 `unknown`。 */
  readonly status: string
  /** 模型状态原因原值；缺字段时为空串。 */
  readonly reason: string
  /** 首 Token 毫秒数；上游没报或非正数时为 null。 */
  readonly ttftMs: number | null
  /** 每秒 Token 数；上游没报或非正数时为 null。 */
  readonly tps: number | null
}

/**
 * 宿主交给浏览器的一份快照。
 *
 * `service` / `model` 为 null 不是错误：上游结构变了或该服务/模型暂时不在快照里时，
 * 页面照样把已知的部分画出来，缺的那一项由客户端给出「未找到」。
 */
export interface OpencodeStatusSnapshot {
  /** 宿主抓取时刻（毫秒时间戳）。 */
  readonly fetchedAt: number
  /** 上游快照的更新时间（毫秒时间戳）；上游没给时为 null。 */
  readonly updatedAt: number | null
  /** 上游自己标了陈旧，或宿主在刷新失败后拿缓存兜底。 */
  readonly stale: boolean
  /** `service: 'go'` 那一条；不在快照里时为 null。 */
  readonly service: OpencodeServiceView | null
  /** `go` 下 `deepseek-v4.1-flash` 那一条；不在快照里时为 null。 */
  readonly model: OpencodeModelView | null
}

/** 宿主路由的响应：成功带快照，失败带机器可读的 error 码。 */
export type OpencodeStatusReply =
  | ({ readonly ok: true } & OpencodeStatusSnapshot)
  | { readonly ok: false; readonly error: string; readonly message: string }

/** 是否为普通对象（排除 null 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读一个去空白后非空的字符串字段。 */
function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const field = value[key]
  if (typeof field !== 'string') return undefined
  const trimmed = field.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 读一个有限数字字段。 */
function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

/** 读一个对象数组里的普通对象元素。 */
function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/** 读 `speed.ttft` / `speed.tps`；非正数视为「没有读数」。 */
function readSpeed(value: unknown): Pick<OpencodeModelView, 'ttftMs' | 'tps'> {
  const speed = isRecord(value) ? value.speed : undefined
  const ttft = readNumber(speed, 'ttft')
  const tps = readNumber(speed, 'tps')
  return {
    ttftMs: ttft !== undefined && ttft > 0 ? ttft : null,
    tps: tps !== undefined && tps > 0 ? tps : null,
  }
}

/**
 * 把上游整页快照收窄成本插件要的那一条。
 *
 * 取值顺序：`components[].service === 'go'` → `breakdown[]` 里 `id === 'deepseek-v4.1-flash'`
 * 的那一条（上面带 status 与 speed）；`breakdown` 里没有时退回 `models[]` 里的同 id 条目
 * （通常只有 reason，没有速度）。任何一层缺失都不抛错，对应字段为 null。
 * @param upstream - 上游 JSON（任意形状，函数自己守卫）。
 * @param fetchedAt - 宿主抓取时刻（毫秒时间戳）。
 * @returns 收窄后的快照。
 */
export function extractSnapshot(upstream: unknown, fetchedAt: number): OpencodeStatusSnapshot {
  const root = isRecord(upstream) ? upstream : {}
  const components = recordsOf(root.components)
  const component = components.find(entry => readString(entry, 'service') === SERVICE_ID)

  const service: OpencodeServiceView | null = component === undefined
    ? null
    : {
        id: SERVICE_ID,
        status: readString(component, 'status') ?? 'unknown',
        reason: readString(component, 'reason') ?? '',
      }

  const breakdown = component === undefined
    ? undefined
    : recordsOf(component.breakdown).find(entry => readString(entry, 'id') === MODEL_ID)
  const listed = component === undefined
    ? undefined
    : recordsOf(component.models).find(entry => readString(entry, 'id') === MODEL_ID)
  const entry = breakdown ?? listed

  const model: OpencodeModelView | null = entry === undefined
    ? null
    : {
        id: MODEL_ID,
        status: readString(entry, 'status') ?? 'unknown',
        reason: readString(entry, 'reason') ?? readString(listed, 'reason') ?? '',
        ...readSpeed(entry),
      }

  return {
    fetchedAt,
    updatedAt: readNumber(root, 'updatedAt') ?? null,
    stale: root.stale === true,
    service,
    model,
  }
}

/** 读一个服务视图；字段不全时返回 undefined。 */
function serviceViewOf(value: unknown): OpencodeServiceView | undefined {
  const id = readString(value, 'id')
  const status = readString(value, 'status')
  if (id === undefined || status === undefined) return undefined
  return { id, status, reason: readString(value, 'reason') ?? '' }
}

/** 读一个模型视图；字段不全或数值类型不对时返回 undefined。 */
function modelViewOf(value: unknown): OpencodeModelView | undefined {
  const id = readString(value, 'id')
  const status = readString(value, 'status')
  if (id === undefined || status === undefined) return undefined
  const ttft = readNumber(value, 'ttftMs')
  const tps = readNumber(value, 'tps')
  if (!isRecord(value)) return undefined
  if (value.ttftMs !== null && ttft === undefined) return undefined
  if (value.tps !== null && tps === undefined) return undefined
  return {
    id,
    status,
    reason: readString(value, 'reason') ?? '',
    ttftMs: ttft ?? null,
    tps: tps ?? null,
  }
}

/**
 * 校验宿主路由的响应形状（浏览器侧守卫）。
 *
 * 页面只信任这个函数放行的字段：HTML fallback、代理插进来的错误页或手工篡改的坏帧都会被拒，
 * 上一份读数保持不变。成功响应里 `service` / `model` 明确要求 null 或完整视图，缺字段视为坏帧。
 * @param value - `JSON.parse` 后的响应体。
 * @returns 合法的响应，或 undefined。
 */
export function parseStatusReply(value: unknown): OpencodeStatusReply | undefined {
  if (!isRecord(value)) return undefined

  if (value.ok === false) {
    const error = readString(value, 'error')
    if (error === undefined) return undefined
    return { ok: false, error, message: readString(value, 'message') ?? '' }
  }
  if (value.ok !== true) return undefined

  const fetchedAt = readNumber(value, 'fetchedAt')
  if (fetchedAt === undefined) return undefined

  const service = value.service === null ? null : serviceViewOf(value.service)
  if (service === undefined) return undefined
  const model = value.model === null ? null : modelViewOf(value.model)
  if (model === undefined) return undefined

  return {
    ok: true,
    fetchedAt,
    updatedAt: readNumber(value, 'updatedAt') ?? null,
    stale: value.stale === true,
    service,
    model,
  }
}
