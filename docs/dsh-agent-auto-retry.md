# dsh-agent-auto-retry

模型请求失败、**所有下游恢复策略都放弃之后**，在同一个回合里自动再试一次，而不是把整个回合判死。宿主半部插件：没有 UI、没有客户端代码、没有构建步骤。它接在 agent loop 的 `agent/request-error` waterfall 上，先让下游（提供方的 `retryPolicy` 执行器、上下文超限压缩、图片卸载）决定；下游说重试就照办，下游放弃（或自己抛错）时才由本插件按自己的策略接手。每次重试都先写成上游同形的 `llm/retry` 事件再等待，因此重试在会话日志里是耐久事实：客户端能看到「等待重试模型请求（n/m）· Xs」，崩溃或 resume 之后编号也能接着写。

**默认不安装这个插件**——本仓库只提供实现与测试；挂载是单独的一步，见[挂载与启用](#挂载与启用)。

-----

## 它做什么

- **同一个回合内重试**：失败不会结束回合，也不会新开一轮；重打的是同一个 step 的同一次请求。
- **不抢下游的工作**：上游执行器 `@deepseek-ai/dsh-llm-retry`、上下文超限压缩（`dsh-compaction-basic`）、图片卸载（`dsh-compaction-image-offload`）都有机会先接手。它们给出的 `{ kind: 'retry' }` 原样放行，本插件一条事件都不写。
- **按失败码判定**：服务端错误、超时、传输失败、限流、空回复这类值得再打一次的失败才重试；认证、配额、请求格式、上下文超限、需先卸载图片这类重试必然重复同样的失败，直接原样上报。
- **有预算**：同一个 step 内最多追加 `maxRetries`（默认 5）次；`0` 表示关闭。新的 step 重新给预算。
- **可取消**：回合被取消（用户停止、父级取消、会话销毁）或插件被卸载时，等待立即结束，不会再发起请求。
- **服从提供方**：提供方给了有效的 `Retry-After` 就按它等；它超过 `maxRetryAfterMs`（默认 5 分钟）就放弃这次重试，而不是擅自缩短间隔再打一次。
- **看得见**：每次重试在会话里留下两条事件，客户端据此显示等待状态与倒计时，token 计量据此分开统计各次尝试。

-----

## 触发时机

插件只接一个扩展点：`agent/request-error`。它是一次模型请求**失败之后、回合关闭之前**的 waterfall，载荷里有失败事实（`failure.code` / `failure.message` / 可选的 `providerRetryAfterMs`）、坐标（`turn` / `step`）、提供方与回合的取消信号。

判定顺序是固定的：

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 1 | 回合已取消（`signal.aborted`） | 不重试，失败原样上报 |
| 2 | 下游 waterfall 返回 `{ kind: 'retry' }` | 放行下游的决定，本插件不插手 |
| 3 | `maxRetries <= 0` | 关闭状态，不重试 |
| 4 | 失败码在 `permanentCodes` 里，或不在 `retryableCodes` 里 | 不重试，失败原样上报 |
| 5 | 本 step 已重试次数达到 `maxRetries` | 不重试，并记一条告警 |
| 6 | 提供方 `Retry-After` 超过 `maxRetryAfterMs` | 不重试，并记一条告警 |
| 7 | 写 `llm/retry` 事件失败 | 不重试（宁可保持原样，也不留下不可重建的重试） |
| 8 | 等待完成 | 写 `llm/retry-started`，返回 `{ kind: 'retry' }` |

下游抛错会让第 2 步落到「没有决定」，并记一条告警；本插件随后按自己的策略判定。最终不重试时上报的仍是原始失败，下游的错误不会顶替它。

-----

## 配置

没有配置块时用默认值。要在 profile 层覆盖，按 patch `id` 写一行：

```yaml
- id: dsh-agent-auto-retry
  name: dsh-agent-auto-retry
  config:
    maxRetries: 8
    initialDelayMs: 1000
    maxDelayMs: 30000
```

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `maxRetries` | `5` | 同一个 step 内最多追加几次重试；`0` 关闭本插件 |
| `retryableCodes` | `['*']` | 允许重试的失败码；`'*'` 匹配所有非永久性失败。给显式列表即变成白名单 |
| `permanentCodes` | 见下 | 永不重试的失败码，优先于 `'*'` |
| `initialDelayMs` | `2000` | 本地退避首个基准等待 |
| `maxDelayMs` | `60000` | 本地退避单次上限 |
| `jitterRatio` | `0.2` | 对称抖动幅度，`0`–`1`；实际等待在基准的 `1 ± jitterRatio` 区间内 |
| `maxRetryAfterMs` | `300000` | 愿意服从的提供方 `Retry-After` 上限；超过就放弃这次重试 |

未知键、类型不对或越界值在**挂载时**直接报错（`dsh-agent-auto-retry: 未知配置项 "maxRetires"`），不会被静默忽略。三个时长字段的上限都是 `2147483647` 毫秒——超过它 `setTimeout` 会折成 1ms，一次本该等更久的退避会变成立即重试。

默认的永久性失败码按「重试必然重复同样的失败」选取：`ABORTED`、`AUTH`、`MISSING_CREDENTIAL`、`INVALID_CREDENTIAL`、`ACCOUNT_SIGN_IN_REQUIRED`、`ACCOUNT_SIGNED_OUT`、`QUOTA`、`ACCOUNT_QUOTA`、`INVALID_REQUEST`、`INVALID_ARGS`、`UNSUPPORTED_CONTENT`、`UNSUPPORTED_REASONING_EFFORT`、`INVALID_MODEL_CONTEXT`、`INVALID_REPLAY_STATE`、`REQUEST_EXTENSION`、`CONTEXT_WINDOW_EXCEEDED`、`IMAGE_OFFLOAD_REQUIRED`、`NO_ADAPTER`。其中 `CONTEXT_WINDOW_EXCEEDED` 与 `IMAGE_OFFLOAD_REQUIRED` 有专门的恢复者：不排除它们，本插件会抢在 compaction 之前用同样的超限请求反复重打。

-----

## 它写进会话的两个事件

两次 `append` 的顺序是刻意的，两个事件的形状与上游 `@deepseek-ai/dsh-llm-retry` 完全一致：

1. **等待前**写 `llm/retry`：携带 `retryId`、`turn`/`step`、`provider`、`mode: 'normal'`、`policyKey`、`retry`、`maxRetries`、`delayMs` 与失败事实。先持久后等待，所以崩溃或取消都不会留下看不见的待定重试。
2. **等待后、下一次请求前**写 `llm/retry-started`：`{ retryId, turn, step, retry }`。

为什么必须同形：会话格式校验器按 `(turn, step, provider, policyKey)` 认链，要求编号从 1 连续、一条链只有一个 `retryId`、`llm/retry-started` 必须配对一条已排定的重试。自造事件既进不了这些校验，也不会被客户端与计量读到。

`policyKey` 带 `dsh-agent-auto-retry` 前缀，因此与提供方自己的策略键永不相同：同一个 step 里，提供方的 `retryPolicy` 执行器与本插件是两条独立的重试链，编号各从 1 开始，互不覆盖。

重试计数**来自会话日志**而不是进程内变量：插件注册一个宿主侧投影单元，把日志折成「链 → 最近一次排定的重试」。因此 resume 之后编号接着写，不会跳号。

-----

## 怎么确认它真的生效

日志是唯一权威证据。一次成功的自动重试会在会话日志里留下这样的序列：

```text
step/start        { turn: 1, step: 1 }
assistant/attempt                          ← 失败的那次尝试
llm/retry         { retry: 1, maxRetries: 5, delayMs: 1000, failure: { code: 'SERVER', … } }
llm/retry-started { retry: 1 }
assistant/message                          ← 重试成功
step/end
```

- 只有 `assistant/attempt` 紧接 `turn/end { reason: { kind: 'error' } }` → 没有重试。按顺序查：失败码是否在 `permanentCodes` 里（日志的 `turn/end.reason.error.code` 就是它）、`retry` 是否已到上限、`Retry-After` 是否超过上限；日志里 `dsh-agent-auto-retry:` 开头的告警会直接说明是哪一条。
- 有 `llm/retry` 但没有 `llm/retry-started` → 等待期间被取消（回合取消或插件卸载），排定留在日志里但不会执行；客户端把这一条渲染成「模型请求重试已取消」。
- 有 `llm/retry` 但 `retry` 编号跳号 → 说明写日志的不是本插件（`policyKey` 不同），或者本插件的链编号被别的东西写脏了：先看该事件里的 `policyKey`。
- 网页上看不到「等待重试模型请求」而日志里有 `llm/retry` → 客户端没消费到，先跑 `pnpm --filter dsh-agent-auto-retry check:css` 对照 `contract.json` 里的 `client-*` 条目。

-----

## 与上游 `dsh-llm-retry` 的分工

| | `@deepseek-ai/dsh-llm-retry` | 本插件 |
| --- | --- | --- |
| 策略来源 | 提供方自身的 `retryPolicy` | 插件自己的配置 |
| 何时重试 | 失败码落在该策略的 `retryableCodes` 内、且预算未耗尽 | 下游全部放弃之后，失败码不是永久性失败时 |
| 预算 | 按提供方配置（`normal` 有上限，`always` 无上限） | 按 step，默认 5 次 |
| 默认安装 | 是（`dsh-base` 的 patch 里有这一行） | 否 |
| 链的 `policyKey` | 由提供方策略折出 | 固定带 `dsh-agent-auto-retry` 前缀 |

因此两套策略是**叠加**而不是替代：提供方配了 `normal: 5` 时，前 5 次由它重试，第 6 次起才轮到本插件；提供方没配策略时，本插件从第 1 次就开始接手。想让本插件成为唯一的重试者，把提供方配成 `retryPolicy: { mode: 'normal', maxRetries: 0 }`。

-----

## 挂载与启用

```bash
pnpm install
dsh plugin --profile web add /path/to/dsh-plugins/dsh-agent-auto-retry
```

本插件**只有宿主半部**：`index.ts` 与 `src/*.ts` 由 Node Type Stripping 直接加载，没有构建产物、没有 `dsh.client` 声明，因此**不需要重建 Web 资源**。改动源码后重启 `dsh` 即可生效；运行中的 Host 不会重读 profile。

卸载：`dsh plugin --profile web remove dsh-agent-auto-retry`，重启后恢复上游原本的「失败即结束回合」。进行中的重试等待会被中断，已排定但未开始的 `llm/retry` 留在日志里（客户端显示为「已取消」）。

-----

## 验证

```bash
node node_modules/typescript/bin/tsc -p dsh-agent-auto-retry/tsconfig.json   # 类型检查
cd dsh-agent-auto-retry && node test/run-all.mjs                            # 测试
node dsh-agent-auto-retry/check-css.mjs                                     # 上游契约校验
```

| 测试文件 | 覆盖 |
| --- | --- |
| `test/policy.test.mjs` | 纯策略：默认集合重试什么 / 不重试什么、永久码优先于通配 `'*'`、白名单模式、空列表关闭、指数退避与上限、抖动上下界、`Retry-After` 的服从与超限放弃、配置解析与未知键报错、`policyKey` 的稳定性与集合顺序无关 |
| `test/chain.test.mjs` | 链折叠：只认本插件的 `policyKey`、按提供方分链、幂等折叠不换引用、形状不完整不记、`step/start` 与 `turn/end` 清空预算、跨 step 不串号、持久化状态 schema |
| `test/plugin-apply.test.mjs` | 假 ctx + 假会话：插件形状、两条事件的顺序与内容、下游决定优先、下游抛错仍可重试且只告警一次、永久码 / 白名单 / 预算 / 关闭、回合取消、等待中取消、`Retry-After`、写事件失败时降级、新 step 重给预算、不同提供方各自分链、卸载中断等待并摘掉监听器 |
| `test/cordis-integration.test.mjs` | 真实 `@deepseek-ai/cordis` 上下文与真实 waterfall：`inject` 等待语义、真实总线上失败请求被重试、下游监听器说重试时不重复排定、同一条链接着编号、冷启动时沿用日志里的编号与 `retryId`、卸载中断等待 |

`test/run-all.mjs` 用 `spawnSync` 逐个跑测试文件；在受限沙箱里子进程捕获输出会被拒绝（EPERM），此时直接 `node test/<file>.test.mjs`。

<details>
<summary>Dev Note</summary>

接线位置是 `dsh-agent-loop` 的 `step()`：请求失败后它把 `{ turn, step, provider, failure, retryPolicy, signal }` 派发到 `agent/request-error` waterfall，默认 `next` 返回 `undefined`（失败终止）。监听器返回 `{ kind: 'retry' }` 时 loop 不做持久化收尾、直接 `continue` 重跑本 step 的下一次尝试；所以「排定重试」的持久化必须由策略层自己写——这正是本插件写 `llm/retry` 的原因。

`ctx.on('agent/request-error', …)` 注册的是全局监听器：载荷里的 `agent` 已经带了 subject，本插件只需要它来拿 `session`。监听器用 `track()` 把 promise 记进活动集，插件卸载时先摘监听器、再 `abort` 生命周期信号、最后 `Promise.allSettled` 等它们收尾——`cancellableDelay` 同时听回合信号与生命周期信号，因此卸载不会把等待留在进程里。

两处「宁可不动」的取舍：`failure` 原样写进事件（不改写、不裁剪），保证重试记录与本插件的策略判定读的是同一份事实；写事件失败时直接放弃这次重试而不是内存里继续等，因为一条无法持久化的重试在 resume 后会让编号跳号，而格式校验器会拒绝整份日志。这两条都在 `test/plugin-apply.test.mjs` 里有断言。

</details>

-----

## 边界

以下限制来自设计取舍或上游事实，不是缺陷。

- **只能重试「同一 step 的同一次请求」**：agent loop 的重试边界是 step；直接调 `ctx.llm.stream()` 的消费方（摘要、标题生成）不经过这个 waterfall，仍然是单次尝试。
- **只看 `failure.code`**：判定完全基于规范化失败码，不解析错误文本。提供方把配额错误写成普通 4xx 时会被当临时失败重试到预算耗尽——预算有限，不会无限重试。
- **预算是按 step 的，不是按回合**：一个回合里跑了 10 个 step，最多可以有 10 × `maxRetries` 次重试。这是刻意的：每个 step 是一次独立的模型请求。
- **永久码列表是启发式的**：它按「重试必然重复同样的失败」选取，不覆盖所有提供方自定义码。拿不准的码默认会被重试（有预算限制）；要全局收紧就把 `retryableCodes` 改成白名单。
- **等待在插件进程内**：重试计时用进程内的 `setTimeout`，崩溃时正在等待的那次重试不会自动续上（日志里留下一条已排定、未开始的记录）。会话 resume 后同一条链的编号仍能接着写。
- **不改写失败事实**：`llm/retry` 里的 `failure` 是 loop 给的那一份；本插件不会补充 `status`、`requestId` 之类的字段。
- **不做跨 step 的补偿**：重试只重打本 step 的请求，不会重放已完成的前序 step，也不会回退工具执行。
- **`always` 模式不在这里**：本插件写的链固定是 `mode: 'normal'`（有预算）；需要无上限重试请走提供方的 `retryPolicy: { mode: 'always' }`。
