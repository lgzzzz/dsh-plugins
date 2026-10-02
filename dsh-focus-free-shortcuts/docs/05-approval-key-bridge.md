# 审批键桥接（`Enter` / `Esc`）

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 5 册：审批面板允许一次 / 拒绝的焦点无关桥接，以及它与面板自身、与停止序列的归属不重叠论证。

---

### 5.6 审批桥接：`handleApprovalInput` 逐行

审批面板（`@deepseek-ai/dsh-client-ui-approval`）不是"可配置命令"，而是**自己监听 `keydown` 的 React 组件**：它渲染一个 `[data-approval-key]` 根节点，在上面挂 `onKeyDown`，并用 `uiSession.registerPendingInteraction` 把这条待答请求发布给会话状态。官方 README 写明了它的设计：「Focus the approval detail region to approve with Enter or reject with Escape.」——**先把焦点落到审批详情区**，`Enter` / `Esc` 才生效。

```js
// 官方 ApprovalFlow 的 keydown(精简,原文见 dsh-client-ui-approval/lib/client.js)
if (event.defaultPrevented
  || !event.currentTarget.contains(document.activeElement)
  || element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null) return
if (event.key !== 'Enter' && event.key !== 'Escape') return
if (event.key === 'Enter' && element.closest('button, a[href], [role="button"]') !== null) return
if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
event.preventDefault()
event.stopPropagation()
answer(event.key === 'Enter' ? 'allowed-once' : 'rejected')
```

它同时用 `registerFixed()` 把 `approval.allow`（`Enter`）与 `approval.reject`（`Esc`）两行**只读快捷键**登记进固定目录——这两行只有"声明与冲突检查"作用，真正的按键处理仍然是上面那段组件代码。

#### 5.6.1 为什么焦点一丢，两个键就都没主人

审批面板是 composer 的 **takeover（顶替）**：它以一个 overlay 条目注册在 `conversation.composer` 链上，`conversation` 渲染时用 `renderSlotChain(..., { overlay: true })` 叠在默认 composer 之上，而 overlay 机制会给未被选中的 fallback 直接加 `style="display: none"`：

```js
// dsh-client-ui-renderer/lib/client.js
function renderChainResult(slotKey, elected, opts) {
  if (!opts?.overlay) return elected ?? fallback
  return [<div style={{ display: elected === null ? 'contents' : 'none' }}>{fallback}</div>, elected]
}
```

所以审批一出现，**composer 输入框被 `display: none` 移除**，而"已不可渲染的元素不能继续持有焦点"——浏览器把焦点退回 `<body>`。于是：

- 这次 `keydown` 的 `event.target` 是 `<body>`；
- 事件根本不经过审批面板（面板不是 `<body>` 的祖先），React 的 `onKeyDown` 完全收不到；
- 面板自己的守卫 `event.currentTarget.contains(document.activeElement)` 也会失败。

结果就是：焦点在 `<body>` 时按 `Enter` / `Esc`，**没有任何一方处理这一按**。这与「面板必须被聚焦」是同一个根因（归属判定读焦点），只是换了第三个区域。

#### 5.6.2 逐行解释

```ts
function installApprovalBridge(ctx) {
  ctx.inject(['shortcuts', 'sessions', 'uiSession'], (scope) => {
    const shortcuts = scope.shortcuts
    const sessions = scope.sessions
    const uiSession = scope.uiSession
    if (typeof shortcuts.observeFixedInput !== 'function') {
      warn('shortcuts service exposes no observeFixedInput; approval bridge not installed')  // ①
      return
    }
    scope.effect(() => shortcuts.observeFixedInput((input) => {
      if (!isKeydown(input)) return                                                        // ②
      handleApprovalInput(shortcuts, sessions, uiSession, input)
    }), `${name}: approval keys`)
  })
}

function handleApprovalInput(shortcuts, sessions, uiSession, input) {
  const gesture = input.gesture
  const context = input.context

  if (!approvalEligible(gesture, context)) return                                          // ③
  const rows = shortcuts.fixedCatalog.getSnapshot()
  const outcome = approvalOutcomeFor(rows, gesture, APPROVAL_COMMAND_IDS)                   // ④
  if (outcome === undefined) return
  if (approvalPanelOwnsTarget(context.target)) return                                       // ⑤

  const approval = presentedApproval(
    mainViewSessionId(sessions.list.getSnapshot()),                                         // ⑥
    uiSession.sessionStatus.getSnapshot(),
  )
  if (approval === undefined) return                                                        // ⑦

  input.consume()                                                                           // ⑧
  approval.answer(outcome).catch((error) => warn(`approval ${approval.key} was not sent:`, error))  // ⑨
}
```

- **① 需要 `uiSession`。** 这条桥的全部事实都来自"每个会话当前发布的待答交互"，而发布者是 `uiSession.sessionStatus`。`ctx.inject(['shortcuts', 'sessions', 'uiSession'], ...)` 在服务缺席时根本不解析，这段逻辑不跑、也不抛。
- **② 只认按键。** `type === 'reset'`（焦点变化、指针按下、组字、模态变化、窗口失焦）不需要理会：审批不需要双按序列，没有"待完成的第一按"要清空。
- **③ 准入：`approvalEligible`。** 与面板自己的守卫一一对应，只去掉"焦点必须在面板里"这一条：
  - `!gesture.repeat`：长按（`event.repeat`）不是新的决定；
  - `!gesture.composing`：输入法组字中不抢键（与面板一致）；
  - `!gesture.defaultPrevented`：已被别人消费过的这一按不接手；
  - `context.modal === null`：模态层（设置等）打开时不越过它动作——Web/Linux 的模态层本来就会挡住后台命令；
  - `context.region === 'page'`：`region` 是官方固定通道给出的焦点分类（`terminal` / `editable` / `page`）。审批出现时 composer 已被隐藏、焦点退回 `<body>`，所以正常路径就是 `page`；而 `editable`（侧栏搜索框、重命名输入框等）与 `terminal` 里的 `Enter` / `Esc` 属于那些控件自己，**输入控件与 IME 候选保持自己的按键**（官方原话），这里一律让开。
  
  修饰键不需要在这里判：`bindingMatches`（第 5.2 节）要求修饰键集合**完全相等**，`Shift+Enter` 之类的组合根本不会命中 `{ code: 'Enter', modifiers: [] }` 这条固定行。
- **④ 读挂载的固定行：`approvalOutcomeFor`。** 与面板键那条桥"读生效绑定"同源：`shortcuts.fixedCatalog.getSnapshot()` 里存在 `approval.allow` / `approval.reject`，且其物理组合**正好**是这一按，才算这次按键归审批所有。审批插件没装载时固定目录里没有这两行，桥自动退化成 no-op——**永远跟随属主，不硬编码键位**。
- **⑤ 面板自己掌权就让位：`approvalPanelOwnsTarget`。** 只要这次按键的目标落在 `[data-approval-key]` 内，面板的 `onKeyDown` 就是更好的 owner：
  - 目标在面板里、且面板 `preventDefault()` + `stopPropagation()` 的那条路径上，`window` 级的固定通道**根本收不到事件**；
  - 但面板有两条**故意不消费**的路径会漏到 `window`：目标位于输入控件内（第 3 个条件），以及 `Enter` 落在被聚焦的按钮 / 链接上（第 5 个条件，为了「Enter on the focused Reject button retains its native reject action」）。
  - 若不判这一条，用户 `Tab` 到"拒绝"按钮再按 `Enter`，本插件会把这一按改判成"允许一次"——把拒绝变成允许。这是一条必须的让位。
- **⑥ 无焦点解析目标：`mainViewSessionId`。** 就是停止桥用的同一个公开事实：`sessions.list.byId[id].retainedBy.mainView > 0`（与 `UiSession.isMain` 同源）。被主视图保留的那个会话，正是 composer 顶替面板所在的那个会话；主视图持有数不为 1（切换瞬间）时返回 `undefined`，宁可这一下不响应，也不答错请求。
- **⑦ 只答"可作答的审批"：`presentedApproval` → `asAnswerableApproval`。** 它要求这条待答交互同时满足：
  - `kind === 'approval'`：`pendingInteraction` 这个槽位是复用的，提问（`question`）等别的域不归这条桥；
  - `key` 是字符串：发布身份；
  - `answerable === true`：已经作答、被撤销、或被 transport 中止的请求不能再接第二次决定；
  - `answer` 是函数：真身就是官方的 `PendingApproval`（类型直接 `import type` 自 `@deepseek-ai/dsh-client-ui-approval/client`）。
  
  任何一条不满足都返回 `undefined`，这一按不消费、不动作。
- **⑧ 先消费，再作答。** 与其它两条桥同构：谁消费谁是 owner。这一按既不该再漏给浏览器（`Esc` 会停止页面加载之类），也不该被停止序列当成"第一下"记下来。
- **⑨ 调用面板按钮的同一个操作。** `pending.answer('allowed-once' | 'rejected')` 正是"允许一次 / 拒绝"两个按钮 `onClick` 里调用的方法，返回给等待中的 Host waterfall。`PendingApproval.answer()` 内部自带一把锁（`waiting` / `answerable`），所以即使时序上还有第二按到达，也不会重复作答。失败被 `.catch` 捕获并告警，不冒泡成未处理的 Promise 拒绝。

#### 5.6.3 归属不重叠（面板 ↔ 审批桥 ↔ 停止序列）

审批键与另外两条桥同处 `fixedListeners`，靠"显式让位 + 共享 `consumed` 标志"保证每按恰好一个 owner：

| 按下时的情形 | 谁处理 | 为什么 |
|---|---|---|
| 焦点在审批面板内（含"审批详情区"、面板上的按钮） | 面板自己 | 面板 `preventDefault()` + `stopPropagation()`，`window` 级固定通道收不到；即使漏到（输入控件 / 聚焦按钮那两条路径），⑤ 让位 |
| 焦点在 `<body>`、`page` 区域，有待答审批 | 审批桥 | 面板收不到这一按（目标不在它子树里），审批桥按 ④ 命中固定行后作答并消费 |
| 焦点在 `<body>`、`page` 区域，无待答审批 | 停止序列（`Esc`）或无人（`Enter`） | 审批桥在 ⑦ 返回 `undefined`，不消费；`Esc` 照旧进入双按序列 |
| 有待答审批时按 `Esc` | 审批桥（一下即拒绝） | 停止序列此时**必须**不响应：内置 `currentTurn()` 与插件 `resolveStopSession` 都以 `pendingInteraction !== undefined` 为门槛，返回"没有可停的轮次"，且不消费 |
| 焦点在输入控件 / 终端 / 模态层之上 | 那个控件自己 | ③ 的 `region` 与 `modal` 门槛直接否决，审批桥不消费 |

> 注意第 3 行的分工：**审批出现时 `Esc` 不再是"连按两下停止"**。这与内置行为一致——有待答交互时内置也拒绝停止——而单按即拒绝正是面板自身处理 `Esc` 的方式（官方 README：reject with Escape）。

---

### 5.7 与另外两条桥的差异一览

| 维度 | 面板键桥 | 停止桥 | 审批键桥 |
|---|---|---|---|
| 属主事实 | 可配置命令的**生效绑定**（`catalog`） | 固定序列的资格 + 归属守卫 | 固定行 `approval.allow` / `approval.reject`（`fixedCatalog`） |
| 目标解析 | `sidebarRight.commandTarget()` 的活动 pane 回退 | 主视图会话 + `conversation.cancel()` | 主视图会话的 `pendingInteraction` + `answer()` |
| 按键形状 | 单键（含修饰键，读绑定） | 裸 `Esc` **两下** | 无修饰 `Enter` / `Esc` **一下** |
| 让位条件 | 焦点已在 pane 内 | 焦点在会话区域内（内置掌权） | 目标落在 `[data-approval-key]` 内（面板掌权） |
| 运行时 | **仅 Web** | Web 与 Desktop | Web 与 Desktop |
| 消费时机 | 确认要动作之后 | 接受了半序列之后 | 解析出可作答审批之后 |
