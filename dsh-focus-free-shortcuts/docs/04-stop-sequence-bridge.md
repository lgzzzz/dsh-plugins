# 停止桥接（`Esc Esc`）

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 4 册：`Esc Esc` 停止序列的桥接实现，以及「每按恰好一个 owner」的归属不重叠论证。

---

### 5.4 停止桥接：`handleStopInput` 逐行

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

#### 5.4.1 ① 资格检查 `escapeEligible`

```ts
function escapeEligible(gesture, context) {
  return gesture.code === 'Escape'
    && !gesture.repeat && !gesture.composing && !gesture.defaultPrevented
    && !gesture.control && !gesture.alt && !gesture.shift && !gesture.meta
    && context.modal === null
    && context.region !== 'terminal'
}
```

必须**全部**满足：是 `Esc` 键、不是长按重复、不在组字、没被消费、不按任何修饰键、没有模态弹窗、不在终端里。这逐条镜像了内置 `response.stop` 的资格门槛（只是不要求 target 非空，因为插件本来就不靠 target）。任何一条不满足 → `sequence.reset()` 并返回（不消费）。

#### 5.4.2 ② 归属让位 `conversationOwnsTarget`

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

这一条**逐字复刻**了内置 stop guard 的归属部分：如果这一按的 target 落在会话区域内（且不在审批/iframe/终端/inert 里），说明**内置 `response.stop` 会处理这一按**，插件就必须让位（`reset` 并返回，不消费）。

为什么要让位，而不是独自处理？因为内置序列手里有插件拿不到的东西：**轮次身份（turn identity）**。下面把「内置序列」「轮次身份」「它靠什么区分两个轮次」三件事分别讲清楚。

#### 5.4.2.1 什么是「内置序列」（built-in sequence）

内置的 `Esc Esc` 停止不是一条"查目录、匹配键位、执行"的普通命令，而是官方 `@deepseek-ai/dsh-client-ui-conversation` 里 `installStopShortcut()` 装起来的一个**固定输入监听器 + 一个两按状态机 `StopSequence`**。它和插件一样，通过 `shortcuts.observeFixedInput()` 挂在固定输入通道上（所以两者都在同一个 `fixedListeners` 列表里）。

官方 `StopSequence.press()` 的完整比较逻辑（`dsh-client-ui-conversation/lib/client.js`，去掉了注释）：

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

注意：它不是只比较「是同一个会话」这么粗。它要求两下 Esc 解析出的 `target` 在**四个维度**上全部相等。这个 `target` 的类型叫 `StopTarget`：

```ts
interface StopTarget {
  readonly sessionId: SessionId   // 会话 id
  readonly turn: number           // 轮次序号 —— 这就是"轮次身份"
  readonly generation: object     // 物化出来的 Session binding 对象（引用身份）
  readonly region: Element        // 这次焦点所在的 [data-conversation-region] DOM 元素
  readonly cancel: () => void     // 真正执行停止的回调
}
```

#### 5.4.2.2 什么是「轮次身份」（turn identity）

就是上面 `StopTarget.turn: number` 这个字段——**当前会话时间线里「正在进行的这一轮」的序号**。

它从哪来（官方 `installStopShortcut` 里的关键几步）：

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

- 一个会话里，用户每提交一次、Agent 开始新的一轮，`turn/start` / `turn/end` 事件就会让这个序号推进（`turn` 是整数序号）。所以「轮次 A」和「轮次 B」本质是**两个不同的整数**（例如 42 和 43）。
- 关键在于 `currentTurn()` **不是第一下按下时缓存一次就永远不变的**：它每次按键都重新读 `turnSource.getSnapshot()`。所以第一下和第二下各自解析出的 `turn` 可以不同。

#### 5.4.2.3 四个字段各管什么（为什么不是只比 `sessionId`）

| 字段 | 相等时表示 | 不相等时会发生什么 |
|---|---|---|
| `sessionId` | 两下打在**同一个会话**上 | 跨会话的两下永远拼不成一次停止 |
| `turn` | 两下落在**同一轮次**上 | 中间换了一轮（A→B），第一下作废 |
| `generation` | 两下对着**同一个 binding 对象** | 会话被替换（换了新的 materialized binding），第一下作废 |
| `region` | 两下焦点在**同一个 `[data-conversation-region]` DOM 元素**里 | composer 座位重新挂载（React 换了新元素），第一下作废 |

- `sessionId` 保证「不跨会话误停」；
- **`turn` 就是「轮次身份」**，保证「不跨轮次误停」；
- `generation` 保证「会话对象被换掉后，旧的那一下不再算数」（绑定替换 = 代际变化）；
- `region` 保证「焦点所有权的连续性」——两次按键必须真的落在同一个输入区域元素里。

#### 5.4.2.4 它到底怎么区分「第一下 A、第二下 A」和「第一下 A、第二下 B」

**场景一：两下都落在轮次 A（轮次 A 还没结束）**

1. 第一下 Esc：`currentTurn()` 现场解析出 `turn = 42`，`press()` 记下 `{ sessionId, turn: 42, generation: bindingX, region: regionEl }`，返回 `false`（只是第一下）。
2. 第二下 Esc（500ms 内）：`currentTurn()` 仍解析出 `turn = 42`，四个字段与第一下**全等** → `target.cancel()` → 停掉轮次 A。

**场景二：第一下落在轮次 A，第二下落在轮次 B（中间 A 结束、B 开始了）**

1. 第一下 Esc：记下 `turn = 42`。
2. 两次之间：轮次 A 发出 `turn/end`、轮次 B 发出 `turn/start`，`turnSource` 的快照从 42 变成 43。
3. 此时有**两道防线**保证不会把「属于 A 的第一下」和「属于 B 的第二下」拼成一次停止：
   - **主动防线（订阅复位）**：记下第一下后，官方代码立刻订阅 `turnSource` / `binding.session` / `uiSession.sessionStatus`，回调里只要发现 `currentTurn() !== turn`（43 ≠ 42）或 `sessions.binding(sessionId) !== binding`，就 `reset()` 把第一下作废。也就是说，**轮次一换，第一下立刻被丢掉**，不用等第二下。
   - **被动防线（比较时兜底）**：即便极端时序下订阅复位没来得及，第二下真正发生时，`press()` 里的 `first.target.turn === target.turn` 比较的是 42 vs 43，为 `false` → 不触发 `cancel()`，而是把第二下当成「轮次 B 的新第一下」重新记录。

   两种防线最终结果一致：**轮次 A 不会被停**，第二下只是开始了「轮次 B」的第一次计数。

#### 5.4.2.5 插件这边差在哪（为什么必须让位）

插件自己的序列身份只有两个字段（`src/decide.ts` 的 `StopToken` 与 `sameStopToken`）：

```ts
interface StopToken {
  readonly sessionId: string
  readonly binding: unknown        // Session binding 对象本身，引用即"代际"
}
function sameStopToken(left, right) {
  return left.sessionId === right.sessionId && left.binding === right.binding
}
```

对比：

| 维度 | 内置 `StopSequence` | 插件 `createStopSequence` |
|---|---|---|
| `sessionId` | 比 | 比 |
| `turn`（轮次身份） | **比** | **拿不到、不比** |
| `generation`（binding 引用） | 比 | 比（`binding === binding`） |
| `region`（焦点区域元素） | **比** | **不靠焦点、不比** |

所以插件**无法区分**「两下都在轮次 A」和「一下 A、一下 B」——只要 `sessionId` 相同、`binding` 还是同一个对象，它就会在 500ms 内凑成一次停止，哪怕中间已经换了轮次（这正是 [第 7 节](05-comparison-boundaries-contracts.md) 边界表里「两按之间轮次恰好结束并立刻开启新轮次 → 插件仍会停到新轮次 B，内置会因 `turn` 变化而复位」的由来）。

这也正是本节「② 归属让位」存在的意义：在「内置会掌权」的场景（target 落在会话区域内），内置手里的 `turn` / `region` 证据**严格优于**插件能读到的任何事实, 这个时候让内置处理器进行处理最准确.；所以插件选择**只在内置不掌权的场景（target 不在会话区内、内置会因为 `context.target` 不满足归属而 `reset`）出手**——此时内置绝不会动作。

#### 5.4.3 ③ 免聚焦解析 `resolveStopSession`

```ts
function resolveStopSession(ctx, sessions) {
  const list = sessions.list.getSnapshot()
  const sessionId = mainViewSessionId(list)          // 找主视图持有的会话
  if (sessionId === undefined) return undefined
  if (list.byId[sessionId]?.running !== true) return undefined
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

逐条解释：

- `mainViewSessionId(list)`：在 `sessions.list` 里找"**被主视图持有（retain）的会话**"。判定依据是 `list.byId[id].retainedBy.mainView > 0`（`retainedBy.mainView` 是主视图对这个会话的引用计数）。这是 `UiSession.isMain` 读的**同一个事实**，即"当前主视图正在显示的那个会话"。**如果主视图持有的会话数不等于 1（比如正在切换会话、恰好两个都在 retain），返回 `undefined`**——宁可这一下不响应，也不能停错会话。
- `list.byId[sessionId]?.running !== true` → 会话不在运行（没在生成回复），没东西可停。
- `sessions.binding(sessionId)`：拿到该会话的**绑定对象**（binding）。拿不到 → 放弃。这个 binding 对象后面还要用来当"代际"身份。
- `snapshot.running / removed`：binding 的会话快照要"正在运行且未移除"。
- `subagent`：如果这是个子代理会话，要求它的 `address.mode === 'continuable'`（可续的）才允许停；否则不碰（与内置 `currentTurn` 的同一条件）。
- `pendingInteraction`：如果该会话有**待答的交互**（审批/提问正在等用户回答），则不停止（与内置一致）。

全部通过，才返回 `{ sessionId, binding }`，作为要停的目标。

#### 5.4.4 ⑤ 双按序列 `createStopSequence`

停止是"**连按两下 Esc**"的序列，需要记住第一下、并在窗口内判断第二下。插件的序列是内置 `StopSequence` 的镜像：

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

- `intervalMs` 取自 `shortcuts.stopSequenceMs`（官方配置，默认 **500ms**）。
- `press(token)` 返回 `true` 表示"这一下凑成了第二下，应当停止"；返回 `false` 表示"这只是第一下（或窗口已过），先记下来"。
- `same` 默认是 `sameStopToken`：要求两下的 `sessionId` 相同、且 `binding` 是**同一个对象**（同一代际）。
- `reset()` 清掉第一下和计时器。哪些情况会触发 reset：收到非 keydown 的固定输入（`type === "reset"`）、焦点变化、pointerdown、组合输入开始/结束、模态变化、窗口失焦——这些与内置序列的复位来源一致。

**为什么第一下也要 `consume()`（第 ④ 步）**：和内置行为一致——一个被接受的半序列 Esc 也不该漏给浏览器或本地控件，所以第一下就消费掉。这样连按两下的第一下不会触发"取消当前编辑"之类的其它 Esc 语义。

#### 5.4.5 ⑥ 停止 `cancelSession`

```ts
function cancelSession(sessions, sessionId) {
  const scoped = sessions.scope(sessionId)
  const conversation = scoped?.get('conversation')
  if (conversation === undefined || typeof conversation.cancel !== 'function') {
    warn(`conversation service unavailable for session ${sessionId}`)
    return
  }
  conversation.cancel().catch((error) => warn(`stop failed ...`, error))
}
```

- `sessions.scope(sessionId)` 拿到该会话的**服务作用域**；
- `scope.get('conversation')` 拿到该会话的**会话服务**（提供 `cancel()`）；
- `conversation.cancel()` 就是 composer 上 Stop 按钮调用的**同一个操作**；
- 失败被 `.catch` 捕获并告警，不会冒泡成未处理的 Promise 拒绝。

### 5.5 归属不重叠（每按恰好一个 owner）

插件与内置命令可能同时盯着同一按键，必须保证**每一按最终只被一家处理**。

- **面板键**：由"焦点"这一个事实唯一决定归属。焦点在 pane 内 → ④ 让位，内置 `dispatch` 独占；焦点不在 → 插件 ⑦ 先消费，内置 `dispatch` 在首行 `defaultPrevented` 处退出。不存在两家都动手的情况。
- **停止**：插件与内置 `response.stop` 都在 `fixedListeners` 里，执行顺序取决于注册先后。靠**双保险**保证互斥：
  - **(a) 显式让位**：② `conversationOwnsTarget` 让插件在"target 落在会话区"时主动放弃（不消费）；
  - **(b) 共享 `consumed` 标志**：即便顺序反了，谁先 `consume()`，另一个 listener 都会在下一轮看到 `gesture.defaultPrevented === true` 而退出（① 资格检查里就有 `!defaultPrevented`）。

  两重机制叠加，无论注册顺序如何，最终都只有一家消费并动作。
