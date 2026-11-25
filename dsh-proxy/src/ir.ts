/**
 * 规则模型：形状校验、语义检查、按 id 增量打补丁。
 *
 * 规则是纯数据，所以每条诊断都指向一个 JSON 路径（`routing.rules[2].match.network`），
 * 不指向文本行列 —— 这正是放弃 RoutingA 换来的东西。
 */

import { deepClone, isIpOrCidr, isPlainObject, parsePortRange } from './util.ts'

/** 内置出口；其余出口名必须来自节点库存。 */
export const EXIT_BUILTIN = ['proxy', 'direct', 'block'] as const

/** `match` 允许的字段；与 xray 的 `routing.rules[].` 同名。 */
export const MATCH_KEYS = ['domain', 'ip', 'port', 'sourcePort', 'network', 'protocol', 'source', 'inboundTag'] as const

/** `network` 的取值。 */
export const NETWORK_VALUES = ['tcp', 'udp'] as const

/** `protocol` 的取值（依赖嗅探）。 */
export const PROTOCOL_VALUES = ['http', 'tls', 'quic', 'bittorrent'] as const

/** 规模上限：一次写入不能把内核拖死。 */
export const LIMITS = {
  rules: 200,
  valuesPerCondition: 100,
  idLength: 32,
  nameLength: 80,
  valueLength: 200,
} as const

/** 规则 id 的字符集；同时用于 JSON Schema 的 pattern。 */
export const ID_PATTERN = '^[a-z0-9][a-z0-9_-]{0,31}$'
const ID_RE = new RegExp(ID_PATTERN)

/** 一条匹配条件。数组内任意一个值命中即算命中；多个字段之间是「且」。 */
export interface Match {
  domain?: string[]
  ip?: string[]
  port?: string[]
  sourcePort?: string[]
  network?: string[]
  protocol?: string[]
  source?: string[]
  inboundTag?: string[]
}

/** 一条规则。 */
export interface Rule {
  id: string
  name?: string
  /** 省略等于启用；禁用的规则留在库里但不参与编译与仿真。 */
  enabled?: boolean
  match: Match
  out: string
}

/** 整份规则。 */
export interface Routing {
  /** 默认出口。 */
  default: string
  /** 顺序即匹配顺序，首条命中即停。 */
  rules: Rule[]
}

/** 诊断级别：error 阻止应用，warning 只提示。 */
export type Severity = 'error' | 'warning'

/** 一条诊断。 */
export interface Diagnostic {
  severity: Severity
  code: string
  /** 出问题的 JSON 路径。 */
  path: string
  message: string
  /** 命中的规则 id，便于按条修复。 */
  ruleId?: string
}

/** 按 id 的增量补丁。 */
export interface RoutingPatch {
  upsert?: Rule[]
  delete?: string[]
  default?: string
}

/** 数据目录里 geo 数据文件的事实；`undefined` 表示无法判断。 */
export interface GeoFacts {
  /** geo 目录的展示路径，只用于文案。 */
  dir?: string
  geositeFile?: string
  geoipFile?: string
  hasGeosite?: boolean
  hasGeoip?: boolean
  /** `ext:文件:标签` 的落点判定。 */
  extFile?: (file: string, tag: string) => 'ok' | 'missing' | 'outside'
}

/** 空规则集：所有流量走选中节点。 */
export function defaultRouting(): Routing {
  return { default: 'proxy', rules: [] }
}

function diagnostic(severity: Severity, code: string, path: string, message: string, ruleId?: string): Diagnostic {
  const entry: Diagnostic = { severity, code, path, message }
  if (ruleId !== undefined) entry.ruleId = ruleId
  return entry
}

function joinPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`
}

/** 形状合法时把 unknown 收窄成 Routing。 */
export function asRouting(value: unknown): Routing | undefined {
  if (!isPlainObject(value)) return undefined
  if (typeof value.default !== 'string' || !Array.isArray(value.rules)) return undefined
  return value as unknown as Routing
}

function ruleIdOf(value: unknown): string | undefined {
  return isPlainObject(value) && typeof value.id === 'string' ? value.id : undefined
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * 校验形状：字段类型、枚举、规模上限、id 唯一性。
 * 纯函数，一次报全，不提前返回。
 */
export function validateRoutingShape(candidate: unknown): Diagnostic[] {
  const out: Diagnostic[] = []
  const push = (severity: Severity, code: string, path: string, message: string, ruleId?: string) => {
    out.push(diagnostic(severity, code, path, message, ruleId))
  }

  if (!isPlainObject(candidate)) {
    push('error', 'routing/not-an-object', 'routing', 'routing 必须是对象：{ "default": 出口名, "rules": [...] }')
    return out
  }

  for (const key of Object.keys(candidate)) {
    if (key !== 'default' && key !== 'rules') {
      push('error', 'routing/unknown-field', `routing.${key}`, `未知字段 ${key}；routing 只接受 default 和 rules`)
    }
  }

  const fallback = candidate.default
  if (typeof fallback !== 'string' || fallback.trim() === '') {
    push('error', 'routing/default-invalid', 'routing.default', 'default 必须是非空字符串，写默认出口的名字')
  } else if (fallback !== fallback.trim()) {
    push('error', 'routing/default-invalid', 'routing.default', 'default 两侧不能有空白')
  }

  const rules = candidate.rules
  if (!Array.isArray(rules)) {
    push('error', 'routing/rules-invalid', 'routing.rules', 'rules 必须是数组（可以为空）')
    return out
  }
  if (rules.length > LIMITS.rules) {
    push('error', 'routing/too-many-rules', 'routing.rules', `规则最多 ${LIMITS.rules} 条，当前 ${rules.length} 条`)
  }

  const seen = new Map<string, number>()
  rules.forEach((rule: unknown, index: number) => {
    const at = `routing.rules[${index}]`
    const ruleId = ruleIdOf(rule)
    if (!isPlainObject(rule)) {
      push('error', 'rule/not-an-object', at, '每条规则必须是对象')
      return
    }
    for (const key of Object.keys(rule)) {
      if (!['id', 'name', 'enabled', 'match', 'out'].includes(key)) {
        push('error', 'rule/unknown-field', joinPath(at, key), `未知字段 ${key}；规则只接受 id、name、enabled、match、out`, ruleId)
      }
    }

    if (typeof rule.id !== 'string' || rule.id === '') {
      push('error', 'rule/id-missing', joinPath(at, 'id'), '每条规则必须有 id，用于增量编辑和诊断引用（小写字母、数字、下划线、连字符，≤32 字符）')
    } else if (!ID_RE.test(rule.id)) {
      push('error', 'rule/id-invalid', joinPath(at, 'id'), `id "${rule.id}" 不合法：只允许 [a-z0-9_-]，以字母或数字开头，最长 ${LIMITS.idLength} 字符`, ruleId)
    } else if (seen.has(rule.id)) {
      push('error', 'rule/id-duplicate', joinPath(at, 'id'), `id "${rule.id}" 与第 ${seen.get(rule.id)! + 1} 条重复；id 必须唯一`, ruleId)
    } else {
      seen.set(rule.id, index)
    }

    if (rule.name !== undefined) {
      if (typeof rule.name !== 'string' || rule.name.trim() === '') {
        push('error', 'rule/name-invalid', joinPath(at, 'name'), 'name 必须是非空字符串，或者省略', ruleId)
      } else if (rule.name.length > LIMITS.nameLength) {
        push('error', 'rule/name-invalid', joinPath(at, 'name'), `name 最长 ${LIMITS.nameLength} 字符`, ruleId)
      }
    }

    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
      push('error', 'rule/enabled-invalid', joinPath(at, 'enabled'), 'enabled 必须是布尔值；省略等于启用', ruleId)
    }

    if (typeof rule.out !== 'string' || rule.out.trim() === '') {
      push('error', 'rule/out-missing', joinPath(at, 'out'), 'out 必须是非空字符串，写出口名（proxy / direct / block 或某个节点 tag）', ruleId)
    } else if (rule.out !== rule.out.trim()) {
      push('error', 'rule/out-invalid', joinPath(at, 'out'), 'out 两侧不能有空白', ruleId)
    }

    validateMatch(rule.match, joinPath(at, 'match'), ruleId, push)
  })

  return out
}

type PushDiagnostic = (severity: Severity, code: string, path: string, message: string, ruleId?: string) => void

function validateMatch(match: unknown, at: string, ruleId: string | undefined, push: PushDiagnostic): void {
  if (!isPlainObject(match)) {
    push('error', 'rule/match-missing', at, 'match 必须是对象，至少写一个条件（domain、ip、port 等）', ruleId)
    return
  }
  const keys = Object.keys(match)
  if (keys.length === 0) {
    push('error', 'rule/match-empty', at, 'match 至少需要一个条件；没有条件的规则会匹配所有流量，默认出口请用 default 表达', ruleId)
  }
  for (const key of keys) {
    if (!(MATCH_KEYS as readonly string[]).includes(key)) {
      push('error', 'rule/match-unknown-field', `${at}.${key}`, `未知匹配字段 ${key}；可用字段：${MATCH_KEYS.join('、')}`, ruleId)
    }
  }

  for (const key of MATCH_KEYS) {
    const values = match[key]
    if (values === undefined) continue
    const fieldPath = `${at}.${key}`
    if (!Array.isArray(values) || values.length === 0) {
      push('error', 'rule/condition-empty', fieldPath, `${key} 必须是非空数组；数组里任意一个值命中即算命中`, ruleId)
      continue
    }
    if (values.length > LIMITS.valuesPerCondition) {
      push('error', 'rule/condition-too-long', fieldPath, `${key} 最多 ${LIMITS.valuesPerCondition} 个值，当前 ${values.length} 个`, ruleId)
    }
    values.forEach((entry: unknown, index: number) => {
      const entryPath = `${fieldPath}[${index}]`
      if (typeof entry !== 'string' || entry.trim() === '') {
        push('error', 'rule/condition-value-invalid', entryPath, `${key} 的每个值必须是非空字符串`, ruleId)
        return
      }
      if (entry !== entry.trim()) {
        push('error', 'rule/condition-value-invalid', entryPath, '值两侧不能有空白', ruleId)
        return
      }
      if (entry.length > LIMITS.valueLength) {
        push('error', 'rule/condition-value-invalid', entryPath, `单个值最长 ${LIMITS.valueLength} 字符`, ruleId)
        return
      }
      validateConditionValue(key, entry, entryPath, ruleId, push)
    })
  }
}

function validateConditionValue(key: string, value: string, at: string, ruleId: string | undefined, push: PushDiagnostic): void {
  switch (key) {
    case 'domain':
      if (/[,\s]/.test(value)) {
        push('error', 'rule/domain-invalid', at, `域名条件里不能有逗号或空白（"${value}"）；数组里一项就是一个值`, ruleId)
        return
      }
      if (value.startsWith('regexp:')) {
        try {
          new RegExp(value.slice('regexp:'.length))
        } catch {
          push('warning', 'rule/domain-regexp-unverified', at, `无法在本地校验正则 "${value}"；内核用 Go 的正则语法，与 JS 并不完全一致`, ruleId)
        }
      }
      if (value.startsWith('ext:') && value.slice(4).split(':').length < 2) {
        push('error', 'rule/domain-ext-invalid', at, `ext: 需要写成 ext:文件名:标签（"${value}"）`, ruleId)
      }
      return
    case 'ip':
      if (value.startsWith('geoip:') || value.startsWith('ext:')) {
        if (value.startsWith('ext:') && value.slice(4).split(':').length < 2) {
          push('error', 'rule/ip-ext-invalid', at, `ext: 需要写成 ext:文件名:标签（"${value}"）`, ruleId)
        }
        return
      }
      if (!isIpOrCidr(value)) {
        push('error', 'rule/ip-invalid', at, `"${value}" 不是 IP、CIDR，也不是 geoip:/ext: 值`, ruleId)
      }
      return
    case 'port':
    case 'sourcePort':
      if (parsePortRange(value) === undefined) {
        push('error', 'rule/port-invalid', at, `"${value}" 不是端口或端口区间；写 443 或 1000-2000，范围 1-65535`, ruleId)
      }
      return
    case 'network':
      if (!(NETWORK_VALUES as readonly string[]).includes(value)) {
        push('error', 'rule/network-invalid', at, `network 只接受 ${NETWORK_VALUES.join(' 或 ')}（小写），收到 "${value}"`, ruleId)
      }
      return
    case 'protocol':
      if (!(PROTOCOL_VALUES as readonly string[]).includes(value)) {
        push('error', 'rule/protocol-invalid', at, `protocol 只接受 ${PROTOCOL_VALUES.join('、')}（小写），收到 "${value}"`, ruleId)
      }
      return
    default:
      return
  }
}

/**
 * 形状合法之后，再对照现实：出口是否真存在、geo 数据文件在不在、有没有被前序规则完全遮住。
 * @param routing - 已通过形状校验的规则集。
 * @param options - `exits` 可用出口名；`geo` 数据文件事实；`sniffing` 是否开启嗅探。
 */
export function checkSemantics(
  routing: unknown,
  { exits = [...EXIT_BUILTIN], geo = {}, sniffing = true }: { exits?: string[]; geo?: GeoFacts; sniffing?: boolean } = {},
): Diagnostic[] {
  const out: Diagnostic[] = []
  const push = (severity: Severity, code: string, path: string, message: string, ruleId?: string) => {
    out.push(diagnostic(severity, code, path, message, ruleId))
  }
  const known = new Set(exits)
  const routingObject = isPlainObject(routing) ? routing : {}
  const rules = Array.isArray(routingObject.rules) ? routingObject.rules : []

  const fallback = routingObject.default
  if (typeof fallback === 'string' && fallback !== '' && !known.has(fallback)) {
    push('error', 'routing/exit-unknown', 'routing.default', `default 指向的出口 "${fallback}" 不存在；可用出口：${[...known].join('、')}`)
  }

  rules.forEach((rule: unknown, index: number) => {
    if (!isPlainObject(rule)) return
    const ruleId = typeof rule.id === 'string' ? rule.id : undefined
    if (typeof rule.out === 'string' && rule.out !== '' && !known.has(rule.out)) {
      push('error', 'rule/exit-unknown', `routing.rules[${index}].out`, `出口 "${rule.out}" 不存在；可用出口：${[...known].join('、')}`, ruleId)
    }
    const match = isPlainObject(rule.match) ? rule.match : {}
    const protocol = stringValues(match.protocol)
    if (protocol.length > 0 && sniffing === false) {
      push('warning', 'rule/protocol-needs-sniffing', `routing.rules[${index}].match.protocol`, 'protocol 条件依赖嗅探；当前配置没开 sniffing，这条规则不会命中', ruleId)
    }

    checkGeoUse('domain', 'geosite', match, index, geo, ruleId, push)
    checkGeoUse('ip', 'geoip', match, index, geo, ruleId, push)

    for (const key of ['domain', 'ip'] as const) {
      stringValues(match[key]).forEach((value, valueIndex) => {
        if (!value.startsWith('ext:')) return
        const file = value.slice(4).split(':')[0] ?? ''
        const tag = value.slice(4).split(':').slice(1).join(':')
        const at = `routing.rules[${index}].match.${key}[${valueIndex}]`
        const verdict = geo.extFile?.(file, tag)
        if (verdict === 'outside') {
          push('error', 'rule/ext-path-escape', at, `ext: 文件 "${file}" 指向数据目录之外；只允许 geo 目录里的 .dat 文件`, ruleId)
        } else if (verdict === 'missing') {
          push('warning', 'rule/ext-file-missing', at, `geo 目录里没有 "${file}"；这条规则会让内核启动失败`, ruleId)
        }
      })
    }
  })

  const enabled = rules.filter((rule: unknown): rule is Rule => isPlainObject(rule) && rule.enabled !== false) as Rule[]
  enabled.forEach((rule, laterIndex) => {
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const earlier = enabled[earlierIndex]!
      if (earlier.out === rule.out) continue
      if (!matchCovers(earlier.match, rule.match)) continue
      const earlierPosition = rules.indexOf(earlier) + 1
      const laterPosition = rules.indexOf(rule) + 1
      push(
        'warning',
        'rule/unreachable',
        `routing.rules[${laterPosition - 1}]`,
        `前面第 ${earlierPosition} 条规则 #${earlier.id} 的匹配条件已经完全覆盖本条，本条不会命中`,
        rule.id,
      )
      break
    }
  })

  return out
}

function checkGeoUse(
  key: 'domain' | 'ip',
  prefix: 'geosite' | 'geoip',
  match: Record<string, unknown>,
  index: number,
  geo: GeoFacts,
  ruleId: string | undefined,
  push: PushDiagnostic,
): void {
  const usesGeo = stringValues(match[key]).some((value) => value.startsWith(`${prefix}:`))
  if (!usesGeo) return
  const present = prefix === 'geosite' ? geo.hasGeosite : geo.hasGeoip
  const file = (prefix === 'geosite' ? geo.geositeFile : geo.geoipFile) ?? (prefix === 'geosite' ? 'geosite.dat' : 'geoip.dat')
  const at = `routing.rules[${index}].match.${key}`
  if (present === false) {
    // 只是 warning，不是 error：这里只能看到本插件的 geo 目录，看不到内核自己的
    // asset 目录（例如 brew 安装的 share/xray），也没有解析 .dat 的内容。真正
    // 的裁决是 `xray -test`；它失败时写入流程会回滚规则与内核，不会留下坏配置。
    push(
      'warning',
      'rule/geo-data-missing',
      at,
      `${prefix}: 需要 ${file}，但没在 ${geo.dir ?? 'geo 目录'} 找到。内核会拒绝启动，除非它自己的数据目录里有这个文件；把文件放进去，或改用 domain: / ip:`,
      ruleId,
    )
  } else if (present === undefined) {
    push('warning', 'rule/geo-data-unverified', at, `无法确认 ${file} 里的标签是否存在（未解析数据文件）；标签写错会让内核拒绝启动`, ruleId)
  }
}

/**
 * `outer` 是否覆盖 `inner`：`inner` 接受的每条流量 `outer` 也接受。
 * 只比较字面值集合 —— `geosite:cn` 永远不会被判为覆盖 `domain:baidu.com`，即使现实中确实覆盖。
 */
export function matchCovers(outer: unknown, inner: unknown): boolean {
  if (!isPlainObject(outer) || !isPlainObject(inner)) return false
  const outerKeys = Object.keys(outer)
  if (outerKeys.length === 0) return false
  return outerKeys.every((key) => {
    const innerValues = inner[key]
    if (!Array.isArray(innerValues)) return false
    const outerValues = new Set(stringValues(outer[key]).map((value) => value.toLowerCase()))
    return innerValues.every((value: unknown) => outerValues.has(String(value).toLowerCase()))
  })
}

/**
 * 按 id 打补丁：先删，再就地替换已存在的 id，新 id 追加到末尾。顺序即语义，必须保住。
 * @param current - 当前规则集。
 * @param patch - `{ upsert?, delete?, default? }`。
 */
export function applyRoutingPatch(
  current: unknown,
  patch: RoutingPatch = {},
): { routing: Routing; changes: { added: string[]; replaced: string[]; removed: string[]; defaultChanged: boolean; total: number } } {
  const base: Routing = isPlainObject(current) ? (deepClone(current) as unknown as Routing) : defaultRouting()
  if (!Array.isArray(base.rules)) base.rules = []
  const removed: string[] = []
  const deleteIds = new Set(Array.isArray(patch.delete) ? patch.delete : [])

  if (deleteIds.size > 0) {
    base.rules = base.rules.filter((rule) => {
      if (deleteIds.has(rule.id)) {
        removed.push(rule.id)
        return false
      }
      return true
    })
  }

  const added: string[] = []
  const replaced: string[] = []
  for (const next of Array.isArray(patch.upsert) ? patch.upsert : []) {
    const index = base.rules.findIndex((rule) => rule.id === next.id)
    if (index === -1) {
      base.rules.push(deepClone(next))
      added.push(next.id)
    } else {
      base.rules[index] = deepClone(next)
      replaced.push(next.id)
    }
  }

  const defaultChanged = typeof patch.default === 'string'
  if (typeof patch.default === 'string') base.default = patch.default

  return {
    routing: base,
    changes: { added, replaced, removed, defaultChanged, total: base.rules.length },
  }
}

/** 把一条规则移到另一个位置；下标越界时原样返回。 */
export function moveRule(routing: Routing, from: number, to: number): Routing {
  const next = deepClone(routing)
  if (!Array.isArray(next.rules)) return next
  if (from < 0 || from >= next.rules.length || to < 0 || to >= next.rules.length) return next
  const [moved] = next.rules.splice(from, 1)
  if (moved !== undefined) next.rules.splice(to, 0, moved)
  return next
}

/** 条件的一行摘要，工具输出与 UI 共用。 */
export function describeMatch(match: unknown): string {
  if (!isPlainObject(match)) return ''
  const parts: string[] = []
  for (const [key, values] of Object.entries(match)) {
    const list = stringValues(values)
    if (list.length === 0) continue
    const shown = list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} +${list.length - 3}`
    parts.push(`${key}: ${shown}`)
  }
  return parts.join(' · ')
}
