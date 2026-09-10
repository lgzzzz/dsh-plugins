# dsh-fork-inbox-guard

让**分叉出来的子会话不再继承源会话「已入队但尚未被认领」的输入**。

## 现象

源会话某个 turn 还在跑时，你在源会话里补发了一条消息；然后点某条**助手最终回复**
下方的分叉按钮进入新会话，再输入一条新消息并发送。结果：发给大模型的第一条用户
消息是**分叉前那条补发的旧消息**，而你刚输入的新消息反而留在队列里显示为排队中。

## 根因（上游 0.1.5-rc.1 的 fork 切点）

1. 运行中补发的消息走 `mode: "queue"`：`prompt()` → `agent.followup(message)` →
   `agent.send(message, "next-turn", true)` → `inbox.splice(...)`，落一条
   `agent/inbox/spliced`（insert）。它位于该 turn 的 `turn/start` 与 `turn/end`
   **之间**；而它被认领（claim）发生在**下一个** turn 的 `preStep`，即下一个
   `turn/start` **之后**。
2. 分叉按钮把助手消息事件的 seq 交给 `session.fork({ atSeq })`，宿主侧切点是
   「目标轮 `turn/end` 之后、下一轮 `turn/start` 之前」的全部事件
   （`dsh-api-session-controller/lib/index.js` 的 `fork()`：`cut` 会前推到下一个
   `turn/start`）。于是子会话 seed **带走了那条 insert，却没带走配对的 claim**。
3. inbox 不是内存态，而是从日志里的 `agent/inbox/spliced` 折叠出来的持久投影
   （`dsh-agent-loop` 的 `inboxProjectionDefinition`）；子会话的投影 cell 会 fold
   整个日志（含 seed）。于是子会话凭空多出一条 pending 消息。
4. 子会话不会自动起跑（fork 不唤醒驱动）。等你发下一条消息时才被唤醒，而
   `inbox.claim()` 的语义是「`next-step` 全部 + **`next-turn` 恰好一条**」，继承来
   的那条排在队首 → 旧消息先被发给模型，你自己的消息留下排队。

## 修法

监听宿主事件 `agent/created`（fork 返回前已同步派发，而在那之前子会话不可能跑过
任何 turn），对 seeded 会话：

1. 折叠**继承前缀** `events[0, inheritedEventCount)` 里的 inbox splice，得到「在切点
   上仍处于 pending」的消息 id 集合；
2. 与子会话**当前** pending 队列求交；
3. 只对命中的 id 调 `agent.inbox.remove(id)`，在**子会话自己的日志**里追加一条
   `agent/inbox/spliced`（`outcome: 'canceled'`）。

不触碰源会话日志，不改 fork 的 seed，也不改任何全局包。

为什么是「前缀折叠 + 求交」而不是 `inbox.clear()`：

- `clear()` 会清掉子会话**自己**排队的消息（resume 场景确实存在）；
- `inheritedEventCount` 恰好是「继承前缀」的权威边界：前缀折叠出的 pending id 与
  当前 pending 求交，命中的就是要丢弃的幽灵消息；
- 消息 id 由控制器用 `randomUUID()` 生成，子会话自己的新消息不可能与前缀里的 id
  相同，所以交集不会误伤。

## 行为边界

| 情况 | 行为 |
| --- | --- |
| 源会话运行中队列里有消息，从该轮助手回复分叉 | 移除继承的幽灵消息（落一条 `canceled`） |
| 源会话队列为空时分叉 | 前缀无 insert → 不动作 |
| **子代理 fork**（`completedTurnPrefix` 切在最后一个 `turn/end`） | **显式跳过 + 天然无交集 → 零改动** |
| 普通新建会话（非 seeded） | `inheritedEventCount === 0` → 不动作 |
| resume 的 fork 子会话 | 继承前缀已配对 → 交集为空；其**自己**在切点后排队的消息保留 |
| 守卫处理之后子会话自己排队的消息 | 保留（seq ≥ `inheritedEventCount`） |
| 已被认领的继承消息 | 不在当前 pending 里 → 不重复处理 |
| 重复调用 / 双挂载 | 幂等（`inbox.remove` 第二次返回 false，不追加事件） |
| 注册表不可用（`ctx.get('agents')` 返回 undefined） | 保守不动作 |
| 日志或 inbox 结构异常 | 降级为一行 `warn`，**绝不外逸**（同步 listener 抛错会否决 Agent 发布） |

### 为什么子代理派发不受影响

上游 `dsh-subagent-fork-in-process` 的 `completedTurnPrefix()` 恰好切在**最后一个
`turn/end`（含）**，而 `claim` 必然发生在某个 `turn/start` 之后，因此：

- 切点**之前**的轮内 splice 全部成对 → 前缀折叠结果为空；
- 切点**之后**的在飞 insert（当前工具调用轮里补发的消息）被直接排除在 seed 之外。

两条都使「继承 pending 集合」为空，交集为空 → 一条消息都不移除、一条事件都不追加
（`test.mjs`「保留：balanced 前缀」「保留：子代理切点把运行中补发的 insert 排除在外」
两组断言即验证此点）。插件另外用 `ctx.agents.isOwnedBy` **显式跳过**有 runtime
owner 的子代理，让这条边界成为可读契约而非隐式巧合。

## 已知限制

- **补偿式修复**：不改 seed，因此子会话日志里仍保留继承前缀中的 `agent/inbox/spliced`
  （insert）事件，只是随后补了一条 `canceled` 的移除事件。逐事件读原始日志（导出、
  审计）仍能看到这条「曾存在的幽灵」。根治需上游让 fork 前缀落在平衡状态（裁剪或
  补 canceled）。
- **只修新分叉**：插件加载**之前**就已创建、且继承消息已被认领的子会话无法回滚。
- **不改变 fork 的种子语义**：`dsh-session` 的 `SessionStore.fork()` 是另一条 fork
  路径（Web 端不走它）；本插件按 `agent/created` 统一生效，与该路径无关。
- 与附件无关的既有行为不受影响；若幽灵消息带文件 receipt，它也一并被移除（那份
  receipt 本就绑在源 agent 上，子会话无法解析）。

## 加载配置

本插件以本地 npm 包形式经 Web Profile 的 `link:` 依赖挂载（详见工作区 `AGENTS.md`
「挂载与激活」）。从插件目录执行：

```sh
dsh plugin --profile web add link:.
# 重启 App 生效（宿主半部为常驻挂载，不做热重载）
```

`dsh plugin` 是 pnpm 转发器：执行 `pnpm add` 后会自动核对 `dsh.profile.bundles` ——
声明了 `dsh.bundle` 的依赖自动并入 bundle 列表，无需手动改
`~/.dsh/profiles/web/package.json`。

卸载：

```sh
dsh plugin --profile web remove dsh-fork-inbox-guard
```

> 加载属于用户操作：代理交付插件后不得自行执行 `dsh plugin add`、`pnpm install`
> 或重启 App（工作区强制规范第 1 条）。

## 本地验证

```sh
npm run typecheck   # tsc --noEmit（本机全局 tsc 即可）
node test.mjs       # 或用 npm test
```

类型解析依赖 `node_modules/@deepseek-ai` 指向全局 dsh 内置 scope 的 junction
（重装全局 dsh 包后需重建）：

```powershell
New-Item -ItemType Junction -Path node_modules\@deepseek-ai `
  -Target (Get-Item <repo>\dsh-git-guard\node_modules\@deepseek-ai).Target
```

`test.mjs` 用**真实的** `@deepseek-ai/dsh-session` 构造 seeded 子会话（seed 就是上游
fork 切点产出的「带 insert、缺 claim」的前缀），覆盖：

- 前缀折叠语义：insert 未配对 → pending；配对后消失；`next-step`/`next-turn` 都识别；
  越界 `start`/`removedCount` 按上游钳制规则处理；畸形 splice 跳过且不影响后续；
- 会话筛选：非 seeded / `inheritedEventCount` 非正或非安全整数 / 结构异常 → 不动作；
  只折叠继承前缀，切点之后的事件不参与；
- 移除路径（真实 Session）：`canceled` splice 被真 Session 接受并追加、折叠回到平衡、
  只记一行不含正文的日志、重复调用幂等、源会话零改动；
- 保留语义：切点之后自己排队的消息保留；balanced 前缀（子代理形态）零追加；resume
  形态保留自己的消息；
- 插件入口：注册监听、子代理显式跳过（零日志零改动）、注册表不可用时保守不动作、
  异常降级为 warn 且绝不外逸。

手工回归（加载后）：

1. 在会话 A 跑一个较长 turn，期间在 A 再补发一条消息；
2. 侧栏「分叉会话」分叉 A（或点助手回复下的分叉按钮），在子会话里发一条新消息；
3. 子会话首轮 `user/message` 应为你刚发的那条，QueueDock 里不应出现你没在子会话里
   发过的排队项；
4. 让一个子代理以 `fork` 上下文派发，确认其会话日志与行为无任何变化；
5. 源会话 A 的处理不受影响。
