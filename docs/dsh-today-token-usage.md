# dsh-today-token-usage

记录 **DSH 发出的每一次大模型请求**的 Token 用量与费用，并在会话面板里显示宿主**今天**与
**本月**的合计：总用量、请求数、缓存命中、未缓存输入、缓存读取、缓存写入（非零时）、输出，
以及按 DeepSeek 官方峰谷价逐笔算出的费用。

```text
会话面板
├─ 环境
├─ 改动请求
├─ 子智能体
└─ 今日 Token 用量
    切换本月        ›
    总用量          326M
    请求数          1.3K
    缓存命中        99%
    未缓存输入      2.7M
    缓存读取        320M
    输出            1.1M
    费用            ¥4.61
```

点「切换本月」后同一栏换成当月累计，分区标题也换成「本月 Token 用量」：

```text
本月 Token 用量
    ‹ 切换今日
    总用量          9400M
    请求数          28K
    缓存命中        99%
    …（未缓存输入 / 缓存读取 / 输出）
    费用            ¥131.06
```

> 切换行为什么贴着标题、而不是放进标题右侧：面板的标题 trailing 位在悬停时会被拖拽手柄
> 替换（`visibility: hidden`），控件放那里点不到；第一行是面板行契约里最靠近标题的可点位置。

> 一句话分工：宿主半部在 `llm/stream` 上拦下每一次模型调用，把用量按天追加到 JSONL（保留
> 35 天），逐笔按 DeepSeek 官方峰谷价折成人民币，维护当日与当月两份合计，并把每月汇总写进
> `months/YYYY-MM.json`；浏览器半部经同源、owner-only 的 SSE 长连接
> （`GET /today-token-usage/stream`）一次收到当日 + 当月读数，面板只做本地切换。
> 面板与 journal 是同一个数，费用也在宿主侧只算一次。

-----

## 它记录哪些请求

采集点是 `llm/stream` waterfall——DSH 里所有模型调用的唯一必经之路：

| 请求来源 | `purpose` | 旧版（会话投影）是否统计 |
|---|---|---|
| 主对话、子智能体（每一步） | 无 | 是（assistant/message、assistant/attempt） |
| 会话标题生成 | `session-title` | **否**（用量根本没写进会话日志） |
| 压缩摘要 | `compaction` | **否**（用量只在 `compaction/summary` 事件里） |
| 时间线报告 | `timeline-report` | 否 |
| auto-review | `auto-review` | 否 |
| 其它插件直接 `ctx.llm.stream()` 的调用 | 取决于调用方 | 否 |

口径：一次 `llm/stream` 调用 = 一条记录。用量取流里**最后一个** `usage` 块（provider 真正
回报的值）；没有回报用量的请求（失败、取消且 provider 未回报）没有 Token 可记，不落行、也
不计入「请求数」。重试的每一次尝试都是独立的模型调用，各记一条，与 provider 实际收到的请求
一一对应。「本月」是同一口径在月内的累加。

-----

## 数据从哪来，怎么到面板

```text
ctx.llm.stream(options)
  → llm/stream waterfall（宿主半部：global 监听，append 在链路里）
  → tapStream：chunk 原样透传，记住最后一个 usage / finish
  → store.record：同步更新当天与当月内存合计（含逐笔计价）+ 串行 append 一行 JSONL
                  + 节流写一份月度汇总（首次待写后最多 2 秒，跨月时立即写）
  → GET /today-token-usage/stream（auth: required + owner 校验，SSE 长连接）
  → 每次记录成功推一帧 { 当天读数, 当月累计 }（跨零点也推新一天的空读数）→ 面板
  → 面板点「切换本月 / 切换今日」只切本地视图，不再发请求
```

为什么不再用会话投影：

| 方案 | 结论 |
|---|---|
| 会话投影折 `assistant/message` | 标题生成的用量不在日志里，压缩摘要的用量在别的事件里：**永远统计不全** |
| 浏览器直接读 journal | 浏览器没有宿主文件权限 |
| 自定义 `ctx.remote` 命名空间 | 构建期按包选定，第三方插件挂不上 |
| **`llm/stream` 拦截 + 同源 SSE 推送（本实现）** | 覆盖所有请求；宿主 `webServer` 是公开服务，路由带 cookie 鉴权且只认 owner，页面无需轮询 |

两条路由：

| 路径 | 形态 | 用途 |
|---|---|---|
| `GET /today-token-usage/stream` | `text/event-stream` 长连接，每帧 `data: {...}` | 页面接收推送（连接建立先补发当前快照；一帧里同时有当天与当月） |
| `GET /today-token-usage/today` | 一次性 JSON | curl / 排障 / 兜底 |

路由安全：`auth: 'required'`（请求必须是活着的 Peer，浏览器靠会话 cookie 过
`webserver/authorize`），处理函数再校验 `peer.principal.kind === 'owner'`；只接受 GET，响应
`cache-control: no-store`，不返回会话内容，只有聚合数字。DSH 的 web server 明确把
`text/event-stream` 排除在 gzip 之外，长连接不会被压缩缓冲；空闲时每 15 秒写一行注释帧保活。

-----

## 落盘：日 JSONL 保留 35 天，月汇总不清理

**日文件**（当天读数与重启恢复的来源）：

- 目录：`$DSH_HOME/state/today-token-usage/`（`$DSH_HOME` 优先，否则 `~/.dsh`；目录 0700）。
- 文件：`requests-YYYY-MM-DD.jsonl`（宿主本地日期），文件 0600，一行一个请求：

```json
{"v":1,"time":1795578…,"day":"2026-11-25","provider":"opencode-go","model":"deepseek-v4.1-flash","reasoningEffort":"max","sessionId":"session-…","purpose":"session-title","finish":"stop","usage":{"inputTokens":1234,"outputTokens":456,"cacheReadTokens":7890,"cacheWriteTokens":0}}
```

- 只存元数据与用量：**不存 prompt、消息内容或凭据**，也不存费用（费用是派生值，见下一节）。
- 保留**今天 + 前 34 天**共 35 个日文件；更早的文件在插件启动与跨天时自动删除。多留几天是为了
  月度汇总缺失 / 损坏时还能把整月重算出来（最长的一个月 31 天）。目录里其它文件不动。
- 启动时读回当天文件恢复当天合计（行解析失败跳过并告警一次），所以 DSH 重启不丢当天数字。

**月汇总**（面板的「本月」视图与以后的历史读取都靠它）：

- 文件：`months/YYYY-MM.json`，一个月一个，约几百字节，**不随日文件清理**。
- 跨月时立即写、首次待写后最多 2 秒必写一次（节流，连续流量也不会一直向后推）、退出时最后写一次；写盘用「临时文件 + rename」。
- 形状（`totals` 是整月累计，`checkpointDay` / `checkpoint` 是写入时刻当天的读数）：

```json
{"v":1,"month":"2026-11",
 "totals":{"requests":2871,"uncachedInputTokens":17555452,"outputTokens":5299489,
           "cacheReadTokens":725517815,"cacheWriteTokens":0,
           "cost":{"total":98.218137,"peak":89.925077,"offPeak":8.293059,"unpricedRequests":0}},
 "checkpointDay":"2026-11-27",
 "checkpoint":{"requests":2127,"uncachedInputTokens":6122890,"outputTokens":2033746,
               "cacheReadTokens":287717903,"cacheWriteTokens":0,
               "cost":{"total":39.2516,"peak":36.5,"offPeak":2.75,"unpricedRequests":0}}}
```

- **同日重启对账**：journal 的追加是异步的，月度汇总的最后一次写入可能晚于它。启动时若
  `checkpointDay` 就是今天，把 `checkpoint` 换成本地当天文件里的全量读数——既不重复也不漏计。
- **更早的 checkpoint 走重建**：`checkpointDay` 早于今天、没有 checkpoint、汇总损坏（版本不符、
  字段坏、JSON 坏）或月份对不上时，差额法补不回中间那些天，直接扫本月日文件重算一份并写回；
  当月日文件都在 35 天保留期内，31 个文件一遍读完。
- **今天的日文件读不出来时不覆盖**：月汇总里今天的读数无从核对，拿 0 去替换会把今天抹掉，写回
  偏低的 checkpoint 又会让下次重启重复计数。这种情形沿用汇总原值，本次进程不覆盖月文件（只告警）。
- **重建不完整时不覆盖**：有日文件读不出来时，重建结果只在内存里用，不写回磁盘——避免用偏小的
  合计覆盖掉更大的汇总。
- 写盘失败只告警一次：下次记录会再排一次，退出时还会再写一次；面板仍按内存合计显示，模型调用
  不受任何影响。

-----

## 费用：官方价目表 + 峰谷计价

价格抄自 [DeepSeek 官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)（2026-11-27
核对），单位「元 / 百万 token」，每格是「空闲 / 高峰」：

| 模型 | 输入·缓存命中 | 输入·缓存未命中 | 输出 |
|---|---|---|---|
| `deepseek-flash`（DeepSeek-V4.1-Flash-1017） | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro`（DeepSeek-V4-Pro-0813） | 0.15 / 0.30 | 4.5 / 9 | 13.5 / 27 |

- **峰时**：北京时间周一至周五（不含中国法定节假日）09:00–12:00、14:00–18:00；其余时段，
  含周末与节假日全天，都是**空闲时段**，价格是峰时的一半。调休上班的周末仍按周末算空闲
  （官方口径：周末全天空闲）。
- **逐笔计价**：每个请求按自己的模型、完成时刻与四个 Token 桶单独算，再相加；金额不四舍五入
  到分，面板最后按量级显示两位 / 四位 / 六位小数。当天与当月用的是同一套单价。
- **峰谷按完成时刻**（journal 的 `time`）判定：跨 12:00 / 18:00 边界的请求整笔记在完成时段。
- **缓存写入**按未命中输入价计。DeepSeek 不单独收这一桶（实际恒为 0），换别的提供方时这是
  不会漏算的保守近似。
- **模型名归一**：`deepseek-flash`、`deepseek-v4.1-flash`、`deepseek-v4-flash`（旧名）、
  `deepseek/deepseek-v4.1-flash`（带厂商前缀）都按同一行计价。
- **不认识的模型**只计 Token、不计费用：当日 / 当月费用全是 0 时面板写「—」，不会把
  「没有价目表」显示成「免费」。
- **节假日表**只收录政府已公布年份（当前 2026，来自
  [国办发明电〔2025〕7 号](https://www.gov.cn/zhengce/content/202511/content_7047090.htm)）；
  未收录的年份退回「周内 + 钟点」规则，落在工作日的法定假日会被当成峰时（偏保守）。新年度
  安排公布后，在 `src/pricing.ts` 的 `HOLIDAY_RANGES` 补一段区间即可。
- **口径边界**：这是官方**刊例价**，不含账户级折扣、赠送余额、汇率或其它渠道加价；峰谷按
  北京时间判定，与宿主进程的本地时区无关。
- **费用不写进日 JSONL**：日文件只存 Token 与请求身份；月汇总里的费用是整月累计值，日级费用
  随时可以从日文件重算。

-----

## 读数口径：与「用量」按钮一致

一致性是这一栏的设计约束，而不是巧合。算式与格式逐条照抄上游
`@deepseek-ai/dsh-client-ui-chat`：

| 项 | 规则 | 上游出处 |
|---|---|---|
| 总用量 | 未缓存输入 + 缓存读取 + 缓存写入 + 输出 | `UsagePill` 的 `billedInputTokens(usage) + usage.outputTokens` |
| 紧凑格式 | `<1000` 原样；`<1M` 用 `K`（百位以上取整、其余一位小数）；否则 `M` | `token-format.ts` 的 `formatTokens` |
| 单位 | 小于 1000 显示原数，千级 `K`、百万级 `M`，**不带 `tok` 后缀**（本栏自己的取舍；上游按钮读数是 `{count} tok`） | 本插件 `src/aggregate.ts` |
| 缓存命中 | 缓存读取 ÷ 输入侧三桶之和；**部分命中不会被舍入成 100%**（自动加位区分到 100 以下） | `formatCacheHitPercent` |
| 请求数 | 当天 / 当月回报了用量的模型调用次数，按同一套 K / M 紧凑格式 | 本插件 |
| 费用 | 逐笔按模型与峰谷计价后相加（元），只显示总额；峰谷单价影响金额本身，不再单独拆行 | 本插件 `src/pricing.ts` |

「用量」按钮开关（设置 → 通用设置 → 性能与用量）里的**简洁 / 详细**只作用于那条按钮；这一栏
始终是「详细」形态的读数，因为面板里没有悬浮对话框可放详表。

-----

## 面板行为

| | 行为 |
|---|---|
| 位置 | 槽位 `conversation.session.panel.section`，`id: today-usage`，`order: 310`（排在「后台任务」的 300 之后，换标题时位置不动） |
| 出现时机 | 当天总用量大于 0 时显示；没有数据（或宿主暂时没给）时整节渲染为空——面板连标题一起隐藏（切换入口也随之不可见） |
| 标题 | 今日视图「今日 Token 用量」，本月视图「本月 Token 用量」。标题由面板从注册项读，切换时重新注册同一 `id`（`order` 不变）换掉 |
| 今日内容 | 首行「切换本月」；随后一项指标一行：图标 + 标签在左、数值右侧；总用量、请求数、缓存命中、未缓存输入、缓存读取、缓存写入（为 0 时不占行）、输出、费用（只显示总额） |
| 本月内容 | 首行「切换今日」，下面是同一套指标行（没有「本月合计」行，月份写在标题里） |
| 切换 | 「切换本月」「切换今日」都贴着分区标题放在第一行，是整行按钮（`button` + `data-row-part="body"`，按压区覆盖整行）：只切本地视图，不发请求、不重新拉数据 |
| 更新 | **宿主推送**：连接建立即收到当前快照（当天 + 当月），之后每次记录更新推一帧；跨零点推新一天的空读数（当月累计保留）。断线由浏览器自动重连，重连后宿主补发当前快照；卸载时关闭连接 |
| 失败 | 保留上一次成功读数；从未成功过则整节为空。路由未就绪、401/403、HTML fallback、坏 JSON、缺 `month` 的载荷都按「暂时没有数据」处理 |
| 日期边界 | 宿主进程的本地时区：日界决定「今天」，月界决定「本月」；峰谷按北京时间判定 |
| 读屏 | 每行连续文本：`总用量 326M`、`缓存命中 99%`、`费用 ¥4.61`……；可点的行是带 `aria-label` 的 `<button>`，图标对辅助技术隐藏 |

-----

## 实现文件

| 文件 | 职责 |
|---|---|
| [`index.ts`](../dsh-today-token-usage/index.ts) | 宿主入口：解析 journal 目录并装配记录器 |
| [`src/install.ts`](../dsh-today-token-usage/src/install.ts) | 接线：`llm/stream` global 监听、journal store、路由注册（`webServer` 可选） |
| [`src/tap.ts`](../dsh-today-token-usage/src/tap.ts) | 用量旁路：chunk 原样透传、结算只回调一次、旁路失败不影响模型流 |
| [`src/journal.ts`](../dsh-today-token-usage/src/journal.ts) | journal 词汇：记录格式、文件名、容错解析、当天合计与按日折价（纯模块） |
| [`src/pricing.ts`](../dsh-today-token-usage/src/pricing.ts) | 价目表、北京时间峰谷判定（含节假日）、逐请求计价（纯模块） |
| [`src/month.ts`](../dsh-today-token-usage/src/month.ts) | 月度汇总的纯逻辑：当月累计、汇总文件编解码、重启对账（纯模块） |
| [`src/month-store.ts`](../dsh-today-token-usage/src/month-store.ts) | 月度汇总的落盘与重建：`months/YYYY-MM.json` 的读写、扫日文件重算 |
| [`src/store.ts`](../dsh-today-token-usage/src/store.ts) | 落盘存储：读回、追加、当天 / 当月合计、节流写月汇总、重启对账、跨天跨月、35 天清理、失败降级 |
| [`src/paths.ts`](../dsh-today-token-usage/src/paths.ts) | `$DSH_HOME` 解析与 journal 目录 |
| [`src/route.ts`](../dsh-today-token-usage/src/route.ts) | 两条 owner-only 路由：JSON 快照 + SSE 推送（扇出、保活、零点补发、断开清理） |
| [`src/web-types.ts`](../dsh-today-token-usage/src/web-types.ts) | `ctx.webServer` 的最小结构化类型（不引入宿主包依赖） |
| [`src/wire.ts`](../dsh-today-token-usage/src/wire.ts) | 两侧共享词汇：路由路径、当天 / 当月读数、费用拆分、守卫、日期与四桶算式（纯模块） |
| [`src/aggregate.ts`](../dsh-today-token-usage/src/aggregate.ts) | 纯计算：读数 → 面板合计、紧凑格式、缓存命中百分比、人民币格式 |
| [`src/usage-client.ts`](../dsh-today-token-usage/src/usage-client.ts) | 浏览器收推送：SSE 订阅、坏帧守卫、全页共用一条连接并缓存最近一帧 |
| [`src/client.ts`](../dsh-today-token-usage/src/client.ts) | 浏览器入口：注册字典、等分区槽、注册分区；切换视图时重新注册以换标题 |
| [`src/view.ts`](../dsh-today-token-usage/src/view.ts) | 今日 / 本月视图（模块级状态 + 订阅，切换会重建这一节也不丢视图） |
| [`src/component.ts`](../dsh-today-token-usage/src/component.ts) | 分区组件：SSE 订阅、视图切换、九个字形（切换行两种视图共用一个）、按行渲染、空数据隐藏 |
| [`src/registration.ts`](../dsh-today-token-usage/src/registration.ts) | 槽键 / 注册 id / `order` 与注册选项；标题 thunk 跟着当前视图（纯模块） |
| [`src/locales.ts`](../dsh-today-token-usage/src/locales.ts) | 本插件字典（zh / en） |
| [`check-css.mjs`](../dsh-today-token-usage/check-css.mjs) + [`contract.json`](../dsh-today-token-usage/contract.json) | 上游槽、行标记、`llm/stream`、`usage` 块、路由与鉴权、SSE 不被 gzip 缓冲、读数口径的静态契约（18 条） |

宿主半部用 `inject = ['llm']`：模型调用服务缺席时整项不激活。`webServer` 走可选注入：没有它
时只记录、不开路由（非 web composition）。浏览器半部用 `inject = ['slots', 'locale']`，
`dsh.client.platform = web`、`immediately: true`。

这一栏不挂样式表：行直接吃会话面板给 `[data-session-panel-row]` / `[data-row-part]` 铺的通用
规则，图标 16px，颜色随行文字，明暗主题自动跟随。

-----

## 契约与静默失败

面板槽、行标记（含按钮 body）、`llm/stream`、`usage` 块、`ctx.webServer.register`、
`webserver/authorize`、cookie 鉴权提供方，以及「用量」按钮的读数口径，都是**改名即静默退化**的
上游事实：拦截点没了一次请求也记不到，鉴权链路没了页面拿不到数据，口径变了面板与按钮各说各话，
行标记没了切换行不可点。
[`contract.json`](../dsh-today-token-usage/contract.json) 把这 17 条事实列成清单，
`pnpm check:css` 逐条对 DSH 安装产物 grep 一遍，缺一条就显式失败并写明后果。

-----

## 验证

```bash
pnpm --filter dsh-today-token-usage build      # 产出 lib/client.js（浏览器半部）
pnpm --filter dsh-today-token-usage typecheck  # tsc --noEmit
pnpm --filter dsh-today-token-usage test       # 12 个测试文件
pnpm --filter dsh-today-token-usage check:css  # 17 条上游契约
```

测试覆盖：

| 文件 | 覆盖 |
|---|---|
| `test/journal.test.mjs` | 编解码往返、坏行/错版本/错日期跳过、四桶合计与逐笔计价、文件名与日期偏移、用量规整 |
| `test/month.test.mjs` | 当月累计、汇总文件编解码与损坏拒绝、同日对账、checkpoint 可用性判定、`months/` 原子写读、扫日文件重建 |
| `test/pricing.test.mjs` | 价目表别名、峰谷窗口边界、周末与节假日、`TZ` 无关性、缓存写入与未知模型计价 |
| `test/tap.test.mjs` | chunk 原样透传、最后一个 usage/finish、抛错与提前 break 都结算一次、回调抛错不影响流 |
| `test/store.test.mjs` | 追加、重启恢复、跨天 / 跨月、35 天清理、月汇总落盘与重启恢复、汇总损坏回退、隔天重启补回中间那天、重建后写回不是空汇总、今天文件缺失不覆盖月文件、磁盘不可写降级、NaN 规整、变化订阅 |
| `test/route.test.mjs` | 两条路由的 owner-only / 405 / 500；SSE 初始快照、扇出、断开清理、保活 |
| `test/usage-client.test.mjs` | SSE 订阅路径、合法帧回调、坏帧忽略、缺 `month` / `cost` 的载荷拒绝、取消订阅关闭连接、全页共用连接与帧缓存 |
| `test/view.test.mjs` | 默认今日、切到本月时标题 thunk 读新标题、重复切换不通知、取消订阅 |
| `test/aggregate.test.mjs` | 读数 → 面板合计、当月合计、紧凑格式、人民币格式、缓存命中（含不许舍入成 100% 的两个端点） |
| `test/plugin-apply.test.mjs` | 真 `apply`：global `llm/stream` 监听、journal 落盘、两条路由、SSE 初始帧与推送（当天 + 当月）、退出时月汇总落盘 |
| `test/artifact-client.test.mjs` | 产物模块 id / 声明 / 字典 / 分区注册 |
| `test/render.test.mjs` | 真 React 渲染：首行「切换本月 / 切换今日」、七项指标 + 费用总额、没有「本月合计」与两行行、未计价「—」、空数据、无告警 |

挂载后建议的肉眼检查：面板里出现「今日 Token 用量」一栏；发一条消息后「总用量」「请求数」「费用」
变大；点第一行「切换本月」看到当月累计、标题变成「本月 Token 用量」、第一行变成「切换今日」；宿主日志无告警；
`$DSH_HOME/state/today-token-usage/requests-<今天>.jsonl` 出现新行（标题生成的请求 `purpose` 是
`session-title`），`months/<本月>.json` 在记录停下约 2 秒后出现。SSE 可以用 curl 直接看：

```bash
curl -N -H "Cookie: <会话 cookie>" http://127.0.0.1:3080/today-token-usage/stream
```

-----

## 已知边界

- **记录从插件生效那一刻开始，不回填。** 面板不再回放会话日志或投影缓存：插件生效之前今天
  已经发生的用量不会补进 journal（标题生成的用量本来就没有日志来源），生效之后跨重启由 JSONL
  与月度汇总恢复。这是「所有请求都有一份可查记录」换来的取舍。
- **只有 web 客户端有这个面板。** 客户端平台是 web；非 web composition 里宿主仍会记录（如果
  插件被挂载），但没有这一栏。
- **日期边界跟宿主进程的本地时区。** 浏览器在别的时区打开也按宿主日界 / 月界切分。
- **同一 `$DSH_HOME` 下只假设一个宿主进程。** 多个 DSH 进程同时运行时，各进程只统计自己发出
  的请求，内存合计不跨进程合并（journal 文件是共享的，重启后会读到彼此写入的行）。
- **面板只显示今天与本月。** 过去的月份已经写进 `months/YYYY-MM.json`，本期没有读取入口；
  将来需要时可以直接读这些文件（格式见上文）。
- **月度汇总最多滞后一个节流窗口（约 2 秒）。** 面板读数始终来自内存合计，不受影响；进程被
  强杀后，重启时用 journal 对账补回：同一天靠 checkpoint 差额，隔了整天则扫本月日文件重建。
  日文件超过 35 天后，月汇总就是唯一的长期记录。
- **本地时钟回拨不换天。** 新日期早于当前合计的日期时只告警一次并停在当前这一天，避免把已
  记下的当天清零、或把记录算到前一天。
- **今天的日文件读不出来时本次运行不覆盖月汇总。** 面板仍显示汇总里的今天；下次重启（文件恢复
  可读）再对账。
- **每个打开的页面保持一条 SSE 长连接。** 断线由浏览器自动重连，重连时宿主补发当前快照；
  长时间没有任何请求时宿主每 15 秒发一行注释帧保活。
- **费用是刊例价估算，不是账单。** 官方价目表 + 峰谷规则逐笔折算，不含账户折扣、赠送余额、
  汇率与渠道加价；节假日表只收录已公布年份（当前 2026），其它年份退回周末规则；峰谷按请求
  **完成时刻**归段。
- **价目表里没有的模型只计 Token。** 当日 / 当月费用全是 0 时费用行写「—」；新增模型时在
  `src/pricing.ts` 的 `MODEL_PRICES` 补一行即可。
- **没有 Config。** 保留天数（35 天）、路由路径、价目表与峰谷规则都写死在代码里。
