/**
 * 给模型用的工具集：读、校验、解释、写四类，共 9 个。
 *
 * 读与写分离是关键设计：`proxy_routing_check` 与 `proxy_route_explain` 没有副作用，
 * 模型可以反复试错而不重启内核；真正落盘只有一个 `proxy_routing_write`。
 * 参数与 `/proxy-api/*` 的请求体同构，所以「先校验再写」的两次调用输入一致。
 *
 * 工具分两组暴露（见 `src/activation.ts`）：状态与读取常驻，校验 / 解释 / 写入 / 订阅
 * 只在 `proxy-routing` 技能加载后出现。两组的分界不是"读与写"，而是"schema 是否便宜"：
 * `check` 与 `write` 各带一份内联的整份规则 schema，两者合计约占全部工具 schema 的八成。
 *
 * 参数 schema 手写而不是走 `defineTool` 的 DSL：规则结构需要内联进 `routing` / `upsert`
 * 的 items（不用 `$ref`，不同 provider 对 `$defs` 支持不一致），手写才能控制到字段级。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { TrafficQuery } from './access.ts'
import type { ActivationCondition } from './activation.ts'
import type { Flow } from './explain.ts'
import { ID_PATTERN, MATCH_KEYS, NETWORK_VALUES, PROTOCOL_VALUES } from './ir.ts'
import { MatchKeysHint, RuleSchemaHint } from './skill.ts'
import type { ProxyService } from './service.ts'

/** 一直可用的工具：状态与现状读取，schema 很小，而且最先被问到。 */
export const ALWAYS_ON_TOOLS = ['proxy_status', 'proxy_routing_read', 'proxy_nodes_list', 'proxy_latency_test', 'proxy_traffic_read'] as const

/** 加载 `proxy-routing` 技能后才出现的工具：schema 贵，且用法要读完技能才清楚。 */
export const SKILL_GATED_TOOLS = ['proxy_routing_check', 'proxy_route_explain', 'proxy_routing_write', 'proxy_subscription_add'] as const

/** `match` 的 JSON Schema：字段内联，模型在工具边界就能拿到字段级约束。 */
function matchSchema(): JsonSchemaNode {
  return {
    type: 'object',
    description: MatchKeysHint,
    additionalProperties: false,
    properties: {
      domain: {
        type: 'array',
        description: '域名条件。可用 geosite:tag、domain:example.com、full:example.com、regexp:…、ext:文件:tag、keyword:…，或裸子串。',
        items: { type: 'string' },
      },
      ip: {
        type: 'array',
        description: 'IP 条件：IPv4/IPv6 字面量、CIDR，或 geoip:tag / ext:文件:tag。',
        items: { type: 'string' },
      },
      port: {
        type: 'array',
        description: '目的端口：443，或区间 1000-2000。',
        items: { type: 'string' },
      },
      sourcePort: {
        type: 'array',
        description: '来源端口，写法同 port。',
        items: { type: 'string' },
      },
      network: {
        type: 'array',
        description: '传输层协议，小写。',
        items: { type: 'string', enum: [...NETWORK_VALUES] },
      },
      protocol: {
        type: 'array',
        description: '嗅探出的应用层协议；需要 sniffing 开启。',
        items: { type: 'string', enum: [...PROTOCOL_VALUES] },
      },
      source: {
        type: 'array',
        description: '来源地址：IP 或 CIDR。',
        items: { type: 'string' },
      },
      inboundTag: {
        type: 'array',
        description: '入站 tag，本插件的入站是 socks 与 http。',
        items: { type: 'string' },
      },
    },
  }
}

/** 一条规则的 JSON Schema。 */
function ruleSchema(): JsonSchemaNode {
  return {
    type: 'object',
    description: RuleSchemaHint,
    additionalProperties: false,
    required: ['id', 'match', 'out'],
    properties: {
      id: {
        type: 'string',
        description: '稳定标识，用于增量编辑与诊断引用；小写字母、数字、下划线、连字符。',
      },
      name: { type: 'string', description: '人类可读的名字，UI 与 explain 会显示它。' },
      enabled: { type: 'boolean', description: 'false 表示保留但禁用；省略等于启用。' },
      match: matchSchema(),
      out: { type: 'string', description: '出口名：proxy / direct / block，或某个节点 tag（以 proxy_routing_read 的 exits 为准）。节点出口在界面上显示为节点名字，见 exitLabels。' },
    },
  }
}

/** 整份规则集的 JSON Schema。 */
function routingSchema(): JsonSchemaNode {
  return {
    type: 'object',
    description: '{ default: 默认出口名, rules: [规则…] }。rules 的顺序就是匹配顺序，首条命中即停。',
    additionalProperties: false,
    required: ['default', 'rules'],
    properties: {
      default: { type: 'string', description: '默认出口名。' },
      rules: {
        type: 'array',
        description: '规则列表，最多 200 条。',
        items: ruleSchema(),
      },
    },
  }
}

/** write 与 check 共用的参数集，保证两次调用的输入形状完全一致。 */
function writeParameters(extra: Record<string, JsonSchemaNode>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: {
      mode: {
        type: 'string',
        enum: ['replace', 'patch'],
        description: 'replace 整份替换（必须给 routing）；patch 按 id 增改删（给 upsert / delete / default）。',
      },
      routing: routingSchema(),
      upsert: {
        type: 'array',
        description: 'mode=patch：按 id 插入或整体替换；已存在的 id 就地替换，新 id 追加到末尾。每条都是完整规则。',
        items: ruleSchema(),
      },
      delete: {
        type: 'array',
        description: 'mode=patch：要删除的规则 id。',
        items: { type: 'string' },
      },
      default: { type: 'string', description: 'mode=patch：改写默认出口名。' },
      ...extra,
    },
  }
}

/** 统一的结果渲染：结构化 JSON，模型和人都能读。 */
function renderJson(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

const output = { schema: {} as JsonSchemaNode, render: renderJson }

/**
 * 注册全部工具。
 * @param ctx - 宿主 Context。
 * @param service - 应用逻辑。
 * @param activation - 改写类工具的启动条件；省略时 9 个工具全部常驻。
 * @returns 注销全部工具的 disposer。
 */
export function registerTools(ctx: Context, service: ProxyService, activation?: ActivationCondition): () => void {
  const disposers: (() => void)[] = []

  const status: ToolDefinition = {
    name: 'proxy_status',
    description:
      '代理内核与规则库的当前状态：内核是否在跑、端口、规则数、节点数、选中的出口、geo 数据是否就位、最后一条错误。只读。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output,
    isConcurrencySafe: () => true,
    async execute() {
      return { ...service.status(), nodes: service.nodesView() }
    },
  }

  const read: ToolDefinition = {
    name: 'proxy_routing_read',
    description:
      '读当前分流规则：{ default, rules }、可用出口名、编译后的规则条数，以及语义检查的诊断。改规则前先读它。只读。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output,
    isConcurrencySafe: () => true,
    async execute() {
      return service.read()
    },
  }

  const check: ToolDefinition = {
    name: 'proxy_routing_check',
    description:
      '只校验、不落盘：检查一份候选规则（形状、语义、能否编译），返回带 JSON 路径的诊断。参数与 proxy_routing_write 完全一致，所以把同样的参数先喂给这里、再喂给 write 即可。只读。',
    parameters: writeParameters({}),
    output,
    isConcurrencySafe: () => true,
    async execute(args) {
      const candidate = service.candidateFor(args as Parameters<ProxyService['candidateFor']>[0])
      if (candidate.error !== undefined) {
        return {
          valid: false,
          diagnostics: [candidate.error],
          exits: service.exits(),
          exitLabels: service.exitLabels(),
          compiled: null,
          changes: null,
        }
      }
      return { ...service.check(candidate.routing), changes: candidate.changes }
    },
  }

  const explain: ToolDefinition = {
    name: 'proxy_route_explain',
    description:
      '仿真一条流量会命中哪条规则、前面的规则为什么被跳过，以及结论依赖哪些前提。判断不了时返回 indeterminate 而不是猜。只读。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        domain: { type: 'string', description: '要试探的目的域名，例如 api.openai.com。给了域名才能判断 domain 类条件。' },
        ip: { type: 'string', description: '目的 IP；domainStrategy=IPIfNonMatch 时域名目标的 ip 条件也靠它判断。' },
        port: { type: 'integer', description: '目的端口，例如 443。' },
        network: { type: 'string', enum: ['tcp', 'udp'], description: '传输层协议；省略时 network 类条件无法判定。' },
        protocol: { type: 'string', enum: [...PROTOCOL_VALUES], description: '嗅探出的应用层协议；省略时 protocol 类条件无法判定。' },
        inboundTag: { type: 'string', description: '入站 tag（socks / http），只在规则里写了 inboundTag 条件时有用。' },
      },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args) {
      return service.explain(args as Flow)
    },
  }

  const write: ToolDefinition = {
    name: 'proxy_routing_write',
    description:
      '保存规则并（默认）应用到内核：先校验，再生成配置、`xray -test`、重启内核；重启失败会回滚到上一份规则。没有 xray 二进制或没选节点时只保存并说明原因。写操作。',
    parameters: writeParameters({
      apply: { type: 'boolean', description: '默认 true；false 只保存不重启内核。' },
      reason: { type: 'string', description: '一句话说明这次改动的意图，会写进日志。' },
    }),
    output,
    async execute(args) {
      return service.write(args as Parameters<ProxyService['write']>[0])
    },
  }

  const nodes: ToolDefinition = {
    name: 'proxy_nodes_list',
    description:
      '列出已导入的出口节点（凭据已脱敏）、订阅来源和当前选中的节点。规则里的 out 只能写这里出现过的出口名。只读。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output,
    isConcurrencySafe: () => true,
    async execute() {
      return {
        ...service.nodesView(),
        exits: service.exits(),
        exitLabels: service.exitLabels(),
        note: '出口名（tag）就是规则里 out 的取值；proxy 是「当前选中节点」的别名。界面上显示的是节点名字（label / exitLabels）。',
      }
    },
  }

  const subscription: ToolDefinition = {
    name: 'proxy_subscription_add',
    description:
      '导入订阅：给 url 就取一次（http/https），或直接把内容贴进 text。支持 ss / vmess / vless / trojan 的 base64 订阅或逐行链接；订阅 URL 用完即弃，只记录脱敏后的来源。写操作。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: '订阅地址；只支持 http/https。' },
        text: { type: 'string', description: '订阅原文或多行分享链接；与 url 二选一。' },
        name: { type: 'string', description: '给这份订阅起个名字，用于分组和日志。' },
      },
    },
    output,
    async execute(args) {
      return service.addSubscription(args as { url?: string; text?: string; name?: string })
    },
  }

  const latency: ToolDefinition = {
    name: 'proxy_latency_test',
    description:
      '对节点做 TCP 握手测延迟（只验证可连接与耗时，不验证能否真的出网）。不给 nodes 就测全部。只读。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nodes: {
          type: 'array',
          description: '节点 id 或 tag 列表；省略表示全部（最多 50 个）。',
          items: { type: 'string' },
        },
      },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args) {
      const input = args as { nodes?: string[] }
      return service.latency(input.nodes)
    },
  }

  const traffic: ToolDefinition = {
    name: 'proxy_traffic_read',
    description:
      '读内核访问日志：某个域名/IP 的实际连接走了哪个出口、是否经过代理。'
      + '只统计经本插件 SOCKS/HTTP 端口进入的连接；HTTPS 只能看到域名与端口，客户端自行解析 DNS 时只记录 IP。只读。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        host: {
          type: 'string',
          description: '域名、IP 或明文 HTTP 的路径子串，大小写不敏感。例如 api.openai.com 或 1.2.3.4。',
        },
        out: {
          type: 'string',
          description: '只保留某个出口名的记录：proxy / direct / block 或节点 tag（见 proxy_routing_read 的 exits）。',
        },
        verdict: {
          type: 'string',
          enum: ['proxy', 'direct', 'block'],
          description: '按归一化分类过滤：proxy 或节点出口=代理，direct=直连，block=拦截。',
        },
        limit: {
          type: 'integer',
          description: '最多返回多少条（1–200，默认 50），最新在前。',
        },
      },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args) {
      return service.traffic(args as TrafficQuery)
    },
  }

  // 前半组常驻，后半组等技能加载；`activation` 省略时两组都常驻。
  const gated = new Set<string>(SKILL_GATED_TOOLS)
  for (const definition of [status, read, check, explain, write, nodes, subscription, latency, traffic]) {
    disposers.push(
      activation === undefined || !gated.has(definition.name)
        ? ctx.tools.register(definition)
        : ctx.tools.register(definition, { when: activation }),
    )
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

/** 规则 id 的 pattern，供文档与测试引用。 */
export const RULE_ID_PATTERN = ID_PATTERN

/** 匹配字段名，供文档与测试引用。 */
export const RULE_MATCH_KEYS = MATCH_KEYS
