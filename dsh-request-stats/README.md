# 请求看板 / Request stats

DSH 插件：为 **opencode-go**（以及任何你配置的固定模型路由）记录每一次模型请求的**服务器身份、首字延迟与输出速度**，并在左侧栏新增「请求看板」入口打开数据看板；`⌘⌥H`（Windows/Linux 为 `Ctrl+Alt+H`）可在看板与对话之间切换。

## 它记录什么

每次模型请求一行：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| 服务器 IP | undici `client:connected` 的 socket 对端地址 | 仅**直连**时可见；连接复用（连接池）时沿用该 host 最近一次观测到的对端，并标记来源 |
| 边缘机房 | 响应头 `cf-ray` 的结尾（如 `SIN`、`LAX`） | 经代理或对端 IP 不可见时，作为服务器身份分组 |
| 首字延迟 | `llm/stream` 首个内容块 | 文本 / 推理 / 工具参数 delta 中最早的一个（思考 token 也算首字） |
| 输出速度 | `usage.outputTokens ÷ 首字到结束的时长` | 提供方未报 usage 时按流式字符数估算并标记 `estimated` |
| DNS 候选 | 请求时刻 `dns.lookup(host)` | 60 秒缓存，便于对照当前解析结果 |
| 其余 | provider、model、purpose、会话 id、tokens、状态、错误 | 不记录提示词、请求头或凭据 |

模型请求里的辅助调用（标题生成 `session-title`、上下文压缩 `compaction` 等）同样会记录，但**默认不参与统计**（它们更短，会把均值拉低）：表头右侧的「包含辅助请求」开关可切换；看板顶部会说明当前排除了多少条。明细里辅助调用带原始用途标签。

> **关于「服务器 IP」**：如果 DSH 经本机 HTTP 代理（`HTTPS_PROXY` / `HTTP_PROXY`）出站，socket 对端是代理而不是服务器，插件会把它记录为「经代理」并改用 Cloudflare 边缘机房代码，不会伪造一个 IP。关掉代理后即可直接记录真实对端 IP；两种情况看板都会明确标注。

## 打开看板

左侧栏 → **请求看板**（三根上升柱的图标），或按 `⌘⌥H`（Windows/Linux 为 `Ctrl+Alt+H`）在「请求看板」与当前对话之间切换。快捷键在输入框、页面和终端里都生效，模态层打开时让位。

> macOS 的 `⌘⌥H` 同时是系统的「隐藏其他应用」菜单快捷键，浏览器可能先把它交给系统；此时页面上会退到 `⌃⌥H`（Control+Option+H）。桌面端仍然只保留 `⌘⌥H`。

看板包含：

- 页首说明：监控的提供方与主机、排除或已包含的辅助调用条数、边缘机房代码的含义，以及记录保存范围与隐私说明。
- 概览：请求数、平均首字延迟（P50/P90）、平均输出速度、输出 tokens；
- 服务器表：按 IP / 边缘机房分组的请求数、占比、首字、速度、tokens、最近时间；
- 趋势：最近请求的首字延迟与输出速度走势；
- 模型表（存在多个模型时）与请求明细（时间、模型、服务器、首字、速度、tokens、状态）；
- 时间范围：1 小时 / 24 小时 / 7 天 / 全部；「清空」对整份账本生效（与当前时间范围无关），需二次确认。
- 「包含辅助请求」开关：默认排除标题生成、压缩等短请求，切换后它们重新计入所有均值与明细。
- 均值只统计成功请求；输出速度含按字符数估算的样本，卡片提示会单独标出估算条数。

## 安装

在本机 DSH 的 **插件 → 添加插件** 中安装本目录（或让 `dsh-plugins` 的 `add-plugins` 脚本挂载），随后在插件行启用。看板入口会出现在左侧栏。

宿主半部与浏览器半部都由 tsdown 编译到 `lib/`（`lib/index.js`、`lib/client.js`，均不进版本库）。挂载前需要先构建：`pnpm build`；仓库根的 `add-plugins` 脚本发现 `lib/` 缺产物时会自动跑这一步。

## 配置

插件行的 `config` 全部可选：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `providers` | `["opencode-go"]` | 只记录这些提供方的请求；空数组表示全部 |
| `hosts` | `["opencode.ai"]` | 只把发往这些主机的网络事件关联到请求 |
| `maxRecords` | `2000` | 保留条数上限（50–50000） |
| `retentionDays` | `30` | 保留天数（1–365） |

示例（`cordis.patch.yml`）：

```yaml
- id: dsh-request-stats
  name: dsh-request-stats
  config:
    providers:
      - opencode-go
    hosts:
      - opencode.ai
    maxRecords: 5000
```

## 数据与隐私

- 记录文件：`$DSH_PROFILE_DIR/dsh-request-stats/records.json`（未使用 profile 时在 `$DSH_HOME` 下），首次写入时创建，写入为防抖 + 原子替换。
- 看板数据由 Host 通过 `/api/dsh-request-stats/state` 提供，只读；`/api/dsh-request-stats/clear` 仅接受同源、本机回环请求。远程浏览器打开看板会看到 403，并提示「看板只接受本机请求」。
- 只保存提供方、模型、服务器、耗时与 token 数；不含提示词、请求体、请求头或凭据。

## 实现要点

- 采集在 `llm/stream` waterfall 里完成：始终原样转发下游 `AsyncIterable<StreamChunk>`，任何采集异常都只影响这一条记录。
- 用 `AsyncLocalStorage` 把 undici 的 `undici:request:create`、`undici:request:headers`、`undici:client:connected` 诊断事件绑定到当前模型调用，并发会话不会串号。
- 浏览器半部是纯 React（`window.__ModuleLoader__` 工厂，源文件在 `src/client/`）：`sidebar.panellist` 提交侧栏入口，`main` 同 id 渲染看板；样式只用 `--dsw-alias-*` 主题 token。
- 两半都是 TypeScript：宿主入口 `src/index.ts` 连同 `src/server/` 打成 `lib/index.js`，浏览器入口 `src/client/index.ts` 打成 `lib/client.js`；共享的数据形状在 `src/shared/types.ts`。

## 开发检查

```sh
pnpm build      # tsdown：两半都编译到 lib/
pnpm typecheck  # tsc --noEmit
pnpm check      # 清单 / 导出 / 产物语法 / 客户端注册形状
pnpm test       # 采集 / 存储 / 聚合 + 用 lib/client.js 做离线渲染与注册测试
```

`test/run.mjs` 直接加载 `src/` 下的 `.ts`（Node Type Stripping），`test/client-render.mjs` 读的是构建产物 `lib/client.js`。
