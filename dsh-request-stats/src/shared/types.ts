/**
 * `dsh-request-stats` 的共享数据契约。
 *
 * 这里只放宿主半部与浏览器半部都必须认同的形状:账本里的一行记录、看板接口返回的
 * 一份聚合,以及看板的时间窗与配置口径。宿主半部按这些形状写入磁盘并渲染 JSON;
 * 浏览器半部只做 type-only import,编译后不留下任何运行时依赖。
 *
 * 记录是**派生展示数据**,不是会话真相:字段全部可选(除了身份、时间与状态),
 * 缺失表示这次请求没有观测到该事实,而不是 0。
 *
 * @module dsh-request-stats/shared/types
 */

/** 一次请求的结果;`aborted` 是调用方取消,不算失败。 */
export type RecordStatus = 'ok' | 'error' | 'aborted'

/** 传输事实的来路:直连观测到对端、经代理、或没能观测到。 */
export type ConnectionKind = 'direct' | 'proxied' | 'unknown'

/** 对端地址是本次连接观测到的,还是沿用同一 host 的连接池记录。 */
export type IpSource = 'connect' | 'pool'

/** 一条可序列化的失败原因;code 与 message 各自截断到固定长度。 */
export interface FailureInfo {
  /** 上游错误码(如 `ECONNRESET`、`RATE_LIMIT`)。 */
  code?: string
  /** 上游错误文本,截断到 300 字符。 */
  message?: string
}

/** 这次请求打到的端点;`path` 不含查询串中的凭据,但仍按 200 字符截断。 */
export interface EndpointInfo {
  /** 请求 origin 的 hostname,小写。 */
  host?: string
  /** 请求路径,截断到 200 字符。 */
  path?: string
}

/**
 * 账本里的一行:一次模型请求的传输事实与流式计时。
 *
 * 记录只在内存里增量补齐,写入磁盘前经过 `sanitize`,所以可选字段表示「没有观测到」。
 */
export interface RequestRecord {
  /** 本次调用的随机 UUID,也是明细表的行 key。 */
  id: string
  /** 请求开始的墙上时间(毫秒时间戳)。 */
  at: number
  /** 提供方路由(如 `opencode-go`),截断到 80 字符。 */
  provider?: string
  /** 模型 id,截断到 120 字符。 */
  model?: string
  /** 辅助调用用途(如 `session-title`);普通对话请求没有。 */
  purpose?: string
  /** 会话 id,截断到 120 字符。 */
  sessionId?: string
  /** 结果。 */
  status: RecordStatus
  /** 这次请求的端点。 */
  endpoint?: EndpointInfo
  /** 直连时观测到的服务器对端地址;经代理时为空。 */
  ip?: string
  /** 对端端口。 */
  ipPort?: number
  /** `ip` 是新连接观测到的,还是同一 host 连接池的沿用值。 */
  ipSource?: IpSource
  /** 传输事实的来路。 */
  connection: ConnectionKind
  /** 经代理时的本机代理地址(`host:port`)。 */
  proxy?: string
  /** 响应 `cf-ray` 头结尾的三字母边缘机房代码(如 `SIN`)。 */
  colo?: string
  /** 完整 `cf-ray` 头。 */
  ray?: string
  /** 响应 `server` 头。 */
  server?: string
  /** 请求时刻该端点 host 的 DNS 地址列表,最多 8 条。 */
  dns?: string[]
  /** 首字延迟:请求开始到第一个内容块。 */
  ttftMs?: number
  /** 解码耗时:首字到流结束。 */
  decodeMs?: number
  /** 总耗时:请求开始到流结束。 */
  totalMs?: number
  /** 输出 token 数;提供方未报 usage 时是按流式字符估算的值。 */
  outputTokens?: number
  /** 输入 token 数(不含缓存命中)。 */
  inputTokens?: number
  /** 缓存读取 token 数。 */
  cacheReadTokens?: number
  /** 输出速度(tokens/s)。 */
  tps?: number
  /** `outputTokens` / `tps` 是估算值,不是提供方读数。 */
  tpsEstimated?: true
  /** 结束原因的种类(如 `stop`、`error`、`cancelled`)。 */
  finishKind?: string
  /** 失败原因;`status` 为 `ok` 时为空。 */
  failure?: FailureInfo
}

/** 看板可选的历史窗口;`all` 表示不截断。 */
export type WindowKey = 'all' | '1h' | '24h' | '7d'

/** 一组数值的分布摘要;没有样本时除 `count` 外全部为空。 */
export interface Distribution {
  /** 参与统计的样本数。 */
  count: number
  /** 均值,一位小数。 */
  avg?: number
  /** nearest-rank 中位数。 */
  p50?: number
  /** nearest-rank P90。 */
  p90?: number
  /** 最小值。 */
  min?: number
  /** 最大值。 */
  max?: number
}

/** 服务器表的一行:按「对端 IP 或边缘机房」分组后的一次请求集合。 */
export interface ServerRow {
  /** 稳定的分组键:`ip:<地址>`、`edge:<机房>` 或 `unknown`。 */
  key: string
  /** 表格里显示的服务器标识。 */
  label: string
  /** 直连观测到的对端地址。 */
  ip?: string
  /** 边缘机房代码。 */
  colo?: string
  /** 组内首条记录(通常一致)的传输来路。 */
  connection: ConnectionKind
  /** 请求数。 */
  requests: number
  /** 占当前窗口请求总数的比例,三位小数。 */
  share: number
  /** 失败请求数。 */
  errors: number
  /** 取消请求数。 */
  aborted: number
  /** 首字延迟均值。 */
  ttftAvg?: number
  /** 首字延迟中位数。 */
  ttftP50?: number
  /** 输出速度均值。 */
  tpsAvg?: number
  /** 输出速度中位数。 */
  tpsP50?: number
  /** 输出 token 合计。 */
  outputTokens: number
  /** 组内最近一次请求的时间。 */
  lastAt: number
  /** 组内出现过的模型。 */
  models: string[]
}

/** 模型表的一行:按「提供方 / 模型」分组。 */
export interface ModelRow {
  /** 稳定的分组键。 */
  key: string
  /** 模型 id;缺失时是 `unknown`。 */
  model: string
  /** 提供方路由。 */
  provider?: string
  /** 请求数。 */
  requests: number
  /** 失败请求数。 */
  errors: number
  /** 首字延迟均值。 */
  ttftAvg?: number
  /** 输出速度均值。 */
  tpsAvg?: number
  /** 输出 token 合计。 */
  outputTokens: number
  /** 组内最近一次请求的时间。 */
  lastAt: number
}

/** 趋势图上的一个点。 */
export interface SeriesPoint {
  /** 请求时间。 */
  at: number
  /** 首字延迟;没有内容块时为空。 */
  ttftMs?: number
  /** 输出速度;没有解码窗口时为空。 */
  tps?: number
  /** 服务器分组键。 */
  key: string
  /** 模型 id。 */
  model?: string
  /** 结果。 */
  status: RecordStatus
}

/** 正在流式输出的调用,用于页首的活动计数。 */
export interface LiveCall {
  /** 模型 id。 */
  model?: string
  /** 提供方路由。 */
  provider?: string
  /** 请求开始时间。 */
  startedAt: number
  /** 已进行的毫秒数。 */
  elapsedMs?: number
}

/** 全量汇总。 */
export interface SummaryTotals {
  /** 当前窗口内的请求数(默认不含辅助调用)。 */
  requests: number
  /** 成功数。 */
  ok: number
  /** 失败数。 */
  errors: number
  /** 取消数。 */
  aborted: number
  /** 此刻仍在流式输出的调用数。 */
  inFlight: number
  /** 成功率:成功 ÷(成功 + 失败),0..1。 */
  successRate?: number
  /** 仅成功请求的首字延迟分布。 */
  ttft: Distribution
  /** 仅成功请求的输出速度分布。 */
  tps: Distribution
  /** 输出 token 合计。 */
  outputTokens: number
  /** 输入 token 合计。 */
  inputTokens: number
  /** 缓存读取 token 合计。 */
  cacheReadTokens: number
  /** 速度样本里估算值的条数。 */
  estimatedSpeeds: number
  /** 平均每条请求的输出 token 数。 */
  avgOutputTokens?: number
}

/** 传输事实的覆盖情况。 */
export interface SummaryCoverage {
  /** 直连观测到对端地址的条数。 */
  direct: number
  /** 经代理的条数。 */
  proxied: number
  /** 没能判定来路的条数。 */
  unknown: number
  /** 带边缘机房代码的条数。 */
  edge: number
}

/** 看板一次轮询拿到的全部内容。 */
export interface Summary {
  /** 生成这份汇总的时间。 */
  generatedAt: number
  /** 生效的窗口。 */
  window: WindowKey
  /** 账本总量,不受窗口影响。 */
  retained: number
  /** 当前视图是否包含辅助调用。 */
  includeAuxiliary: boolean
  /** 当前窗口内的辅助调用条数。 */
  auxiliary: number
  /** 受监控的提供方与 host。 */
  watched: { providers: string[]; hosts: string[] }
  /** 当前窗口的合计。 */
  totals: SummaryTotals
  /** 传输事实覆盖情况。 */
  coverage: SummaryCoverage
  /** 按服务器分组。 */
  servers: ServerRow[]
  /** 按模型分组。 */
  models: ModelRow[]
  /** 趋势序列(最近 120 条)。 */
  series: SeriesPoint[]
  /** 明细(最近 80 条,新的在前)。 */
  recent: RequestRecord[]
  /** 正在流式输出的调用(最多 8 条)。 */
  live: LiveCall[]
}

/** 行配置解析后的录制参数。 */
export interface RecordingOptions {
  /** 要记录的提供方路由;空集合表示全部。 */
  providers: string[]
  /** 受监控的端点 host。 */
  hosts: string[]
  /** 账本保留的最大行数。 */
  maxRecords: number
  /** 账本保留的天数。 */
  retentionDays: number
}
