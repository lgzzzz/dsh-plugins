# 审批键桥接（`Enter` / `Esc`）

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 5 册：审批面板允许一次 / 拒绝的焦点无关桥接，以及它与面板自身、与停止序列的归属不重叠论证；末尾把与它同源、共用同一个待答槽位的提问卡片取消桥（第 6 组）一并对照。

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
- **⑧ 先消费，再作答。** 与其它几条桥同构：谁消费谁是 owner。这一按既不该再漏给浏览器（`Esc` 会停止页面加载之类），也不该被停止序列当成"第一下"记下来。
- **⑨ 调用面板按钮的同一个操作。** `pending.answer('allowed-once' | 'rejected')` 正是"允许一次 / 拒绝"两个按钮 `onClick` 里调用的方法，返回给等待中的 Host waterfall。`PendingApproval.answer()` 内部自带一把锁（`waiting` / `answerable`），所以即使时序上还有第二按到达，也不会重复作答。失败被 `.catch` 捕获并告警，不冒泡成未处理的 Promise 拒绝。

#### 5.6.3 归属不重叠（面板 ↔ 审批桥 ↔ 提问桥 ↔ 停止序列）

审批键与另外几条桥同处 `fixedListeners`，靠"显式让位 + 共享 `consumed` 标志"保证每按恰好一个 owner：

| 按下时的情形 | 谁处理 | 为什么 |
|---|---|---|
| 焦点在审批面板内（含"审批详情区"、面板上的按钮） | 面板自己 | 面板 `preventDefault()` + `stopPropagation()`，`window` 级固定通道收不到；即使漏到（输入控件 / 聚焦按钮那两条路径），⑤ 让位 |
| 焦点在 `<body>`、`page` 区域，有待答审批 | 审批桥 | 面板收不到这一按（目标不在它子树里），审批桥按 ④ 命中固定行后作答并消费 |
| 焦点在 `<body>`、`page` 区域，无待答审批 | 停止序列（`Esc`）或无人（`Enter`） | 审批桥在 ⑦ 返回 `undefined`，不消费；`Esc` 照旧进入双按序列 |
| 有待答审批时按 `Esc` | 审批桥（一下即拒绝） | 停止序列此时**必须**不响应：内置 `currentTurn()` 与插件 `resolveStopSession` 都以 `pendingInteraction !== undefined` 为门槛，返回"没有可停的轮次"，且不消费 |
| 焦点在输入控件 / 终端 / 模态层之上（提问卡片自己的答案文本域除外，见下面两行） | 那个控件自己 | ③ 的 `region` 与 `modal` 门槛直接否决，审批桥不消费 |
| 焦点在 `<body>`、`page` 区域，有待答提问 | 提问桥 | 提问卡片同样是 composer 顶替，出现后焦点退回 `<body>`；卡片自己完全不绑 `Esc`，这一按本来没有 owner。提问桥用与审批桥同一条"主视图会话 + `pendingInteraction`"解析出可关闭卡片后，先消费再调卡片自己的 `dismiss()` |
| 有待答提问时按 `Esc` | 提问桥（一下即取消卡片） | 停止序列与上一行审批同理地拒绝（同一 `pendingInteraction !== undefined` 门槛），审批桥也不接手（`asAnswerableApproval` 要求 `kind === 'approval'`）；这一按恰好一个 owner |
| 焦点在提问卡片自己的答案文本域（`editable`）里按 `Esc` | 提问桥 | 这是准入里**刻意**不收 `editable` 的例外：卡片自己的 `keydown` 只看 `Enter`，自由文本问题还会自动聚焦这个文本域，所以这里的 `Esc` 同样没有别的 owner；归属由 `questionCardOwnsTarget` 收口到"这一张卡片" |
| 焦点在提问卡片之外的文本控件（侧栏搜索框、重命名框）里按 `Esc` | 那个控件自己 | 准入虽然放行 `editable`，但归属判定要求 target 落在属性值等于本次提问 `key` 的 `[data-question-key]` / `[data-plan-review-key]` 卡片内；不满足就不动作、不消费，别的文本控件保留自己的 `Esc` |
| 有待答提问，且 `kind === 'plan-review'`（`exit_plan_mode` 那张 Approve / Request changes 卡片） | 提问桥（同一个 `dismiss()`） | 这是**活着的** plan-review 展示：`dismiss()` 正是卡片上「Request changes」按钮调用的那个动词，结果与提问卡片同一套——带工具调用线索时收起面板（`hide`），Host 未命名时把等待拒绝为 `ASK_CANCELLED` 并把 composer 交回给用户写反馈 |
| 从 `ask_user_question` 工具调用行重新打开的**只读 review 卡片**（已定局的提问回看） | 提问桥（同一个 `dismiss()`） | 这不是活着的待答卡片：它没有作答通道、没有倒计时，`dismiss()` 就是 `card.remove`（移除卡片）。它承载的 `kind` 取决于原来的问题（`question` 或 `plan-review`），所以"活卡片 / 只读回看"不是靠 `kind` 分辨的——两种情形都由同一个 `dismiss()` 正确收场 |
| 待答交互是审批域（`kind === 'approval'`）而不是提问域 | 审批桥 | 提问桥的运行时收窄要求 `kind` 为 `question` / `plan-review`，审批域不归它；反过来审批桥也只认 `kind === 'approval'`，两个域互不越界 |

> 注意第 3 行的分工：**审批出现时 `Esc` 不再是"连按两下停止"**。这与内置行为一致——有待答交互时内置也拒绝停止——而单按即拒绝正是面板自身处理 `Esc` 的方式（官方 README：reject with Escape）。

> 提问卡片同理：**有待答提问时 `Esc` 不是"连按两下停止"，也不是拒绝审批，而是取消这张卡片**。所以第 3 行说的"无待答审批"还要再看一眼这个槽位发布的是不是提问：是提问时 `Esc` 归提问桥，而 `Enter` 仍完全归卡片自己（`Enter` 只出现在卡片的选项 / 字段上，这条桥根本不碰它）。

---

### 5.7 与其它几条桥的差异一览

| 维度 | 面板键桥 | 停止桥 | 审批键桥 | 提问键桥 |
|---|---|---|---|---|
| 属主事实 | 可配置命令的**生效绑定**（`catalog`） | 固定序列的资格 + 归属守卫 | 固定行 `approval.allow` / `approval.reject`（`fixedCatalog`） | 主视图会话已发布的 `pendingInteraction` 收窄到提问域（`kind` 为 `question` / `plan-review`、`key` 是字符串、带 `dismiss()`）——**不读任何固定行** |
| 目标解析 | `sidebarRight.commandTarget()` 的活动 pane 回退 | 主视图会话 + `conversation.cancel()` | 主视图会话的 `pendingInteraction` + `answer()` | 同一条"主视图会话 + `pendingInteraction`"，但调卡片关闭 / 取消按钮用的 `dismiss()`（**从不**调 `answer()`） |
| 按键形状 | 单键（含修饰键，读绑定） | 裸 `Esc` **两下** | 无修饰 `Enter` / `Esc` **一下** | 裸 `Esc` **一下**（无修饰、非长按、非组字、未被消费） |
| 让位条件 | 焦点已在 pane 内 | 焦点在会话区域内（内置掌权） | 目标落在 `[data-approval-key]` 内（面板掌权） | `editable` 区域里**卡片之外**的目标（卡片自己没绑 `Esc`，但别的文本控件保留自己的 `Esc`）：归属要求 `[data-question-key]` / `[data-plan-review-key]` 命中的卡片，其属性值恰好等于本次提问的 `key` |
| 运行时 | **仅 Web** | Web 与 Desktop | Web 与 Desktop | Web 与 Desktop **都安装**（固定动作，不经原生键盘桥派发）；但卡片本身是 **Web 独有**的客户端特性（`@deepseek-ai/dsh-client-ui-user-questions` 声明 `dsh.client.platform: "web"`），桌面端没有任何人发布提问域的 `pendingInteraction`，所以这条桥在 Desktop 实际是 no-op |
| 消费时机 | 确认要动作之后 | 接受了半序列之后 | 解析出可作答审批之后 | 解析出可关闭提问、且通过卡片归属收口之后（先消费，再 `dismiss()`） |

#### 5.7.1 提问卡片桥（第 6 组）补充：`editable` 的放宽与 `dismiss()` 的三种落点

提问桥与审批桥同走一条线：`ctx.inject(['shortcuts', 'sessions', 'uiSession'], ...)`；`shortcuts.observeFixedInput` 缺席时告警 `shortcuts service exposes no observeFixedInput; question bridge not installed` 并放弃安装；Web 与 Desktop 都安装（这里没有任何"可配置绑定"要交给原生键盘桥派发，与审批桥同理）。不过卡片本身是 **Web 独有**的客户端特性（`@deepseek-ai/dsh-client-ui-user-questions` 声明 `dsh.client.platform: "web"`）：桌面端没有人发布提问域的 `pendingInteraction`，所以这条桥在 Desktop 装上也是 no-op——不需要额外的运行时守卫，因为那里根本没有会重复派发的那一按（没有卡片，就没有可取消的提问）。处理顺序与审批桥同构：准入（`questionEscapeEligible`：裸 `Esc`、非长按、非组字、未被消费、无修饰键、`modal === null`、`region !== 'terminal'`）→ 用主视图会话取到可关闭卡片（`presentedQuestion` → `asDismissableQuestion`）→ `editable` 收口 → `input.consume()` → `question.dismiss()`，其中 `dismiss()` 失败时告警 `question <key> was not cancelled:`（消费不回退）。

- **`editable` 是刻意放宽的，但被"卡片归属"围住**：审批桥要求 `context.region === 'page'`，提问桥则**允许** `editable`。原因是卡片自己的自由文本答案字段就是一个 `<textarea>`（`region` 正是 `editable`）、自由文本问题还会自动聚焦它，而该字段的 `keydown` 只处理 `Enter`——若照抄审批桥的 `region === 'page'`，用户在答案框里按 `Esc` 就又变成没有主人。安全性由归属判定兜住：`context.region === 'editable'` 时，只有 `questionCardOwnsTarget(context.target, question.key)` 成立（target 落在 `[data-question-key]` / `[data-plan-review-key]` 卡片内，且**该元素自身的属性值恰好等于本次待答提问的 `key`**）才继续。侧栏搜索框、重命名输入框这些卡片之外的文本控件因此完整保留自己的 `Esc`；已经卸载的旧卡片、或另一次调用的 review 卡片，也因为 key 对不上而匹配失败。
- **只调 `dismiss()`，从不调 `answer()`**：`dismiss()` 就是卡片关闭 / 取消按钮调用的同一个公开动词，插件不替用户作答，`Esc` 与"点关闭 / 取消按钮"永远同义。它的实际结果由上游卡片的形状决定——`kind` 只区分卡片属于哪个域，并不区分"活卡片 / 只读回看"：
  - **提问卡片（`kind === 'question'`）**：带工具调用线索的走 `hide`——只收起面板，请求继续等待、倒计时照跑，`ask_user_question` 的工具调用行能重新打开它；Host 未命名的阻塞式请求没有可返回的调用行，于是把整个等待拒绝为 `ASK_CANCELLED`（按钮自己的标签是「取消」/「放弃整组问题」/「Dismiss all questions」）。
  - **活着的 plan-review 卡片（`kind === 'plan-review'`，`exit_plan_mode` 的 Approve / Request changes）**：`dismiss()` 正是「Request changes（请求修改）」按钮的动词，结果与上面同一套——带工具调用线索时收起面板（计划仍在，可从工具调用行重开），Host 未命名时以 `ASK_CANCELLED` 结束等待并把 composer 交回给用户写反馈。
  - **只读 review 卡片（已定局的提问从它的 `ask_user_question` 工具调用行重新打开，`review !== undefined`）**：它是回看而不是待答，没有作答通道、没有倒计时，`dismiss()` 就是 `card.remove`（移除卡片）。它可以承载 `question` 或 `plan-review` 两种 `kind`，所以两种情形走的是同一个 `dismiss()`、却各自得到正确的结果。
