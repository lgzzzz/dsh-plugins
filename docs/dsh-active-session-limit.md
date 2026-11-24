# dsh-active-session-limit

全进程同时最多 3 个会话在跑任务（含子智能体）；名额占满后，后到的会话按先来先到排队，等名额
空出、且上一个会话结束已满 5 秒后才启动。纯宿主半部插件：没有页面、没有工具，只在会话的生命
周期事件上挂一个闸门。

```text
时间轴（maxActive = 3，cooldownMs = 5000）

A  ────────────────┐
B  ────────────────┼──┐                ← 三个名额都占着
C  ────────────────┘  │
D  排队 ───────────────┴───────────────  A 结束后满 5 秒，D 占住它让出的名额
E  排队 ───────────────────────────────  再等下一个名额
```

> 口径一句话：**「活跃」按运行计，不按会话是否存在计**；只有新会话等 5 秒冷却，已有会话继续
> 对话只受名额限制。

-----

## 它做的是什么

| | 行为 |
|---|---|
| 名额 | 一个会话开始跑任务（提出第一个 step）时占一个名额，跑完转空闲时交回。同一段运行里后续的 step 直接通过，不重复排队 |
| 上限 | `maxActive`，默认 3，含子智能体会话 |
| 冷却 | `cooldownMs`，默认 5000：从**最近一次会话结束**起算，只有**新会话**的首次准入检查它 |
| 新会话 | 还没跑过任何回合的会话（`turnBoundaryOf(session).lastTurn === 0`）。刚新建的会话、刚派出的子智能体都属于这一类 |
| 已有会话 | 有回合历史、继续对话的会话：名额空出即可继续，不被冷却拖住 |
| 排队 | 先来先到；顺序在每次名额空出时重算（被冷却挡住的会跳过，冷却是全局的，跳过不会造成饥饿） |
| 子会话 | 子智能体会话同样占名额、同样按新会话等冷却 |
| 名额接管 | 名额占满、而等待者是某个**正在跑的祖先**的后代时，祖先的名额临时让给后代（父会话暂停，下次提 step 时重新排队）。见[为什么需要名额接管](#为什么需要名额接管) |
| 取消 | 排队期间用户点了停止：等待结束、不占名额，这一轮按宿主的取消语义结束 |
| 提示 | 不往会话记录里写任何东西；排队 / 放行 / 接管只写宿主日志。被挡住的会话仍是 `running`，界面上就是「运行中」 |
| 插件激活 | 已经在跑的会话按「占着名额」接管（写一行 `is already running; counted as active`），等它们转空闲时释放 |

宿主日志长这样（`ctx.logger.info` / `debug`）：

```text
session "abc" is waiting for a free slot (3/3 active, 1 waiting, cooldown 4210 ms)
session "abc" admitted after waiting 4213 ms (3/3 active)
session "parent" released its slot while its descendant "child" runs      # debug
session "def" ended; 2/3 active                                            # debug
```

## 「活跃」为什么按运行计，不按会话存在计

Web 里一个会话（Agent）通常从打开起活到进程退出：切走、关标签页都不会销毁它。按「存在」计名额
的话，前 3 个打开的会话会永久占满上限，新会话永远排不进来（只能重启宿主）。按「运行」计则与
用户看到的「正在跑 / 空闲」一致，也正好是资源真正被消耗的那段时间。

## 为什么闸门在 `agent/pre-step`

- `agent/created` 是串行（serial）事件，确实可以 `await` 住——但挡住它等于把「新建会话」的
  Host 调用本身挂住（Web 的新建会话会一直等），而子智能体那边则是「子会话已经建出来、却永远
  不开始」；两者都比「会话可见、任务在排队」更难解释。
- `agent/pre-step` 是宿主文档里唯一明确「可以拒绝或改写一个 step」的可挂起通路，位置正好在
  提示词与工具装配之后、这一步的模型请求之前：被挡住的会话不会进入这一步的请求，`agent.status` 已经是
  `running`，界面上的「运行中」不需要任何额外 UI（压缩等前置维护请求由别的监听器在闸门前后触发，
  不归本插件管）。
- 代价写在[已知边界](#已知边界)里：排队期间的这一轮提示词还没提交进会话日志，进程重启会丢掉
  排队中的一轮。

## 准入状态机

判定与计数全在 `src/limiter.ts` 的纯状态机里（不读时间、不碰 Cordis），`index.ts` 只做接线：

| 状态 | 含义 |
|---|---|
| `active` | 正占着名额的会话 id |
| `suspended` | 名额被后代接管、自己暂停中的会话 id |
| `pendingNew` | 还没跑过回合的会话 id：只有它们的首次准入要等冷却 |
| `waiters` | 先来先到的排队者（含 `isNew` 快照、`enqueuedAt`、取消监听） |
| `lastEndedAt` | 最近一次会话结束的时间，冷却从这里起算 |

放行规则（每次 `pump()` 从队首扫一遍）：

1. 名额未满，且（不是新会话 或 冷却已过）→ 放行；
2. 否则如果等待者有活跃祖先 → 让祖先 `suspend`，放行；
3. 都做不到 → 停手。若有被冷却挡住的新会话，就在 `lastEndedAt + cooldownMs` 安排一次唤醒。

冷却按**最近一次结束**起算：排队期间又有会话结束会重置冷却。因为同时最多只有 3 个会话在跑，
重置最多发生 3 次，之后不会再有结束，队列一定会推进——不会饥饿。

## 为什么需要名额接管

没有接管时，下面这条链会死锁：

| 时刻 | 状态 |
|---|---|
| 3 个根会话都在跑，各派一个子智能体 | 名额 3/3（根会话） |
| 子会话请求准入 | 名额满，排队 |
| 根会话在等子会话的结果 | 不会结束、也不会让出名额 |
| 子会话在等名额 | 永远不会跑 → 根会话永远等不到结果 |

所以等待者带一条「活着的上级链」（`session.header.parentSession` 往上走，仅 `origin: 'subagent'`
的会话有）；名额满时把链上第一个仍在跑的祖先暂停，让后代顶上，上限不变、依赖链继续推进。父会话
在下次提出 step 时重新排队。

## 判定「新会话」

| 来源 | 时机 |
|---|---|
| `agent/created` | 创建时 `turnBoundaryOf(session).lastTurn === 0`（新建会话、新派出的子智能体） |
| 插件激活 | 对 `ctx.agents.list()` 里还没跑过回合的会话补登记 |

一旦放行就从 `pendingNew` 删除，所以同一会话后续的对话不再等冷却；排队中被取消的会话仍然算
「新会话」，下次启动照旧等冷却。

## 实现文件

| 文件 | 角色 |
|---|---|
| [`index.ts`](../dsh-active-session-limit/index.ts) | 插件入口：Config、`inject: ['agents']`、四条 `agent/*` 接线、上级链计算 |
| [`src/limiter.ts`](../dsh-active-session-limit/src/limiter.ts) | 名额 / 冷却 / 排队 / 接管的纯状态机 |
| [`test/limiter.test.mjs`](../dsh-active-session-limit/test/limiter.test.mjs) | 状态机行为（假时钟）：准入、冷却、取消、接管、销毁、卸载 |
| [`test/plugin.test.mjs`](../dsh-active-session-limit/test/plugin.test.mjs) | 接线行为（假 ctx）：接管、新会话冷却、子会话接管、取消、卸载 |
| [`contract.json`](../dsh-active-session-limit/contract.json) + [`check-contract.mjs`](../dsh-active-session-limit/check-contract.mjs) | 上游接线契约校验（`pnpm check:css`） |
| [`cordis.patch.yml`](../dsh-active-session-limit/cordis.patch.yml) | 挂载行与默认配置 |
| `locale/en.json`、`locale/zh.json`、`icon.svg` | 插件页标题 / 说明 / 图标 |

## 配置

```yaml
- id: dsh-active-session-limit
  name: dsh-active-session-limit
  config:
    maxActive: 3        # 同时活跃的会话上限，含子智能体
    cooldownMs: 5000    # 上一个会话结束后，新会话要再等的毫秒数；0 只保留名额限制
```

两个值都有 schema（整数、下限、上限 256 / 600000），改动会重新挂载本行、队列随之清空。

## 契约与静默失败

插件只靠上游的 `agent/*` 事件和 `ctx.agents` 工作，改名不会报错、只会静默退化。`check-contract.mjs`
把清单逐条对 DSH 安装产物 grep 一遍，缺一条就显式失败：

| 契约 | 被改名后的表现 |
|---|---|
| `agent/pre-step`（`dsh-agent-loop`） | 闸门不再触发：不限流、不排队 |
| `agent/status` + `"idle" : "running"`（`dsh-agent-loop`） | 「结束」认不出来：名额永不释放，队列卡死 |
| `agent/created` / `agent/disposed`（`dsh-agent`） | 新会话不登记、销毁的会话留痕 |
| `turnBoundaryOf` / `lastTurn`（`dsh-agent`） | 判不出新会话，冷却适用范围退化 |
| `parentSession`（`dsh-session`）/ `origin: "subagent"`（`dsh-subagent`） | 上级链不可信，名额接管失效 |
| `super(ctx, "agents")`（`dsh-agent`） | `inject: ['agents']` 等不到服务，插件整体不激活 |

## 验证

```bash
pnpm --filter dsh-active-session-limit typecheck
pnpm --filter dsh-active-session-limit test
pnpm --filter dsh-active-session-limit check:css
```

- 状态机 13 组断言：三个名额、排队、新会话冷却（4999 / 5000 ms 边界）、已有会话不等冷却、
  取消不占名额、子会话接管、暂停中结束也起算冷却、销毁、激活接管、卸载放行、日志。
- 接线 7 组断言：默认配置、激活接管、新会话冷却、子会话接管、取消的 `AbortError`、排队中销毁、
  卸载放行。
- 挂载后：插件行出现在「设置 → 插件」，标题 / 说明 / 图标来自 `locale/*.json` 与 `icon.svg`；
  新开第 4 个会话发消息时，宿主日志出现 `is waiting for a free slot`，前一个会话结束后约 5 秒
  出现 `admitted after waiting ...`。

## 已知边界

- **只统计本进程内的智能体**：进程外的子智能体提供方（external subagent provider）不经过这里的
  `agent/*` 事件，不计入。
- **排队期间的提示词不落日志**：闸门在 `agent/pre-step`，宿主在装配之后、提交之前把它挂住；这时
  进程重启会丢掉排队中的这一轮（与普通取消一致，不是新增的持久化问题）。
- **「开始启动」指第一个模型请求**：新建会话的 Host 调用已经返回、会话已经可见，被挡住的是它的
  第一个 step。
- **冷却按最近一次结束起算**：会话密集结束会把新会话推迟到最后一轮结束 + 5 秒（最多 3 次重置）。
- **同会话的多 step 不重复排队**：一段运行内部的多个 step 只占一次名额、只过闸门一次。
- **与上游子智能体容量的关系**：子智能体服务自己的 `maxActiveSubagents`（默认 8）超额会直接报错；
  本插件是全局排队，两者同时生效，先报错的仍是上游那道。
- **主会话也在管辖内**：包括正在跟你对话的这个会话——它同样占名额、同样会给新会话起算冷却。
