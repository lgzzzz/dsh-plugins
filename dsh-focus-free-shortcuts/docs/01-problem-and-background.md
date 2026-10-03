# 问题与背景

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 1 册：先讲清「问题是什么」，再补齐后面反复用到的 DOM / 焦点 / 事件预备知识。

---

## 1. 问题："要先聚焦才生效"的几个快捷键

GUI 里有几个快捷键，必须先把焦点点进特定区域才会响应（表里前四行）；最后一行则是另一种"按下去毫无反应"——那个键本身没有任何问题，只是它在那种状态下**没有主人**：

| 快捷键 | 触发的是哪条命令 | 内置的生效条件 | 你观察到的现状 |
|---|---|---|---|
| 全屏/还原 `⌘⌥Enter`（Windows/Linux 是 `Ctrl+Alt+Enter`） | `pane.fullscreen.toggle` | 焦点必须落在右侧栏**可见的 dock pane** 内 | 焦点在输入框或点过空白处时按下去毫无反应，必须先点一下面板 |
| 分屏 `⌘\`（`Ctrl+\`） | `pane.split` | 同上 | 同上 |
| 停止当前轮次 `Esc` `Esc` | 固定序列 `response.stop` | 焦点必须在**会话区域**内（实际就是 composer） | 点空白处后连按两下无效，必须先点输入框 |
| 审批：允许一次 `Enter` / 拒绝 `Esc` | 审批面板自己的 `onKeyDown` | 焦点必须在**审批详情区**内（`[data-approval-key]`） | 审批一出现，composer 被顶替隐藏、焦点退回 `<body>`，两个键都没反应，必须先点一下审批卡片 |
| 取消提问卡片 `Esc` | 提问卡片自己的关闭 / 取消按钮（`PendingQuestion.dismiss()`）——**没有任何按键绑定** | 面板**完全不绑** `Esc`（它自己的 `keydown` 只看 `Enter`），卡片唯一的出口是自己的关闭按钮 | 提问卡片弹出、composer 被顶替隐藏、焦点退回 `<body>`，按 `Esc` 毫无反应：既没人取消提问，也没人停止回合 |

> 名词先混个脸熟：**composer** = 主界面底部的输入框；**dock pane** = 右侧栏里的面板；**审批详情区** = 审批卡片里那块可聚焦的说明区域。前两者的精确定义（含 DOM 标记）见 [第 2.2 节](#22-本-gui-里的两个关键区域composer-与-dock-pane)，审批面板见 [第 5 册](05-approval-key-bridge.md)；提问卡片（`ask_user_question` 的 composer 顶替卡片）见同册第 5.6.3、5.7 节与 [第 6 册](06-comparison-boundaries-contracts.md) 第 7 节的边界表。

> 关于键位写法：官方把"主修饰键"记作 `primary`，在 macOS 上它映射成 `⌘`（`meta`），在 Windows/Linux 上映射成 `Ctrl`（`control`）。所以 `primary+alt+Enter` 在 macOS 是 `⌘⌥Enter`、在 Windows/Linux 是 `Ctrl+Alt+Enter`；`primary+Backslash` 同理是 `⌘\` / `Ctrl+\`。

前四条快捷键的共同点：**用户必须先"点一下"，让焦点落到正确的地方，快捷键才肯干活**。本文要做的就是讲清楚"为什么非得点一下"，以及"这个插件怎么把这一步免掉"。

> 表里第 5 行要单独说一句：它既不是前四条那种"要先聚焦才生效"的键——`Esc` 在提问卡片上**根本没有绑定**，聚焦到哪儿都不会有人响应；也不是 `Ctrl+Alt+J` / `Ctrl+Alt+←/→` 那种插件新挂的键——`Esc` 本来就是既有按键。它是一个**既有键在一种状态下没有主人**：提问卡片以 composer 顶替的方式出现，卡片自己不处理 `Esc`，而内置的 `response.stop` 固定序列与本插件的停止桥都以"有待答交互"为门槛拒绝这一按、且都不消费。本插件要做的只是把这一按接过来，交给卡片唯一的出口——关闭 / 取消按钮调用的 `PendingQuestion.dismiss()`（见 [第 5 册](05-approval-key-bridge.md) 第 5.6.3、5.7 节）。

> 与前四条那种"点一下就有主人"的键、以及第 5 行那个"本来没主人"的键都不同，本插件还带两把**全新的键**——`Ctrl+Alt+J`（聚焦输入框）与 `Ctrl+Alt+←` / `Ctrl+Alt+→`（切换右栏页面）。它们不解决"要先聚焦"的问题：官方没有任何命令占用它们，插件自己各挂一条固定键预约下来，再走同一条固定输入通道把键盘交还给 composer（`Ctrl+Alt+J`）、或把右侧栏切到下一张页面并把键盘交给新页面（`Ctrl+Alt+←/→`）。实现细节见 [第 6 册](06-comparison-boundaries-contracts.md) 的对照表，桥接实现分别在 `src/focus-composer.ts` 与 `src/page-cycle.ts`（见 [第 7 册](07-build-test-and-enable.md)）。

---

## 2. 预备知识

这一节解释后面反复出现的几个概念。如果你已经熟悉，可以跳到 [第 3 节](02-root-cause.md)。

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
