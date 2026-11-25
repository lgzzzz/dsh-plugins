/**
 * 状态存储：走 DSH 的存储域（`ctx.storageDomain`），不自己找文件路径。
 *
 * 规则整体放 `global`：`rules[]` 的顺序就是匹配顺序，拆成表会引入「顺序存哪」的第二份
 * 真相，整份原子写更简单。节点与订阅放表。
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { defaultRouting, type Routing } from './ir.ts'
import type { ProxyNode } from './nodes.ts'

/** 一个订阅来源。只留脱敏后的展示字段，完整 URL 用完即弃。 */
export interface SubscriptionRecord {
  id: string
  name: string
  /** 脱敏后的来源，例如 `https://example.com/***`。 */
  source: string
  addedAt: number
  updatedAt: number
  nodeCount: number
}

const routingSchema = z.object({
  default: z.string(),
  // 单条规则由规则引擎校验（它的诊断比 zod 的更具体），存储层只管信封。
  rules: z.array(z.unknown()),
})

const settingsSchema = z.object({
  routing: routingSchema,
  selectedNode: z.string().nullable(),
})

const tlsSchema = z.object({
  mode: z.enum(['none', 'tls', 'reality']),
  serverName: z.string().optional(),
  alpn: z.array(z.string()).optional(),
  fingerprint: z.string().optional(),
  publicKey: z.string().optional(),
  shortId: z.string().optional(),
  spiderX: z.string().optional(),
})

const transportSchema = z.object({
  network: z.enum(['tcp', 'ws', 'grpc']),
  path: z.string().optional(),
  host: z.string().optional(),
  serviceName: z.string().optional(),
})

const nodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  tag: z.string(),
  protocol: z.enum(['shadowsocks', 'vmess', 'vless', 'trojan']),
  server: z.string(),
  port: z.number(),
  password: z.string().optional(),
  method: z.string().optional(),
  uuid: z.string().optional(),
  alterId: z.number().optional(),
  flow: z.string().optional(),
  security: z.string().optional(),
  tls: tlsSchema.optional(),
  transport: transportSchema.optional(),
  subscriptionId: z.string().optional(),
  addedAt: z.number(),
})

const subscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string(),
  addedAt: z.number(),
  updatedAt: z.number(),
  nodeCount: z.number(),
})

/** 本插件的存储域声明；域名单只允许小写字母、数字与下划线。 */
export const proxyDomainSpec = defineDomain({
  name: 'dsh_proxy',
  version: 1,
  tables: {
    nodes: domainTable(nodeSchema),
    subscriptions: domainTable(subscriptionSchema),
  },
  global: {
    schema: settingsSchema,
    initial: { routing: defaultRouting(), selectedNode: null },
  },
})

/** 一份完整的状态快照。 */
export interface StateSnapshot {
  routing: Routing
  selectedNode: string | null
  nodes: ProxyNode[]
  subscriptions: SubscriptionRecord[]
}

/** 存储句柄；`close()` 由插件的 effect disposer 负责。 */
export class ProxyStore {
  private readonly handle: Domain<typeof proxyDomainSpec>

  private constructor(handle: Domain<typeof proxyDomainSpec>) {
    this.handle = handle
  }

  /** 打开域。同名域已打开时抛 `already-open`。 */
  static async open(ctx: Context): Promise<ProxyStore> {
    const handle = await ctx.storageDomain.open(proxyDomainSpec)
    return new ProxyStore(handle)
  }

  /** 当前规则集；存进来的形状不对时退回默认规则，不阻塞插件。 */
  routing(): Routing {
    const value = this.handle.global.get().routing
    if (typeof value.default !== 'string' || !Array.isArray(value.rules)) return defaultRouting()
    return value as unknown as Routing
  }

  /** 当前选中的节点 id。 */
  selectedNode(): string | null {
    return this.handle.global.get().selectedNode
  }

  /** 节点库存（含凭据；对外输出必须走 `redactNode`）。 */
  nodes(): ProxyNode[] {
    return [...this.handle.table('nodes').entries()].map(([, node]) => node as unknown as ProxyNode)
  }

  /** 订阅记录。 */
  subscriptions(): SubscriptionRecord[] {
    return [...this.handle.table('subscriptions').entries()].map(([, record]) => record as SubscriptionRecord)
  }

  /** 快照：工具与 UI 都读它，避免各自拼。 */
  snapshot(): StateSnapshot {
    return {
      routing: this.routing(),
      selectedNode: this.selectedNode(),
      nodes: this.nodes(),
      subscriptions: this.subscriptions(),
    }
  }

  /** 整份替换规则集。 */
  async setRouting(routing: Routing): Promise<void> {
    const current = this.handle.global.get()
    await this.handle.global.set({ ...current, routing })
  }

  /** 选择出口节点。 */
  async selectNode(id: string | null): Promise<void> {
    const current = this.handle.global.get()
    await this.handle.global.set({ ...current, selectedNode: id })
  }

  /** 写入或覆盖节点。 */
  async putNode(node: ProxyNode): Promise<void> {
    await this.handle.table('nodes').put(node.id, node)
  }

  /** 删除节点。 */
  async deleteNode(id: string): Promise<boolean> {
    return this.handle.table('nodes').delete(id)
  }

  /** 写入或覆盖一条订阅记录。 */
  async putSubscription(record: SubscriptionRecord): Promise<void> {
    await this.handle.table('subscriptions').put(record.id, record)
  }

  /** 关闭域；重复调用安全。 */
  async close(): Promise<void> {
    await this.handle.close()
  }
}
