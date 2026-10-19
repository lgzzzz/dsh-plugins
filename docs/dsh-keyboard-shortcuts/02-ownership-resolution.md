# 归属判定：从按键目标反推操作对象

> 本文件是 [dsh-keyboard-shortcuts 说明](../dsh-keyboard-shortcuts.md) 的第 2 册：键盘事件链路，以及面板命令、页面关闭命令、停止序列、审批面板、提问卡片各自的归属判定与失败表现。

-----

## 3. 归属判定：读本次按键的焦点元素

按键事件都会送到应用（`dsh-client-shortcuts` 在 `window` 上挂 keydown 监听，焦点在哪都能看到每次按键）；决定「这一按属于谁」的是归属判定层，它的起点是这次按键落在哪个 DOM 元素上，各条命令再各自补充模态层、事件来源等上下文。

### 3.1 键盘事件的链路

`dsh-client-shortcuts` 对每次 keydown 依次做下面几步。

**第 1 步：取 target。**

```js
const target = event.composedPath().find((value) => value instanceof Element)
const element = target instanceof Element ? target : document.activeElement
```

结果：`element` = 当前聚焦元素（无焦点时是 `<body>`）。

**第 2 步：由 target 派生 `region`（区域类型）。**

```js
const region = element?.closest(".xterm")
  ? "terminal"
  : element?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
    ? "editable"
    : "page"
```

- target 在 `.xterm`（终端）里 → `region = "terminal"`；
- target 是输入框 / 文本域 / 下拉框 / 可编辑区域 → `region = "editable"`；
- 其余（包括 `<body>`）→ `region = "page"`。

**第 3 步：组装 context（上下文）。**

```js
const context = { region, modal, target: element }
```

其中 `modal` 表示当前是否有模态弹窗打开（没有则为 `null`）。

**第 4 步：依次交给两个通道。**

```js
fixed?.({ type: "keydown", gesture, context, consume })   // 先：固定输入通道
if (native) return                                        // （仅桌面端 macOS/Windows 会在这里提前返回）
shortcuts.dispatch({ ...gesture, defaultPrevented: event.defaultPrevented }, context, consume)  // 后：可配置命令
```

- **固定输入通道（fixed input）**：处理键位不可改的固定序列，例如 `Esc Esc` 停止。
- **可配置命令（configurable commands）**：处理可在「设置 → 快捷键」里改键位的命令，例如 `⌘\` 分屏；`⌘⌥Enter` 全屏与 `⌘⌥,` 关页已由本插件的固定行接管。
- 桌面端（Desktop）macOS/Windows 上，可配置键位不走这段 DOM 监听，而由 Electron 的原生键盘桥派发，因此那段代码在 `if (native) return` 提前返回（对插件的影响见 [第 3 册](03-fixed-input-and-pane-keys.md)）。

链路只从这一次事件里取值（`target` 与由它派生的 `region`，以及当下的模态层 `modal`），没有「鼠标悬停在哪」「上次点过哪」的信息；焦点为空时 `target` 就是 `<body>`，靠 target 做的判定随之落空。

### 3.2 分屏命令的归属判定（`⌘\`）

`pane.split` 是可配置命令，其 `resolve()`（精简）：

```js
resolve: ({ target: element }) => {
  const target = sidebar.focusedTarget(element)      // 从焦点元素反推目标面板
  if (target === undefined) {
    return { status: "blocked", reason: "command.noFocus" }
  }
  const unavailable = reason(kind, target)
  if (unavailable !== null) return { status: "blocked", reason: unavailable }
  return { status: "handled", run: () => { /* 执行分屏 */ } }
}
```

`sidebar.focusedTarget(element)` 内部（`sidebarTargetFromElement`）依次检查：

1. `element` 是否为 `null` 或已从文档移除 → 是则返回 `undefined`；
2. `element.closest("[data-sidebar-right-session]")` 得到的会话 id 是否等于右侧栏当前显示的会话 → 不等则返回 `undefined`；
3. `element.closest("[data-dockkit-pane], [data-dockkit-float]")` 能否找到面板容器（`[data-dockkit-pane]` = dock 里的面板，`[data-dockkit-float]` = 浮动面板）→ 找不到则返回 `undefined`；
4. 该容器是否可见、是否属于当前可见的 dock 布局、tab 是否还在、导航版本是否一致 → 任一不符则返回 `undefined`。

任何一步失败，`resolve` 就返回 `blocked / noFocus`；`dispatch` 会 `consume()`（消费这一按）但不执行任何动作，用户看到的就是「没反应」。

| 焦点位置 | `keydown` 的 target | `focusedTarget(target)` | 命令表现 |
|---|---|---|---|
| composer 输入框 | `<textarea>`（祖先链里没有 `[data-dockkit-pane]`） | 第 3 步 `closest(...)` 返回 `null` → `undefined` | `noFocus`，无反应 |
| 右侧栏 dock pane 内 | pane 元素（或 pane 内部的子元素） | 全部检查通过 → 返回该 pane | 正常分屏 |
| 消息列表空白处（无焦点） | `<body>` | 第 2 步 `body.closest("[data-sidebar-right-session]")` 为 `null` → `undefined` | `noFocus`，无反应 |

#### 3.2.1 关闭页面的归属判定（固定行 `page.close`）

`page.close` 在 Web 上仍是可配置命令（默认 `⌘⌥W`，被固定行挤成冲突），实际由固定行 `dsh-keyboard-shortcuts.page.close`（`⌘⌥,`）接管。固定行命中后，插件先尝试免聚焦回退，再交回官方命令：

```js
// fixed-keys.ts
if (target.id === 'page.close' && pageClose?.handle(input) === true) return
input.consume()
registry.invoke('page.close', { region, modal, target })
```

`pageClose.handle(input)` 的判定与官方 `resolve()` 逐条对齐：

1. 输入法组字、长按重复、已被前面的处理器消费 → 让位；
2. 模态层打开 → 让位：官方 `page.close` 的 `modals` 是 `["settings", "shortcuts", "other"]`，弹窗下它负责关掉最上面那层；
3. 焦点已在可见 dock pane 内 → 让位：官方 `focusedTarget()` 能解析，交给它执行；
4. 右栏折叠、`commandTarget()` 解析不到目标、`canCloseTarget()` 为假 → 让位：官方命令会按原语义收场；
5. 以上都通过才 `consume()`，然后 `isTargetCurrent()` 成立时执行 `closeTarget()`。

| 焦点位置 | 官方 `focusedTarget` | 插件行为 |
|---|---|---|
| composer 输入框 / 消息区 / `<body>` | `undefined` | 回退到活动 dock pane 并关页 |
| 右侧栏 dock pane 内 | 该 pane | 让位，官方命令关页 |
| 侧栏容器内、但不在 pane 内 | `undefined`（`commandTarget()` 同样不回退） | 不动作；官方命令按 `command.stale` / `noFocus` 收场 |
| 模态弹窗打开 | — | 让位，官方命令关弹窗 |

逐行实现见 [第 3 册第 5.5 节](03-fixed-input-and-pane-keys.md)。

### 3.3 停止序列的归属判定（`Esc Esc`）

停止走固定序列通道，分两部分：

1. `response.stop` 通过 `registerFixed()` 注册进 fixed catalog：在设置界面里声明 `Esc Esc` 这个键位并参与键位冲突检测，键位**不可改绑**。
2. 真正处理按键的是 `installStopShortcut` 里通过 `observeFixedInput` 订阅的一段逻辑。

这段逻辑（精简）在每次 keydown 时先做资格检查，再做归属检查：

```js
// —— 资格检查：不符合基本条件就直接放弃（连第一下都不记）——
if (gesture.code !== "Escape" || gesture.repeat || gesture.composing || gesture.defaultPrevented
  || gesture.control || gesture.alt || gesture.shift || gesture.meta
  || context.modal !== null || context.region === "terminal" || context.target === null) {
  reset(); return
}

// —— 归属检查：从 target 反推你在哪个会话、哪个区域 ——
const occurrence = target.closest("[data-conversation-session]")
const region = target.closest("[data-conversation-region]")
if (occurrence === null || region === null || !occurrence.contains(region)
  || target.closest("[data-approval-key], iframe, .xterm, [inert]") !== null) {
  reset(); return
}

const sessionId = occurrence.dataset.conversationSession
// ... 继续：解析会话、确认正在 running、确认无待答交互，然后 consume 并进入「双按」序列
```

归属检查的两个 `closest()` 依赖这些标记：

- `[data-conversation-session]` 与 `[data-conversation-region]` 官方只挂在会话的消息列表 body 与 composer seat（输入区座位）上；
- `occurrence.contains(region)` 要求「区域」真的在「会话」里面（防止两个标记分别命中不同容器）；
- 另外要求 target 不在 `[data-approval-key]`（审批控件）、`iframe`（内嵌网页）、`.xterm`（终端）、`[inert]`（被禁用的内容）里。

| 焦点位置 | `keydown` 的 target | 两个 `closest()` | 表现 |
|---|---|---|---|
| composer | `<textarea>`（在 `[data-conversation-region]` 内） | 都命中 | 进入双按序列，两下停止 |
| 右侧栏 pane | pane 元素 | 都不命中 → `null` | 第一下 `Esc` 被 `reset()` 丢弃 |
| 消息列表空白处（无焦点） | `<body>` | `body.closest(...)` 都是 `null` | 第一下 `Esc` 被 `reset()` 丢弃 |

两条命令的失败方式不同：

- 面板命令是**阻塞**：`resolve` 返回 `blocked/noFocus`，`dispatch` 会 `consume()` 这一按，但不执行动作。
- 停止序列是**静默 reset**：资格 / 归属检查不通过时直接 `reset()`，**不消费**，第一下 `Esc` 被当作从未发生。

### 3.4 审批面板的归属判定（`Enter` / `Esc`）

审批面板既不是可配置命令，也不是固定序列，而是**组件自己监听 `keydown`**：在渲染出的 `[data-approval-key]` 根节点上挂 React 的 `onKeyDown`：

```js
// 精简；原文见 dsh-client-ui-approval/lib/client.js 的 ApprovalFlow
onKeyDown: (event) => {
  const element = event.target
  if (event.defaultPrevented
    || !event.currentTarget.contains(document.activeElement)     // 焦点必须在面板内
    || element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]') !== null) return
  if (event.key !== "Enter" && event.key !== "Escape") return
  if (event.key === "Enter" && element.closest('button, a[href], [role="button"]') !== null) return
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
  event.preventDefault()
  event.stopPropagation()
  answer(event.key === "Enter" ? "allowed-once" : "rejected")
}
```

它同时用 `registerFixed()` 把 `approval.allow`（`Enter`）与 `approval.reject`（`Esc`）登记进固定目录——这两行只做声明与冲突检查，真正处理按键的仍是上面这段组件代码。

生效条件是焦点落在面板自己的子树里。审批面板以 composer 的**顶替（takeover）**方式出现：它以 overlay 条目叠在默认 composer 之上，而 overlay 机制给未被选中的 fallback 直接加 `display: none`：

```js
// dsh-client-ui-renderer/lib/client.js
return [<div style={{ display: elected === null ? "contents" : "none" }}>{fallback}</div>, elected]
```

于是审批一出现，composer 输入框被隐藏，不可渲染的元素不能持有焦点，浏览器把焦点退回 `<body>`。此时这次 `keydown` 的 target 是 `<body>`：面板不是 `<body>` 的祖先，React 的 `onKeyDown` 收不到，面板自己的 `contains(document.activeElement)` 也不成立，`Enter` 与 `Esc` 都没有 owner。

| 焦点位置 | `keydown` 的 target | 面板自己的判定 | 表现 |
|---|---|---|---|
| 审批详情区（点过卡片） | 面板内的元素 | `currentTarget.contains(activeElement)` 成立 | `Enter` 允许一次、`Esc` 拒绝 |
| 面板上的「拒绝」按钮 | 那个 `<button>` | `Enter` 让给按钮自身（第 4 个条件） | `Enter` 触发按钮 = 拒绝 |
| composer 被顶替隐藏后（无焦点） | `<body>` | 面板收不到事件 | 两个键都没反应 |

内置 stop guard 的归属检查里同样写着 `target.closest("[data-approval-key], iframe, .xterm, [inert]")`：目标落在审批控件里时，内置序列主动放弃；本插件沿用同一个标记做让位（见 [第 5 册](05-approval-key-bridge.md)）。

### 3.5 提问卡片：`Esc` 在任何焦点位置都没有绑定

提问卡片（`ask_user_question` 的 composer 顶替卡片）不绑 `Esc`：

- 卡片根节点带 `[data-question-key]`（plan-review 卡片换成 `[data-plan-review-key]`），组件里只有两处 `keydown`：聚焦选项上的 `Enter`（尝试提交整组答案）与自定义答案文本域上的 `Enter`（继续 / 提交，`Shift+Enter` 换行），没有任何一处读 `Escape`。
- 卡片唯一的出口是头部那个关闭 / 取消按钮，它调 `PendingQuestion.dismiss()`。
- 「停止」这条路也不接管：内置 `currentTurn()` 与本插件的 `resolveStopSession` 都以 `pendingInteraction !== undefined` 为门槛（[第 4 册](04-stop-sequence-bridge.md) 第 5.7.3、5.8 节），有待答交互时不停止、也不消费。

因此焦点落在卡片里时这一按仍然没有 owner（自由文本问题还会自动把焦点放进它的答案文本域）。唯一可行的接法是走固定输入通道，把这一按接到面板关闭 / 取消按钮调用的同一个操作上：即 [第 5 册](05-approval-key-bridge.md) 第 5.9.3、5.10 节讲的提问桥；与内置命令的对照见 [第 6 册](06-boundaries-and-contracts.md)。

### 3.6 全屏右栏上的 `Esc`：浮层比它盖住的待答交互更近

右栏**全屏呈现**时盖住整个视口（手动全屏，或窄于 768px 的窗口里展开即自动全屏）。这一状态下裸 `Esc` 有几个候选 owner，按「浮层先关」排定：全屏的面板在最上面，先关它。

- **全屏关栏桥**（`src/fullscreen-dismiss.ts`）：只要面板仍是全屏呈现且已展开就认领这一按。它挂在 window **捕获阶段**，早于固定通道与任何本地控件；命中即 `preventDefault() + stopPropagation()` 再调 `sidebarRight.toggleExpanded()`（与面板自带的折叠按钮同一个动词，见 [第 5.11 节](05-approval-key-bridge.md)）。官方 `response.stop` 与本插件的停止桥都在固定通道里，因此全屏期间收不到这一按，凑不成「连按两下停止」；关栏之后再按两下才停。
- **待答审批（3.4）与提问卡片（3.5）**：两者都是 composer 顶替，浮层盖住整块 composer 后**在屏幕上看不见**。这两条桥各加一条 `fullscreenSidebarShown()` 守卫：面板全屏且展开时不在这一按上作答，否则同一次按键会既关栏、又答掉一个看不见的请求。

让位条件都来自浮层自身的边界：

| 按下时的情形 | 这一按归谁 | 表现 |
|---|---|---|
| 焦点在终端 `.xterm` 内 | 终端 | 关栏桥不动作、不消费（与停止桥、审批桥、提问桥同一条门槛） |
| 焦点在右栏自己的文本控件里（`[data-sidebar-right-session]` 内，例如终端页签的重命名输入框） | 那个控件 | 关栏桥不动作、不消费：重命名由它自己的 `Esc` 取消 |
| 模态层打开 | 模态层 | `context.modal !== null` 直接否决 |
| 右栏已折叠，或 DOM 上不是全屏呈现（`push`） | 无人 | 不动作、不消费（只在「全屏 + 展开」时才接管） |
| 服务面读到折叠、DOM 上却仍留着全屏标记（面板正在卸载） | 无人 | 两侧读数不一致时不动作：`toggleExpanded()` 在折叠态下的语义是**展开**，不能凭陈旧标记去碰它 |
| 焦点在被浮层盖住的 composer 里（`editable`，但不在右栏内） | 全屏关栏桥 | 照常关栏并消费：浮层比它盖住的控件更近 |

### 3.7 折叠中间步骤（`⌘⌥.` / `Ctrl+Alt+.`）

这条键不看焦点区域：页面、文本控件、终端里都认，只要主会话里还有展开的工作步骤。它只看两件事：

1. `fixedRowOwns()` 确认这一按属于插件自己的固定行 `dsh-keyboard-shortcuts.collapse-steps`；
2. 主会话滚动口里能收集到至少一个展开目标（轮次过程 / 过程组标题 / 单步详情）。

长按、输入法组合、已被前面的处理器消费、模态层打开时不动作、也不消费。目标收集与两层优先级见 [第 9 册](09-collapse-steps.md)，固定输入通道里的位置见 [第 3 册第 5.7 节](03-fixed-input-and-pane-keys.md)。
