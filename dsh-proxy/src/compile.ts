/**
 * 编译：结构化规则 → xray 的 `routing.rules[]`，以及整份内核配置。
 *
 * 这一层只做字段搬运 —— `geosite:`、`geoip:`、`ext:`、`domain:` 这些前缀本来就是
 * xray 的值约定，原样保留。映射表见 DESIGN.md §6.3。
 */

import type { Routing } from './ir.ts'
import type { ProxyNode } from './nodes.ts'
import { outboundForNode } from './nodes.ts'
import { isIpOrCidr } from './util.ts'

/** 一条 xray 路由规则。 */
export interface XrayFieldRule {
  type: 'field'
  domain?: string[]
  ip?: string[]
  port?: string
  sourcePort?: string
  network?: string
  protocol?: string[]
  source?: string[]
  inboundTag?: string[]
  outboundTag: string
}

/** 一条未参与编译的规则及原因。 */
export interface SkippedRule {
  id: string
  reason: string
}

/** 编译结果。 */
export interface CompiledRouting {
  /** 交给 xray 的 `routing.rules[]`，已含注入规则与默认出口规则。 */
  rules: XrayFieldRule[]
  skipped: SkippedRule[]
  stats: { enabled: number; disabled: number; injected: number }
}

/** 编译选项。 */
export interface CompileOptions {
  /** 节点库存；用它们的服务器地址注入防环规则。 */
  nodes?: ProxyNode[]
  /** 入站 tag；注入规则只对这些入站生效。省略表示对所有入站生效。 */
  inboundTags?: string[]
}

/**
 * 编译整份规则集。
 *
 * 产物顺序固定：先注入「访问代理服务器自身地址 → direct」（防环）与 Apple Push → direct，
 * 再按顺序放用户规则，最后一条无条件的默认出口规则指向 `routing.default`。
 * 关闭的规则不进产物，但也不从库里删。
 */
export function compileRouting(routing: Routing, options: CompileOptions = {}): CompiledRouting {
  const skipped: SkippedRule[] = []
  const injected: XrayFieldRule[] = []
  const inboundTag = options.inboundTags !== undefined && options.inboundTags.length > 0 ? options.inboundTags : undefined

  const servers = (options.nodes ?? []).map((node) => node.server).filter((server) => server !== '')
  const serverIps = servers.filter((server) => isIpOrCidr(server))
  const serverDomains = servers.filter((server) => !isIpOrCidr(server))
  if (serverIps.length > 0) {
    injected.push({ type: 'field', ip: [...new Set(serverIps)], outboundTag: 'direct' })
  }
  if (serverDomains.length > 0) {
    injected.push({
      type: 'field',
      domain: [...new Set(serverDomains)].map((domain) => `full:${domain}`),
      outboundTag: 'direct',
    })
  }
  // 与 v2rayA 一样的隐式直连：Apple 推送走代理会断。
  injected.push({
    type: 'field',
    domain: ['domain:push-apple.com.akadns.net', 'domain:push.apple.com'],
    ...(inboundTag === undefined ? {} : { inboundTag }),
    outboundTag: 'direct',
  })

  const rules: XrayFieldRule[] = [...injected]
  let enabled = 0
  let disabled = 0
  for (const rule of routing.rules) {
    if (rule.enabled === false) {
      skipped.push({ id: rule.id, reason: 'enabled: false，规则保留但不参与编译' })
      disabled += 1
      continue
    }
    enabled += 1
    const compiled: XrayFieldRule = { type: 'field', outboundTag: rule.out }
    const match = rule.match
    if (match.domain !== undefined && match.domain.length > 0) compiled.domain = [...match.domain]
    if (match.ip !== undefined && match.ip.length > 0) compiled.ip = [...match.ip]
    if (match.port !== undefined && match.port.length > 0) compiled.port = match.port.join(',')
    if (match.sourcePort !== undefined && match.sourcePort.length > 0) compiled.sourcePort = match.sourcePort.join(',')
    if (match.network !== undefined && match.network.length > 0) compiled.network = match.network.join(',')
    if (match.protocol !== undefined && match.protocol.length > 0) compiled.protocol = [...match.protocol]
    if (match.source !== undefined && match.source.length > 0) compiled.source = [...match.source]
    if (match.inboundTag !== undefined && match.inboundTag.length > 0) compiled.inboundTag = [...match.inboundTag]
    rules.push(compiled)
  }

  // 默认出口规则必须带一个有效的匹配字段：xray 会以 "this rule has no effective
  // fields" 拒绝只有 outboundTag 的 field 规则。`network: tcp,udp` 匹配所有流量。
  rules.push({ type: 'field', network: 'tcp,udp', outboundTag: routing.default })

  return { rules, skipped, stats: { enabled, disabled, injected: injected.length } }
}

/** 生成内核配置的输入。 */
export interface XrayConfigInput {
  routing: Routing
  nodes: ProxyNode[]
  /** 选中的节点 id；`null` 表示还没选节点。 */
  selectedNode: string | null
  socksPort: number
  httpPort: number
  /** 路由的 domainStrategy；默认 `IPIfNonMatch`。 */
  domainStrategy?: 'AsIs' | 'IPIfNonMatch' | 'IPOnDemand'
  logLevel?: 'warning' | 'info' | 'debug'
}

/** 生成的内核配置；`warnings` 说明降级行为。 */
export interface XrayConfig {
  config: Record<string, unknown>
  /** 参与编译的入站 tag。 */
  inboundTags: string[]
  warnings: string[]
}

/** 入站：只监听回环，两个端口都开嗅探（`protocol` 条件依赖它）。 */
function buildInbounds(input: XrayConfigInput): { inbounds: Record<string, unknown>[]; tags: string[] } {
  const sniffing = { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: false }
  return {
    inbounds: [
      {
        tag: 'socks',
        listen: '127.0.0.1',
        port: input.socksPort,
        protocol: 'socks',
        settings: { udp: true, auth: 'noauth' },
        sniffing,
      },
      {
        tag: 'http',
        listen: '127.0.0.1',
        port: input.httpPort,
        protocol: 'http',
        settings: { allowTransparent: false },
        sniffing,
      },
    ],
    tags: ['socks', 'http'],
  }
}

/**
 * 生成整份 xray 配置。
 *
 * 没有选中节点时 `proxy` 出口缺席，此时 `routing.default === 'proxy'` 的规则集不能启动；
 * 由调用方（CoreManager）先拒绝启动并给出明确错误，规则校验与仿真不受影响。
 */
export function buildXrayConfig(input: XrayConfigInput): XrayConfig {
  const warnings: string[] = []
  const { inbounds, tags } = buildInbounds(input)
  const compiled = compileRouting(input.routing, { nodes: input.nodes, inboundTags: tags })

  const outbounds: Record<string, unknown>[] = []
  const selected = input.nodes.find((node) => node.id === input.selectedNode)
  for (const node of input.nodes) {
    outbounds.push(outboundForNode(node, node.tag))
  }
  if (selected !== undefined && selected.tag !== 'proxy') {
    outbounds.push(outboundForNode(selected, 'proxy'))
  }
  outbounds.push({ tag: 'direct', protocol: 'freedom', settings: {} })
  outbounds.push({ tag: 'block', protocol: 'blackhole', settings: {} })

  if (selected === undefined) {
    warnings.push('没有选中的节点：配置里没有 proxy 出口，内核无法启动')
  }

  const config: Record<string, unknown> = {
    log: { loglevel: input.logLevel ?? 'warning' },
    inbounds,
    outbounds,
    routing: {
      domainStrategy: input.domainStrategy ?? 'IPIfNonMatch',
      rules: compiled.rules,
    },
  }

  return { config, inboundTags: tags, warnings }
}
