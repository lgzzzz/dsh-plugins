# dsh-focus-free-shortcuts

本文假设你只看这一份文档，就能理解问题是什么、为什么会发生、以及这个插件是怎么修好的。凡是用到的概念，都会在第一次出现时解释清楚，尽量不省略推导步骤。

---

## 目录

1. [问题：两个"要先聚焦才生效"的快捷键](#1-问题两个要先聚焦才生效的快捷键)
2. [预备知识](#2-预备知识)
3. [根因：归属判定读焦点](#3-根因归属判定读焦点)
4. [解决思路总览](#4-解决思路总览)
5. [实现细节（逐条展开）](#5-实现细节逐条展开)
6. [与内置命令的完整对照](#6-与内置命令的完整对照)
7. [已知边界与失败模式](#7-已知边界与失败模式)
8. [依赖的非正式契约](#8-依赖的非正式契约)
9. [构建与测试](#9-构建与测试)
10. [启用](#10-启用)

---

## 1. 问题：两个"要先聚焦才生效"的快捷键

GUI 里有两个快捷键，必须先把焦点点进特定区域才会响应：

| 快捷键 | 触发的是哪条命令 | 内置的生效条件 | 你观察到的现状 |
|---|---|---|---|
| 全屏/还原 `⌘⌥Enter`（Windows/Linux 是 `Ctrl+Alt+Enter`） | `pane.fullscreen.toggle` | 焦点必须落在右侧栏**可见的 dock pane** 内 | 焦点在输入框或点过空白处时按下去毫无反应，必须先点一下面板 |
| 分屏 `⌘\`（`Ctrl+\`） | `pane.split` | 同上 | 同上 |
| 停止当前轮次 `Esc` `Esc` | 固定序列 `response.stop` | 焦点必须在**会话区域**内（实际就是 composer） | 点空白处后连按两下无效，必须先点输入框 |

> 名词先混个脸熟：**composer** = 主界面底部的输入框；**dock pane** = 右侧栏里的面板。两者的精确定义（含 DOM 标记）见 [第 2.2 节](#22-本-gui-里的两个关键区域composer-与-dock-pane)。

> 关于键位写法：官方把"主修饰键"记作 `primary`，在 macOS 上它映射成 `⌘`（`meta`），在 Windows/Linux 上映射成 `Ctrl`（`control`）。所以 `primary+alt+Enter` 在 macOS 是 `⌘⌥Enter`、在 Windows/Linux 是 `Ctrl+Alt+Enter`；`primary+Backslash` 同理是 `⌘\` / `Ctrl+\`。

这三条快捷键的共同点：**用户必须先"点一下"，让焦点落到正确的地方，快捷键才肯干活**。本文要做的就是讲清楚"为什么非得点一下"，以及"这个插件怎么把这一步免掉"。

---

## 2. 预备知识

这一节解释后面反复出现的几个概念。如果你已经熟悉，可以跳到第 3 节。

### 2.1 DOM 元素（Element）与文档树

网页在浏览器里被解析成一棵"文档树"，树上每一个节点就是一个 **DOM 元素（Element）**，例如 `<body>`、`<div>`、`<textarea>`、`<input>`。元素之间是父子关系：`<textarea>` 在某个 `<div>` 里面，那个 `<div>` 又在 `<body>` 里面。

这个插件最关心的几种元素：

- `<body>`：整个页面的根容器，所有可见内容都在它里面。
- `<textarea>`：输入框，composer（对话输入区）用的就是它。
- 带有特定属性的元素，比如 `data-dockkit-pane="xxx"`（表示"这是一个右侧栏的 dock 面板"）、`data-conversation-session="xxx"`（表示"这块属于某个会话"）。这些 `data-*` 属性是官方代码用来给元素做标记的，本身没有显示效果，只是给脚本看的。

### 2.2 本 GUI 里的两个关键区域：composer 与 dock pane

后面反复出现两个名词，这里一次性定义清楚。

**composer（输入区 / 输入框）**：主界面底部"输入消息"的那块区域。它本质是一个可输入的文本域 `<textarea>`，外面套着一层"座位"容器（官方代码里叫 composer seat），DOM 上带 `data-composer-seat` 和 `data-conversation-region="composer"` 两个标记。你打字用的输入框、以及旁边"停止生成"的按钮，都属于 composer。文档里说"焦点在 composer / 输入框"，指的就是焦点落在这一块（通常是那个 `<textarea>`）。

**dock pane（右侧栏的 dock 面板）**：右侧栏（Right Sidebar）的布局用的是一套叫 **dock（dockkit）** 的"面板网格"系统。在这套系统里：

- 一个 **pane（面板）** 是右侧栏里的一块独立矩形区域，DOM 上带 `data-dockkit-pane`（停靠在 dock 里的面板）或 `data-dockkit-float`（浮动面板）标记；
- 每个 pane 里可以放一个或多个 **tab（标签页）**（某个工具页、某个网页等），tab 带 `data-dockkit-tab` 标记；
- 多个 pane 可以并排——"分屏（split）"的产物就是多出一个并排的 pane；也可以让某个 pane **全屏（fullscreen）** 占满整个右侧栏。

文档里说"焦点在 dock pane 内"，指的就是"当前焦点元素位于某个 `[data-dockkit-pane]` / `[data-dockkit-float]` 容器里"。"活动 dock pane"指 dock 布局当前标记为活动的那一个 pane（布局上的 `activeDockPaneId`）。

这两个区域**互不相干**：composer 在主对话区底部，dock pane 在右侧栏里。键盘快捷键要判断"你想操作谁"，靠的就是看这次按键的焦点落在哪个区域。

### 2.3 焦点（focus）与 `document.activeElement`

**焦点（focus）** 是浏览器的一个概念：同一个时刻，最多只有一个元素"持有焦点"，持有焦点的元素才会收到键盘输入。

- 你点击一个输入框，焦点就落到那个输入框上，`document.activeElement` 就是这个输入框。
- 有些元素（输入框、按钮、带 `tabindex` 的元素等）天然可聚焦；普通的 `<div>`、`<body>` 默认不可聚焦。
- **当没有任何元素真正持有焦点时**（例如刚打开页面，或者你点了一下消息列表的空白处——点空白 `<div>` 不会让它获得焦点），浏览器把焦点放在 `<body>` 上，`document.activeElement` 就是 `<body>`。

要特别注意：**"焦点在 `<body>`"和"焦点在输入框"是两种状态，前者代表"没聚焦任何东西"**。这是后面所有问题的根源。

### 2.4 `keydown` 事件派发给谁

按下键盘时，浏览器会产生一个 `keydown` 事件，并**派发（dispatch）给当前持有焦点的元素**。所以：

- 焦点在 composer 输入框 → 这次 `keydown` 的 `event.target` 是那个 `<textarea>`；
- 焦点在某个可聚焦的面板 → `event.target` 是面板元素；
- 没有聚焦任何东西 → `event.target` 是 `<body>`。

### 2.5 `event.target`、`document.activeElement`、`composedPath()`

这三者说的基本是同一件事，但有细微差别：

- `document.activeElement`：**当前**持有焦点的元素。是"状态"，随时可读。
- `event.target`：**这一次事件**实际落在的元素。对 keydown 而言，通常就是焦点元素。
- `event.composedPath()`：返回一个数组，从事件落点一路排到 `window`，即 `[最内层元素, 父元素, ..., <body>, <html>, document, window]`。官方代码取 `composedPath()` 里第一个 Element，就是为了拿到"最内层的那个元素"（等价于 `event.target`，但能穿透 shadow DOM 等边界）。

官方键盘处理里 `target` 的取法是：

```js
const target = event.composedPath().find((value) => value instanceof Element)
const element = target instanceof Element ? target : document.activeElement
```

即：先拿事件路径里第一个元素，拿不到就退而求其次读 `document.activeElement`。两者本质都是"当前聚焦元素"。

### 2.6 `element.closest(选择器)`：从自己往上找祖先

`closest()` 是 DOM 的标准方法：从当前元素开始，**沿着父链一直往上**，找到第一个匹配给定 CSS 选择器的祖先元素（包括自己），找不到就返回 `null`。

举例，假设 DOM 结构是：

```html
<body>
  <div class="chat" data-conversation-session="s1">
    <div data-conversation-region="chat">
      <p>你好</p>            <!-- 你的光标/焦点假设在这里附近 -->
    </div>
  </div>
</body>
```

对一个落在 `<p>` 上的事件目标 `el` 调用：

- `el.closest("p")` → 那个 `<p>`；
- `el.closest("[data-conversation-region]")` → 那个 `<div data-conversation-region="chat">`；
- `el.closest("[data-conversation-session]")` → 那个 `<div data-conversation-session="s1">`；
- `el.closest("[data-dockkit-pane]")` → `null`（因为这条父链上根本没有这个属性）。

官方命令就是靠 `closest()` 判断"这次按键落在哪个容器里"。**一旦 target 是 `<body>`，`body.closest(任何标记)` 几乎必然返回 `null`**，因为 `<body>` 在最外层，它上面没有这些标记。

### 2.7 `preventDefault()` 与"消费（consume）"

`event.preventDefault()` 是 DOM 标准方法，作用是**告诉浏览器"这个事件我已经处理了，请忽略它的默认行为"**（例如阻止输入框里敲 Tab 移焦点、阻止 `Esc` 关弹窗等）。

在本项目的代码里，"消费一个按键（`consume`）"就是指调用 `preventDefault()`。消费之后，事件对象上的 `event.defaultPrevented` 会变成 `true`，后续的处理者可以通过这个标志知道"已经有人处理过了"。

后面你会看到，"消费"是这套快捷键体系里"谁拥有这一按"的核心机制：**谁消费了，谁就是这一按的 owner**。

---

## 3. 根因：归属判定读焦点

问题不在监听层（按键事件**其实都送到了应用**），而在**归属判定层**：应用拿到按键后要回答"用户想操作的是哪个面板 / 哪个会话"，而它回答这个问题的唯一依据，是"这次按键发生在哪个 DOM 元素上"。

### 3.1 键盘事件的完整链路

`dsh-client-shortcuts` 这个包负责所有键盘事件的仲裁。它在 `window` 上挂了 keydown 监听，所以**无论焦点在哪，它都能看到每次按键**。它对每次 keydown 依次做下面几步：

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

规则：

- target 在 `.xterm`（终端）里 → `region = "terminal"`；
- target 是输入框/文本域/下拉框/可编辑区域 → `region = "editable"`；
- 其余（包括 `<body>`）→ `region = "page"`。

**第 3 步：组装 context（上下文）。**

```js
const context = { region, modal, target: element }
```

其中 `modal` 表示"当前是否有模态弹窗打开"（没有则是 `null`）。

**第 4 步：依次交给两个通道。**

```js
fixed?.({ type: "keydown", gesture, context, consume })   // 先：固定输入通道
if (native) return                                        // （仅桌面端 macOS/Windows 会在这里提前返回）
shortcuts.dispatch({ ...gesture, defaultPrevented: event.defaultPrevented }, context, consume)  // 后：可配置命令
```

- **固定输入通道（fixed input）**：处理那些**键位不可改**的固定序列，比如 `Esc Esc` 停止。
- **可配置命令（configurable commands）**：处理那些**可以在"设置 → 快捷键"里改键位**的命令，比如 `⌘⌥Enter` 全屏、`⌘\` 分屏。
- 桌面端（Desktop）macOS/Windows 上，可配置键位不走这段 DOM 监听，而是由 Electron 的原生键盘桥派发，所以那段代码会在 `if (native) return` 提前返回（后面第 5 节会再解释这对插件意味着什么）。

**关键结论**：整条链路里，`target` 从取到的那一刻起就一直等于"当前聚焦元素"，**没有任何**"鼠标悬停在哪儿""上次点过哪儿"的信息。一旦焦点为空，`target` 就是 `<body>`，后面所有靠 target 做的判断都会落空。

### 3.2 面板命令的归属判定（`⌘⌥Enter` / `⌘\`）

`pane.fullscreen.toggle` 和 `pane.split` 是两条**可配置命令**，它们的 `resolve()` 长这样（精简）：

```js
resolve: ({ target: element }) => {
  const target = sidebar.focusedTarget(element)      // ← 关键：从"焦点元素"反推"目标面板"
  if (target === undefined) {
    return { status: "blocked", reason: "command.noFocus" }   // 反推失败 → 放弃
  }
  const unavailable = reason(kind, target)
  if (unavailable !== null) return { status: "blocked", reason: unavailable }
  return { status: "handled", run: () => { /* 真正执行全屏/分屏 */ } }
}
```

`sidebar.focusedTarget(element)` 内部（`sidebarTargetFromElement`）依次检查：

1. `element` 是否为 `null` 或已从文档移除 → 是则返回 `undefined`；
2. `element.closest("[data-sidebar-right-session]")` 拿到的会话 id 是否等于右侧栏当前显示的会话 → 不等则返回 `undefined`；
3. `element.closest("[data-dockkit-pane], [data-dockkit-float]")` 能否找到一个面板容器（`[data-dockkit-pane]` = dock 里的面板，`[data-dockkit-float]` = 浮动的面板）→ 找不到则返回 `undefined`；
4. 该容器是否可见、是否属于当前可见的 dock 布局、tab 是否还在、导航版本是否一致 → 任一不符则返回 `undefined`。

只要上面任何一步失败，`resolve` 就返回 `blocked / noFocus`，**命令静默放弃，什么都不做**。

把三个典型焦点位置代入，走查一遍：

| 焦点位置 | `keydown` 的 target | `focusedTarget(target)` 的结果 | 命令表现 |
|---|---|---|---|
| composer 输入框 | `<textarea>`（它的祖先链里没有 `[data-dockkit-pane]`） | 第 3 步 `closest(...)` 返回 `null` → `undefined` | `noFocus`，无反应 |
| 右侧栏 dock pane 内 | pane 元素（或 pane 内部的子元素） | 全部检查通过 → 返回该 pane | 正常全屏/分屏 |
| 消息列表空白处（无焦点） | `<body>` | 第 2 步 `body.closest("[data-sidebar-right-session]")` 为 `null` → `undefined` | `noFocus`，无反应 |

> 官方 README 里其实写明了这是**有意为之**的设计："Split and fullscreen require focus within a visible dock pane."（分屏和全屏要求焦点在可见的 dock 面板内）。

### 3.3 停止序列的归属判定（`Esc Esc`）

停止用的是**固定序列**，和面板命令走的是不同的通道。它分两部分：

1. `response.stop` 通过 `registerFixed()` 注册进 fixed catalog，作用是**在设置界面里声明"Esc Esc"这个键位、并参与键位冲突检测**——但它的键位**不可改绑**。
2. 真正处理按键的，是 `installStopShortcut` 里通过 `observeFixedInput` 订阅的一段逻辑。

这段逻辑（精简）在每次 keydown 时先做一层"资格"检查，再做"归属"检查：

```js
// —— 资格检查：不符合基本条件就直接放弃（连第一下都不记）——
if (gesture.code !== "Escape" || gesture.repeat || gesture.composing || gesture.defaultPrevented
  || gesture.control || gesture.alt || gesture.shift || gesture.meta
  || context.modal !== null || context.region === "terminal" || context.target === null) {
  reset(); return
}

// —— 归属检查：从 target 反推"你在哪个会话、哪个区域" ——
const occurrence = target.closest("[data-conversation-session]")
const region = target.closest("[data-conversation-region]")
if (occurrence === null || region === null || !occurrence.contains(region)
  || target.closest("[data-approval-key], iframe, .xterm, [inert]") !== null) {
  reset(); return
}

const sessionId = occurrence.dataset.conversationSession
// ... 继续：解析会话、确认正在 running、确认无待答交互，然后 consume 并进入"双按"序列
```

其中最关键的是**归属检查**里那两个 `closest()`：

- `[data-conversation-session]` 和 `[data-conversation-region]` 这两个标记，官方只挂在**会话的消息列表 body** 和 **composer seat（输入区座位）** 上；
- `occurrence.contains(region)` 要求"区域"必须真的在"会话"里面（防止两个标记分别命中不同容器）；
- 另外还要求 target 不在 `[data-approval-key]`（审批控件）、`iframe`（内嵌网页）、`.xterm`（终端）、`[inert]`（被禁用的内容）里。

把三个典型焦点位置代入：

| 焦点位置 | `keydown` 的 target | 两个 `closest()` 的结果 | 表现 |
|---|---|---|---|
| composer | `<textarea>`（在 `[data-conversation-region]` 内） | 两个都命中 | 正常进入双按序列，两下停止 |
| 右侧栏 pane | pane 元素 | 都命中不了 → `null` | 第一下 Esc 就被 `reset()` 丢弃 |
| 消息列表空白处（无焦点） | `<body>` | `body.closest(...)` 都是 `null` | 第一下 Esc 就被 `reset()` 丢弃 |

> 注意两条命令的失败方式不一样：
> - 面板命令是**阻塞**：`resolve` 返回 `blocked/noFocus`，`dispatch` 会 `consume()`（消费这一按），但**不执行任何动作**——用户看到的就是"没反应"。
> - 停止序列是**静默 reset**：资格/归属检查不通过时直接 `reset()`，**不消费**——第一下 Esc 被当作从没发生过，你连按第二下的机会都没有。

### 3.4 为什么"点一下"就好了

点击（pointerdown）会**把焦点搬进那个容器**：

- **点侧栏面板**：右侧栏插件里的 `observeSidebarFocus` 监听 pointerdown，当点击落在 pane 上、且点的不是 pane 里的控件（按钮/输入框等）时，直接执行 `pane.focus()`，把焦点设进那个 pane。之后 keydown 的 target 就是 pane，`focusedTarget` 就能解析出来。
- **点 composer**：`<textarea>` 本身可聚焦，点一下焦点自然进输入框，之后 Esc Esc 的两个 `closest()` 就能命中。

所以"先点一下"不是巧合，也不是什么隐藏机制，而是**手动把下一次按键的 target 修对了**。本插件要做的，就是在这两步之间插入一个"不需要手动点"的兜底。

### 3.5 为什么改键位 / 换绑定没用

拒绝发生在**归属判定**这一步，而不是"按哪个键触发"这一步。

- 改键位只改变"哪个组合键能匹配到这条命令"（第 1 步匹配）；
- 匹配成功之后，命令照样执行 `resolve()` 读 `focusedTarget` / 会话标记（第 2 步归属判定）；
- 焦点不对，第 2 步照样失败。

所以无论把全屏绑成 `⌘⌥Enter` 还是别的什么键，焦点不在面板内就永远不生效。

此外，如果你想"用设置里的 override 抢内置默认键"（比如把 `⌘⌥Enter` 抢给一条你自己的命令），会被 `effectiveShortcuts` 判为 **conflict（键位冲突）**：因为内置的 `pane.fullscreen.toggle` 仍是**未改动**状态、仍占着默认键，与你新录的键重叠，编辑会被挡下（冲突规则：未改动的内置行会与任何重叠键冲突，只有"改动过的行"之间才按新规则仲裁）。这就是为什么"改键位"这条路从两个方向都走不通。

---

## 4. 解决思路总览

既然根因是"归属判定读焦点"，那就**换一个不依赖焦点的归属判定来源**，同时**只在确定自己该接管时才出手**，避免和内置命令打架。

本插件做的三件事：

1. **不注册任何命令**：不往 shortcut catalog 里加东西，因此没有默认键位、没有冲突、不需要改设置。
2. **挂在固定输入通道上，先于内置命令观察每一次按键**，并能在合适的时候 `consume()`（= 接管这一按）。
3. **用两个不读焦点的来源做归属判定**：
   - 面板键 → 用 `sidebarRight.commandTarget()` 的"活动 dock pane"回退（这正是 `sidebar.right.toggle` 那个"在哪儿按都能展开侧栏"的键用的同一机制）；
   - 停止 → 用 `sessions.list` 里"主视图正在持有的会话"来定位要停的会话，再调该会话上的 `conversation.cancel()`。

下面第 5 节把这些机制一条一条展开。

---

## 5. 实现细节（逐条展开）

### 5.1 固定输入通道：`observeFixedInput` 与"消费即让位"

**这个通道是什么**：`shortcuts.observeFixedInput(listener)` 把 `listener` 加进一个 `fixedListeners` 集合，返回一个"取消订阅"函数。每次 keydown，`installKeyboard` 都会在跑 `dispatch`（可配置命令）**之前**，把这些 listener 全部调一遍。

**为什么它能"抢"在可配置命令前面**：因为顺序是 `fixed?.()`（固定通道）→ `dispatch()`（可配置命令）。而 `dispatch` 一开头就有：

```js
if (gesture.defaultPrevented || gesture.composing) return { status: "pass" }
```

也就是说，只要固定通道里有人 `consume()`（调用了 `preventDefault()`），等轮到 `dispatch` 时它一读 `event.defaultPrevented` 是 `true`，立刻 `pass`，内置命令这一按就不执行了。

**"消费即让位"的精确机制**——`fixedInput` 的包装长这样：

```js
let consumed = false
for (const listener of [...fixedListeners]) {
  listener(input.type === "reset" ? input : {
    ...input,
    gesture: { ...input.gesture, defaultPrevented: input.gesture.defaultPrevented || consumed },
    consume: () => { consumed = true; input.consume() }
  })
}
```

拆开讲：

- `consumed` 是一个**本轮共享的标志**；
- 每个 listener 收到的 `consume` 都是同一个包装：调用它就做两件事——把 `consumed` 置 `true`，并调用最底层的 `input.consume()`（也就是 `event.preventDefault()`）；
- 每个 listener 收到的 `gesture.defaultPrevented` 是"**原始值 或 之前是否已被消费**"（`|| consumed`）。

含义：**多个固定 listener 是"多播"关系，但消费是共享的**。谁先消费，后面的 listener 一看 `defaultPrevented` 为 `true` 就知道"已经被处理过了"，可以选择让位。这正是插件与内置 `response.stop`（它也在 `fixedListeners` 里）互斥不打架的基础。

### 5.2 读生效绑定：`enabledBinding`

面板键的键位是**可改的**，所以插件不能硬编码 `⌘⌥Enter` / `⌘\`，而必须读"用户当前实际生效的绑定"。它读 `shortcuts.catalog.getSnapshot()`（快捷键目录的快照），每条记录形如 `{ id, binding, issue, conflicts, ... }`。

```ts
function enabledBinding(rows, id) {
  const row = rows.find(r => r.id === id)
  if (row === undefined) return undefined                       // 这条命令根本不存在
  if (row.binding === null) return undefined                    // 已被解绑（用户清空了键位）
  if (row.issue !== null) return undefined                      // 被系统/浏览器规则保留（如"此组合键被系统占用"）
  if (row.conflicts.length > 0) return undefined                // 处于键位冲突中
  return row.binding                                            // 这才是"当前生效的绑定"
}
```

含义：命令**解绑、被保留、或处于冲突**时，插件都不接管——因为此时内置命令自己也不会响应（`dispatch` 不会把它放进 `bindings` 表）。插件**永远跟随用户设置**：改绑后跟随新键，解绑后放手。

> 唯一一处与内置 `refreshLabels` 的差异：`refreshLabels` 在"启用"判定里还要求 `config.status !== "loading"`（目录还在首次读取时不算启用），而插件不查这个 `loading` 状态。这只影响"首屏目录尚未读完"的极短瞬间，方向上无碍（不会因此误动作，最多是那一瞬间按内置其实还没就绪时插件抢先接管了，而这正是本插件想要的行为）。

### 5.3 面板键桥接：`handlePaneInput` 逐行

```ts
function handlePaneInput(shortcuts, sidebar, input) {
  const gesture = input.gesture
  const context = input.context

  if (gesture.composing || gesture.defaultPrevented) return   // ①
  if (context.modal !== null) return                          // ②

  const rows = shortcuts.catalog.getSnapshot()
  const action = paneActionFor(rows, gesture, { fullscreen: 'pane.fullscreen.toggle', split: 'pane.split' })
  if (action === undefined) return                            // ③

  const element = context.target ?? document.activeElement
  if (sidebar.focusedTarget(element) !== undefined) return    // ④

  if (!sidebar.isExpanded()) return                           // ⑤

  const target = sidebar.commandTarget(element)               // ⑥
  if (target === undefined) return

  input.consume()                                             // ⑦
  if (gesture.repeat) return                                  // ⑧
  if (!sidebar.isTargetCurrent(target)) return                // ⑨

  if (action === 'fullscreen') sidebar.toggleFullscreen(target)   // ⑩
  else sidebar.split(target.paneId)
}
```

逐行解释：

- **① 组合输入或已被消费 → 让开。** `composing` 表示正在用输入法组字（此时快捷键应失效）；`defaultPrevented` 表示这一按已经被别的监听器消费了。两种情况都不该再动。
- **② 模态弹窗打开 → 让开。** 面板命令的 `modals` 是空数组，意味着"有弹窗时它们不生效"；此时内置 `dispatch` 会消费并 `blocked`，插件不掺和，让内置统一处理弹窗下的按键。
- **③ 这一按不是两个面板命令的生效绑定 → 不关我事。** `paneActionFor` 会查 `enabledBinding`（第 5.2 节），只有这一按**恰好**命中 `pane.fullscreen.toggle` 或 `pane.split` 当前生效的键位时才继续。
- **④ 焦点已经在面板内 → 让内置独占。** 这是内置命令自己的场景：`focusedTarget` 能解析出来，内置 `dispatch` 会在同一轮里正常执行全屏/分屏。插件若再动一次就会全屏两次（来回抵消），所以**不动作、也不消费**，把这一按完整留给内置。
- **⑤ 面板折叠 → 无面板可全屏/分屏。** 折叠时右侧栏根本没有展开的面板，任何目标都无从谈起。此时正确的做法是先用 `sidebar.right.toggle`（展开键）展开——展开动作会顺手聚焦活动 pane，之后内置命令就能用了。
- **⑥ 免聚焦解析目标。** 走到这里，说明焦点不在面板内，内置命令会 `noFocus` 放弃，插件接手。`sidebar.commandTarget(element)` 是官方公开方法，逻辑是：
  1. 先 `focusedTarget(element)`——但前面 ④ 已经确认它是 `undefined`；
  2. 若 `element.closest("[data-sidebar-right-session]")` 命中（target 在侧栏容器内，但不在 pane 内）→ **刻意返回 `undefined`，不回退**（官方注释："stale sidebar markup never falls back to another pane"，防止对陈旧的侧栏标记误回退到另一个面板）；
  3. 否则 → 返回"**当前屏会话的活动 dock pane**"（`activeDockPaneId` 对应的那个 pane，及其活动 tab 的 occurrence 与导航版本）。

  第 3 步的"活动 dock pane 回退"就是 `sidebar.right.toggle`（展开键）能"在任何地方按都生效"的同一机制。
- **⑦ 先消费，再动作。** 因为这一按若不消费，等轮到内置 `dispatch` 时它会 `noFocus` 并自己 `consume()`——插件必须抢先把这一按标记为"我处理了"，否则这一按会被两家同时处理（语义上"每按一个 owner"被破坏）。
- **⑧ 重复键（长按自动重复）→ 消费但不执行。** 与内置 `dispatch` 的语义一致：`consume()` 后 `if (!gesture.repeat) run()`。即：按住不放产生的一连串 repeat 事件，只消费不重复触发动作。
- **⑨ 目标过期兜底。** 从"读到 target"到"真正执行"之间可能有别的渲染发生（会话切换、tab 变化等）。`isTargetCurrent` 校验"当前屏会话、pane、tab、导航版本"是否仍与捕获时一致，不一致就放弃。虽然 `toggleFullscreen` / `split` 内部也会再校验一次，但插件在这里先兜一道，和面板控件的行为保持一致。
- **⑩ 执行。** 全屏 → `toggleFullscreen(target)`；分屏 → `split(target.paneId)`。这两个方法内部还会各自做预算/宽度/可见性校验，不满足就静默不做（与内置命令同一条路径）。

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

所以插件**无法区分**「两下都在轮次 A」和「一下 A、一下 B」——只要 `sessionId` 相同、`binding` 还是同一个对象，它就会在 500ms 内凑成一次停止，哪怕中间已经换了轮次（这正是文档第 7 节边界表里「两按之间轮次恰好结束并立刻开启新轮次 → 插件仍会停到新轮次 B，内置会因 `turn` 变化而复位」的由来）。

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

---

## 6. 与内置命令的完整对照

| 场景 | 内置命令（没有插件时） | 本插件（装了之后） |
|---|---|---|
| 焦点在输入框，按 `⌘⌥Enter` | `noFocus`，消费但不动作 | 取活动 dock pane，正常全屏 |
| 焦点已在面板内，按 `⌘⌥Enter` | 正常全屏 | 让位，不动作、不消费 |
| 面板折叠，按 `⌘⌥Enter` | 无动作 | 无动作（先用展开键展开，展开会顺手聚焦活动 pane） |
| 焦点在侧栏容器内、但不在 pane 内（如侧栏边距） | `noFocus` | `commandTarget` 按官方语义返回 `undefined`，无动作 |
| 内置键位被改绑 | 跟随新键 | 同样跟随新键（读生效绑定） |
| 内置键位被解绑 / 被系统保留 / 冲突中 | 不响应 | 不响应（`enabledBinding` 返回 `undefined`） |
| 模态弹窗打开，按面板键 | 消费并 `blocked`（modal） | 让位，不动作、不消费 |
| 焦点在 composer，`Esc Esc` | 正常停止 | 让位，不动作、不消费 |
| 焦点在 `<body>`（点过空白处），`Esc Esc` | 第一下 Esc 就被丢弃，无动作 | 主视图会话停止 |
| 存在待答交互（审批/提问） | 不停止 | 不停止 |
| 桌面端（Desktop）按面板键 | native 通道派发 | **不安装面板桥**（见第 7 节） |
| 桌面端 `Esc Esc` | DOM 固定通道驱动，正常 | 停止桥照常安装，正常 |

---

## 7. 已知边界与失败模式

每一条都说明"为什么"，而不只是"是什么"。

| 情况 | 行为 | 为什么 |
|---|---|---|
| Desktop 运行时 | 面板桥不安装并告警一次；停止桥照常安装 | 桌面端 macOS/Windows 的可配置键位由 Electron 原生键盘桥派发，DOM 侧的 `consume()` 压不住那一次派发，两边都动作会来回抵消（全屏两次）。而停止序列在两端都由 DOM 固定通道驱动（`installKeyboard` 的 `fixed?.()` 在 native 分支 `return` **之前**执行），所以停止桥可以照常装。 |
| `sidebarRight` 服务缺席 | 面板桥不安装，插件整体仍 no-op，不抛 | 面板桥通过 `ctx.inject(['shortcuts', 'sidebarRight'], ...)` 依赖侧栏服务，服务不存在时注入不解析、这段逻辑根本不跑；停止桥独立，不受影响。 |
| `shortcuts.observeFixedInput` 缺席 | 各告警一次，不安装 | 整个方案都建立在固定输入通道上；没有这个 API 就没有可挂的点，只能放弃。 |
| 主视图持有会话数 ≠ 1（正在切换） | 不停止 | `mainViewSessionId` 要求恰好一个会话被主视图 retain。切换过程中可能出现两个会话同时被 retain 的瞬间，此时"当前会话"有歧义，宁可这一下不响应，也不停错会话。 |
| 会话无 `running` / 已 `removed` / 子代理不可续 / 有待答交互 | 不停止 | 这些是内置 `currentTurn` 的同一批门槛；不满足说明"没有可停的轮次"或"此时不该停"。 |
| 某会话 scope 上没有 `conversation` | 告警一次，不发停止 | `conversation.cancel()` 是停止的唯一入口；服务缺失时无法停，只能告警。 |
| `cancel()` 拒绝（返回 rejected Promise） | 捕获并告警，不冒泡 | 避免未处理的 Promise 拒绝污染控制台/运行时。 |
| 两按之间轮次恰好结束并立刻开启新轮次 | 500ms 窗口内仍会停到新轮次 | 内置序列要求两按的 `(sessionId, turn, generation, region)` 全同，其中 `turn` 能区分"轮次 A"和"轮次 B"；插件只用 `(sessionId, generation)`，轮次身份不是公开事实。所以"第一下在轮次 A 结束前、第二下落在刚开的新轮次 B"这种窗口内，插件仍会停 B，内置则会因 `turn` 变化而复位。 |
| 焦点在侧栏容器内、但不在 pane 内 | `commandTarget` 返回 `undefined`，无动作 | 官方 `commandTarget` 故意对"target 在 `[data-sidebar-right-session]` 内但不在 pane 内"的陈旧标记**不回退**（防止误回退到另一面板），插件尊重这个语义，此时与内置一样不动作。 |

告警前缀统一为 `[dsh-focus-free-shortcuts]`，方便在控制台过滤。

---

## 8. 依赖的非正式契约

本插件依赖三处**不是正式对外契约**的事实。它们都与官方代码同源，但官方没有承诺"永不变名"。若上游改名，本插件会**退化成 no-op（什么都不做，但绝不误动作）**，并在诊断里说明。

1. 命令 id `pane.fullscreen.toggle` / `pane.split`（与官方 `shortcuts.register` 处同源）；
2. DOM 标记 `[data-conversation-session]` / `[data-conversation-region]`（与官方 stop guard 同源）；
3. `retainedBy.mainView` 的语义（与 `UiSession.isMain` 同源）。

---

## 9. 构建与测试

```bash
cd dsh-focus-free-shortcuts
../node_modules/.bin/tsdown                          # 构建产物（或 pnpm build）
node test-focus-free.mjs                             # 跑测试（或 pnpm test）
../node_modules/.bin/tsc --noEmit                    # 类型检查（或 pnpm typecheck）
node --check lib/client.js && node --check index.ts  # 语法检查（或 pnpm check）
```

`test-focus-free.mjs` 覆盖（A–G 七组）：

- **A 绑定判定**：`bindingMatches`（修饰键顺序无关、双键和弦拒绝）、`enabledBinding`（解绑 / 保留 / 冲突 / 缺席）
- **B Escape 准入**：`escapeEligible` 逐项否决
- **C 目标归属**：`conversationOwnsTarget` 的假 DOM（含 approval / iframe / xterm / inert）
- **D Escape 序列**：窗口 / 代际 / reset
- **E 面板键桥接**：聚焦让位、回退全屏/分屏、折叠/模态/repeat/过期目标、改绑/解绑/冲突、desktop 让位、服务缺席
- **F 停止桥接**：主视图会话歧义、停止成功与全部否决路径、卸载复位
- **G 产物**：`lib/client.js` 的模块 id / 插件名 / `inject` 声明与端到端装配（产物零 `require`，不依赖任何 external）

---

## 10. 启用

```bash
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-focus-free-shortcuts
```

重启 / 刷新 GUI 后验证：

- 焦点放在输入框，按 `⌘⌥Enter` → 应直接全屏右侧栏面板（不再需要先点面板）；
- 把焦点点到消息空白处（或任意非输入控件），连按两下 `Esc` → 应停止当前轮次。

撤销：

```bash
dsh plugin --profile web remove dsh-focus-free-shortcuts
```

`add-plugins.sh` / `add-plugins.ps1` 已包含本插件。
