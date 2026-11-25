/**
 * 节点：分享链接解析、订阅解码、出口生成与脱敏。
 *
 * MVP 支持 ss / vmess / vless / trojan 四种分享链接；Clash YAML、hysteria2、tuic
 * 明确不做 —— 解析不了就报「不支持」，不猜。
 */

import { createHash } from 'node:crypto'
import { connect } from 'node:net'

/** 支持的协议。 */
export type NodeProtocol = 'shadowsocks' | 'vmess' | 'vless' | 'trojan'

/** TLS / REALITY 选项。 */
export interface NodeTls {
  mode: 'none' | 'tls' | 'reality'
  serverName?: string
  alpn?: string[]
  fingerprint?: string
  publicKey?: string
  shortId?: string
  spiderX?: string
}

/** 传输层选项。 */
export interface NodeTransport {
  network: 'tcp' | 'ws' | 'grpc'
  path?: string
  host?: string
  serviceName?: string
}

/** 一个代理节点。凭据字段只用于生成内核配置，永远不进工具输出与日志。 */
export interface ProxyNode {
  id: string
  name: string
  /** 出口名：规则里 `out` 写的就是它。 */
  tag: string
  protocol: NodeProtocol
  server: string
  port: number
  password?: string
  method?: string
  uuid?: string
  alterId?: number
  flow?: string
  security?: string
  tls?: NodeTls
  transport?: NodeTransport
  subscriptionId?: string
  addedAt: number
}

/** 解析结果：成功带节点，失败带原因。 */
export type ParseResult = { ok: true; node: NodeSpec } | { ok: false; reason: string }

/** 解析出的节点，尚未分配 id / tag。 */
export type NodeSpec = Omit<ProxyNode, 'id' | 'tag' | 'addedAt' | 'subscriptionId'>

/** 订阅解析结果。 */
export interface SubscriptionParse {
  nodes: NodeSpec[]
  errors: { line: number; reason: string }[]
}

/** 一个节点的 TCP 握手耗时。 */
export interface LatencyResult {
  nodeId: string
  tag: string
  ok: boolean
  ms?: number
  error?: string
}

function decodeBase64(text: string): string {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

/** 整段文本是否像一个 base64 订阅体（而不是若干条分享链接）。 */
function looksLikeBase64Body(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.includes('://')) return false
  return /^[A-Za-z0-9+/\-_=\s]+$/.test(trimmed) && trimmed.length > 16
}

/** 稳定 id：同一协议 + 同一服务器 + 同一凭据 → 同一条记录。 */
function stableId(spec: NodeSpec): string {
  const key = `${spec.protocol}|${spec.server}|${spec.port}|${spec.uuid ?? ''}|${spec.password ?? ''}|${spec.method ?? ''}`
  return `${spec.protocol.slice(0, 2)}-${createHash('sha256').update(key).digest('hex').slice(0, 10)}`
}

function readSearch(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)
  return value === null || value === '' ? undefined : value
}

function transportFromParams(params: URLSearchParams): NodeTransport | undefined {
  const network = readSearch(params, 'type') ?? 'tcp'
  if (network === 'tcp' || network === 'none') return undefined
  if (network === 'ws') {
    return {
      network: 'ws',
      ...(readSearch(params, 'path') === undefined ? {} : { path: readSearch(params, 'path')! }),
      ...(readSearch(params, 'host') === undefined ? {} : { host: readSearch(params, 'host')! }),
    }
  }
  if (network === 'grpc') {
    const serviceName = readSearch(params, 'serviceName') ?? readSearch(params, 'path')
    return { network: 'grpc', ...(serviceName === undefined ? {} : { serviceName }) }
  }
  return { network: 'tcp' }
}

function tlsFromParams(params: URLSearchParams, fallbackName?: string, defaultSecurity: 'none' | 'tls' = 'none'): NodeTls | undefined {
  const security = readSearch(params, 'security') ?? defaultSecurity
  if (security === 'tls') {
    const alpn = readSearch(params, 'alpn')
    return {
      mode: 'tls',
      ...(readSearch(params, 'sni') ?? fallbackName) === undefined ? {} : { serverName: (readSearch(params, 'sni') ?? fallbackName)! },
      ...(alpn === undefined ? {} : { alpn: alpn.split(',') }),
      ...(readSearch(params, 'fp') === undefined ? {} : { fingerprint: readSearch(params, 'fp')! }),
    }
  }
  if (security === 'reality') {
    return {
      mode: 'reality',
      ...(readSearch(params, 'sni') ?? fallbackName) === undefined ? {} : { serverName: (readSearch(params, 'sni') ?? fallbackName)! },
      ...(readSearch(params, 'fp') === undefined ? {} : { fingerprint: readSearch(params, 'fp')! }),
      ...(readSearch(params, 'pbk') === undefined ? {} : { publicKey: readSearch(params, 'pbk')! }),
      ...(readSearch(params, 'sid') === undefined ? {} : { shortId: readSearch(params, 'sid')! }),
      ...(readSearch(params, 'spx') === undefined ? {} : { spiderX: readSearch(params, 'spx')! }),
    }
  }
  return undefined
}

function parseShadowsocks(uri: string): ParseResult {
  const body = uri.slice('ss://'.length)
  const hashIndex = body.indexOf('#')
  const name = hashIndex === -1 ? 'shadowsocks' : decodeURIComponent(body.slice(hashIndex + 1))
  const payload = (hashIndex === -1 ? body : body.slice(0, hashIndex)).split('?')[0] ?? ''

  let method: string
  let password: string
  let host: string
  let port: number

  const at = payload.lastIndexOf('@')
  if (at !== -1) {
    const userinfo = decodeBase64(payload.slice(0, at))
    const colon = userinfo.indexOf(':')
    if (colon === -1) return { ok: false, reason: 'ss 用户信息里没有 method:password' }
    method = userinfo.slice(0, colon)
    password = userinfo.slice(colon + 1)
    const hostPort = payload.slice(at + 1)
    const lastColon = hostPort.lastIndexOf(':')
    if (lastColon === -1) return { ok: false, reason: 'ss 链接缺少端口' }
    host = hostPort.slice(0, lastColon).replace(/^\[|\]$/g, '')
    port = Number(hostPort.slice(lastColon + 1))
  } else {
    const decoded = decodeBase64(payload)
    const atSign = decoded.lastIndexOf('@')
    const colon = decoded.indexOf(':')
    if (atSign === -1 || colon === -1) return { ok: false, reason: 'ss 链接格式无法识别' }
    method = decoded.slice(0, colon)
    password = decoded.slice(colon + 1, atSign)
    const hostPort = decoded.slice(atSign + 1)
    const lastColon = hostPort.lastIndexOf(':')
    if (lastColon === -1) return { ok: false, reason: 'ss 链接缺少端口' }
    host = hostPort.slice(0, lastColon).replace(/^\[|\]$/g, '')
    port = Number(hostPort.slice(lastColon + 1))
  }

  if (method === '' || password === '' || host === '' || !Number.isInteger(port) || port <= 0) {
    return { ok: false, reason: 'ss 链接缺少 method、password、host 或 port' }
  }
  return { ok: true, node: { name, protocol: 'shadowsocks', server: host, port, method, password } }
}

function parseVmess(uri: string): ParseResult {
  const body = uri.slice('vmess://'.length).trim()
  let payload: unknown
  try {
    payload = JSON.parse(decodeBase64(body))
  } catch {
    return { ok: false, reason: 'vmess 链接不是合法的 base64 JSON' }
  }
  if (typeof payload !== 'object' || payload === null) return { ok: false, reason: 'vmess JSON 不是对象' }
  const record = payload as Record<string, unknown>
  const server = String(record.add ?? '')
  const port = Number(record.port ?? 0)
  const uuid = String(record.id ?? '')
  if (server === '' || uuid === '' || !Number.isInteger(port) || port <= 0) {
    return { ok: false, reason: 'vmess JSON 缺少 add、port 或 id' }
  }
  const network = String(record.net ?? 'tcp')
  const tls = String(record.tls ?? '')
  const name = String(record.ps ?? record.add ?? 'vmess')
  const transport: NodeTransport | undefined =
    network === 'ws'
      ? {
          network: 'ws',
          ...(record.path === undefined ? {} : { path: String(record.path) }),
          ...(record.host === undefined ? {} : { host: String(record.host) }),
        }
      : network === 'grpc'
        ? { network: 'grpc', ...(record.path === undefined ? {} : { serviceName: String(record.path) }) }
        : undefined
  const tlsOptions: NodeTls | undefined =
    tls === 'tls' || tls === 'reality'
      ? {
          mode: tls === 'reality' ? 'reality' : 'tls',
          ...(record.sni === undefined ? { serverName: server } : { serverName: String(record.sni) }),
          ...(record.alpn === undefined ? {} : { alpn: String(record.alpn).split(',').filter(Boolean) }),
          ...(record.fp === undefined ? {} : { fingerprint: String(record.fp) }),
        }
      : undefined
  return {
    ok: true,
    node: {
      name,
      protocol: 'vmess',
      server,
      port,
      uuid,
      alterId: Number(record.aid ?? 0),
      security: String(record.scy ?? 'auto'),
      ...(transport === undefined ? {} : { transport }),
      ...(tlsOptions === undefined ? {} : { tls: tlsOptions }),
    },
  }
}

function parseUrlLike(uri: string, protocol: NodeProtocol): ParseResult {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return { ok: false, reason: `${protocol} 链接不是合法 URL` }
  }
  const server = url.hostname.replace(/^\[|\]$/g, '')
  const port = Number(url.port)
  if (server === '' || !Number.isInteger(port) || port <= 0) {
    return { ok: false, reason: `${protocol} 链接缺少 host 或 port` }
  }
  const name = url.hash === '' ? `${protocol}-${server}` : decodeURIComponent(url.hash.slice(1))
  const params = url.searchParams
  const transport = transportFromParams(params)
  // trojan 的传输层本来就是 TLS；没写 security 参数时按 tls 处理。
  const tls = tlsFromParams(params, server, protocol === 'trojan' ? 'tls' : 'none')
  const credential = decodeURIComponent(url.username)

  if (protocol === 'vless') {
    if (credential === '') return { ok: false, reason: 'vless 链接缺少 id' }
    const flow = readSearch(params, 'flow')
    return {
      ok: true,
      node: {
        name,
        protocol,
        server,
        port,
        uuid: credential,
        ...(flow === undefined ? {} : { flow }),
        ...(transport === undefined ? {} : { transport }),
        ...(tls === undefined ? {} : { tls }),
      },
    }
  }
  if (credential === '') return { ok: false, reason: 'trojan 链接缺少密码' }
  return {
    ok: true,
    node: {
      name,
      protocol: 'trojan',
      server,
      port,
      password: credential,
      ...(transport === undefined ? {} : { transport }),
      ...(tls === undefined ? {} : { tls }),
    },
  }
}

/** 解析一条分享链接。 */
export function parseNodeUri(uri: string): ParseResult {
  const trimmed = uri.trim()
  if (trimmed === '') return { ok: false, reason: '空行' }
  if (trimmed.startsWith('ss://')) return parseShadowsocks(trimmed)
  if (trimmed.startsWith('vmess://')) return parseVmess(trimmed)
  if (trimmed.startsWith('vless://')) return parseUrlLike(trimmed, 'vless')
  if (trimmed.startsWith('trojan://')) return parseUrlLike(trimmed, 'trojan')
  const scheme = trimmed.includes('://') ? trimmed.slice(0, trimmed.indexOf('://')) : trimmed.slice(0, 12)
  return { ok: false, reason: `不支持的协议 ${scheme}；目前支持 ss / vmess / vless / trojan` }
}

/**
 * 解析一段订阅内容：整段 base64 或逐行的分享链接都可以。
 * @param text - 订阅原文（已取回的文本），或用户粘贴的多行链接。
 */
export function parseSubscription(text: string): SubscriptionParse {
  const raw = String(text ?? '')
  const body = looksLikeBase64Body(raw) ? decodeBase64(raw) : raw
  const nodes: NodeSpec[] = []
  const errors: { line: number; reason: string }[] = []
  const lines = body.split(/\r?\n/)
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    const result = parseNodeUri(trimmed)
    if (result.ok) nodes.push(result.node)
    else errors.push({ line: index + 1, reason: result.reason })
  })
  return { nodes, errors }
}

/**
 * 给一批节点分配不冲突的 id 与出口名（tag）。
 * @param specs - 解析出的节点。
 * @param existing - 已有节点；同 id 的保留原 tag，避免规则里的 `out` 失效。
 */
export function assignIdentities(specs: NodeSpec[], existing: ProxyNode[] = []): ProxyNode[] {
  const byId = new Map(existing.map((node) => [node.id, node]))
  const usedTags = new Set<string>()
  const now = Date.now()
  const created: ProxyNode[] = []
  for (const spec of specs) {
    const id = stableId(spec)
    const previous = byId.get(id)
    let tag = previous?.tag ?? slugTag(spec.name, spec.protocol)
    let suffix = 2
    while (usedTags.has(tag)) {
      tag = `${slugTag(spec.name, spec.protocol)}-${suffix}`
      suffix += 1
    }
    usedTags.add(tag)
    created.push({
      ...spec,
      id,
      tag,
      addedAt: previous?.addedAt ?? now,
      ...(previous?.subscriptionId === undefined ? {} : { subscriptionId: previous.subscriptionId }),
    })
  }
  return created
}

function slugTag(name: string, protocol: NodeProtocol): string {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return slug === '' ? protocol : slug
}

/** 生成 xray 的一个 outbound。`exportTag` 决定它在配置里的名字。 */
export function outboundForNode(node: ProxyNode, exportTag: string = node.tag): Record<string, unknown> {
  const outbound: Record<string, unknown> = { tag: exportTag, protocol: node.protocol }
  switch (node.protocol) {
    case 'vmess':
      outbound.settings = {
        vnext: [
          {
            address: node.server,
            port: node.port,
            users: [{ id: node.uuid ?? '', alterId: node.alterId ?? 0, security: node.security ?? 'auto' }],
          },
        ],
      }
      break
    case 'vless':
      outbound.settings = {
        vnext: [
          {
            address: node.server,
            port: node.port,
            users: [{ id: node.uuid ?? '', encryption: 'none', ...(node.flow === undefined ? {} : { flow: node.flow }) }],
          },
        ],
      }
      break
    case 'trojan':
      outbound.settings = { servers: [{ address: node.server, port: node.port, password: node.password ?? '' }] }
      break
    case 'shadowsocks':
      outbound.settings = {
        servers: [{ address: node.server, port: node.port, method: node.method ?? 'aes-128-gcm', password: node.password ?? '' }],
      }
      break
  }
  const stream = streamSettingsOf(node)
  if (stream !== undefined) outbound.streamSettings = stream
  return outbound
}

function streamSettingsOf(node: ProxyNode): Record<string, unknown> | undefined {
  const settings: Record<string, unknown> = {}
  if (node.transport !== undefined && node.transport.network !== 'tcp') {
    settings.network = node.transport.network
    if (node.transport.network === 'ws') {
      settings.wsSettings = {
        ...(node.transport.path === undefined ? {} : { path: node.transport.path }),
        ...(node.transport.host === undefined ? {} : { headers: { Host: node.transport.host } }),
      }
    } else {
      settings.grpcSettings = { serviceName: node.transport.serviceName ?? '' }
    }
  }
  if (node.tls !== undefined && node.tls.mode !== 'none') {
    settings.security = node.tls.mode
    if (node.tls.mode === 'reality') {
      settings.realitySettings = {
        ...(node.tls.serverName === undefined ? {} : { serverName: node.tls.serverName }),
        ...(node.tls.fingerprint === undefined ? {} : { fingerprint: node.tls.fingerprint }),
        ...(node.tls.publicKey === undefined ? {} : { publicKey: node.tls.publicKey }),
        ...(node.tls.shortId === undefined ? {} : { shortId: node.tls.shortId }),
        ...(node.tls.spiderX === undefined ? {} : { spiderX: node.tls.spiderX }),
      }
    } else {
      settings.tlsSettings = {
        ...(node.tls.serverName === undefined ? {} : { serverName: node.tls.serverName }),
        ...(node.tls.alpn === undefined ? {} : { alpn: node.tls.alpn }),
        ...(node.tls.fingerprint === undefined ? {} : { fingerprint: node.tls.fingerprint }),
      }
    }
  }
  return Object.keys(settings).length === 0 ? undefined : settings
}

/** 工具输出用：去掉一切凭据字段。 */
export function redactNode(node: ProxyNode): {
  id: string
  name: string
  tag: string
  protocol: NodeProtocol
  server: string
  port: number
  transport?: string
  tls?: string
  subscriptionId?: string
} {
  const redacted: ReturnType<typeof redactNode> = {
    id: node.id,
    name: node.name,
    tag: node.tag,
    protocol: node.protocol,
    server: node.server,
    port: node.port,
  }
  if (node.transport !== undefined) redacted.transport = node.transport.network
  if (node.tls !== undefined && node.tls.mode !== 'none') redacted.tls = node.tls.mode
  if (node.subscriptionId !== undefined) redacted.subscriptionId = node.subscriptionId
  return redacted
}

/**
 * 对一个节点做 TCP 握手测延迟。只测「连得上、多久」，不验证代理是否真的能出网。
 * @param node - 目标节点。
 * @param timeoutMs - 超时；默认 5 秒。
 */
export function measureLatency(node: ProxyNode, timeoutMs = 5000): Promise<LatencyResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const socket = connect({ host: node.server, port: node.port })
    let settled = false
    const finish = (result: LatencyResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      finish({ nodeId: node.id, tag: node.tag, ok: true, ms: Date.now() - startedAt })
    })
    socket.once('timeout', () => {
      finish({ nodeId: node.id, tag: node.tag, ok: false, error: `连接超时（${timeoutMs}ms）` })
    })
    socket.once('error', (error: Error) => {
      finish({ nodeId: node.id, tag: node.tag, ok: false, error: error.message })
    })
  })
}
