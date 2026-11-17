# dsh-request-stats

请求看板：为 opencode-go（以及任何 JSON 配置里指定的固定模型路由）记录每一次模型请求的服务器身份、首字延迟与输出速度，并在左侧栏新增「请求看板」入口。

## 它解决的问题

同一模型的请求会落到不同的 Cloudflare 边缘节点，首字延迟与出字速度差别很大。插件在 Host 进程内把「这次请求的传输事实」和「这次请求的流式计时」合成一行记录，看板按服务器聚合，用来判断当前是不是换到了更慢/更快的节点。

## 结构

| 位置 | 职责 |
| --- | --- |
| `index.js` | 插件入口：解析行配置（`providers` / `hosts` / `maxRecords` / `retentionDays`）、创建账本与采集器、挂 `llm/stream` 与 `/api/dsh-request-stats/*` |
| `server/collect.js` | `llm/stream` waterfall 包裹下游流：记录首个内容块与 `usage`；用 `AsyncLocalStorage` + undici 诊断通道（`undici:request:create`、`undici:client:connected`、`undici:request:headers`）把对端 socket 地址、经代理解析、`cf-ray` 机房绑到同一次调用 |
| `server/records.js` | profile 级 JSON 账本：启动同步读取、防抖原子写入、按 `maxRecords` / `retentionDays` 截断；`profileContext.dir` 优先于环境变量（Host 进程没有 `DSH_PROFILE_DIR`） |
| `server/summary.js` | 纯聚合：时间窗过滤、均值/nearest-rank P50/P90、按 IP 或边缘机房分组、趋势序列与明细 |
| `server/routes.js` | 只读桥：`GET /api/dsh-request-stats/state`、`POST /api/dsh-request-stats/clear`；仅同源且本机回环、Host 头也是回环才放行 |
| `client.js` | 浏览器半部：`sidebar.panellist` 提交左侧栏入口，`main` 同 id 渲染看板；4 秒轮询、范围切换、二次确认清空、趋势与明细表 |

## 「服务器 IP」怎么来

- **直连**：`undici:client:connected` 的 socket 对端地址就是真实边缘 IP；连接池复用时沿用该 host 最近一次观测，并标记 `ipSource: 'pool'`。
- **经代理**：socket 对端是本机代理，插件记录 `connection: 'proxied'` 与代理地址，改用 `cf-ray` 结尾的三字母机房代码作为服务器身份，并附上请求时刻的 DNS A 记录，不伪造 IP。
- 看板把两类记录都算进同一张服务器表，用「直连 / 经代理」标签区分。

## 数据与边界

- 账本：`<profile>/dsh-request-stats/records.json`（无 profile 时在 `$DSH_HOME`）。
- 只存提供方、模型、用途、端点、服务器、耗时与 token 数；不存提示词、请求体、请求头或凭据。
- 首字 = 第一个 `text-delta` / `reasoning-delta` / `tool-call-delta`（思考 token 也算首字）；速度 = `usage.outputTokens ÷ 首字到结束`；提供方未报 usage 时按流式字符数估算并标 `tpsEstimated`。
- 均值只统计成功请求；输出速度的样本里含估算值，KPI 提示单独给出估算条数。
- 辅助调用（`session-title`、`compaction` 等）默认不参与统计（更短，会拉低均值），表头「包含辅助请求」开关可切换；看板页脚说明当前排除了多少条。
- 「清空」清空整份账本，与当前时间范围无关；「本 profile 保留 N 条」始终显示账本总量，而不是窗口内数量。
- 看板路由不校验浏览器 cookie，只接受本机回环 + 同源请求。

## 开发检查

```sh
cd dsh-request-stats
node check.mjs        # 清单 / 导出 / 语法 / 主题 token
node test/run.mjs     # 采集、账本、聚合的离线测试
node test/client-render.mjs  # 浏览器半部以真实 React 离线渲染
```
