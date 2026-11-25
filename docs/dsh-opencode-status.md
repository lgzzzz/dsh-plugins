# dsh-opencode-status

在会话面板里显示 **OpenCode 状态页**（`https://opencode.ai/status/api/status`）中
`go` 服务下 `deepseek-v4.1-flash` 的当前状态：服务状态、模型状态、首 Token 时长与吞吐。
每 5 秒刷新一次。

```text
会话面板
├─ 环境
├─ 改动请求
├─ 子智能体
├─ 今日 Token 用量
└─ OpenCode Go
    模型                 deepseek-v4.1-flash
    状态                 降级 · 延迟
    首 Token             9.1 秒
    吞吐                 148 tok/s
```

> 一句话分工：上游接口不带 CORS 头，页面不能直连，所以**宿主半部**代理抓取并把 90KB 的整页
> 快照收窄成「`go` 服务 + `deepseek-v4.1-flash`」一条，后台每 5 秒保活刷新、常驻内存，挂在
> 同源、owner-only 的 `GET /opencode-status/status` 上；**浏览器半部**在页面装载时轮询它，
> 把读数摊成会话面板的分区行。

-----

## 数据从哪来

```text
https://opencode.ai/status/api/status（Cloudflare，cache-control: max-age=15，无 CORS 头）
  → 宿主：createStatusSource（后台每 5 秒保活刷新 + 并发合流 + 5 秒 TTL，超时 10 秒）
  → wire.ts：extractSnapshot —— components[service=go]
       ├─ service.status / service.reason
       ├─ breakdown[id=deepseek-v4.1-flash].status / reason / speed.{ttft,tps}
       │    （breakdown 里没有时退回 models[] 的同 id 条目，通常只有 reason）
       └─ updatedAt / stale
  → GET /opencode-status/status（auth: required + owner 校验，JSON，no-store）
  → 浏览器：每 5 秒一次 readStatus → statusRows → 面板行
```

上游字段到面板的映射：

| 上游字段 | 面板位置 | 缺失时 |
|---|---|---|
| `components[service='go'].status` | 「Go 服务」行（仅当与模型状态/原因不同时出现） | 该行不出现 |
| `components[service='go'].reason` | 同上，拼成「状态 · 原因」 | 空串，只显示状态 |
| `breakdown[id='deepseek-v4.1-flash'].status` | 「状态」行 | `unknown` |
| `breakdown[id='deepseek-v4.1-flash'].reason` | 「状态」行，拼成「状态 · 原因」；`none` 不显示 | 空串 |
| `breakdown[id].speed.ttft`（毫秒） | 「首 Token」行，`9.1 秒` | 该行不出现 |
| `breakdown[id].speed.tps` | 「吞吐」行，`148 tok/s` | 该行不出现 |
| 顶层 `updatedAt` | 不显示（仍保留在宿主响应里，供排障 / 以后扩展） | — |
| 顶层 `stale` | 不直接显示；缓存兜底时为 true | — |

模型 id 固定为 `deepseek-v4.1-flash`（上游用点号与连字符拼写，不是 `deepseekv4.1flash`）。
把模型 id、状态码、原因码当**数据**而不是文案：未知码原样显示，只把已知词汇翻成中/英文，
不会把新出现的状态静默改写成别的意思。

-----

## 轮询、缓存与失败路径

| 环节 | 行为 |
|---|---|
| 宿主保活 | 装配即抓一次，之后每 5 秒后台刷新，最新快照常驻内存；页面请求只读内存，不等上游往返 |
| 页面轮询 | 页面装载即启动一次，之后每 5 秒一次（下一次在上一次有结果后才排，避免慢请求叠加）；读数留在内存，切换会话直接复用 |
| 后台标签页 | `document.visibilityState === 'hidden'` 时跳过请求，回到前台后下一拍补取 |
| 单次请求 | 15 秒超时；网络失败 / 非 JSON / 形状不对都折成 `{ ok: false }`，不抛错 |
| 宿主缓存 | 5 秒 TTL + 并发合流：多个页面同时刷新只打一次上游 |
| 上游失败 | 缓存不超过 10 分钟时带 `stale: true` 兜底；更旧或无缓存则 502 + `{ ok: false }` |
| 页面已有读数 | 刷新失败时保留最后一份成功读数，不清空整栏 |
| 从未成功 | 一行「状态 / 暂时无法获取」 |
| 模型不在快照里 | 「模型 / deepseek-v4.1-flash」+「状态 / 未找到」 |
| 还没有第一份响应 | 返回 null，整节（含标题）隐藏，与面板其它分区一致 |

为什么是 5 秒：上游响应带 `cache-control: max-age=15`，实测 `updatedAt` 只在整分
`:32` 跳（间隔 1–5 分钟），5 秒既能让面板较快看到边缘缓存刷新后的新值，又把请求量控制在
1 秒轮询的 1/5；更密的轮询大部分时间只会拿到同一份快照，多出的请求由 Cloudflare 边缘缓存
接住。宿主保活与页面轮询用同一节奏：页面每一拍读到的内存快照最老约 5 秒，且不必等上游往返。
面板本身不显示更新时间，读数是否新鲜由外部状态页负责，插件只保证请求节奏稳定。

-----

## 路由与安全

`GET /opencode-status/status` 注册在 `ctx.webServer` 上：

- `kind: 'exact'`，`auth: 'required'`——必须是活着的 Peer，浏览器靠会话 cookie 过
  `webserver/authorize`；
- 处理函数再校验 `peer.principal.kind === 'owner'`，非 owner 一律 403；
- 只接受 GET（其余 405 + `Allow: GET`）；响应 `cache-control: no-store` 与
  `x-content-type-options: nosniff`；
- 只返回聚合状态，不含任何会话内容；上游错误只回一行说明，不暴露内部路径。

`webServer` 只在 web composition 里存在；缺席时（CLI / 非 web 环境）插件安静挂载，不注册
路由，也不影响其它声明。

-----

## 面板行规则

- 最多五行，顺序固定：`Go 服务`（条件出现）→ `模型` → `状态` → `首 Token` → `吞吐`；
- **Go 服务行只在它与模型状态（status 或 reason）不同时出现**：两者一致时模型行已经说明
  问题，不重复；
- 每行 16px 线框字形，标签在 `data-row-part="content"`、读数在 `data-row-part="trailing"`，
  沿用会话面板对 `data-session-panel-row` 的通用样式，主题色自动跟随明暗；
- 行上另有 `data-opencode-status="<key>"` 调试标记。

-----

## 文件结构

| 文件 | 作用 |
|---|---|
| `index.ts` | 宿主半部入口：`name` + `apply`（调用 `src/install.ts`） |
| `src/install.ts` | 把取数器挂到 `ctx.webServer` 的 exact 路由上，装配即启动后台保活，卸载时一起收回 |
| `src/upstream.ts` | 抓上游 + 5 秒保活刷新（含 5 秒 TTL）+ 并发合流 + 失败兜底 + 超时 |
| `src/route.ts` | 同源 JSON 路由：owner / GET 校验、200 / 403 / 405 / 502 |
| `src/wire.ts` | 共享类型、上游收窄 `extractSnapshot`、浏览器侧守卫 `parseStatusReply` |
| `src/web-types.ts` | 本插件用到的 `ctx.webServer` 最小类型面（不引入宿主包依赖） |
| `src/client.ts` | 浏览器半部入口：注册字典与分区槽，页面装载时启动后台轮询 |
| `src/registration.ts` | 分区注册契约：槽键 / id / 排序 / 标题 thunk |
| `src/component.tsx` | 分区组件与 16px 字形；同步读取共享读数仓并订阅变化 |
| `src/rows.ts` | 一份响应 → 面板行的纯函数 |
| `src/format.ts` | 状态/原因译文、秒与 tok/s、相对时间 |
| `src/status-client.ts` | 浏览器侧轮询：5 秒间隔、15 秒超时、后台跳过、停止中止 |
| `src/status-store.ts` | 页面级读数仓：单点轮询、最近一份响应、订阅；读数不随面板卸载丢失 |
| `src/locales.ts` | 中英文字典（标题、行标签、状态/原因、单位、时间） |
| `contract.json` / `check-css.mjs` | 上游契约静态校验（分区槽、行标记、webServer 鉴权链路） |

-----

## 构建、测试与校验

```bash
cd dsh-opencode-status
pnpm build        # tsdown → lib/client.js（浏览器半部）
pnpm typecheck    # tsc --noEmit
pnpm test         # 10 个测试文件：收窄、格式化、排版、取数、路由、轮询、读数仓、装配、渲染
pnpm check        # node --check 全部 .ts / 构建产物语法
pnpm check:css    # 对 DSH 安装产物校验槽位、行标记、路由与鉴权契约
```

装进 profile（插件页「添加插件」或仓库脚本）：

```bash
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-opencode-status
```

安装后客户端半部变为 `dsh-opencode-status / opencode-status / active`；宿主路由由插件 fiber
持有，停用或卸载时一起收回。

-----

## 验证状态

已验证：

- 宿主路由：不带 cookie 401，带 owner cookie 200，返回的 `go` / `deepseek-v4.1-flash` 字段与
  上游一致；
- 取数节奏：按装配参数用真实计时器跑 14 秒，三次上游请求的间隔为 5001 ms / 5000 ms；线上
  `GET /opencode-status/status` 的 `fetchedAt` 约每 5 秒推进一次（上游响应快慢带来的抖动属正常）；
- 在线 slot 注册：`conversation.session.panel.section` 的 occupants 里有
  `dsh-opencode-status / opencode-status / order 320 / active: true`；
- 单元与装配测试 10 个文件全绿；`check-css.mjs` 8/8 通过。

验证限制：当前环境没有浏览器控制，无法确认实际像素、悬停行为与明暗主题下的观感。改完宿主
半部的取数节奏后，运行中的进程仍按旧间隔抓取，直到下一次重组合替换已加载的模块；判断线上
节奏要看 `GET /opencode-status/status` 里 `fetchedAt` 的推进，而不是仓库里的常量。
