/**
 * 应用逻辑：工具、HTTP 路由、面板三处共用同一套实现，避免「UI 说得通、工具说另一套」。
 *
 * 写规则的处理顺序固定（DESIGN.md §7.2）：形状校验 → 语义检查 → 生成配置 → 落盘 →
 * 重启内核 → 失败回滚。内核不可用时不阻塞保存，只把「未应用」说清楚。
 */

import type { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { AccessLog, type TrafficQuery, type TrafficView } from './access.ts'
import { buildXrayConfig, compileRouting } from './compile.ts'
import { ensureDataDir, type ResolvedConfig } from './config.ts'
import { CoreManager, type CoreStatus } from './core.ts'
import { explainFlow, type ExplainResult, type Flow } from './explain.ts'
import {
  applyRoutingPatch,
  asRouting,
  checkSemantics,
  EXIT_BUILTIN,
  validateRoutingShape,
  type Diagnostic,
  type GeoFacts,
  type Routing,
  type Rule,
} from './ir.ts'
import type { RingLog } from './log.ts'
import {
  assignIdentities,
  measureLatency,
  nodeLabel,
  parseSubscription,
  redactNode,
  type LatencyResult,
  type ProxyNode,
} from './nodes.ts'
import type { ProxyStore, SubscriptionRecord } from './store.ts'
import { clip, isPlainObject } from './util.ts'

/** 一次规则写入请求；工具参数与 `/proxy-api/routing` 的请求体同构。 */
export interface RoutingWriteRequest {
  mode: 'replace' | 'patch'
  routing?: unknown
  upsert?: unknown[]
  delete?: string[]
  default?: string
  /** 默认 true；false 只保存不重启内核。 */
  apply?: boolean
  /** 一句话说明这次改动的意图，写进日志。 */
  reason?: string
}

/** 一次规则写入的结果。 */
export interface RoutingWriteResult {
  saved: boolean
  /** 是否真的改动并重启了内核。 */
  applied: boolean
  changes: { added: string[]; replaced: string[]; removed: string[]; defaultChanged: boolean; total: number } | null
  diagnostics: Diagnostic[]
  /** 内核侧结果；`null` 表示这次没有尝试应用。 */
  core: { applied: boolean; tested: boolean; error?: string; rolledBack?: boolean } | null
  message: string
  /** 保存后的规则集，失败时为当前规则集。 */
  routing: Routing
}

/** 一次订阅导入的结果。 */
export interface SubscriptionResult {
  added: number
  updated: number
  skipped: number
  errors: { line: number; reason: string }[]
  subscription: SubscriptionRecord | null
  /** 前几个节点（已脱敏），给模型一个「导进来了什么」的样本。 */
  sample: ReturnType<typeof redactNode>[]
  message: string
}

/** 状态视图。 */
export interface StatusView {
  core: CoreStatus
  ruleCount: number
  enabledRuleCount: number
  nodeCount: number
  selectedNode: { id: string; tag: string; name: string; label: string } | null
  exits: string[]
  /** 出口名 → 展示名；节点出口显示节点名字。 */
  exitLabels: Record<string, string>
  geo: { dir: string; hasGeosite: boolean; hasGeoip: boolean }
  ports: { socks: number; http: number }
}

/** 只读视图。 */
export interface RoutingView {
  default: string
  rules: Rule[]
  exits: string[]
  /** 出口名 → 展示名；节点出口显示节点名字。 */
  exitLabels: Record<string, string>
  compiled: { ruleCount: number; skipped: { id: string; reason: string }[] }
  diagnostics: Diagnostic[]
}

/** 校验结果。 */
export interface CheckResult {
  valid: boolean
  diagnostics: Diagnostic[]
  exits: string[]
  /** 出口名 → 展示名；节点出口显示节点名字。 */
  exitLabels: Record<string, string>
  compiled: { rules: unknown[]; skipped: { id: string; reason: string }[] } | null
}

/** 内核动作。 */
export type CoreAction = 'start' | 'stop' | 'restart'

export class ProxyService {
  readonly config: ResolvedConfig
  readonly store: ProxyStore
  readonly core: CoreManager
  /** 内核访问日志：连接记录的来源。 */
  readonly access: AccessLog
  private readonly ctx: Context
  private readonly log: RingLog

  constructor(ctx: Context, config: ResolvedConfig, store: ProxyStore, log: RingLog) {
    this.ctx = ctx
    this.config = config
    this.store = store
    this.log = log
    ensureDataDir(config)
    this.access = new AccessLog(log, {
      path: config.accessLogPath,
      enabled: config.accessLog,
    })
    this.core = new CoreManager(ctx, config, log, this.access)
  }

  /** 当前可用出口：内置三个 + 节点 tag。 */
  exits(): string[] {
    return [...EXIT_BUILTIN, ...this.store.nodes().map((node) => node.tag)]
  }

  /**
   * 出口名 → 展示名。节点出口显示节点的名字，内置出口显示自己。
   *
   * 只用于展示：规则里的 `out` 与内核配置里的 outbound tag 始终是出口名本身。
   */
  exitLabels(): Record<string, string> {
    const labels: Record<string, string> = {}
    for (const node of this.store.nodes()) labels[node.tag] = nodeLabel(node)
    // 内置出口最后写入：节点名字再像 proxy，也不该盖掉它作为默认出口的含义。
    for (const exit of EXIT_BUILTIN) labels[exit] = exit
    return labels
  }

  /** geo 数据文件事实；用于语义检查的 `ext:` 与 `geosite:` 判定。 */
  geoFacts(): GeoFacts {
    const dir = this.config.geoDir
    return {
      dir,
      geositeFile: 'geosite.dat',
      geoipFile: 'geoip.dat',
      hasGeosite: existsSync(join(dir, 'geosite.dat')),
      hasGeoip: existsSync(join(dir, 'geoip.dat')),
      extFile: (file: string, _tag: string) => {
        const target = resolve(dir, file)
        if (target !== resolve(dir) && !target.startsWith(`${resolve(dir)}${sep}`)) return 'outside'
        return existsSync(target) ? 'ok' : 'missing'
      },
    }
  }

  /** 状态视图。 */
  status(): StatusView {
    const snapshot = this.store.snapshot()
    const selected = snapshot.nodes.find((node) => node.id === snapshot.selectedNode)
    const enabledRuleCount = snapshot.routing.rules.filter((rule) => rule.enabled !== false).length
    const geo = this.geoFacts()
    return {
      core: this.core.status(),
      ruleCount: snapshot.routing.rules.length,
      enabledRuleCount,
      nodeCount: snapshot.nodes.length,
      selectedNode:
        selected === undefined
          ? null
          : { id: selected.id, tag: selected.tag, name: selected.name, label: nodeLabel(selected) },
      exits: this.exits(),
      exitLabels: this.exitLabels(),
      geo: { dir: this.config.geoDir, hasGeosite: geo.hasGeosite === true, hasGeoip: geo.hasGeoip === true },
      ports: { socks: this.config.socksPort, http: this.config.httpPort },
    }
  }

  /** 读当前规则集 + 编译摘要。 */
  read(): RoutingView {
    const routing = this.store.routing()
    const compiled = compileRouting(routing, { nodes: this.store.nodes() })
    const exits = this.exits()
    return {
      default: routing.default,
      rules: routing.rules,
      exits,
      exitLabels: this.exitLabels(),
      compiled: { ruleCount: compiled.rules.length, skipped: compiled.skipped },
      diagnostics: checkSemantics(
        routing,
        { exits, labels: this.exitLabels(), geo: this.geoFacts(), sniffing: true },
      ),
    }
  }

  /**
   * 校验一份候选规则集，不落盘、不重启。
   *
   * 形状与语义一次报全：即使形状有 error 也继续跑语义检查，调用方（模型或面板）
   * 不用「先修形状、再发现出口写错」来回两轮。语义检查对任意 JSON 都安全，不会
   * 因为形状问题抛错；只是形状没通过时不尝试编译。
   */
  check(candidate: unknown): CheckResult {
    const shape = validateRoutingShape(candidate)
    const shapeOk = shape.every((entry) => entry.severity !== 'error')
    const exits = this.exits()
    const labels = this.exitLabels()
    const diagnostics = [...shape, ...checkSemantics(candidate, { exits, labels, geo: this.geoFacts(), sniffing: true })]
    const routing = asRouting(candidate)
    // 编译要求结构完整（规则一定有 match），所以形状没过就不编译。
    if (routing === undefined || !shapeOk) return { valid: false, diagnostics, exits, exitLabels: labels, compiled: null }
    const compiled = compileRouting(routing, { nodes: this.store.nodes() })
    return { valid: diagnostics.every((entry) => entry.severity !== 'error'), diagnostics, exits, exitLabels: labels, compiled }
  }

  /**
   * 最近连接：查询内核访问日志，回答「某个域名/IP 实际走了哪个出口」。
   * 内核停止后仍返回本次会话已有的记录，只把 `live` 置 false 并说明原因。
   * @param query - 过滤条件；字段之间是「且」。
   */
  traffic(query: TrafficQuery = {}): TrafficView {
    const stats = this.access.stats()
    const running = this.core.status().running
    const live = this.config.accessLog && running && stats.following
    let reason: string | undefined
    if (!live) {
      if (!this.config.accessLog) reason = '访问日志已关闭（accessLog: false）'
      else if (!running) reason = '内核未运行：以下是本次会话已有的记录'
      else if (stats.lastError !== null) reason = `访问日志读取失败：${stats.lastError}`
      else reason = '访问日志未在跟随'
    }
    return this.access.query(query, {
      labels: this.exitLabels(),
      exits: this.exits(),
      live,
      ...(reason === undefined ? {} : { reason }),
      file: this.config.accessLogPath,
    })
  }

  /** 仿真一条流量。 */
  explain(flow: Flow): ExplainResult {
    const built = this.buildConfig()
    const routing = built.config['routing'] as { domainStrategy?: string } | undefined
    return explainFlow(this.store.routing(), flow, {
      domainStrategy: routing?.domainStrategy ?? 'IPIfNonMatch',
      labels: this.exitLabels(),
    })
  }

  /**
   * 按请求算出候选规则集，不落盘。write 与 check 共用，保证「先校验再写」两次调用
   * 得到的是同一个结果。
   * @param request - 与工具参数同构的请求。
   */
  candidateFor(request: RoutingWriteRequest): {
    routing: unknown
    changes: RoutingWriteResult['changes']
    error?: Diagnostic
  } {
    if (request.mode === 'replace') {
      if (request.routing === undefined) {
        return {
          routing: this.store.routing(),
          changes: null,
          error: {
            severity: 'error',
            code: 'request/routing-missing',
            path: 'routing',
            message: 'mode=replace 时必须提供 routing（完整的 { default, rules }）',
          },
        }
      }
      return { routing: request.routing, changes: null }
    }
    const patched = applyRoutingPatch(this.store.routing(), {
      upsert: Array.isArray(request.upsert) ? (request.upsert as Rule[]) : undefined,
      delete: Array.isArray(request.delete) ? request.delete : undefined,
      ...(request.default === undefined ? {} : { default: request.default }),
    })
    return { routing: patched.routing, changes: patched.changes }
  }

  /**
   * 按请求算出候选规则集 → 校验 → （可选）应用。
   * @param request - 与工具参数同构的请求。
   */
  async write(request: RoutingWriteRequest): Promise<RoutingWriteResult> {
    const current = this.store.routing()
    const built = this.candidateFor(request)
    if (built.error !== undefined) {
      return {
        saved: false,
        applied: false,
        changes: null,
        diagnostics: [built.error],
        core: null,
        message: '没有提供 routing',
        routing: current,
      }
    }
    const candidate = asRouting(built.routing) ?? (built.routing as Routing)
    let changes: RoutingWriteResult['changes'] = built.changes

    const check = this.check(candidate)
    if (!check.valid) {
      return {
        saved: false,
        applied: false,
        changes,
        diagnostics: check.diagnostics,
        core: null,
        message: '规则没有保存：有 error 级诊断',
        routing: current,
      }
    }

    if (changes === null) {
      changes = {
        added: [],
        replaced: [],
        removed: [],
        defaultChanged: current.default !== candidate.default,
        total: candidate.rules.length,
      }
    }

    await this.store.setRouting(candidate)
    this.log.push('action', `规则已保存：${describeChanges(changes)}${request.reason === undefined ? '' : `（${request.reason}）`}`)

    if (request.apply === false) {
      return {
        saved: true,
        applied: false,
        changes,
        diagnostics: check.diagnostics,
        core: null,
        message: '规则已保存；apply=false，没有重启内核',
        routing: candidate,
      }
    }

    const selected = this.store.selectedNode()
    if (selected === null) {
      return {
        saved: true,
        applied: false,
        changes,
        diagnostics: check.diagnostics,
        core: null,
        message: '规则已保存；还没有选中的节点，所以没有重启内核（先导入订阅并选一个节点）',
        routing: candidate,
      }
    }

    const binary = await this.core.resolveBinary()
    if (binary.path === null) {
      return {
        saved: true,
        applied: false,
        changes,
        diagnostics: check.diagnostics,
        core: null,
        message: `规则已保存；${binary.error ?? '没有可用的 xray 可执行文件'}，所以没有应用到内核`,
        routing: candidate,
      }
    }

    const config = this.buildConfig(candidate)
    const outcome = await this.core.apply(config.config, config.proxyLabel)
    if (outcome.applied) {
      this.log.push('action', '新规则已应用到内核')
      return {
        saved: true,
        applied: true,
        changes,
        diagnostics: check.diagnostics,
        core: outcome,
        message: '规则已保存并应用，内核重启完成',
        routing: candidate,
      }
    }

    // 应用失败：把规则回滚到应用前的样子，内核侧由 CoreManager 自己回滚。
    await this.store.setRouting(current)
    this.log.push('error', `应用失败，规则已回滚：${outcome.error ?? '未知原因'}`)
    return {
      saved: false,
      applied: false,
      changes,
      diagnostics: check.diagnostics,
      core: outcome,
      message: `规则已回滚：${clip(outcome.error ?? '内核拒绝启动', 600)}`,
      routing: current,
    }
  }

  /** 生成整份内核配置。 */
  buildConfig(routing: Routing = this.store.routing()): ReturnType<typeof buildXrayConfig> {
    return buildXrayConfig({
      routing,
      nodes: this.store.nodes(),
      selectedNode: this.store.selectedNode(),
      socksPort: this.config.socksPort,
      httpPort: this.config.httpPort,
      accessLogPath: this.config.accessLog ? this.config.accessLogPath : null,
    })
  }

  /**
   * 导入一个订阅：给 URL 就取一次，给文本就直接解析。
   * URL 用完即弃，只把脱敏后的来源写进记录。
   */
  async addSubscription(input: { url?: string; text?: string; name?: string }): Promise<SubscriptionResult> {
    let body = input.text ?? ''
    let source = '粘贴的文本'
    let name = input.name ?? ''
    if (typeof input.url === 'string' && input.url !== '') {
      source = redactUrl(input.url)
      if (name === '') name = hostOf(input.url)
      try {
        const response = await fetch(input.url, {
          signal: AbortSignal.timeout(20_000),
          headers: { 'user-agent': 'dsh-proxy/0.1' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        body = await response.text()
      } catch (error) {
        return {
          added: 0,
          updated: 0,
          skipped: 0,
          errors: [],
          subscription: null,
          sample: [],
          message: `取订阅失败：${(error as Error).message}`,
        }
      }
    }
    if (body.trim() === '') {
      return { added: 0, updated: 0, skipped: 0, errors: [], subscription: null, sample: [], message: '没有可解析的内容：请给 url 或 text' }
    }

    const parsed = parseSubscription(body)
    if (parsed.nodes.length === 0) {
      return {
        added: 0,
        updated: 0,
        skipped: 0,
        errors: parsed.errors.slice(0, 10),
        subscription: null,
        sample: [],
        message: parsed.errors.length === 0 ? '没有解析到任何节点' : `没有解析到节点：${parsed.errors[0]?.reason ?? ''}`,
      }
    }

    const subscriptionId = `sub-${name === '' ? Date.now().toString(36) : slugKey(name)}`
    const existing = this.store.nodes()
    const existingIds = new Set(existing.map((node) => node.id))
    const created = assignIdentities(parsed.nodes, existing).map((node) => ({ ...node, subscriptionId }))
    let added = 0
    let updated = 0
    for (const node of created) {
      await this.store.putNode(node)
      if (existingIds.has(node.id)) updated += 1
      else added += 1
    }

    const now = Date.now()
    const previousSub = this.store.subscriptions().find((record) => record.id === subscriptionId)
    const record: SubscriptionRecord = {
      id: subscriptionId,
      name: name === '' ? subscriptionId : name,
      source,
      addedAt: previousSub?.addedAt ?? now,
      updatedAt: now,
      nodeCount: created.length,
    }
    await this.store.putSubscription(record)

    if (this.store.selectedNode() === null) {
      const first = created[0]
      if (first !== undefined) await this.store.selectNode(first.id)
    }

    this.log.push('action', `订阅已导入：新增 ${added}，更新 ${updated}，来源 ${source}`)
    return {
      added,
      updated,
      skipped: parsed.errors.length,
      errors: parsed.errors.slice(0, 10),
      subscription: record,
      sample: created.slice(0, 5).map(redactNode),
      message: `导入完成：新增 ${added} 个节点，更新 ${updated} 个${parsed.errors.length === 0 ? '' : `，${parsed.errors.length} 行无法解析`}`,
    }
  }

  /** 测延迟；不给 id 就测全部节点。`ids` 里可以写节点 id、出口名或名字。 */
  async latency(ids?: string[]): Promise<{ results: LatencyResult[]; message: string }> {
    const nodes = this.store.nodes()
    const targets =
      ids === undefined || ids.length === 0
        ? nodes
        : nodes.filter((node) => ids.includes(node.id) || ids.includes(node.tag) || ids.includes(nodeLabel(node)))
    if (targets.length === 0) return { results: [], message: nodes.length === 0 ? '还没有节点' : '没有匹配的节点' }
    const results: LatencyResult[] = []
    for (const node of targets.slice(0, 50)) {
      results.push(await measureLatency(node))
    }
    const ok = results.filter((result) => result.ok).length
    return { results, message: `${results.length} 个节点：${ok} 个 TCP 握手成功` }
  }

  /** 选节点；`id` 可以写节点 id、出口名或名字。会写入状态，但不自动重启内核。 */
  async selectNode(id: string): Promise<{ ok: boolean; message: string }> {
    const node = this.store.nodes().find(
      (entry) => entry.id === id || entry.tag === id || nodeLabel(entry) === id,
    )
    if (node === undefined) return { ok: false, message: `没有这个节点：${id}` }
    const label = nodeLabel(node)
    await this.store.selectNode(node.id)
    this.log.push('action', `选中节点：${label}`)
    return { ok: true, message: `已选中 ${label}；重启内核后生效` }
  }

  /** 启停内核。 */
  async coreAction(action: CoreAction): Promise<{ ok: boolean; message: string; status: CoreStatus }> {
    if (action === 'stop') {
      await this.core.stop()
      return { ok: true, message: '内核已停止', status: this.core.status() }
    }
    if (this.store.selectedNode() === null) {
      return { ok: false, message: '还没有选中的节点，先导入订阅并选一个节点', status: this.core.status() }
    }
    const built = this.buildConfig()
    try {
      if (action === 'restart' && this.core.status().running) await this.core.stop()
      await this.core.start(built.config, built.proxyLabel)
      return { ok: true, message: action === 'restart' ? '内核已重启' : '内核已启动', status: this.core.status() }
    } catch (error) {
      return { ok: false, message: (error as Error).message, status: this.core.status() }
    }
  }

  /** 插件卸载：停内核、关存储域。 */
  async shutdown(): Promise<void> {
    await this.core.stop()
    await this.store.close()
  }

  /** 启动时的状态检查：报告缺什么，但不阻塞插件加载。 */
  async startupReport(): Promise<string> {
    const binary = await this.core.resolveBinary()
    ensureDataDir(this.config)
    if (binary.path === null) return binary.error ?? '没有可用的 xray 可执行文件'
    return `内核：${binary.path}${this.core.status().version === null ? '' : `（${this.core.status().version}）`}`
  }

  /** 供 HTTP 与工具共用的节点视图。 */
  nodesView(): {
    nodes: ReturnType<typeof redactNode>[]
    selectedNode: string | null
    subscriptions: SubscriptionRecord[]
  } {
    const snapshot = this.store.snapshot()
    return {
      nodes: snapshot.nodes.map(redactNode),
      selectedNode: snapshot.selectedNode,
      subscriptions: snapshot.subscriptions,
    }
  }
}

function describeChanges(changes: { added: string[]; replaced: string[]; removed: string[]; defaultChanged: boolean; total: number }): string {
  const parts: string[] = []
  if (changes.added.length > 0) parts.push(`新增 ${changes.added.join(', ')}`)
  if (changes.replaced.length > 0) parts.push(`修改 ${changes.replaced.join(', ')}`)
  if (changes.removed.length > 0) parts.push(`删除 ${changes.removed.join(', ')}`)
  if (changes.defaultChanged) parts.push('切换默认出口')
  if (parts.length === 0) parts.push('无实际变化')
  return `${parts.join('；')}（共 ${changes.total} 条）`
}

function slugKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const hasQuery = parsed.search !== ''
    return `${parsed.protocol}//${parsed.host}/***${hasQuery ? '?***' : ''}`
  } catch {
    return '***'
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

/** 判断是不是一个完整的写入请求（HTTP 入口用）。 */
export function asWriteRequest(value: unknown): RoutingWriteRequest | undefined {
  if (!isPlainObject(value)) return undefined
  const mode = value.mode
  if (mode !== 'replace' && mode !== 'patch') return undefined
  return value as unknown as RoutingWriteRequest
}
