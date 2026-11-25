/**
 * 仿真：一条流量会命中哪条规则，前面的规则为什么被跳过或无法判定。
 *
 * 求值必须诚实 —— 判断不了的绝不假装匹配，也不假装不匹配。于是每条规则有四种结论：
 * `match`、`no-match`、`opaque`（依赖 geosite:/geoip:/ext: 这类本地没有的数据）、
 * `missing`（缺输入，比如没给域名）。`opaque` 与 `missing` 的规则继续往后看，
 * 因为「确定命中哪条」+「哪些可能抢先」才是对用户有用的答案。
 *
 * 边界见 DESIGN.md §6.5：`domain` 比的是目的域名，`ip` 依赖 `domainStrategy`。
 */

import type { Routing, Rule } from './ir.ts'
import { ipInCidr, parsePortRange } from './util.ts'

/** 待仿真的流量。字段都可以缺，缺得越多结论越弱。 */
export interface Flow {
  domain?: string
  ip?: string
  port?: number
  network?: string
  protocol?: string
  source?: string
  inboundTag?: string
}

/** 单条规则的结论。 */
export type Verdict = 'match' | 'no-match' | 'opaque' | 'missing'

/** 一条「可能抢先命中」的规则。 */
export interface UncertainRule {
  id: string
  name?: string
  out: string
  /** 在规则列表里的位置，从 1 开始。 */
  position: number
  /** `opaque` 依赖本地没有的数据；`missing` 只是缺输入。 */
  kind: 'opaque' | 'missing'
  reason: string
}

/** 一条确定不命中的规则。 */
export interface SkippedRule {
  id: string
  name?: string
  out: string
  position: number
  reason: string
}

/** 仿真结果。 */
export interface ExplainResult {
  /** 第一条**确定**命中的规则；没有则为 null（此时走兜底出口）。 */
  matched: { id: string; name?: string; out: string; position: number } | null
  /** 命中规则之前那些无法排除的规则；它们可能抢先。 */
  uncertain: UncertainRule[]
  /** 命中规则之前被确定否定的规则。 */
  skipped: SkippedRule[]
  /** 兜底出口（没有任何规则命中时使用）。 */
  fallbackOut: string
  /** `matched` 是否已经确定：有 `uncertain` 时它不是必然结果。 */
  certain: boolean
  warnings: string[]
  /** 结论成立的前提，逐条列出。 */
  assumptions: string[]
}

interface ConditionResult {
  verdict: Verdict
  detail: string
}

const GEOSITE_PREFIX = 'geosite:'
const GEOIP_PREFIX = 'geoip:'
const EXT_PREFIX = 'ext:'

function domainVerdict(values: string[], domain: string): ConditionResult {
  const target = domain.toLowerCase()
  let opaque: string | undefined
  for (const value of values) {
    const lower = value.toLowerCase()
    if (lower.startsWith(GEOSITE_PREFIX) || lower.startsWith(EXT_PREFIX)) {
      opaque ??= value
      continue
    }
    if (lower.startsWith('regexp:')) {
      try {
        if (new RegExp(value.slice('regexp:'.length), 'i').test(domain)) {
          return { verdict: 'match', detail: `命中 ${value}` }
        }
      } catch {
        opaque ??= value
      }
      continue
    }
    if (lower.startsWith('full:')) {
      if (target === lower.slice('full:'.length)) return { verdict: 'match', detail: `精确等于 ${value}` }
      continue
    }
    if (lower.startsWith('domain:')) {
      const suffix = lower.slice('domain:'.length)
      if (target === suffix || target.endsWith(`.${suffix}`)) return { verdict: 'match', detail: `域后缀命中 ${value}` }
      continue
    }
    if (lower.startsWith('keyword:')) {
      if (target.includes(lower.slice('keyword:'.length))) return { verdict: 'match', detail: `包含 ${value}` }
      continue
    }
    if (target.includes(lower)) return { verdict: 'match', detail: `子串命中 ${value}` }
  }
  if (opaque !== undefined) {
    return { verdict: 'opaque', detail: `${domain} 是否属于 ${opaque} 需要 geo 数据文件，本地无法判定` }
  }
  return { verdict: 'no-match', detail: `${domain} 不在 [${values.join(', ')}] 里` }
}

function ipVerdict(values: string[], ip: string): ConditionResult {
  let opaque: string | undefined
  for (const value of values) {
    const lower = value.toLowerCase()
    if (lower.startsWith(GEOIP_PREFIX) || lower.startsWith(EXT_PREFIX)) {
      opaque ??= value
      continue
    }
    const inside = ipInCidr(ip, value)
    if (inside === true) return { verdict: 'match', detail: `落在 ${value} 内` }
    if (inside === undefined) opaque ??= value
  }
  if (opaque !== undefined) {
    return { verdict: 'opaque', detail: `${ip} 是否属于 ${opaque} 需要 geo 数据文件，本地无法判定` }
  }
  return { verdict: 'no-match', detail: `${ip} 不在 [${values.join(', ')}] 里` }
}

function portVerdict(values: string[], port: number): ConditionResult {
  for (const value of values) {
    const range = parsePortRange(value)
    if (range !== undefined && port >= range.from && port <= range.to) {
      return { verdict: 'match', detail: `端口 ${port} 落在 ${value}` }
    }
  }
  return { verdict: 'no-match', detail: `端口 ${port} 不在 [${values.join(', ')}] 里` }
}

function listVerdict(values: string[], actual: string, label: string): ConditionResult {
  return values.some((value) => value.toLowerCase() === actual.toLowerCase())
    ? { verdict: 'match', detail: `${label} 命中 ${actual}` }
    : { verdict: 'no-match', detail: `${label} ${actual} 不在 [${values.join(', ')}] 里` }
}

function evaluateCondition(key: string, values: string[], flow: Flow, domainStrategy: string): ConditionResult {
  switch (key) {
    case 'domain':
      return flow.domain === undefined
        ? { verdict: 'missing', detail: '没有提供目的域名' }
        : domainVerdict(values, flow.domain)
    case 'ip':
      if (flow.ip === undefined) {
        return {
          verdict: 'missing',
          detail:
            domainStrategy === 'AsIs'
              ? '没有提供 IP；domainStrategy=AsIs 下 ip 条件不参与目的域名的判定'
              : '没有提供 IP；domainStrategy=IPIfNonMatch 会先解析域名，ip 条件仍可能命中',
        }
      }
      return ipVerdict(values, flow.ip)
    case 'port':
      return flow.port === undefined ? { verdict: 'missing', detail: '没有提供端口' } : portVerdict(values, flow.port)
    case 'sourcePort':
      return { verdict: 'missing', detail: '仿真不接受来源端口' }
    case 'network':
      return flow.network === undefined
        ? { verdict: 'missing', detail: '没有提供 network（tcp/udp）' }
        : listVerdict(values, flow.network, 'network')
    case 'protocol':
      return flow.protocol === undefined
        ? { verdict: 'missing', detail: '没有提供协议；protocol 条件依赖嗅探结果' }
        : listVerdict(values, flow.protocol, 'protocol')
    case 'source':
      return flow.source === undefined
        ? { verdict: 'missing', detail: '没有提供来源地址' }
        : listVerdict(values, flow.source, 'source')
    case 'inboundTag':
      return flow.inboundTag === undefined
        ? { verdict: 'missing', detail: '没有提供入站 tag' }
        : listVerdict(values, flow.inboundTag, 'inboundTag')
    default:
      return { verdict: 'no-match', detail: `未知条件 ${key}` }
  }
}

function describe(rule: Rule): { id: string; name?: string } {
  return rule.name === undefined ? { id: rule.id } : { id: rule.id, name: rule.name }
}

/**
 * 按顺序仿真一条流量。
 * @param routing - 当前规则集。
 * @param flow - 待仿真的流量；缺字段会降低结论强度并写进 `assumptions`。
 * @param options - `domainStrategy` 影响 ip 条件的解释，默认 `IPIfNonMatch`。
 */
export function explainFlow(routing: Routing, flow: Flow, options: { domainStrategy?: string } = {}): ExplainResult {
  const domainStrategy = options.domainStrategy ?? 'IPIfNonMatch'
  const uncertain: UncertainRule[] = []
  const skipped: SkippedRule[] = []
  const warnings: string[] = []
  const assumptions: string[] = []
  let usesDomain = false
  let usesIp = false
  let usesGeo = false
  let usesProtocol = false

  for (let index = 0; index < routing.rules.length; index += 1) {
    const rule = routing.rules[index]!
    if (rule.enabled === false) continue
    const match = rule.match
    for (const [key, values] of Object.entries(match)) {
      if (key === 'domain') usesDomain = true
      if (key === 'ip') usesIp = true
      if (key === 'protocol') usesProtocol = true
      if (values.some((value: string) => value.startsWith(GEOSITE_PREFIX) || value.startsWith(GEOIP_PREFIX))) usesGeo = true
    }

    let verdict: Verdict = 'match'
    let kind: 'opaque' | 'missing' = 'opaque'
    let reason = ''
    for (const [key, values] of Object.entries(match)) {
      const evaluated = evaluateCondition(key, values, flow, domainStrategy)
      if (evaluated.verdict === 'no-match') {
        verdict = 'no-match'
        reason = `${key} 不匹配：${evaluated.detail}`
        break
      }
      if (evaluated.verdict === 'opaque') {
        verdict = 'opaque'
        reason = `${key} 无法判定：${evaluated.detail}`
        continue
      }
      if (evaluated.verdict === 'missing') {
        if (verdict !== 'opaque') verdict = 'missing'
        kind = 'missing'
        reason = `${key} 缺少输入：${evaluated.detail}`
      }
    }

    if (verdict === 'match') {
      if (uncertain.length > 0) {
        warnings.push(`前面有 ${uncertain.length} 条规则无法本地判定，它们可能抢先命中；结论不是必然结果`)
      }
      return {
        matched: { ...describe(rule), out: rule.out, position: index + 1 },
        uncertain,
        skipped,
        fallbackOut: routing.default,
        certain: uncertain.length === 0,
        warnings,
        assumptions,
      }
    }
    if (verdict === 'opaque' || verdict === 'missing') {
      uncertain.push({ ...describe(rule), out: rule.out, position: index + 1, kind, reason })
      continue
    }
    skipped.push({ ...describe(rule), out: rule.out, position: index + 1, reason })
  }

  if (usesGeo) assumptions.push('含 geosite:/geoip: 的规则无法本地判定：没有解析 .dat 数据文件')
  if (usesDomain) assumptions.push('domain 条件比的是目的域名：SOCKS 传入的域名，或嗅探出的 SNI')
  if (usesIp) {
    assumptions.push(
      domainStrategy === 'AsIs'
        ? 'domainStrategy=AsIs：ip 条件只对 IP 目标生效'
        : 'domainStrategy=IPIfNonMatch：域名目标会先解析再重试，ip 条件可能命中',
    )
  }
  if (usesProtocol) assumptions.push('protocol 条件依赖嗅探，且嗅探会改写目标地址')
  if (usesDomain && flow.domain === undefined) warnings.push('未提供域名：domain 条件无法判定')
  if (usesIp && flow.ip === undefined) warnings.push('未提供 IP：带 ip 条件的规则无法排除')

  if (uncertain.length > 0) {
    warnings.push(`有 ${uncertain.length} 条规则无法本地判定，它们可能抢先命中；结论不是必然结果`)
  }

  return { matched: null, uncertain, skipped, fallbackOut: routing.default, certain: false, warnings, assumptions }
}
