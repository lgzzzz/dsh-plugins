/**
 * 随插件分发的 skill：规则语义、模板与陷阱。
 *
 * 工具描述保持短，细节放这里按需加载。schema 提示语同时被工具参数描述引用，
 * 所以只在这一处写清楚。
 */

/** `match` 的字段与语义，工具参数描述直接引用。 */
export const MatchKeysHint =
  '可用字段：domain[]（值可以是 geosite:tag、domain:example.com、full:example.com、regexp:…、ext:文件:tag、keyword:… 或子串）、'
  + 'ip[]（CIDR 或 geoip:tag）、port[]（443 或 1000-2000）、sourcePort[]、network[]（tcp/udp）、'
  + 'protocol[]（http/tls/quic/bittorrent，需要嗅探）、source[]、inboundTag[]。'
  + '数组里任意一个值命中即算命中；不同字段之间是「且」。'

/** 一条规则的结构，工具参数描述直接引用。 */
export const RuleSchemaHint =
  '每条规则是 { id, name?, enabled?, match: {…}, out }：id 只允许 [a-z0-9_-]（≤32 字符）且必须唯一，'
  + 'match 至少一个条件，out 必须是可用出口名（proxy / direct / block 或某个节点 tag）。'

/** 整份规则集的结构，工具参数描述直接引用。 */
export const RoutingWriteSchemaHint =
  '{ default: 出口名, rules: [规则…] }：rules 的顺序就是匹配顺序，首条命中即停，没有规则命中时走 default（默认出口）。'

/** 技能正文。 */
const CONTENT = `# 分流路由规则

规则是结构化数据，不是文本 DSL：

\`\`\`json
{
  "default": "proxy",
  "rules": [
    { "id": "ads", "name": "广告 → 拦截", "match": { "domain": ["geosite:category-ads-all"] }, "out": "block" },
    { "id": "cn",  "name": "国内域名 → 直连", "match": { "domain": ["geosite:cn"] }, "out": "direct" },
    { "id": "ai",  "name": "AI → 代理", "match": { "domain": ["geosite:openai", "domain:anthropic.com"] }, "out": "us" }
  ]
}
\`\`\`

## 加载本技能才会出现四个工具

\`proxy_routing_check\`、\`proxy_route_explain\`、\`proxy_routing_write\`、\`proxy_subscription_add\`
只在 \`proxy-routing\` 技能加载成功之后才进入工具列表。所以在**上一个**步骤里看不到它们是正常的 ——
本轮加载之后，下一步就会看到。\`proxy_status\`、\`proxy_routing_read\`、\`proxy_nodes_list\`、
\`proxy_latency_test\`、\`proxy_traffic_read\` 一直都在。

如果已经把本技能加载过、却仍然看不到那四个工具（例如会话被恢复或分叉过），重新加载一次本技能即可。

## 一条规则怎么读

- \`match\` 里**同一字段的多个值之间是「或」**（数组里任一命中即算命中），**不同字段之间是「且」**。
  所以 \`{ "domain": ["geosite:cn"], "ip": ["geoip:cn"] }\` 表示「域名命中 cn 且 IP 命中 cn」，很少是你想要的；
  想表达「域名或 IP 任一在国内」，写两条规则。
- \`out\` 只能写 \`proxy\`、\`direct\`、\`block\` 或某个节点 tag。可用出口名以 \`proxy_routing_read\` 返回的 \`exits\` 为准；
  同一次返回里的 \`exitLabels\` 给出每个出口的展示名（节点出口显示节点名字），界面上看到的就是它。
  出口名与展示名不是一回事：写进 \`out\` 的必须是出口名。
- \`enabled: false\` 的规则留在库里但不参与编译与仿真。
- \`default\` 是默认出口，必须存在。

## 值的写法（沿用 xray 的约定）

| 写法 | 含义 |
|---|---|
| \`geosite:cn\` | 域名分类，需要 \`geosite.dat\` |
| \`geoip:cn\` | IP 分类，需要 \`geoip.dat\` |
| \`domain:example.com\` | 该域及其子域 |
| \`full:example.com\` | 精确等于 |
| \`regexp:^ad\\.\` | 正则（Go 语法） |
| \`keyword:google\` | 包含子串 |
| \`ext:site.dat:tag\` | 自定义 .dat 里的分类，文件必须放在 geo 目录 |
| 裸字符串 \`example.com\` | 子串匹配 |

## 规则命名

\`name\` 是给人看的标签，整份规则库用同一个格式：\`<对象> → <去向>\`。

- **对象在前，去向在后**，中间是空格 + \`→\` + 空格；去向只写 \`直连\` / \`代理\` / \`拦截\`，
  不写具体节点名，也不写延迟。规则到底落到哪个节点由 \`out\` 决定，面板会在名字之后单独显示节点名；
  把节点名写进 \`name\` 会随换节点一起过时。
- 对象用产品本名、大小写照原样（\`GitHub\`、\`V2EX\`、\`OpenCode\`、\`Command Code\`）；多个对象用 \` / \` 分隔
  （\`Google / YouTube\`）；泛指一组站点时用中文词（\`广告\`、\`内网域名\`、\`国内 IP\`）。
- 不要倒装（不要写「拦截广告」）、不要夹 emoji、版本号、「最快 405ms」这类会变的词。
- 例：\`广告 → 拦截\`、\`内网域名 → 直连\`、\`Google / YouTube → 代理\`、\`OpenCode → 代理\`。
- \`name\` 可省略（界面退回显示 \`id\`），最长 80 字符。

## 推荐流程

1. \`proxy_routing_read\` 看现状与可用出口。
2. 想好改动，先 \`proxy_routing_check\`（与 write 参数完全一致），按 id 修到没有 error。
3. 用 \`proxy_route_explain\` 拿几条真实流量验证：命中哪条、前面的为什么被跳过。
4. \`proxy_routing_write\` 落盘。默认会重启内核；失败会自动回滚。

增量改动用 \`mode: "patch"\`：\`upsert\` 里给完整规则（同 id 就地替换，新 id 追加到末尾），\`delete\` 里给 id。
整份重写用 \`mode: "replace"\`。

## 实际流量 vs 仿真

- \`proxy_route_explain\` 是**预测**：按当前规则仿真一条流量会命中哪条规则。
- \`proxy_traffic_read\` 是**事实**：读内核访问日志，回答「刚才的访问实际走了哪个出口」。
  \`host\` 支持域名 / IP / 明文 HTTP 的路径子串，\`verdict\` 取 proxy / direct / block。
- 访问日志只覆盖经本插件 SOCKS/HTTP 端口的连接；HTTPS 只能看到域名与端口；客户端自行
  解析 DNS 时只记录 IP（哪怕嗅探出的 SNI 实际参与了路由）。绕过代理的流量不可见。

## 常见模板

- 某类站点走指定节点：
  \`{ "id": "openai", "match": { "domain": ["geosite:openai", "domain:anthropic.com"] }, "out": "us" }\`
- 国内直连（域名与 IP 分两条，因为字段之间是「且」）：
  \`{ "id": "cn-domain", "match": { "domain": ["geosite:cn"] }, "out": "direct" }\`
  \`{ "id": "cn-ip", "match": { "ip": ["geoip:cn"] }, "out": "direct" }\`
- 广告拦截：\`{ "id": "ads", "match": { "domain": ["geosite:category-ads-all"] }, "out": "block" }\`
- 公司域名直连：\`{ "id": "corp", "match": { "domain": ["domain:corp.example"] }, "out": "direct" }\`
- 只代理某个端口：\`{ "id": "alt", "match": { "port": ["8443"] }, "out": "proxy" }\`

## 陷阱

1. **顺序遮蔽**：前面的规则先命中。把具体的规则放前面、宽泛的放后面；\`proxy_routing_check\` 会在能证明遮蔽时给 warning。
2. **geo 数据**：用了 \`geosite:\`/\`geoip:\` 但在 geo 目录找不到 \`.dat\` 时 check 只给 warning —— 唯一的裁决是
   \`xray -test\`，失败会回滚规则与内核。数据文件要自己放到 \`~/.dsh/proxy/geo/\`（或配置里的 \`geoDir\`）；
   这个目录里有 \`.dat\` 时会作为 \`XRAY_LOCATION_ASSET\` 传给内核，没有则沿用内核自己的数据目录。
3. **\`protocol\` 依赖嗅探**，而且嗅探会改写目标地址；仿真只能在你显式提供 protocol 时判定。
4. **\`ip\` 条件与 domainStrategy 有关**：默认 \`IPIfNonMatch\`，域名目标会先解析再重试，所以 ip 规则对域名也可能命中。
5. **不要写没有条件的规则**：那会匹配全部流量，默认出口请用 \`default\`。
6. 规则多不等于好：每条规则都要参与匹配，200 条以上会被规模上限拒绝。
`

/** 注册用的技能定义。 */
export const routingSkill = {
  name: 'proxy-routing',
  // 目录里模型只看得到 description，所以触发词必须写在这里，而不是只写进 whenToUse。
  description:
    '调整代理分流规则、给某些域名/IP 加例外、解释某条流量为什么走了某个出口、查某个网址/IP 实际走没走代理、测节点延迟或导入代理订阅时使用。'
    + '加载后会给出 proxy_routing_check / proxy_route_explain / proxy_routing_write / proxy_subscription_add 四个工具，'
    + '以及规则语义、常见模板和陷阱。',
  whenToUse: '当用户要调整分流、给某些域名/IP 加例外、解释某条流量为什么走了某个出口、查某次访问实际走没走代理，或导入代理订阅时',
  content: CONTENT,
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
} as const
