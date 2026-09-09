# dsh-fork-inbox-guard

让**分叉会话不再继承源会话「已发出但未被认领」的输入**。

DSH 0.1.5-alpha.1 的会话 fork 切点会把「最后一个 `turn/end` 之后、下一个
`turn/start` 之前」的事件一并纳入 seed（`dsh-api-session-controller` 的
`fork()` 会把 `cut` 前推到下一个 `turn/start`）。用户消息的入队是
`agent/inbox/spliced` 事件，而 **inbox 是从会话日志折叠出来的持久投影**
（`dsh-agent-loop` 的 `inboxProjectionDefinition`，新会话的投影会 fold 整个
日志含 seed）。于是：

- 源会话在 turn 运行中分叉时，该 turn 的「入队」splice 落在切点内、对应的
  「认领」splice 落在切点外 → 子会话凭空多出一条 pending 消息；
- 子会话不会自动起跑（没有 wake），等你发下一条消息时，第一个 turn 的
  `claim()` 先取走继承来的那条 → 分叉前那条没完成的消息被「一起」发给模型，
  而你自己刚输入的消息反而排在后面。

本插件在宿主侧监听 `agent/created`，对 seeded 会话折叠继承前缀
`events[0, inheritedEventCount)` 里的 inbox splice，求出**在切点上仍 pending**
的消息 id，再与子会话当前的 pending 队列求交，只移除命中的那些。

## 行为边界

| 情况 | 行为 |
| --- | --- |
| fork 子会话继承了 pending 输入 | 移除（落一条 `agent/inbox/spliced` `outcome: 'canceled'`） |
| 子会话**自己**在分叉后排队的消息 | 保留（seq ≥ `inheritedEventCount`） |
| 已被认领的继承消息 | 不在当前 pending 里，不重复处理 |
| 普通（非 seeded）会话 | `inheritedEventCount === 0` → 前缀为空，不动作 |
| 重启后 resume 的 fork 子会话 | 同样生效；其自身排队消息保留 |
| 子代理 fork（seed 以 `turn/end` 结尾） | 天然不含 pending splice，无副作用 |
| 源会话 | 完全不触碰（那条消息在源会话里仍是真实输入） |

日志：每次实际移除会经 `ctx.logger.info` 记录一行（数量 + 会话 id），不记录
消息正文。监听整体 `try/catch`——同步 listener 抛错会否决 Agent 发布，因此任何
异常（含 logger 自身抛错）都被吞掉。

## 为什么用「前缀折叠 + 求交」而不是 `inbox.clear()`

`clear()` 会清掉子会话**自己**排队的消息（resume 场景下确实存在），而
`inheritedEventCount` 恰好是「继承前缀」的权威边界：前缀里折叠出的 pending
id 与当前 pending 队列的交集，就是要丢弃的幽灵消息。折叠按上游同样的
`toSpliced` 语义与钳制规则实现；形状非法的 splice 被跳过而不是抛错。

## 实现说明

- 纯 TypeScript 宿主半部（`index.ts`），由 App 内置的 Node 22 Type Stripping
  直接加载，无编译步骤、无浏览器半部；`package.json` 必须保持
  `"type": "module"`，且只能使用可擦除语法（无 enum / 命名空间 / 参数属性）。
  `tsconfig.json` 开启 `erasableSyntaxOnly` 强制该约束。
- 不消费任何宿主服务：只注册 `agent/created` 事件，因此
  `cordis.patch.yml` 的挂载行不声明 `inject`。
- `agent/created` 与 `Agent` / `Inbox` 的类型经 `import type` 从
  `@deepseek-ai/dsh-agent` 引入（运行时被 Type Stripping 擦除）；插件体内对
  session / inbox 只使用本地结构切片，便于单测用 fake agent 驱动。
- 文件上传 receipt 的绑定属于**源** agent（子会话没有为继承消息绑定过
  receipt），因此这里直接 `agent.inbox.remove(id)` 即可，无需退役 receipt。

## 加载配置

本插件以本地 npm 包形式经 Web Profile 的 `link:` 依赖挂载（详见工作区
`AGENTS.md`「挂载与激活」）。从插件目录执行：

```sh
dsh plugin --profile web add link:.
# 重启 App 生效
```

`dsh plugin` 是 pnpm 转发器：执行 `pnpm add` 后会自动核对
`dsh.profile.bundles` —— 声明了 `dsh.bundle` 的依赖自动并入 bundle 列表，
无需手动改 `~/.dsh/profiles/web/package.json`。

卸载：

```sh
dsh plugin --profile web remove dsh-fork-inbox-guard
```

> 加载属于用户操作：代理交付插件后不得自行执行 `dsh plugin add`、
> `pnpm install` 或重启 App（强制规范第 1 条）。

修改 `index.ts` 后需重启 App 生效（宿主半部为常驻挂载，不做热重载）。

## 本地验证

类型解析依赖 `node_modules/@deepseek-ai` 指向全局 dsh 内置 scope 的 junction
（重装全局 dsh 包后需重建）：

```sh
npm run typecheck        # tsc --noEmit（本机全局 tsc 即可）
node test.mjs            # 或用 npm test
```

`test.mjs` 用**真实的** `@deepseek-ai/dsh-session` 构造 seeded 会话，覆盖：

- 前缀折叠：insert 后又被 claim 的不算 pending；`next-step` 同样识别；
  部分移除后只留剩余；越界 splice 按上游钳制规则处理；
- 形状非法的 splice（`null`、未知 target、缺 `inserted`、`start`/`removedCount`
  非数字、条目缺 id）被跳过且不影响后续合法 splice；
- 移除只命中继承 pending，子会话自身排队消息保留；重复调用幂等；
- 非 seeded / `inheritedEventCount === 0` / 结构异常的 agent 均不动作、不抛错；
- `agent/created` 监听注册、正常移除与日志、异常降级为 `warn`、
  logger 自身抛错不外逸。

手工回归（加载后）：

1. 让 A 会话跑一个较长 turn，期间在 A 再发一条消息；
2. 侧栏「分叉会话」分叉 A，在子会话里发一条新消息；
3. 子会话首轮 `user/message` 应为你刚发的那条（而不是分叉前那条），
   QueueDock 里不应出现你没在子会话里发过的排队项；
4. 源会话 A 的处理不受影响。

## 已知限制

- 只处理 `agent/created` 之后的**仍 pending** 的继承消息；若在插件加载前某条
  继承消息已被认领（例如插件是后装的、而子会话早已跑过一轮），无法回滚。
- 不改变上游 fork 的 seed 内容，因此子会话日志里仍保留继承前缀里的
  `agent/inbox/spliced`（insert）事件，只是随后补了一条 `canceled` 的移除事件。
  若希望从源头不带入，需要上游改切点（见工作区分析：方案 A/B）。
- `dsh-session` 的 `SessionStore.fork()` 是另一条 fork 路径（Web 端不走它），
  本插件按 `agent/created` 统一生效，与该路径无关。
