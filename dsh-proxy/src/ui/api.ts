/**
 * `/proxy-api` 的浏览器侧客户端与线格式类型。
 *
 * 面板只走同源 cookie 取数；响应体一律当 JSON 文本读，错误信息从 `{ error }` 里取。
 */

/** 内核环形日志的一行。 */
export interface LogLine {
  time: number
  source: string
  text: string
}

/** 归一化后的出口分类：代理（proxy 或节点 tag）、直连、拦截。 */
export type TrafficVerdict = 'proxy' | 'direct' | 'block'

/** 一条连接记录（`/traffic` 的展示形状）。 */
export interface TrafficEntry {
  time: number
  source: string
  network: 'tcp' | 'udp'
  inbound: string
  /** 目的域名或 IP。 */
  host: string
  port: number | null
  /** 仅明文 HTTP 有：已脱敏的路径。 */
  path?: string
  /** 实际命中的出站 tag。 */
  out: string
  /** 出口展示名；节点出口是节点名字。 */
  outLabel: string
  verdict: TrafficVerdict
}

/** `/traffic` 的响应。 */
export interface TrafficView {
  /** 访问日志是否正在写。 */
  live: boolean
  /** `live: false` 的原因。 */
  reason?: string
  /** 访问日志文件路径。 */
  file: string
  /** 命中项，最新在前。 */
  entries: TrafficEntry[]
  summary: {
    matched: number
    proxied: number
    direct: number
    blocked: number
    byOut: Record<string, number>
    first: number | null
    last: number | null
  }
  window: { capacity: number; kept: number; dropped: number; parseErrors: number }
  warnings: string[]
  /** 固定的边界说明。 */
  note: string
}

/** 一份规则库校验诊断。 */
export interface Diagnostic {
  severity: 'error' | 'warning'
  code: string
  path: string
  message: string
  ruleId?: string
}

/** 一条路由规则：匹配条件 + 出口。 */
export interface Rule {
  id: string
  name?: string
  enabled?: boolean
  match: Record<string, string[] | undefined>
  out: string
}

/** 整份规则库：默认出口 + 有序规则。 */
export interface Routing {
  default: string
  rules: Rule[]
}

/** 一个节点的库存信息（不含凭据）。 */
export interface NodeSummary {
  id: string
  name: string
  tag: string
  /** 展示名（宿主半部按名字算好）；缺席时按 `name`、`tag` 依次退让。 */
  label?: string
  protocol: string
  server: string
  port: number
}

/** 一条订阅来源。 */
export interface SubscriptionSummary {
  id: string
  name: string
  source: string
  nodeCount: number
}

/** `/state` 的整份面板快照。 */
export interface PanelState {
  status: {
    core: {
      state: 'stopped' | 'starting' | 'running' | 'error'
      running: boolean
      binary: string | null
      version: string | null
      lastError: string | null
    }
    ruleCount: number
    enabledRuleCount: number
    nodeCount: number
    selectedNode: { id: string; tag: string; name: string; label?: string } | null
    exits: string[]
    /** 出口名 → 展示名；节点出口是节点名字。旧宿主不给这个字段时按出口名显示。 */
    exitLabels?: Record<string, string>
    geo: { dir: string; hasGeosite: boolean; hasGeoip: boolean }
    ports: { socks: number; http: number }
  }
  routing: {
    default: string
    rules: Rule[]
    exits: string[]
    /** 出口名 → 展示名；旧宿主不给这个字段时按出口名显示。 */
    exitLabels?: Record<string, string>
    diagnostics: Diagnostic[]
  }
  nodes: {
    nodes: NodeSummary[]
    selectedNode: string | null
    subscriptions: SubscriptionSummary[]
  }
  logs: LogLine[]
}

/** `/check` 的结果。 */
export interface CheckResult {
  valid: boolean
  diagnostics: Diagnostic[]
}

/** `/write` 的结果。 */
export interface WriteResult {
  saved: boolean
  applied: boolean
  diagnostics: Diagnostic[]
  message: string
}

/** 返回一句人话的动作结果（内核启停、订阅导入、选节点、测延迟）。 */
export interface MessageResult {
  /** `/core` 与 `/select` 会带成败标记；订阅导入、测延迟只给 message。 */
  ok?: boolean
  message: string
}

/**
 * 解析非 2xx 响应里的错误文本。
 * @param payload - 已解析的响应体。
 * @param status - HTTP 状态码。
 * @returns 服务端的 `error` 字段，缺失时退回状态码。
 */
function errorMessage(payload: unknown, status: number): string {
  return typeof payload === 'object' && payload !== null && 'error' in payload
    ? String((payload as { error: unknown }).error)
    : `HTTP ${status}`
}

/**
 * 把异常折成一句可显示的话。
 * @param caught - 捕获到的任意值。
 * @returns 错误消息。
 */
export function describeError(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

/**
 * 调一次 `/proxy-api`。
 * @param path - 以 `/` 开头的子路径。
 * @param body - 省略则发 GET，否则把这个值 JSON 序列化后 POST。
 * @returns 解析后的响应体。
 * @throws 网络失败、非 2xx 或响应不是 JSON 时抛出。
 */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/proxy-api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const text = await response.text()
  const payload: unknown = text === '' ? {} : JSON.parse(text)
  if (!response.ok) throw new Error(errorMessage(payload, response.status))
  return payload as T
}
