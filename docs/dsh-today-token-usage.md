# dsh-today-token-usage

记录 **DSH 发出的每一次大模型请求**的 Token 用量，并在会话面板里显示宿主**当天**的合计：
总用量、请求数、缓存命中、未缓存输入、缓存读取、缓存写入（非零时）、输出。

```text
会话面板
├─ 环境
├─ 改动请求
├─ 子智能体
└─ 今日 Token 用量
    总用量          326M
    请求数          1.3K
    缓存命中        99%
    未缓存输入      2.7M
    缓存读取        320M
    输出            1.1M
```

> 一句话分工：宿主半部在 `llm/stream` 上拦下每一次模型调用，把用量按天追加到 JSONL（保留
> 30 天）；浏览器半部经同源、owner-only 的 SSE 长连接（`GET /today-token-usage/stream`）接收
> 宿主推送并渲染。
> 面板与 journal 是同一个数。

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
一一对应。

-----

## 数据从哪来，怎么到面板

```text
ctx.llm.stream(options)
  → llm/stream waterfall（宿主半部：global 监听，append 在链路里）
  → tapStream：chunk 原样透传，记住最后一个 usage / finish
  → store.record：同步更新当天内存合计 + 串行 append 一行 JSONL
  → GET /today-token-usage/stream（auth: required + owner 校验，SSE 长连接）
  → 每次记录成功推一帧（跨零点也推新一天的空读数）→ 面板
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
| `GET /today-token-usage/stream` | `text/event-stream` 长连接，每帧 `data: {...}` | 页面接收推送（连接建立先补发当前快照） |
| `GET /today-token-usage/today` | 一次性 JSON | curl / 排障 / 兜底 |

路由安全：`auth: 'required'`（请求必须是活着的 Peer，浏览器靠会话 cookie 过
`webserver/authorize`），处理函数再校验 `peer.principal.kind === 'owner'`；只接受 GET，响应
`cache-control: no-store`，不返回会话内容，只有聚合数字。DSH 的 web server 明确把
`text/event-stream` 排除在 gzip 之外，长连接不会被压缩缓冲；空闲时每 15 秒写一行注释帧保活。

-----

## 落盘：按天 JSONL，保留 30 天

- 目录：`$DSH_HOME/state/today-token-usage/`（`$DSH_HOME` 优先，否则 `~/.dsh`；目录 0700）。
- 文件：`requests-YYYY-MM-DD.jsonl`（宿主本地日期），文件 0600，一行一个请求：

```json
{"v":1,"time":1795578…,"day":"2026-11-25","provider":"opencode-go","model":"deepseek-v4.1-flash","reasoningEffort":"max","sessionId":"session-…","purpose":"session-title","finish":"stop","usage":{"inputTokens":1234,"outputTokens":456,"cacheReadTokens":7890,"cacheWriteTokens":0}}
```

- 只存元数据与用量：**不存 prompt、消息内容或凭据**。
- 保留**今天 + 前 29 天**共 30 个日文件；更早的文件在插件启动与跨天时自动删除。目录里其它
  文件不动。
- 启动时读回当天文件恢复合计（行解析失败跳过并告警一次），所以 DSH 重启不丢当天数字。
- 读盘/写盘失败只告警一次：面板仍按内存合计显示，模型调用不受任何影响。

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
| 请求数 | 当天回报了用量的模型调用次数，按同一套 K / M 紧凑格式 | 本插件 |

「用量」按钮开关（设置 → 通用设置 → 性能与用量）里的**简洁 / 详细**只作用于那条按钮；这一栏
始终是「详细」形态的两段读数（总量 + 缓存命中），因为面板里没有悬浮对话框可放详表。

-----

## 面板行为

| | 行为 |
|---|---|
| 位置 | 槽位 `conversation.session.panel.section`，`id: today-usage`，`order: 300` |
| 出现时机 | 当天总用量大于 0 时显示；没有数据（或宿主暂时没给）时整节渲染为空——面板连标题一起隐藏 |
| 内容 | 一项指标一行：图标 + 标签在左、数值右侧；总用量、请求数、缓存命中、未缓存输入、缓存读取、缓存写入（为 0 时不占行）、输出 |
| 更新 | **宿主推送**：连接建立即收到当前快照，之后每次记录更新推一帧；跨零点推新一天的空读数。断线由浏览器自动重连，重连后宿主补发当前快照；卸载时关闭连接 |
| 失败 | 保留上一次成功读数；从未成功过则整节为空。路由未就绪、401/403、HTML fallback、坏 JSON 都按「暂时没有数据」处理 |
| 日期边界 | 宿主进程的本地时区；零点后宿主返回新一天的空合计，面板自动收起 |
| 读屏 | 每行连续文本：`总用量 326M`、`缓存命中 99%`……；图标对辅助技术隐藏 |

-----

## 实现文件

| 文件 | 职责 |
|---|---|
| [`index.ts`](../dsh-today-token-usage/index.ts) | 宿主入口：解析 journal 目录并装配记录器 |
| [`src/install.ts`](../dsh-today-token-usage/src/install.ts) | 接线：`llm/stream` global 监听、journal store、路由注册（`webServer` 可选） |
| [`src/tap.ts`](../dsh-today-token-usage/src/tap.ts) | 用量旁路：chunk 原样透传、结算只回调一次、旁路失败不影响模型流 |
| [`src/journal.ts`](../dsh-today-token-usage/src/journal.ts) | journal 词汇：记录格式、文件名、容错解析、合计（纯模块） |
| [`src/store.ts`](../dsh-today-token-usage/src/store.ts) | 落盘存储：读回、追加、跨天、30 天清理、失败降级 |
| [`src/paths.ts`](../dsh-today-token-usage/src/paths.ts) | `$DSH_HOME` 解析与 journal 目录 |
| [`src/route.ts`](../dsh-today-token-usage/src/route.ts) | 两条 owner-only 路由：JSON 快照 + SSE 推送（扇出、保活、零点补发、断开清理） |
| [`src/web-types.ts`](../dsh-today-token-usage/src/web-types.ts) | `ctx.webServer` 的最小结构化类型（不引入宿主包依赖） |
| [`src/wire.ts`](../dsh-today-token-usage/src/wire.ts) | 两侧共享词汇：路由路径、当天读数、守卫、日期与四桶算式（纯模块） |
| [`src/aggregate.ts`](../dsh-today-token-usage/src/aggregate.ts) | 纯计算：读数 → 面板合计、紧凑格式、缓存命中百分比 |
| [`src/usage-client.ts`](../dsh-today-token-usage/src/usage-client.ts) | 浏览器收推送：SSE 订阅、坏帧守卫、卸载关闭 |
| [`src/client.ts`](../dsh-today-token-usage/src/client.ts) | 浏览器入口：注册字典、等分区槽、注册分区 |
| [`src/component.tsx`](../dsh-today-token-usage/src/component.tsx) | 分区组件：SSE 订阅、七个字形、按行渲染、空数据隐藏 |
| [`src/registration.ts`](../dsh-today-token-usage/src/registration.ts) | 槽键 / 注册 id / `order` 与注册选项（纯模块） |
| [`src/locales.ts`](../dsh-today-token-usage/src/locales.ts) | 本插件字典（zh / en） |
| [`check-css.mjs`](../dsh-today-token-usage/check-css.mjs) + [`contract.json`](../dsh-today-token-usage/contract.json) | 上游槽、行标记、`llm/stream`、`usage` 块、路由与鉴权、SSE 不被 gzip 缓冲、读数口径的静态契约（16 条） |

宿主半部用 `inject = ['llm']`：模型调用服务缺席时整项不激活。`webServer` 走可选注入：没有它
时只记录、不开路由（非 web composition）。浏览器半部用 `inject = ['slots', 'locale']`，
`dsh.client.platform = web`、`immediately: true`。

这一栏不挂样式表：行直接吃会话面板给 `[data-session-panel-row]` / `[data-row-part]` 铺的通用
规则，图标 16px，颜色随行文字，明暗主题自动跟随。

-----

## 契约与静默失败

面板槽、行标记、`llm/stream`、`usage` 块、`ctx.webServer.register`、`webserver/authorize`、
cookie 鉴权提供方，以及「用量」按钮的读数口径，都是**改名即静默退化**的上游事实：拦截点没了
一次请求也记不到，鉴权链路没了页面拿不到数据，口径变了面板与按钮各说各话。
[`contract.json`](../dsh-today-token-usage/contract.json) 把这 16 条事实列成清单，
`pnpm check:css` 逐条对 DSH 安装产物 grep 一遍，缺一条就显式失败并写明后果。

-----

## 验证

```bash
pnpm --filter dsh-today-token-usage build      # 产出 lib/client.js（浏览器半部）
pnpm --filter dsh-today-token-usage typecheck  # tsc --noEmit
pnpm --filter dsh-today-token-usage test       # 9 个测试文件
pnpm --filter dsh-today-token-usage check:css  # 16 条上游契约
```

测试覆盖：

| 文件 | 覆盖 |
|---|---|
| `test/journal.test.mjs` | 编解码往返、坏行/错版本/错日期跳过、四桶合计、文件名与日期偏移、用量规整 |
| `test/tap.test.mjs` | chunk 原样透传、最后一个 usage/finish、抛错与提前 break 都结算一次、回调抛错不影响流 |
| `test/store.test.mjs` | 追加、重启恢复、跨天切换、30 天清理、坏行容错、磁盘不可写降级、NaN 规整、变化订阅 |
| `test/route.test.mjs` | 两条路由的 owner-only / 405 / 500；SSE 初始快照、扇出、断开清理、保活 |
| `test/usage-client.test.mjs` | SSE 订阅路径、合法帧回调、坏帧忽略、取消订阅关闭连接 |
| `test/aggregate.test.mjs` | 读数 → 面板合计、紧凑格式、缓存命中（含不许舍入成 100% 的两个端点） |
| `test/plugin-apply.test.mjs` | 真 `apply`：global `llm/stream` 监听、journal 落盘、两条路由、SSE 初始帧与推送 |
| `test/artifact-client.test.mjs` | 产物模块 id / 声明 / 字典 / 分区注册 |
| `test/render.test.mjs` | 真 React 渲染：行集合、数值、命中插值、空数据、无告警 |

挂载后建议的肉眼检查：面板里出现「今日 Token 用量」一栏；发一条消息后「总用量」「请求数」变大；
宿主日志无告警；`$DSH_HOME/state/today-token-usage/requests-<今天>.jsonl` 出现新行（标题生成的
请求 `purpose` 是 `session-title`）。SSE 可以用 curl 直接看：

```bash
curl -N -H "Cookie: <会话 cookie>" http://127.0.0.1:3080/today-token-usage/stream
```

-----

## 已知边界

- **记录从插件生效那一刻开始，不回填。** 面板不再回放会话日志或投影缓存：插件生效之前今天
  已经发生的用量不会补进 journal（标题生成的用量本来就没有日志来源），生效之后跨重启由 JSONL
  恢复。这是「所有请求都有一份可查记录」换来的取舍。
- **只有 web 客户端有这个面板。** 客户端平台是 web；非 web composition 里宿主仍会记录（如果
  插件被挂载），但没有这一栏。
- **日期边界跟宿主进程的本地时区。** 浏览器在别的时区打开也按宿主日界切分。
- **同一 `$DSH_HOME` 下只假设一个宿主进程。** 多个 DSH 进程同时运行时，各进程只统计自己发出
  的请求，内存合计不跨进程合并（journal 文件是共享的，重启后会读到彼此写入的行）。
- **每个打开的页面保持一条 SSE 长连接。** 断线由浏览器自动重连，重连时宿主补发当前快照；长时间没有任何请求时宿主每 15 秒发一行注释帧保活。
- **不计算价格/费用，不提供历史查询 UI。** journal 是普通 JSONL，可用 `jq` 自己查。
- **没有 Config。** 保留天数（30 天）与路由路径固定。
