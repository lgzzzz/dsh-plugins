# 给 DSH 装上 v2rayA 的分流能力：插件设计方案

> 目标：DSH 拥有 v2rayA 的分流能力，**由 DSH（模型）自己编写、校验、解释并应用路由规则**。
> 定稿口径：数据面用**上游 XTLS/Xray-core**；规则用**结构化 IR**，不做 RoutingA。
> 本文是设计分析，不含安装动作；代码片段是骨架示意，不是已交付实现。

## 0. 一句话结论

做一个 DSH 插件，把"分流规则"做成**可被模型读写、可校验、可仿真、可回滚的结构化数据**，编译成上游 xray 的 `routing.rules[]`，交给 `xray` 进程执行。规则不是文本 DSL，而是一个带 id 的 JSON 对象；`RoutingA` 不进入主链路。

两个关键取舍：

1. **数据面用上游 xray-core**，不引 v2rayA 的 fork。上游已经具备我们需要的一切（含原生 TUN），没有理由背一个自行编译的内核。
2. **规则用结构化 IR**，不用 RoutingA。模型写 JSON 比写小众 DSL 可靠，错误能落到字段而不是行列，规则还能按 id 增量编辑。

## 1. 事实基础（已核对，非记忆）

| 事实 | 来源 |
|---|---|
| v2rayA = Go 服务 + Vue GUI，用自定义规则语言 RoutingA，编译成 xray `routing.rules[]` | `v2rayA/service/kernel/v2ray/template_routing.go:parseRoutingA` |
| RoutingA 的映射：`domain`/`ip`/`port`/`sourcePort`/`network`/`protocol`/`source`/`inboundTag`/`user` + `outboundTag`；`default:` 变末尾默认出口规则 | 同上 |
| v2rayA 保存规则 = 写库 → 重启内核 → 失败恢复旧规则再重启 | `service/server/service/core_config.go:ApplyCoreConfig` |
| v2rayA 是 AGPL-3.0（本方案不再引用其代码，仅作行为参考） | `v2rayA/LICENSE` |
| v2rayA 的 fork 额外提供：独立 DNS 模块（:52353）、`tun-mips` TUN、anytls/juicity/tuic、MultiObservatory | `core/dns`、`core/hint/proxy/*`、`core/main/distro/all` |
| **上游 xray 已有原生 TUN**（`proxy/tun`，含 darwin/linux/windows/WFP） | XTLS/Xray-core 仓库 `proxy/tun` |
| 本机 **没有** xray 可执行文件；`brew info xray` 显示可装 26.11.9 | `command -v` / `brew info` |
| DSH 运行版本 **0.2.3-alpha.2**；Host 侧有 `tools`/`storageDomain`/`subprocess`/`webServer`/`skills`；Client 侧 `main` 是 keyed slot，`sidebar.panellist` 按 id 对应主面板 | `cordis_inspect` 实时查询 |

## 2. 三种做法与取舍

| 方案 | 做法 | 优点 | 问题 |
|---|---|---|---|
| A. 包一层 v2raya | 插件调 v2raya 的 REST（:2017，JWT） | 功能最全、代码最少 | 要另装并常驻 v2raya；规则编译在 Go 侧，模型无法解释"为什么走这个出口"；版本漂移 |
| B. 全量重写 | TS 重写协议、内核、透明代理 | 完全自主 | VMess/VLESS/REALITY/TUN 重写不现实 |
| **C. 控制面自研 + 上游 xray（采用）** | 规则模型、节点库存、生命周期、仿真在插件；流量交给 `xray` | 规则可控可解释；4–6 人日可到 MVP；与 DSH 工具/UI 深度集成 | 需要 xray 二进制；MVP 只做本地 SOCKS/HTTP |

选择 C 的核心理由：**AI 编写路由的瓶颈不在协议实现，而在"写完能不能验证、错了能不能解释、坏了能不能回滚"**。这三件事 v2rayA 的 GUI 都没解决，恰好是纯逻辑，插件做最合适。

## 3. 架构

```
┌──────────────────────────── DSH (0.2.3-alpha.2) ────────────────────────────┐
│                                                                             │
│  模型/Agent ──proxy_* 工具──┐                                                │
│                             ├──► 控制面 (Host 插件, TS)                      │
│  Web UI「代理」页 ─/proxy-api─┘      │                                      │
│                                      ├─ 规则 IR 校验 + 编译 + 仿真            │
│                                      ├─ 节点与订阅库存 (storageDomain)        │
│                                      ├─ 配置生成 + xray -test 校验           │
│                                      └─ 内核进程管理 (subprocess)            │
│                                                  │ spawn / restart          │
└──────────────────────────────────────────────────┼──────────────────────────┘
                                                   ▼
                                    xray（上游二进制，数据面）
                                    127.0.0.1:10808 socks / 10809 http
                                    127.0.0.1:20172 规则端口
```

- **控制面**：Cordis 插件，`apply(ctx, config)` 里注册工具、HTTP 路由、存储域、skill。
- **数据面**：上游 `xray`，插件只负责生成 JSON、`-test` 校验、启动/重启/回滚。
- **边界**：插件不碰系统防火墙、不改系统代理；这些是阶段 4 里用户显式点击的动作。

## 4. 能力范围

| v2rayA 能力 | MVP | 后续 | 说明 |
|---|---|---|---|
| 分流规则编辑 / 校验 / 应用 | ✅ 结构化 | | 核心 |
| 规则仿真（这条流量走哪） | ✅ | | v2rayA 没有，AI 调试的关键 |
| 节点 / 服务器管理 | ✅ 单节点选择 | 多分组、负载均衡 | MVP 用确定性选择，便于解释 |
| 订阅导入 / 更新 | ✅ ss/vmess/vless/trojan + base64 | hysteria2、Clash YAML | 四种协议覆盖大多数机场 |
| 延迟测试 | ✅ TCP 握手 | 真流量测速 | 便宜够用 |
| 内核生命周期 | ✅ 单实例 | | 只认上游 xray |
| 嗅探 sniffing | ✅ | | `protocol` 匹配依赖它 |
| DNS | ⚠️ 固定安全默认 | 可视化 | 默认防泄漏，不开放随意改 |
| 自定义入站 | ⚠️ 固定 socks/http/rule | 表单 | |
| geo 数据文件 | ✅ 存在性检测 | 解析 + 精确仿真 | 见 §6.5 |
| 透明代理 / TUN | ❌ | 阶段 4（上游 `proxy/tun`） | 需 root/系统权限 |
| 系统代理 / PAC | ❌ | 阶段 4 | 改系统状态，必须显式确认 |
| 多用户 / JWT | ❌ | | DSH 自带鉴权 |
| GFWList 更新 | ❌ | 可选 | 依赖第三方数据源 |
| 日志 | ✅ 内核日志尾部 + 连接记录 | 按域名/IP 过滤连接 | |

边界澄清：这个插件代理的是**用户应用的流量**（应用连 `127.0.0.1:10808`），不会改变 DSH 自己访问模型 API 的路径。如果目标是让 DSH 的模型请求也走代理，那是另一个集成点（进程级 `HTTPS_PROXY` 或 provider 自定义 fetch），会影响所有会话，必须单独设计、单独授权。

## 5. 插件骨架

```
dsh-proxy-plugin/
├── package.json          # dsh.bundle.patch + dsh.client
├── cordis.patch.yml      # 插入一行 named plugin
├── index.js              # Host：apply() 注册工具、路由、skill
├── lib/
│   ├── schema.js         # 规则 IR 的 JSON Schema + zod 校验
│   ├── compile/          # IR → xray routing.rules[]
│   ├── explain/          # 流匹配仿真
│   ├── nodes/            # 订阅解析、outbound 生成
│   ├── core/             # 配置生成、-test、进程管理、回滚
│   └── http.js           # /proxy-api 路由
├── src/client.tsx        # 面板入口：注册侧栏图标与主面板（React）
├── src/ui/               # 面板组件、CSS Modules、取数、词条
├── lib/client.js         # ↑ 由 tsdown 打包出的浏览器半部（__ModuleLoader__）
├── docs/DETAIL.md        # 插件详情页
├── locale/{zh,en}.json
└── icon.svg
```

`package.json` 关键字段：

```json
{
  "name": "@local/dsh-proxy",
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js", "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" },
  "peerDependencies": { "@deepseek-ai/dsh-storage-domain": "0.2.3-alpha.2", "zod": "^4" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true }
  }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: proxy
      name: '@local/dsh-proxy'
      config:
        coreBinary: ''        # 空 = 自动探测；不自动下载
        socksPort: 10808
        httpPort: 10809
        rulePort: 20172
```

Host 侧 `apply`：

```js
export const inject = ['tools', 'storageDomain', 'subprocess', 'webServer', 'skills']

export async function apply(ctx, config) {
  const domain = await ctx.storageDomain.open(proxyDomain)    // §9
  ctx.effect(() => () => domain.close())

  const core = new CoreManager(ctx, config, domain)            // §8
  registerTools(ctx, core, domain)                             // §7
  registerApi(ctx, core, domain)                               // /proxy-api
  ctx.skills.register(routingSkill)                            // §7.3
}
```

## 6. 规则模型（本方案的核心）

### 6.1 为什么放弃 RoutingA

| | RoutingA | 结构化 IR |
|---|---|---|
| 模型写错的典型形态 | "第 7 行第 12 列解析失败" | "rules[2].match.network 的值 'TCP' 不合法" |
| 错误定位 | 行号 + 列号，还要求模型回数行 | 字段路径，直接可改 |
| 增量编辑 | 只能整份文本重写或删行区间 | 按 `id` 改一条、删一条 |
| 语义歧义 | `domain(a) && domain(b)` 实际是 OR | 数组天然就是"任一匹配"，无歧义 |
| 扩展新字段 | 改语法 + 改文档 + 改解析器 | 加一个 schema 字段 |
| 解析器维护 | 自己写 lexer/parser/诊断，500–800 行 | 无 |

代价只有一条：**逐 token 成本更高**（同内容 JSON 约是文本的 2–3 倍）。但用了 `id` 之后日常只改两三条，这点差异可以忽略。

顺带甩掉一个历史包袱：RoutingA 里"定义出口"（`outbound: office = socks(...)`）和"匹配规则"是两种语句，而我们的出口来自节点库存——IR 里没有 `outbound` 定义，出口就是一个字符串，必须已经存在。

### 6.2 IR 定义

```ts
type Routing = {
  default: string                 // 默认出口
  rules: Rule[]                   // 顺序即匹配顺序，首条命中
}

type Rule = {
  id: string                      // 稳定标识，供增量编辑与诊断引用
  name?: string                   // 人类可读的名字，UI 与 explain 用
  enabled?: boolean               // 默认 true
  match: Match
  out: string                     // 出口名：proxy / direct / block / 节点 tag
}

type Match = {
  domain?: string[]               // 值沿用 xray 约定，见 §6.3
  ip?: string[]
  port?: string[]                 // "80" 或 "1000-2000"
  sourcePort?: string[]
  network?: ('tcp' | 'udp')[]
  protocol?: ('http' | 'tls' | 'quic' | 'bittorrent')[]
  source?: string[]
  inboundTag?: string[]
}
```

一个真实样例：

```json
{
  "default": "proxy",
  "rules": [
    { "id": "ads",  "name": "拦截广告",   "match": { "domain": ["geosite:category-ads-all"] }, "out": "block" },
    { "id": "cn",   "name": "国内直连",   "match": { "domain": ["geosite:cn"], "ip": ["geoip:cn"] }, "out": "direct" },
    { "id": "ai",   "name": "AI 走美国",  "match": { "domain": ["geosite:openai", "domain:anthropic.com"], "network": ["tcp"] }, "out": "us" },
    { "id": "corp", "name": "公司内网",   "match": { "domain": ["domain:corp.example"], "port": ["443"] }, "out": "direct" }
  ]
}
```

`geosite:`、`geoip:`、`ext:`、`domain:`、`full:`、`regexp:` 这些前缀**不是语法，是值约定**——它们本来就是 xray 的字符串格式，原样保留。

`user`、`attrs`、`balancerTag`、`domainMatcher` 这些字段暂不开放：它们对应多用户、属性路由、负载均衡等能力，等相应的节点/入站功能落地再加，避免 schema 先长出用不上的分支。

### 6.3 编译映射

| IR | xray `routing.rules[]` |
|---|---|
| `match.domain: ["example.com"]` | `domain: ["example.com"]`（子串） |
| `match.domain: ["domain:example.com"]` / `["full:…"]` / `["regexp:…"]` | 原样带前缀 |
| `match.domain: ["ext:X.dat:tag"]` | 同名域值，并校验文件在数据目录内 |
| `match.ip: ["10.0.0.0/8", "geoip:cn"]` | `ip: [...]` |
| `match.port: ["80", "443", "1000-2000"]` | `port: "80,443,1000-2000"` |
| `match.sourcePort` | `sourcePort`，同样逗号连接 |
| `match.network: ["tcp","udp"]` | `network: "tcp,udp"` |
| `match.protocol` | `protocol: [...]`（需嗅探） |
| `match.source` / `inboundTag` | 同名字段 |
| `rule.out` | `outboundTag` |
| `routing.default` | 末尾追加一条 catch-all 规则 |
| `enabled: false` | 编译时跳过，保留在库里 |

编译时按 v2rayA 的做法**前置注入**两条隐式规则：代理服务器自身地址 → `direct`（防环）、Apple Push 域名 → `direct`。这两条不占 IR 的 id，只在编译产物里出现。

### 6.4 语义检查

1. **出口必须存在**：`proxy`/`direct`/`block` 内置，其余必须是节点库存里真实存在的出口名（分组或单个节点）——否则报错。
2. **id 唯一且稳定**：重复 id 直接拒绝；`id` 只允许 `[a-z0-9_-]{1,32}`。
3. **顺序遮蔽**：前序规则完全覆盖后续规则时给 warning（例如前面有一条 `{domain:["geosite:cn"]} -> direct`，后面又写 `{domain:["domain:baidu.com"]} -> us`，后者永远不会命中）。
4. **`protocol` 需要嗅探**：用了 `protocol` 而嗅探未开 → warning + 一键开启。
5. **`ext:` 路径逃逸**：只允许数据目录内的 `.dat`，`../` 一律拒绝。
6. **geo 标签存在性**：`geosite:openai` 若不在已加载的 `.dat` 里，内核会拒绝启动（`illegal domain rule`）；能检测就提前报，检测不了降级为 warning。
7. **规模上限**：规则条数、单条条件的值个数、`ext` 文件大小都要有上限，避免一次写入把内核拖死。

### 6.5 仿真 explain

输入一个流 `{domain?, ip?, port?, network?, source?, inboundTag?}`，输出：

```json
{
  "matched": { "id": "ai", "name": "AI 走美国", "out": "us" },
  "skipped": [
    { "id": "ads", "reason": "domain 不匹配：api.openai.com 不在 geosite:category-ads-all" },
    { "id": "cn",  "reason": "domain 不匹配：geosite:cn" }
  ],
  "warnings": ["未提供 ip：ip 条件在 domainStrategy=IPIfNonMatch 下可能命中"]
}
```

按顺序对每条规则做谓词求值，但必须诚实标注边界：

- `domain` 匹配的是**目的地域名**（SOCKS 传入的域名，或嗅探出的 SNI）；只给 IP 时 `domain` 条件不参与。
- `ip` 条件在 `domainStrategy: AsIs` 下只对 IP 目标生效；`IPIfNonMatch` 会先解析域名再重试。
- `geosite:`/`geoip:` 需要解析 `.dat` 才能精确判断；没解析时返回 `"unknown"` 而不是假装匹配。

`geosite.dat` / `geoip.dat` 是 v2fly 的 protobuf 格式，字段极简（`GeoIPList{entry{country_code, cidr[]}}`、`GeoSiteList{entry{country_code, domain{type,value}[]}}`），写一个 ~100 行的手工 protobuf 读取器即可，不必引重依赖。

### 6.6 迁移：让模型当解析器

放弃 RoutingA 后，老用户手里的 v2raya 规则不能直接导入。但**不需要写导入器**：用户把旧规则文本贴进对话，模型读懂后直接调 `proxy_routing_write` 写成 IR。模型的强项就是把这类文本转成结构化数据，这比维护一个只读的 Go 语法复刻更省，也更灵活（老语法里的怪癖模型能按语义处理）。

如果将来用户量足够大，再加一个只读导入器也不迟——但**不进 MVP 排期**。

## 7. 让 DSH 编写路由：工具设计

### 7.1 工具集（9 个）

| 工具 | 类型 | 作用 | 关键返回 |
|---|---|---|---|
| `proxy_status` | 读 | 内核状态、端口、规则数、最后错误 | `{running, ports, ruleCount, lastError}` |
| `proxy_nodes_list` | 读 | 分组、节点、协议、延迟、订阅状态 | 脱敏后的节点列表 |
| `proxy_subscription_add` | 写 | 添加/更新订阅并同步 | `{added, updated, skipped, errors}` |
| `proxy_latency_test` | 读 | 测指定节点/全部节点 TCP 握手 | `{nodeId, ms, ok}` |
| `proxy_routing_read` | 读 | 当前 IR + 编译摘要 + 可用出口名 | `{default, rules, outbounds}` |
| `proxy_traffic_read` | 读 | 内核访问日志：某域名/IP 实际走了哪个出口 | `{live, entries, summary}` |
| `proxy_routing_check` | 读 | 只校验不落盘：schema、语义、编译、拟生成配置 | 诊断数组（带 ruleId）+ 出口名 |
| `proxy_route_explain` | 读 | 仿真一条流命中哪条规则 | 见 §6.5 |
| `proxy_routing_write` | 写 | 改规则并应用（含回滚） | diff + 应用结果 + 新状态 |

设计取舍：

- **读与写分离**：`check` 和 `explain` 无副作用，模型可以反复试错，不每次重启内核。
- **预测与实际分开**：`proxy_route_explain` 仿真「应该走哪」，`proxy_traffic_read` 读访问日志回答「实际走了哪」；后者的出口是内核真正执行的 outboundTag。
- **不做 `proxy_apply` 大工具**：写操作只有"改规则"和"改订阅"两类，参数少、语义清楚。
- 工具名统一 `proxy_` 前缀，避免和未来内置工具撞名。
- `proxy_routing_check` 与 `proxy_routing_write` 参数同构（`routing` 或 `upsert`/`delete`），只是不落盘；这样"先校验再写"两次调用的输入完全一致，模型不用换形状。

### 7.2 `proxy_routing_write` 的参数

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["mode"],
  "properties": {
    "mode": { "enum": ["replace", "patch"], "description": "replace 整份替换；patch 按 id 增量增改删" },
    "routing": {
      "type": "object",
      "description": "mode=replace 时的完整规则对象",
      "properties": {
        "default": { "type": "string" },
        "rules": { "type": "array", "description": "结构同 §6.2 的 Rule" }
      }
    },
    "upsert": {
      "type": "array",
      "description": "mode=patch：按 id 插入或整体替换；新规则追加到末尾",
      "items": { "type": "object", "description": "结构同 §6.2 的 Rule" }
    },
    "delete": {
      "type": "array",
      "items": { "type": "string" },
      "description": "mode=patch：要删除的规则 id"
    },
    "apply": { "type": "boolean", "description": "默认 true；false 只保存不重启内核" },
    "reason": { "type": "string", "description": "一句话说明这次改动的意图，写入审计记录" }
  }
}
```

`Rule` 的结构就是 §6.2 的定义；实际 schema 把它的字段**内联**进 `rules` 和 `upsert` 的 `items`，不用 `$ref`——不同模型 provider 对 `$defs` 的支持不一致，内联最稳，代价只是 schema 变长。`match` 里每个字段都被 JSON Schema 约束住（枚举、端口 pattern、`minProperties: 1`），模型在工具边界就能拿到字段级错误。

`execute` 的执行顺序固定：schema 校验 → 语义检查 → 生成新配置 → `xray -test` → 写库 → 重启内核 → 探测端口 → 失败恢复旧库并重启 → 返回结构化结果。写坏规则最多损失一次重启，不会留下半生效状态。

### 7.3 随插件分发的 skill（`routing`）

工具描述保持短，规则语义和常见模板放进按需加载的 skill；同时**这个 skill 也是四个改写类工具的解锁条件**：

```js
ctx.skills.register({
  name: 'proxy-routing',
  description: '调整代理分流规则、给某些域名/IP 加例外、解释某条流量为什么走了某个出口、…',
  whenToUse: '当用户要调整分流、添加域名/IP 例外、或解释某条流量为什么走了某个出口时',
  content: routingSkillMarkdown,   // IR 字段说明 + 常见模板 + 陷阱（顺序遮蔽、protocol 需嗅探、geo 数据）
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
})
```

**为什么分两组暴露。** 9 个工具的 schema 合计约 11.4k 字符（≈2.85k token），其中 `check` 与 `write`
各带一份内联的整份规则 schema，两者占 9.2k 字符。这些内联是按 §7.2 的决定做的（不用 `$ref`），
所以换不来更便宜的写法；但它们的结论只有读完 skill 才解释得清：`uncertain` / `opaque` / `missing`
的区别、`patch` 的语义、什么时候回滚。于是：

| 组 | 工具 | 暴露时机 | schema 成本 |
|---|---|---|---|
| 常驻 | `proxy_status`、`proxy_routing_read`、`proxy_nodes_list`、`proxy_latency_test`、`proxy_traffic_read` | 一直 | ≈0.5k token |
| 受控 | `proxy_routing_check`、`proxy_route_explain`、`proxy_routing_write`、`proxy_subscription_add` | `proxy-routing` 加载后 | ≈2.4k token |

实现见 `src/activation.ts`：`ctx.tools.register(definition, { when })` 每步求值一次，false 时工具从
schema、PTC 绑定与执行里一起消失。解锁有四条路径 —— 模型 `skill` 调用成功（`tools/result`）、
用户 `/proxy-routing` 显式调用（`session/event` 的 `skill-invocation`）、请求头里已有声明
（native 模式的 resume / fork）、以及 `toolExposure: 'always'` 关掉整套机制。PTC 的请求头只有
`run_code`，所以分叉后要重新加载 skill，正文里写明了这点。

分类边界不是"读与写"，而是"schema 是否便宜 + 用法是否要先读文档"：`proxy_routing_read` 是只读的但常驻，
因为它最常被先问到；`proxy_route_explain` 也是只读的但受控，因为它的四种结论需要 skill 解释。

### 7.4 一次真实闭环

用户："openai 和 anthropic 走美国节点，公司域名直连，广告全拦。"

```
1. proxy_nodes_list            → 出口有 us / hk / direct / block
2. proxy_routing_read          → 现有 4 条规则
3. proxy_routing_check         → 校验候选 upsert：
     { id:"ads",  match:{domain:["geosite:category-ads-all"]}, out:"block" }
     { id:"ai",   match:{domain:["geosite:openai","domain:anthropic.com"]}, out:"us" }
     { id:"corp", match:{domain:["domain:corp.example"]}, out:"direct" }
   返回：2 条 ok，1 条 warning（geosite:openai 依赖 geosite.dat）
4. proxy_routing_write(patch, upsert:[...], apply:true)
   → 内核重启成功；diff 显示新增 3 条、顺序符合预期
5. proxy_route_explain(domain:"api.openai.com")
   → 命中 id=ai → us
6. proxy_route_explain(domain:"intranet.corp.example", port:443)
   → 命中 id=corp → direct
```

第 3、5 步是这个方案相对 v2rayA 的真正增量：**规则在被应用之前就能被证明是对的**。

## 8. 内核生命周期

```
stopped ──start──► starting ──端口就绪──► running
                      │                     │
                      └──超时/退出──► error └──apply──► restarting（失败自动回滚）
```

- **启动**：生成 `config.generated.json`（0600）→ `xray -test -config` → `ctx.subprocess.spawn` → 轮询端口（500ms × 6）→ running。
- **重启**：`terminate()` → `waitForExit()` → 重新 spawn。xray 不支持热加载配置，所以必须重启。
- **回滚**：保存旧 IR 与新 IR，新配置启动失败时写回旧 IR 再启动一次，把内核 stderr 尾部返回给调用方（与 v2rayA 的 `ApplyCoreConfig` 同款语义）。
- **崩溃**：`done` resolve 且非主动停止 → 状态转 error，记录 exitCode 与 stderr 尾部，不自动重启（避免代理环路时无限重启）。
- **退出清理**：`ctx.effect` 的 disposer 里 terminate + `waitForExit`，插件卸载后不残留进程。

配置骨架：

```json
{
  "log": { "loglevel": "warning", "access": "<dataDir>/access.log" },
  "inbounds": [
    { "tag": "socks", "listen": "127.0.0.1", "port": 10808, "protocol": "socks", "settings": { "udp": true } },
    { "tag": "http",  "listen": "127.0.0.1", "port": 10809, "protocol": "http" },
    { "tag": "rule-socks", "listen": "127.0.0.1", "port": 20172, "protocol": "socks",
      "settings": { "udp": true }, "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] } }
  ],
  "outbounds": [
    { "tag": "proxy",  "protocol": "<选中节点的协议>", "settings": {}, "streamSettings": {} },
    { "tag": "direct", "protocol": "freedom" },
    { "tag": "block",  "protocol": "blackhole" }
  ],
  "routing": { "domainStrategy": "IPIfNonMatch", "rules": [] }
}
```

`proxy` 一项由选中节点展开（vmess/vless/trojan/shadowsocks 各自结构见 `lib/nodes`）；没有选中节点时拒绝启动并返回明确错误，但规则校验与仿真不依赖内核，仍可用。

### 8.1 连接记录（访问日志）

`log.access` 是「某网址/IP 到底走没走代理」的唯一事实来源：内核每接受一条连接写一行，
行尾方括号里就是实际参与的 tag。本机 xray 26.11.9 实测格式（不是推测）：

```
2026/11/26 09:32:47.495539 from tcp:127.0.0.1:56396 accepted tcp:127.0.0.1:18099 [socks -> direct]
2026/11/26 09:34:54.691686 from udp:127.0.0.1:51067 accepted udp:127.0.0.1:18444 [socks -> proxy]
2026/11/26 09:32:47.526721 from 127.0.0.1:56400 accepted http://localhost:18099/ [http -> proxy]
2026/11/26 09:36:34.554696 from 127.0.0.1:56527 accepted //localhost:18099 [http -> direct]
```

生命周期：插件把 `access` 写进生成的配置 → `xray -test`（会顺带创建空文件）→ 启动前
`prepare()`（超过 8MiB 截断，否则记下当前 EOF）→ spawn 后 400ms 轮询读增量 → 停止/退出时
做最后一次 drain。文件是 O_APPEND 的、内核不轮转，所以偏移与上限都由插件自己管；内存里
保留最近 1000 条，过滤与汇总在服务端做。

边界（界面与工具都照实写）：

- 只有经本插件 SOCKS/HTTP 端口的连接可见；绕过代理的流量不可见。
- HTTPS 只能看到 `host:port`；明文 HTTP 的路径会被嗅探出来，展示前脱敏查询串。
- 客户端自行解析 DNS 时只有 IP；嗅探出的 SNI 参与路由但**不进访问日志**（实测：规则
  `domain:example.com` 命中并走 proxy，日志行仍是 `tcp:127.0.0.1:18443`）。
- 无字节数、无规则 id；keep-alive 是一条连接一行，不是一次请求一行。
- 后台的端口就绪探测不产生日志行（实测），不会污染列表。
- 每个条目入队时快照 `proxy` 出口当前的节点名，重启换节点不会改写历史记录的展示名。


内核可替换：`coreBinary` 指向任意兼容实现即可。上游 xray 已带 `proxy/tun`，阶段 4 做全局模式不需要换内核；只有要用 v2rayA fork 的 `dns_module`/`tun-mips` 私有字段时才需要分支，现在不预留。

## 9. 存储与密钥

用 DSH 的存储域，不自己找文件路径：

```js
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const proxyDomain = defineDomain({
  name: 'dsh-proxy',
  version: 1,
  tables: {
    nodes: domainTable(nodeSchema),                 // 非敏感元数据
    subscriptions: domainTable(subscriptionSchema), // URL 只存引用
  },
  // 规则整体放 global：顺序是语义的一部分，必须原子更新
  global: { schema: settingsSchema, initial: { routing: { default: 'proxy', rules: [] }, selectedNode: null } },
})
```

- **规则**放 `global`，因为 `rules[]` 的顺序就是匹配顺序，拆成表会引入"顺序存哪"的第二份真相；整份原子写更简单。
- **非敏感**：节点地址/端口/协议、分组、UI 偏好 → storage domain。
- **敏感**：订阅 URL（可能含 token）、节点 UUID/密码/REALITY 私钥 → `ctx.credentials`，domain 里只存 `secretRef`；凭据服务若不接受自定义键，退化为 `$DSH_HOME/proxy/secrets.json`（0600）。
- **运行时文件**：`$DSH_HOME/proxy/`（0700）放 `config.generated.json`、`config.last-good.json`、geo 数据、`audit.log`。不写工作区，不写 `cordis.patch.yml`。
- **脱敏**：工具返回、日志、UI 都不出现完整 UUID/password/订阅 token；订阅 URL 只显示 `https://host/***`。

## 10. UI

侧栏新增一个面板图标（`sidebar.panellist`，id `proxy`）+ 主面板（`main`，key `proxy`），`sidebar.panellist.trailing` 显示内核是否在跑。

```
┌ 代理 ────────────────────────────────────────────────────┐
│ ● 运行中  xray 26.11   10808 socks / 10809 http  [重启]    │
├ 规则 ─┬ 节点 ─┬ 连接 ─┬ 日志 ──────────────────────────┤
│  1  [x] 拦截广告      domain geosite:category-ads-all  block│
│  2  [x] 国内直连      domain geosite:cn + ip geoip:cn  direct│
│  3  [x] AI 走美国     domain geosite:openai, …           us │
│  4  [ ] 公司内网      domain domain:corp.example       direct│
│                                        [+ 新增] [校验] [应用]│
└──────────────────────────────────────────────────────────┘
```

- **规则 tab**：列表 + 行的启用开关 + 行内编辑（条件用标签输入，不用自由文本）；拖拽或"上移/下移"调整顺序。不做带行号的文本编辑器。
- **应用**：先 `check`，有 error 禁用；有 warning 允许但二次确认；应用后 toast 显示变更条数。
- **仿真**只保留 agent 工具 `proxy_route_explain`（与 `service.explain` 同一实现）；HTTP `POST /proxy-api/explain` 仍在，供排查时直接查一条流量。面板不再提供「模拟」页签。
- **连接 tab**：`GET /proxy-api/traffic` 返回访问日志里的最近连接（最新在前），顶部按域名/IP 与出口分类过滤，汇总覆盖整个环形窗口；徽标区分代理 / 直连 / 拦截，并显示实际出口的展示名。内核停止后仍显示本次会话的历史，并把 `live` 置 false 说明原因。
- **日志 tab**：`/state` 带回内核与动作日志的尾部（最多 500 行），点明每条连接的出口去「连接」页签看。
- 客户端取数走 `fetch('/proxy-api/state')`（同源 cookie，`auth: 'required'`），不引 typert 代码生成；状态轮询 2s，页面隐藏时暂停。
- **按钮**：所有操作按钮统一黑底白字（主操作 / 危险 / 图标形态只保留语义与尺寸差异），悬停提亮、禁用半透明；页签是导航，仍用下划线选中样式。
- **实现**：`src/client.tsx` 只做注册，`src/ui/Panel.tsx` 摆骨架、四个页签各自成文件，规则/节点的数据与副作用收在 `src/ui/use-proxy-panel.ts`，「连接」页签在 `src/ui/use-traffic.ts`；样式写在 `.module.css`（构建期换哈希类名、物化时自注入，见 `docs/dsh-css-architecture/02-build-time-css-pipeline.md`），文案走 `ctx.locale` 并由 `locale-context.tsx` 接成 React 上下文。控件按插件规范自写（不 import `dsh-client-ui-primitives`）：颜色取 `--dsw-alias-*` 令牌跟随主题，按钮固定黑底白字。
- **显示名**：界面上一律显示节点名字，`out` / `<option value>` 仍是出口名；两套兜底（宿主 `nodeLabel()`、浏览器 `src/ui/labels.ts`）保证半部不同批更新时也不渲染成空白。

## 11. 安全与权限

| 风险 | 缓解 |
|---|---|
| 规则把流量导向任意服务器（含内网） | 出口只允许已配置项；`ext:` 路径限制；应用前 UI 展示 diff |
| 订阅 URL / 节点密钥泄漏到日志或工具输出 | 统一脱敏层；工具返回结构化字段而非原始 URL |
| 内核绑定到 0.0.0.0 变开放代理 | `listen` 固定 `127.0.0.1` |
| DNS 泄漏 | 默认 `domainStrategy: IPIfNonMatch` + 内置 DNS 段；不开放随意改 |
| 自动下载二进制被投毒 | 默认不下载；用户显式触发 + SHA256 校验 + 展示来源 URL |
| 改系统代理/防火墙 | MVP 不做；阶段 4 必须是用户点击 + 单独确认 |
| 插件崩溃留下孤儿进程 | disposer 里 terminate + `waitForExit`；启动时清理上次 PID 文件 |

## 12. 实施计划

| 阶段 | 内容 | 工作量 | 验收标准 |
|---|---|---|---|
| 0 骨架 | bundle 可安装、侧栏出现"代理"、页面渲染"内核未运行"、`/proxy-api/state` 返回 JSON | 0.5–1 人日 | 安装返回 `applied`；刷新页面看到入口；`curl /proxy-api/state` 200 |
| 1 规则引擎 | IR schema、编译、语义检查、explain + 三个只读工具 | 1.5–2 人日 | ≥ 40 条单测（字段校验、前缀约定、顺序遮蔽、`ext` 逃逸、禁用规则）；explain 对 20 个样例流命中预期 id |
| 2 节点与内核 | 订阅解析、outbound 生成、`-test`、启停、应用+回滚、`proxy_nodes_list`、`proxy_routing_write` | 2–3 人日 | 导入真实订阅 → 启动 → `curl --socks5-hostname 127.0.0.1:10808 https://example.com` 成功；写坏规则后旧规则仍生效 |
| 3 体验 | 三个 tab、行内编辑、diff、状态点、日志流、zh/en 文案、图标、详情页 | 2 人日 | 按 DSH 的 UI 走查清单过一遍；错误态可复现 |
| 4 可选 | geo 解析、模板库、TUN/全局模式、系统代理 | 3–5 人日 | 分平台验收 |

MVP 合计约 **4–6 人日**。阶段 1 与阶段 2 可并行：前者是纯函数，后者依赖外部内核。

## 13. 风险与未决项

1. **本机没有 xray**（`brew info xray` 可装 26.11.9）。先定二进制来源：`brew install xray`、用户自备路径、或显式授权的下载。不解决，"应用规则"只能做到生成配置。
2. **DSH 处于 alpha**（0.2.3-alpha.2）。`engines.dsh` + peerDependencies 固定版本，升级按 `references/upgrading.md` 回归。
3. **xray 字段漂移**。xray 用日期版本（26.x），不要写死老的 1.8；以实测版本为下限，`-test` 兜底。
4. **`protocol` 匹配依赖嗅探**，且嗅探会改写目标地址；仿真结果必须标注这一前提。
5. **geo 数据体积与来源**（geosite.dat 数 MB）；MVP 只做存在性检测，阶段 4 再解析。
6. **迁移成本**。没有 RoutingA 导入器，v2raya 老用户要靠模型转写（§6.6）；这是接受的取舍，不进 MVP。
7. **订阅格式的熵**。Clash YAML、hysteria2、tuic 先明确不做，工具返回"不支持"而不是猜。
8. **peer 依赖能否在 profile 里解析**。阶段 0 先验证 `@deepseek-ai/dsh-storage-domain` 与 `zod` 能 import；不行就走两条退路之一：用一个手写的 `{ parse, safeParse }` 校验对象喂 `defineDomain`（不引 zod），或整体退化为 `$DSH_HOME/proxy/state.json`（原子写 + 0600）。
9. **不做全局模式时的预期管理**。MVP 只改 SOCKS/HTTP 端口，用户可能误以为整机已走代理；UI 必须明说"仅代理显式连接该端口的应用"。

## 14. 建议的下一步

先做**阶段 0 + 阶段 1**：不碰内核也能交付"读规则、校验规则、解释规则"三件事，风险最低，且能立刻验证"DSH 会写路由"这个核心命题。规则模型稳定后再接节点和内核——那时才需要定 xray 二进制怎么来。
