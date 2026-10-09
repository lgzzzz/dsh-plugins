# 停止桥接（`Esc Esc`）

> 本文件是 [dsh-focus-free-shortcuts 说明](../dsh-focus-free-shortcuts.md) 的第 4 册：`Esc Esc` 停止序列的桥接实现，以及「每按恰好一个 owner」的归属不重叠条件。

-----

## 5.7 停止桥接：`handleStopInput` 逐行

```ts
function handleStopInput(ctx, shortcuts, sessions, sequence, input) {
  const gesture = input.gesture
  const context = input.context

  if (!escapeEligible(gesture, context)) { sequence.reset(); return }      // ①
  if (conversationOwnsTarget(context.target)) { sequence.reset(); return } // ②

  const candidate = resolveStopSession(ctx, sessions)
  if (candidate === undefined) { sequence.reset(); return }                // ③

  input.consume()                                                          // ④
  if (!sequence.press({ sessionId: candidate.sessionId, binding: candidate.binding })) return  // ⑤

  cancelSession(sessions, candidate.sessionId)                             // ⑥
}
```

### 5.7.1 ① 资格检查 `escapeEligible`

```ts
function escapeEligible(gesture, context) {
  return gesture.code === 'Escape'
    && !gesture.repeat && !gesture.composing && !gesture.defaultPrevented
    && !gesture.control && !gesture.alt && !gesture.shift && !gesture.meta
    && context.modal === null
    && context.region !== 'terminal'
}
```

必须**全部**满足：是 `Esc` 键、不是长按重复、不在组字、没被消费、不按任何修饰键、没有模态弹窗、不在终端里。任一条不满足 → `sequence.reset()` 并返回（不消费）。这些条件与内置 `installStopShortcut()` 装起来的那条固定监听器的资格门槛逐条相同，只差它另外要求 `context.target !== null`；`response.stop` 只是同一处登记进固定目录的那行键位（`Esc` `Esc`），自身不做判定。

### 5.7.2 ② 归属让位 `conversationOwnsTarget`

```ts
function conversationOwnsTarget(target) {
  if (target === null || typeof target.closest !== 'function') return false
  const occurrence = target.closest('[data-conversation-session]')
  const region = target.closest('[data-conversation-region]')
  if (occurrence === null || region === null) return false
  if (!occurrence.contains(region)) return false
  return target.closest('[data-approval-key], iframe, .xterm, [inert]') === null
}
```

target 落在 `[data-conversation-session]` 之内、`[data-conversation-region]` 也在该 occurrence 之内，同时又不在 `[data-approval-key], iframe, .xterm, [inert]` 中时，判定为"内置停止监听器会处理这一按"，插件 `reset()` 并返回（不消费）。选择器与内置 `installStopShortcut()` 的归属判定相同。

#### 5.7.2.1 内置序列 `StopSequence` 的比较字段

内置的 `Esc Esc` 停止不是一条"查目录、匹配键位、执行"的普通命令，而是官方 `@deepseek-ai/dsh-client-ui-conversation` 里 `installStopShortcut()` 装起来的一个**固定输入监听器 + 一个两按状态机 `StopSequence`**。它同样通过 `shortcuts.observeFixedInput()` 挂在固定输入通道上，因此与插件同处一个 `fixedListeners` 列表。

`StopSequence.press()` 的比较逻辑（`dsh-client-ui-conversation/lib/client.js`）：

```js
press(target) {
  const first = this.first
  this.reset()
  if (first !== undefined
      && performance.now() <= first.deadline
      && first.target.sessionId === target.sessionId
      && first.target.turn === target.turn
      && first.target.generation === target.generation
      && first.target.region === target.region) {
    target.cancel()          // 四个身份全等 → 触发停止
    return true
  }
  this.first = { target, deadline: performance.now() + this.intervalMs }
  this.timer = setTimeout(() => this.reset(), this.intervalMs + 1)
  return false               // 否则把这一下记成"新的第一下"
}
```

它要求两下 Esc 解析出的 `StopTarget` 在四个字段上全部相等：

```ts
interface StopTarget {
  readonly sessionId: SessionId   // 会话 id
  readonly turn: number           // 轮次序号 —— 这就是"轮次身份"
  readonly generation: object     // 物化出来的 Session binding 对象（引用身份）
  readonly region: Element        // 这次焦点所在的 [data-conversation-region] DOM 元素
  readonly cancel: () => void     // 真正执行停止的回调
}
```

| 字段 | 含义 | 两下不一致时 |
|---|---|---|
| `sessionId` | 会话 id | 跨会话的两下拼不成一次停止 |
| `turn` | 当前会话时间线里"正在进行的这一轮"的序号 | 中间换了轮次（A→B），第一下作废 |
| `generation` | 物化的 Session binding 对象，按引用比较 | 会话被替换成新的 binding，第一下作废 |
| `region` | 这次焦点所在的 `[data-conversation-region]` 元素 | 该 DOM 元素重新挂载，第一下作废 |

`turn` 由 `installStopShortcut` 现场解析，每次按键重新读一次：

```js
const sessionId = occurrence.dataset.conversationSession   // 从 DOM 反推会话 id
const binding = sessions.binding(sessionId)                // 该会话的"物化绑定"对象
const turnSource = openTurn(binding)                       // 该绑定下"当前打开的轮次"的可观察源
const currentTurn = () => {
  const session = binding.session.getSnapshot()
  if (!session.running || session.removed
      || (session.subagent !== null && session.subagent.address.mode !== 'continuable')
      || uiSession.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction !== undefined) {
    return undefined
  }
  return turnSource.getSnapshot()                          // ← 返回当前轮次的序号
}
const turn = currentTurn()                                 // 每一按都**现场重新解析**一次
```

其中 `running` / `removed` / `subagent` / `pendingInteraction` 四项与插件 `resolveStopSession` 的条件相同（见 5.7.3）。

轮次变化后第一下作废有两条路径：订阅 `turnSource` / `binding.session` / `uiSession.sessionStatus` 后，回调里发现 `currentTurn() !== turn` 或 `sessions.binding(sessionId) !== binding` 即 `reset()`；以及 `press()` 里的 `first.target.turn === target.turn` 比较为 `false`，把第二下记成新的第一下。两条路径结果一致：轮次 A 不会被停。

#### 5.7.2.2 插件的序列身份 `StopToken`

插件序列的身份只有两个字段（`src/stop-sequence.ts`）：

```ts
interface StopToken {
  readonly sessionId: string
  readonly binding: unknown        // Session binding 对象本身，引用即"代际"
}
function sameStopToken(left, right) {
  return left.sessionId === right.sessionId && left.binding === right.binding
}
```

插件比较 `sessionId` 与 `binding`（同一对象），不比较 `turn`（拿不到），也不使用焦点区域。因此两按之间轮次恰好结束并立刻开启新轮次时，插件仍会凑成一次停止；内置会因 `turn` 变化而复位（见 [第 7 节](06-boundaries-and-contracts.md) 边界表）。

由此确定让位条件：target 落在会话区域内时，内置手里的 `turn` / `region` 证据多于插件能读到的事实，这一按交给内置；插件只在内置会因 `context.target` 不满足归属而 `reset` 的场景出手，此时内置绝不动作。

### 5.7.3 ③ 免聚焦解析 `resolveStopSession`

```ts
function resolveStopSession(ctx, sessions) {
  const list = sessions.list.getSnapshot()
  const sessionId = mainViewSessionId(list)          // 找主视图持有的会话
  if (sessionId === undefined) return undefined
  if (!list.byId[sessionId]?.running) return undefined
  const binding = sessions.binding(sessionId)
  if (binding === undefined) return undefined
  const snapshot = binding.session.getSnapshot()
  if (!snapshot.running || snapshot.removed) return undefined
  if (snapshot.subagent !== null && snapshot.subagent.address.mode !== 'continuable') return undefined
  const uiSession = ctx.get('uiSession')
  const pending = uiSession?.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction
  if (pending !== undefined) return undefined
  return { sessionId, binding }
}
```

逐条说明：

- `mainViewSessionId(list)`：在 `sessions.list` 里找"被主视图持有（retain）的会话"，依据 `list.byId[id].retainedBy.mainView > 0`（主视图对该会话的引用计数），与 `UiSession.isMain` 读的是同一事实。主视图持有的会话数不等于 1（比如正在切换会话）时返回 `undefined`——不响应，也不停错会话。
- `list.byId[sessionId]?.running !== true` → 会话不在运行（没在生成回复），没东西可停。
- `sessions.binding(sessionId)` 拿不到 → 放弃；这个 binding 对象同时用作"代际"身份。
- binding 的会话快照要"正在运行且未移除"（`snapshot.running` / `snapshot.removed`）。
- 子代理会话要求 `subagent.address.mode === 'continuable'`（可续的）才允许停，否则不碰（与内置 `currentTurn` 同一条件）。
- `pendingInteraction !== undefined`（有待答的审批 / 提问）→ 不停止（与内置一致）。

全部通过才返回 `{ sessionId, binding }`，作为要停的目标。

### 5.7.4 ⑤ 双按序列 `createStopSequence`

停止是"连按两下 `Esc`"的序列，需要记住第一下并在窗口内判断第二下：

```ts
function createStopSequence({ intervalMs, now, same }) {
  let first
  let timer
  const reset = () => { first = undefined; clearTimeout(timer); timer = undefined }
  return {
    press(token) {
      const previous = first
      reset()
      if (previous !== undefined && now() <= previous.deadline && same(previous.token, token)) return true
      first = { token, deadline: now() + intervalMs }
      timer = setTimeout(reset, intervalMs + 1)
      return false
    },
    reset,
  }
}
```

- `intervalMs` 取自 `shortcuts.stopSequenceMs`（默认 **500ms**）。
- `press(token)` 返回 `true` 表示这一下凑成了第二下、应当停止；返回 `false` 表示这只是第一下（或窗口已过），先记下来。
- `same` 默认是 `sameStopToken`：要求两下的 `sessionId` 相同、且 `binding` 是**同一个对象**（同一代际）。
- `reset()` 清掉第一下和计时器。触发 reset 的输入来源：非 keydown 的固定输入（`type === "reset"`）、焦点变化、`pointerdown`、组合输入开始 / 结束、模态变化、窗口失焦。
- 第一下也 `consume()`（第 ④ 步）：一个被接受的半序列 `Esc` 不漏给浏览器或本地控件，因此不会触发"取消当前编辑"之类的其它 Esc 语义。

### 5.7.5 ⑥ 停止 `cancelSession`

```ts
function cancelSession(sessions, sessionId) {
  const scoped = sessions.scope(sessionId)
  const conversation = scoped?.get('conversation')
  if (conversation === undefined || typeof conversation.cancel !== 'function') {
    warn(`conversation service unavailable for session ${String(sessionId)}; stop not sent`)
    return
  }
  conversation.cancel().catch((error) => warn(`stop failed for session ${String(sessionId)}:`, error))
}
```

- `sessions.scope(sessionId)` 拿到该会话的服务作用域；
- `scope.get('conversation')` 拿到该会话的会话服务（提供 `cancel()`）；
- `conversation.cancel()` 就是 composer 上 Stop 按钮调用的同一个操作；
- 服务缺失时 `warn` 告警；失败被 `.catch` 捕获并告警，不会冒泡成未处理的 Promise 拒绝。

## 5.8 归属不重叠（每按恰好一个 owner）

- **面板键**：归属由"焦点"这一个事实唯一决定。焦点在 pane 内 → [5.3](03-fixed-input-and-pane-keys.md) 的 ④ 让位，内置 `dispatch` 独占；焦点不在 → 插件 ⑦ 先消费，内置 `dispatch` 在首行 `defaultPrevented` 处退出。
- **停止**：插件与内置 `response.stop` 都在 `fixedListeners` 里，执行顺序取决于注册先后，靠两重机制保证互斥：
  - **（a） 显式让位**：② `conversationOwnsTarget` 让插件在"target 落在会话区"时主动放弃（不消费）；
  - **（b） 共享 `consumed` 标志**：即便顺序反了，谁先 `consume()`，另一个 listener 都会看到 `gesture.defaultPrevented === true` 而退出（① 资格检查里含 `!defaultPrevented`）。

> **审批键与停止序列的交叉点**：有待答审批时，`Esc` 不是"第一下停止"而是"一下拒绝"。内置 `currentTurn()` 与插件 `resolveStopSession` 都以 `pendingInteraction !== undefined` 为门槛拒绝停止，所以停止侧既不动作也不消费这一按。审批桥的实现与它自己的让位策略见 [第 5 册](05-approval-key-bridge.md)（第 5.9 节）。

> **提问卡片与停止序列的交叉点**：有待答提问时，`Esc` 是提问卡片自己的取消——按卡片关闭 / 取消按钮的同一个语义调 `PendingQuestion.dismiss()`。停止侧门槛与上一条相同，因此这一按在停止序列眼里连"第一下"都记不下来。提问桥在"这个槽位此刻发布的是提问域卡片"（`kind` 为 `question` / `plan-review`、`key` 是字符串、带 `dismiss()`）时才接下这一按。一个会话同一时刻只发布一个待答交互（跨域优先级由 `dsh-client-ui-session` 的 `publishPendingInteractions` 决定），所以审批桥与提问桥不可能同时认领同一按。细节见 [第 5 册](05-approval-key-bridge.md) 第 5.9.3、5.10 节与 [第 6 册](06-boundaries-and-contracts.md) 第 7 节。
