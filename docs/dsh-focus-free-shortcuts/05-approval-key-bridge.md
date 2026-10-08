# 审批键桥接（`Enter` / `Esc`）

> 本文件是 [dsh-focus-free-shortcuts 说明](../dsh-focus-free-shortcuts.md) 的第 5 册：审批面板「允许一次 / 拒绝」的焦点无关桥接，以及它与面板自身、停止序列、提问卡片取消桥之间的归属判定。

-----

## 5.9 审批桥接：安装与 `handleApprovalInput`

审批面板（`@deepseek-ai/dsh-client-ui-approval`）不是"可配置命令"，而是自己监听 `keydown` 的 React 组件：它渲染一个 `[data-approval-key]` 根节点，在上面挂 `onKeyDown`，并用 `uiSession.registerPendingInteraction` 把这条待答请求发布给会话状态。面板的处理器只在焦点位于 `[data-approval-key]` 子树内时才作答：

```js
// 审批面板自己的 keydown(精简,原文见 dsh-client-ui-approval/lib/client.js)
if (event.defaultPrevented
  || !event.currentTarget.contains(document.activeElement)
  || element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null) return
if (event.key !== 'Enter' && event.key !== 'Escape') return
if (event.key === 'Enter' && element.closest('button, a[href], [role="button"]') !== null) return
if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
event.preventDefault()
event.stopPropagation()
if (event.repeat || composing.current || compositionEnded.current || event.nativeEvent.isComposing || event.keyCode === 229) return
answer(event.key === 'Enter' ? 'allowed-once' : 'rejected')
```

它同时用 `registerFixed()` 把 `approval.allow`（`Enter`）与 `approval.reject`（`Esc`）两行只读快捷键登记进固定目录。这两行只承担声明与冲突检查，实际按键处理由本桥接完成。

### 5.9.1 焦点与事件目标

审批面板以一个 overlay 条目注册在 `conversation.composer` 链上：`conversation` 用 `renderSlotChain(..., { overlay: true })` 把它叠在默认 composer 之上，而 overlay 机制会给未被选中的 fallback 加上 `style="display: none"`（`dsh-client-ui-renderer/lib/client.js` 的 `renderChainResult`）。composer 输入框被隐藏后浏览器把焦点退回 `<body>`，于是审批出现期间的按键事实是：

- 这次 `keydown` 的 `event.target` 是 `<body>`；
- 事件不经过审批面板（面板不是 `<body>` 的祖先），面板的 React `onKeyDown` 收不到；
- 面板自己的守卫 `event.currentTarget.contains(document.activeElement)` 也不成立。

此时固定通道给出的 `region` 是 `page`（见 5.9.2 ③）。焦点停在过程卡片上的情形由 5.9.4 的捕获路径处理。

### 5.9.2 `handleApprovalInput` 的判定步骤

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
    scope.effect(() => installApprovalCapture(shortcuts, sessions, uiSession),
      `${name}: approval capture`)                                                         // ②′
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

- **① 需要 `uiSession`。** 判定用到的待答交互全部来自 `uiSession.sessionStatus`。`ctx.inject(['shortcuts', 'sessions', 'uiSession'], ...)` 在任一服务缺席时不解析，这段逻辑不执行也不抛错；`observeFixedInput` 缺席时告警 `shortcuts service exposes no observeFixedInput; approval bridge not installed` 并放弃安装。
- **② 只认按键。** `type === 'reset'` 的输入（焦点变化、指针按下、组字、模态变化、窗口失焦）直接跳过：审批是单按，没有半完成的序列。
- **②′ 第二条投递路径。** `installApprovalCapture` 在同一作用域里再挂一个 window **捕获阶段** keydown 监听，早于一切目标 / 冒泡处理器。两条路共用同一判定、互斥不双触发：捕获路命中就吞掉事件，固定通道收不到；捕获路放行，固定通道再按 ③～⑨ 判定一次。
- **③ 准入 `approvalEligible`：**
  - `!gesture.repeat`：`event.repeat` 的长按不是新的一次决定；
  - `!gesture.composing`：输入法组字中不接管；
  - `!gesture.defaultPrevented`：已被别人消费过的这一按不接手；
  - `context.modal === null`：模态层（设置等）打开时不动作；
  - `context.region === 'page'`：`region` 是官方固定通道给出的焦点分类，取值为 `terminal` / `editable` / `page`。审批出现时 composer 已被隐藏、焦点退回 `<body>`，正常路径就是 `page`；`editable`（侧栏搜索框、重命名输入框等）与 `terminal` 里的 `Enter` / `Esc` 属于那些控件自己，一律让开。

  修饰键由 `bindingMatches`（第 7 册第 9 节的 A 组判定）判定：修饰键集合须完全相等（顺序无关）、双键和弦一律不匹配，所以 `Shift+Enter` 之类的组合不会命中 `{ code: 'Enter', modifiers: [] }` 这条固定行。
- **④ 读已挂载的固定行 `approvalOutcomeFor`：** `shortcuts.fixedCatalog.getSnapshot()` 里存在 `approval.allow` / `approval.reject`，且物理组合正好是这一按，才判定为 `allowed-once` / `rejected`；审批插件未装载时没有这两行，桥为 no-op。
- **⑤ 面板掌权就让位 `approvalPanelOwnsTarget`：** 目标落在 `[data-approval-key]` 内时不动作，交给面板的 `onKeyDown`。面板有两条不消费的路径会漏到 `window`——目标在输入控件内、`Enter` 落在被聚焦的按钮 / 链接上（保留按钮原生动作）；不判这条让位，`Tab` 到「拒绝」按钮再按 `Enter` 会变成「允许一次」。
- **⑥ 无焦点解析目标 `mainViewSessionId`：** 读 `sessions.list.byId[id].retainedBy.mainView > 0`，即主视图保留的那个会话。持有数不为 1（切换瞬间）时返回 `undefined`，这一按不响应。
- **⑦ 只答"可作答的审批" `presentedApproval` → `asAnswerableApproval`：** 要求这条待答交互同时满足：
  - `kind === 'approval'`：`pendingInteraction` 这个槽位是复用域，提问（`question`）等别的域不归这条桥；
  - `key` 是字符串；
  - `answerable === true`：已经作答、被撤销或被 transport 中止的请求不能再接第二次决定；
  - `answer` 是函数：真身就是官方的 `PendingApproval`（类型 `import type` 自 `@deepseek-ai/dsh-client-ui-approval/client`）。

  任何一条不满足都返回 `undefined`，这一按不消费、不动作。
- **⑧ 先消费，再作答。** `input.consume()` 标记本桥是这一按的 owner：事件不再漏给浏览器（`Esc` 会停止页面加载之类），也不会被停止序列当成"第一下"记下来。
- **⑨ 调用面板按钮的同一个操作。** `approval.answer('allowed-once' | 'rejected')` 正是"允许一次 / 拒绝"两个按钮 `onClick` 里调用的方法，返回给等待中的 Host waterfall。请求一旦定局，`PendingApproval.answerable` 即为假，再调 `answer()` 只会拿到一个 rejected Promise（`settlePendingComposer` 把内部"已定局"错误转成 rejected Promise）；本桥在更早一步的 `asAnswerableApproval` 里就要求 `answerable === true`，所以同一个审批不会收到第二次决定。失败被 `.catch` 捕获并告警 `approval <key> was not sent:`，不冒泡成未处理的 Promise 拒绝。

### 5.9.3 归属判定与让位

审批键与另外几条桥同处 `fixedListeners`，靠"显式让位 + 共享 `consumed` 标志"保证每按恰好一个 owner；审批键自己另有捕获路径，两条路互斥——捕获路命中即吞事件，固定通道根本收不到，未命中则原样放行、由固定通道决定：

| 按下时的情形 | 归属 | 判定依据 |
|---|---|---|
| 焦点在审批面板内（`[data-approval-key]` 子树，含审批详情区、面板上的按钮） | 面板自己 | 面板 `preventDefault()` + `stopPropagation()` 后 window 级固定通道收不到；漏到 `window` 的输入控件 / 聚焦按钮两条路径由 ⑤ 让位 |
| 焦点停在某张**过程卡片**上（工具卡 `div[role="button"][tabindex="0"]` / 轨迹行 `tr[tabindex="0"]`），有待答审批 | 审批桥（**捕获路径**） | 卡片的 React `keydown` 先 `preventDefault()` 再折叠 / 选中；捕获监听在它之前拦下并作答，卡片收不到这一按（见 5.9.4） |
| 焦点在 `<body>`、`page` 区域，有待答审批 | 审批桥（捕获路径先拦，未拦到则由固定通道接手） | 面板收不到（目标不在其子树里）；两路共用同一判定，先命中者作答并消费 |
| 焦点在 `<body>`、`page` 区域，无待答审批 | 停止序列（`Esc`，内置固定序列 `response.stop`）或无人（`Enter`） | 审批桥在 ⑦ 返回 `undefined`，不消费；`Esc` 进入双按序列 |
| 有待答审批时按 `Esc` | 审批桥（一下即拒绝） | 内置停止监听器（`currentTurn()`）与插件 `resolveStopSession` 都以 `pendingInteraction !== undefined` 为门槛返回"没有可停的轮次"，不消费 |
| 焦点在输入控件（`editable`）/ 终端（`terminal`）/ 模态层（`modal !== null`）之上 | 那个控件自己 | ③ 的 `region` 与 `modal` 门槛否决，审批桥不消费 |
| 焦点在 `<body>`、`page` 区域，有待答提问 | 提问桥 | 提问卡片本身不绑 `Esc`；提问桥用同一条"主视图会话 + `pendingInteraction`"解析出可关闭卡片，先消费再调 `dismiss()` |
| 有待答提问时按 `Esc` | 提问桥（一下即取消卡片） | 停止侧因同一门槛拒绝；审批桥的 `asAnswerableApproval` 要求 `kind === 'approval'`，不接手 |
| 焦点在提问卡片自己的答案文本域（`editable`）里按 `Esc` | 提问桥 | 准入放行 `editable`；归属由 `questionCardOwnsTarget` 收口到本次提问 `key` 的那一张卡片 |
| 焦点在提问卡片之外的文本控件（侧栏搜索框、重命名框）里按 `Esc` | 那个控件自己 | 归属要求 target 落在属性值等于本次提问 `key` 的 `[data-question-key]` / `[data-plan-review-key]` 卡片内；不满足就不动作、不消费 |
| 有待答提问，且 `kind === 'plan-review'`（`exit_plan_mode` 那张 Approve / Request changes 卡片） | 提问桥（同一个 `dismiss()`） | `dismiss()` 正是卡片上「Request changes」按钮调用的那个动词：带工具调用线索时收起面板（`hide`），Host 未命名时把等待拒绝为 `ASK_CANCELLED` 并把 composer 交回给用户写反馈 |
| 从 `ask_user_question` 工具调用行重新打开的**只读 review 卡片**（已定局的提问回看） | 提问桥（同一个 `dismiss()`） | 没有作答通道、没有倒计时，`dismiss()` 就是 `card.remove`；它承载的 `kind` 取决于原来的问题（`question` 或 `plan-review`） |
| 待答交互是审批域（`kind === 'approval'`）而不是提问域 | 审批桥 | 提问桥的收窄要求 `kind` 为 `question` / `plan-review`；审批桥只认 `kind === 'approval'`。一个会话同一时刻只发布一个待答交互，两个域不会同时认领同一按 |

> 有待答审批时 `Esc` 一下即拒绝，不进入停止序列的双按序列；有待答提问时 `Esc` 取消卡片，`Enter` 仍完全归卡片自己（`Enter` 只出现在卡片的选项 / 字段上，这条桥根本不碰它）。

### 5.9.4 捕获路径：焦点停在过程卡片上（`approvalCaptureOutcome` + `installApprovalCapture`）

固定通道的前提是这一按能冒泡到 `window` 且未被消费。官方通道按"本地控件先裁决，再到 window"的顺序派发（`installKeyboard`），而过程卡片自己就绑了 `Enter` 并且先 `preventDefault()`：

```js
// dsh-client-ui-tool 的执行卡片(精简,原文见该包 lib/client.js)
const toggleFromKeyboard = (event) => {
  if (!expandable || event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()           // ① 先消费
  toggleExpand()                   // ② 再折叠 / 展开
}
// dsh-client-ui-trajectory 的轨迹行(精简)
onKeyDown: (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()           // ① 先消费
  selectRecord(record.cell.index)  // ② 再选中
}
```

"点过一张卡片"这个动作把焦点留在卡片上（`tabindex="0"` 的可聚焦控件点击后保持焦点）。此时按 `Enter`：

- React 的根容器在 window 之下，卡片的处理器先跑，折叠 / 选中已经发生；
- 这一按带着 `defaultPrevented = true` 冒到固定通道，③ 里"已被消费"那一条直接否决，固定通道错过。

捕获阶段早于目标 / 冒泡处理器运行，因此审批桥在 `window` 上再挂一条捕获监听：

```ts
export function approvalCaptureOutcome(rows, gesture, element) {
  const outcome = approvalOutcomeFor(rows, gesture, APPROVAL_COMMAND_IDS)  // ④ 同一个固定行判定
  if (outcome === undefined) return undefined
  const context = captureContext(element)                                  // 同一个区域 / 模态读数
  if (!approvalEligible(gesture, context)) return undefined                // ③ 同一套准入
  return approvalPanelOwnsTarget(context.target) ? undefined : outcome     // ⑤ 同一条让位
}

function installApprovalCapture(shortcuts, sessions, uiSession) {
  if (typeof window === 'undefined') return () => {}
  const onKeydown = (event) => {
    const outcome = approvalCaptureOutcome(
      shortcuts.fixedCatalog.getSnapshot(), captureGesture(event), composedElement(event))
    if (outcome === undefined) return
    const approval = presentedApproval(
      mainViewSessionId(sessions.list.getSnapshot()),
      uiSession.sessionStatus.getSnapshot(),
    )
    if (approval === undefined) return
    event.preventDefault()
    event.stopPropagation()                                                // ⑥ 卡片再也收不到这一按
    approval.answer(outcome).catch((error) => warn(`approval ${approval.key} was not sent:`, error))
  }
  window.addEventListener('keydown', onKeydown, true)
  return () => window.removeEventListener('keydown', onKeydown, true)
}
```

- **③④⑤ 复用同一套判定。** 捕获路不另立规则：固定行预约（④）、准入（③）、面板归属（⑤）全部复用。`captureGesture` 在捕获阶段构造的手势 `defaultPrevented` 恒为 `false`（此时还没有处理器运行），因此能通过 ③ 的"已被消费"门槛。
- **⑥ 先吞，再答。** `stopPropagation()` 让事件到不了目标，卡片的 React 处理器不执行；`preventDefault()` 拦掉浏览器默认动作。只答不吞时，按一次 `Enter` 会既批准又折叠卡片。
- **两路互斥，不会双答。** 捕获路命中并吞掉事件 → 固定通道收不到；捕获路放行 → 事件照常冒泡，固定通道再决定一次（判定相同）。无论焦点在 `<body>` 还是某张卡片上，每按恰好一个 owner。未命中捕获（例如捕获监听被卸载、或目标区域整体让位）时，固定通道仍是正常投递路径。
- **`src/capture.ts` 提供共用的读数。** 按键落点（`composedElement` / `pressElement`）、原始手势（`captureGesture`）、归属上下文（`captureContext`，含区域与模态）与终端落点判定（`terminalTarget`）都由 `src/capture.ts` 导出；审批桥、页面循环桥、会话导航桥、聚焦输入框桥、聚焦右栏页面桥与新建会话桥（终端）的捕获钩子共用它（各桥的捕获钩子清单见第 7 册第 9 节的源码表）。
- **`suppressFocusRing` 抑制焦点环。** 作答会把键盘交回 composer，应用随即切到键盘模态；`ui-theme` 的 `focus.css` 只在 `html[data-input-modality=pointer]` 下把焦点环设为透明，切到 `keyboard` 后仍处于 `:focus-visible` 的过程卡片会显出边框。两条路都在作答前调用 `suppressFocusRing`（`src/focus-ring.ts`）：给该控件打上官方的 `data-dsh-automatic-focus`（"无环聚焦"标记），焦点不动、边框不画，并在 blur 或 Tab / 方向键导航时按官方同一套规则摘除标记。模态判定仍归应用（测试 I⑫；第 6 册第 8 节第 16、17 条）。
- **让位条件一条不少。** 目标落在 `[data-approval-key]` 内、落在 `input/textarea/select/contenteditable` 或 `.xterm` 内、模态层打开、长按、组字中、别的键、固定行缺席、审批已作答、主视图歧义、审批属于别的会话——都由同一套判定否决，捕获监听既不作答也不吞事件（测试 I⑨、I⑩）。

## 5.10 审批键桥的归属事实与提问卡片取消桥

| 维度 | 内容 |
|---|---|
| 属主事实 | 固定目录 `shortcuts.fixedCatalog.getSnapshot()` 中的 `approval.allow`（`Enter`）/ `approval.reject`（`Esc`）两行；固定行缺席时为 no-op |
| 目标解析 | 主视图会话已发布的 `pendingInteraction` 收窄为 `PendingApproval` 后调 `answer('allowed-once' / 'rejected')` |
| 按键形状 | 无修饰的 `Enter` / `Esc` **一下**（修饰键集合须完全相等） |
| 准入 / 让位 | `region === 'page'`、`modal === null`、非长按、非组字、未被消费；目标落在 `[data-approval-key]` 内让位给面板；固定行缺席、审批已作答 / 被撤销、主视图歧义、会话不匹配均否决 |
| 投递路径 | window **捕获阶段**监听（先于一切目标 / 冒泡处理器）+ 固定输入通道；两路共用同一判定、互斥不双触发 |
| 运行时 | 固定行，Web 与 Desktop 都安装 |
| 消费时机 | 解析出可作答审批之后（固定通道 `input.consume()`；捕获路 `preventDefault()` + `stopPropagation()`） |
| 失败表现 | `answer()` 拒绝时告警 `approval <key> was not sent:`，不作为未处理的 Promise 拒绝冒泡；`observeFixedInput` 缺席时不安装（告警见 5.9.2 ①） |

### 5.10.1 提问卡片取消桥（第 6 组）：`editable` 的放行与 `dismiss()` 的三种落点

提问桥与审批桥同走一条线：`ctx.inject(['shortcuts', 'sessions', 'uiSession'], ...)`；`shortcuts.observeFixedInput` 缺席时告警 `shortcuts service exposes no observeFixedInput; question bridge not installed` 并放弃安装；Web 与 Desktop 都安装（这里没有"可配置绑定"要交给原生键盘桥派发）。卡片本身是 **Web 独有**的客户端特性（`@deepseek-ai/dsh-client-ui-user-questions` 声明 `dsh.client.platform: "web"`）：桌面端没有人发布提问域的 `pendingInteraction`，这条桥在 Desktop 装上也是 no-op。处理顺序：

1. 准入 `questionEscapeEligible`：`Escape`、非长按、非组字、未被消费、无修饰键、`modal === null`、`region !== 'terminal'`；
2. 用主视图会话取到可关闭卡片：`presentedQuestion` → `asDismissableQuestion`（`kind` 为 `question` / `plan-review`、`key` 为字符串、`dismiss` 为函数）；
3. `editable` 收口：`context.region === 'editable'` 时要求 `questionCardOwnsTarget(context.target, question.key)` 成立；
4. `input.consume()`，然后调用 `question.dismiss()`；失败时告警 `question <key> was not cancelled:`（消费不回退）。

- **`editable` 在准入里放行，由卡片归属收口。** 审批桥要求 `context.region === 'page'`，提问桥的准入不设这一条：卡片自己的自由文本答案字段就是一个 `<textarea>`（`region` 正是 `editable`），自由文本问题还会自动聚焦它，而该字段的 `keydown` 只处理 `Enter`。归属判定要求 target 落在 `[data-question-key]` / `[data-plan-review-key]` 卡片内，且该元素自身的属性值恰好等于本次待答提问的 `key`。侧栏搜索框、重命名输入框这些卡片之外的文本控件因此保留自己的 `Esc`；已卸载的旧卡片、或另一次调用的 review 卡片因 key 对不上而匹配失败。
- **只调 `dismiss()`，从不调 `answer()`。** `dismiss()` 就是卡片关闭 / 取消按钮调用的同一个公开动词，插件不替用户作答。它的实际结果由上游卡片的形状决定——`kind` 只区分卡片属于哪个域，并不区分"活卡片 / 只读回看"：
  - **提问卡片（`kind === 'question'`）**：带工具调用线索的走 `hide`——只收起面板，请求继续等待、倒计时照跑，`ask_user_question` 的工具调用行能重新打开它；Host 未命名的阻塞式请求没有可返回的调用行，于是把整个等待拒绝为 `ASK_CANCELLED`（按钮自己的标签是「取消」/「放弃整组问题」/「Dismiss all questions」）。
  - **活着的 plan-review 卡片（`kind === 'plan-review'`，`exit_plan_mode` 的 Approve / Request changes）**：`dismiss()` 正是「Request changes（请求修改）」按钮的动词，结果与上面同一套——带工具调用线索时收起面板（计划仍在，可从工具调用行重开），Host 未命名时以 `ASK_CANCELLED` 结束等待并把 composer 交回给用户写反馈。
  - **只读 review 卡片（已定局的提问从它的 `ask_user_question` 工具调用行重新打开，`review !== undefined`）**：它是回看而不是待答，没有作答通道、没有倒计时，`dismiss()` 就是 `card.remove`（移除卡片）。它可以承载 `question` 或 `plan-review` 两种 `kind`，两种情形走的是同一个 `dismiss()`。
