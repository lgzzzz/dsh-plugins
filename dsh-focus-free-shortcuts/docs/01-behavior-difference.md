# 行为差异与影响面

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 1 册：六条「焦点不在目标区域内就没有反应」的快捷键，以及后文反复用到的 DOM / 焦点 / 事件术语。

---

## 1. 需要先聚焦才生效的快捷键

下表六条键的生效条件都取决于「本次按键的焦点落在哪个元素上」。前五行要求焦点落在特定区域内；第 6 行（提问卡片 `Esc`）是既有键在那种状态下完全没有绑定。

| 快捷键 | 命令 / 绑定来源 | 生效条件 | 焦点不在该区域时的表现 |
|---|---|---|---|
| 全屏/还原 `⌘⌥Enter`（Windows/Linux 为 `Ctrl+Alt+Enter`） | `pane.fullscreen.toggle`（可配置命令） | 焦点落在右侧栏**可见的 dock pane** 内（`[data-dockkit-pane]` 或 `[data-dockkit-float]`，且容器可见、属于当前可见的 dock 布局） | `resolve()` 返回 `blocked / command.noFocus`：消费这一按但 `run` 不执行，表现为无反应 |
| 分屏 `⌘\`（`Ctrl+\`） | `pane.split`（可配置命令） | 同上 | 同上 |
| 关闭当前页面／窗口 `⌘⌥W`（Windows/Linux 为 `Ctrl+Alt+W`） | `page.close`（可配置命令；Desktop 上默认是 `⌘W` / `Ctrl+W`） | 同上（焦点落在右侧栏可见的 dock pane 内才解析得到目标页） | Web 上 `resolve()` 返回 `blocked / command.noFocus`（提示「请先聚焦右侧面板」）：消费这一按但 `run` 不执行，表现为无反应；Desktop 上同一命令在解析不到面板时走 `closeWindow()`，**本来就免聚焦**（所以本插件只补 Web 这一半） |
| 停止当前轮次 `Esc` `Esc` | 固定序列 `response.stop`（键位不可改绑） | 焦点落在会话区域内：`target.closest("[data-conversation-session]")` 与 `target.closest("[data-conversation-region]")` 双双命中且 `occurrence.contains(region)` | 资格/归属检查不通过时 `reset()` 且**不消费**，第一下 `Esc` 被丢弃 |
| 审批：允许一次 `Enter` / 拒绝 `Esc` | 审批面板自己的 `onKeyDown`；`registerFixed()` 另登记 `approval.allow` / `approval.reject`，仅用于声明键位与冲突检查 | 焦点落在审批详情区（`[data-approval-key]` 子树内，且 `currentTarget.contains(document.activeElement)` 成立） | 面板收不到这一按，`Enter` 与 `Esc` 都是无反应 |
| 取消提问卡片 `Esc` | 无按键绑定；卡片唯一出口是头部关闭 / 取消按钮，调 `PendingQuestion.dismiss()` | 无（组件里只有两处 `keydown`，都只读 `Enter`，不读 `Escape`） | `Esc` 既不取消提问、也不停止回合 |

> 术语：**composer** = 主界面底部的输入区；**dock pane** = 右侧栏里的面板；**审批详情区** = 审批卡片里那块可聚焦的说明区域。前两者的 DOM 标记见 [第 2.2 节](#22-本-gui-里的两个关键区域composer-与-dock-pane)，审批面板见 [第 5 册](05-approval-key-bridge.md)；提问卡片（`ask_user_question` 的 composer 顶替卡片）见同册第 5.6.3、5.7 节与 [第 6 册](06-boundaries-and-contracts.md) 第 7 节的边界表。

> 键位写法：官方把主修饰键记作 `primary`，在 macOS 上映射成 `⌘`（`meta`），在 Windows/Linux 上映射成 `Ctrl`（`control`）。因此 `primary+alt+Enter` 是 `⌘⌥Enter` / `Ctrl+Alt+Enter`，`primary+Backslash` 是 `⌘\` / `Ctrl+\`。`page.close` 在 Desktop 上是 `primary+W`（`⌘W` / `Ctrl+W`），在 Web 上被官方改成 `primary+alt+W`（`⌘⌥W` / `Ctrl+Alt+W`）以免被浏览器当成关标签页的 `⌘W`。本插件自己挂的四条固定键同样声明逻辑组合、由 `registerFixed` 按设备平台规范化成生效的物理绑定：`primary+alt+J` 是 `⌘⌥J` / `Ctrl+Alt+J`，`primary+alt+←` / `primary+alt+→` 是 `⌘⌥←` / `⌘⌥→`（macOS）、`Ctrl+Alt+←` / `Ctrl+Alt+→`（Windows/Linux），`primary+↑` / `primary+↓` 是 `⌘↑` / `⌘↓`（macOS）、`Ctrl+↑` / `Ctrl+↓`（Windows/Linux），`primary+alt+↑` / `primary+alt+↓` 是 `⌘⌥↑` / `⌘⌥↓`（macOS）、`Ctrl+Alt+↑` / `Ctrl+Alt+↓`（Windows/Linux）。

> 第 6 行的前提条件：有待答交互时，内置 `response.stop` 固定序列与本插件的停止桥都以 `pendingInteraction !== undefined` 为门槛拒绝这一按，且都不消费。插件把这一按接到卡片关闭 / 取消按钮调用的同一个 `PendingQuestion.dismiss()` 上（见 [第 5 册](05-approval-key-bridge.md) 第 5.6.3、5.7 节）。

> 本插件另有四条官方没有任何命令占用的固定键（声明为逻辑组合，按平台落成）：`primary+alt+J` = `⌘⌥J`（macOS）/ `Ctrl+Alt+J`（Windows/Linux）（`dsh-focus-free-shortcuts.focus-composer`，把键盘交还 composer）、`primary+alt+←/→` = `⌘⌥←` / `⌘⌥→`（macOS）/ `Ctrl+Alt+←` / `Ctrl+Alt+→`（Windows/Linux）（`dsh-focus-free-shortcuts.page-cycle`，把右侧栏切到下一张页面并把键盘交给新页面）、`primary+↑/↓` = `⌘↑` / `⌘↓`（macOS）/ `Ctrl+↑` / `Ctrl+↓`（Windows/Linux）（`dsh-focus-free-shortcuts.session-cycle`，在左侧栏前三个工作区当前显示出来的会话行之间导航）与 `primary+alt+↑/↓` = `⌘⌥↑` / `⌘⌥↓`（macOS）/ `Ctrl+Alt+↑` / `Ctrl+Alt+↓`（Windows/Linux）（`dsh-focus-free-shortcuts.session-active-cycle`，只在其中带状态点的活跃会话之间切换）。四者都走固定输入通道，实现分别在 `src/focus-composer.ts`、`src/page-cycle.ts` 与 `src/session-cycle.ts`；对照表见 [第 6 册](06-boundaries-and-contracts.md)，构建与启用见 [第 7 册](07-build-test-and-enable.md)。

> 焦点落在**终端**（`.xterm`）里时，上面四条里的 `primary+alt+J`、`primary+alt+←/→` 与 `primary+alt+↑/↓` / `primary+↑/↓` 依然生效：终端在自己的 textarea 处理器里对经手的按键 `preventDefault()+stopPropagation()`，事件到不了 window 上的固定通道，所以这些桥各自在 window **捕获阶段**另挂一个 `keydown` 监听，在事件进入终端前判定并吞掉这一按（见 [第 3 册](03-fixed-input-and-pane-keys.md) 第 4 节）。同一机制还补上了内置「新建会话」`session.new` 的 `primary+alt+N` = `⌘⌥N`（macOS）/ `Ctrl+Alt+N`（Windows/Linux）：它不是本插件的固定键，所以桥只跟随**生效目录**里那一行当前的绑定，动作调同一个 `uiWorkspace.startSession()`（`src/session-new.ts`）。

---

## 2. 预备知识

本节解释后文反复出现的概念。若已熟悉，可直接跳到 [第 3 节](02-ownership-resolution.md)。

### 2.1 DOM 元素（Element）与文档树

网页在浏览器里被解析成一棵文档树，树上每个节点是一个 **DOM 元素（Element）**，例如 `<body>`、`<div>`、`<textarea>`、`<input>`；元素之间是父子关系（`<textarea>` 在某个 `<div>` 里，那个 `<div>` 又在 `<body>` 里）。本插件最关心的几种：

- `<body>`：整个页面的根容器，所有可见内容都在它里面。
- `<textarea>`：输入框，composer（对话输入区）用的就是它。
- 带特定属性的元素，例如 `data-dockkit-pane="xxx"`（右侧栏的 dock 面板）、`data-conversation-session="xxx"`（属于某个会话）。这些 `data-*` 属性是官方代码给元素做的标记，本身没有显示效果，只给脚本读取。

### 2.2 本 GUI 里的两个关键区域：composer 与 dock pane

**composer（输入区 / 输入框）**：主界面底部「输入消息」的区域，本质是可输入的文本域 `<textarea>`，外面套一层座位容器（官方称 composer seat），DOM 上带 `data-composer-seat` 与 `data-conversation-region="composer"` 两个标记。打字用的输入框与旁边「停止生成」的按钮都属于 composer。「焦点在 composer / 输入框」指焦点落在这一块（通常是那个 `<textarea>`）。

**dock pane（右侧栏的 dock 面板）**：右侧栏（Right Sidebar）的布局用一套叫 **dock（dockkit）** 的面板网格系统：

- **pane（面板）**是右侧栏里的一块独立矩形区域，DOM 上带 `data-dockkit-pane`（停靠在 dock 里的面板）或 `data-dockkit-float`（浮动面板）标记；
- 每个 pane 里可以放一个或多个 **tab（标签页）**（工具页、网页等），tab 带 `data-dockkit-tab` 标记；
- 多个 pane 可以并排——「分屏（split）」的产物就是多出一个并排的 pane；某个 pane 也可以**全屏（fullscreen）**占满整个右侧栏。

「焦点在 dock pane 内」指当前焦点元素位于某个 `[data-dockkit-pane]` / `[data-dockkit-float]` 容器里；「活动 dock pane」指 dock 布局当前标记为活动的那一个（布局上的 `activeDockPaneId`）。

这两个区域互不相干：composer 在主对话区底部，dock pane 在右侧栏。快捷键判断「你想操作谁」，靠的就是这次按键的焦点落在哪个区域。

### 2.3 焦点（focus）与 `document.activeElement`

同一时刻最多只有一个元素持有焦点，持有焦点的元素才收到键盘输入。

- 点击一个输入框，焦点落到那个输入框上，`document.activeElement` 就是它。
- 输入框、按钮、带 `tabindex` 的元素等天然可聚焦；普通的 `<div>`、`<body>` 默认不可聚焦。
- 没有任何元素真正持有焦点时（刚打开页面，或点了一下消息列表的空白 `<div>`），浏览器把焦点放在 `<body>` 上，`document.activeElement` 就是 `<body>`。

「焦点在 `<body>`」与「焦点在输入框」是两种状态，前者代表**没有聚焦任何东西**。

### 2.4 `keydown` 的目标元素：`event.target` / `document.activeElement` / `composedPath()`

按下键盘时浏览器产生 `keydown` 事件，并派发给当前持有焦点的元素：焦点在 composer 输入框时 `event.target` 是那个 `<textarea>`，焦点在某个可聚焦面板时是面板元素，没有聚焦任何东西时是 `<body>`。

三者说的基本是同一件事：

- `document.activeElement`：**当前**持有焦点的元素，是随时可读的状态。
- `event.target`：**这一次事件**实际落在的元素，对 keydown 通常就是焦点元素。
- `event.composedPath()`：从事件落点一路排到 `window` 的数组（`[最内层元素, 父元素, ..., <body>, <html>, document, window]`）；取其中第一个 Element 就得到最内层元素，且能穿透 shadow DOM 边界。

官方键盘处理里的取法是：

```js
const target = event.composedPath().find((value) => value instanceof Element)
const element = target instanceof Element ? target : document.activeElement
```

即先取事件路径里第一个元素，取不到再退读 `document.activeElement`。

### 2.5 `element.closest(选择器)`：从自己往上找祖先

`closest()` 从当前元素起沿父链向上，返回第一个匹配给定 CSS 选择器的祖先元素（含自己），找不到返回 `null`。

假设 DOM 结构是：

```html
<body>
  <div class="chat" data-conversation-session="s1">
    <div data-conversation-region="chat">
      <p>你好</p>
    </div>
  </div>
</body>
```

对一个落在 `<p>` 上的事件目标 `el` 调用：

- `el.closest("p")` → 那个 `<p>`；
- `el.closest("[data-conversation-region]")` → 那个 `<div data-conversation-region="chat">`；
- `el.closest("[data-conversation-session]")` → 那个 `<div data-conversation-session="s1">`；
- `el.closest("[data-dockkit-pane]")` → `null`（这条父链上没有该属性）。

官方命令就是靠 `closest()` 判断这次按键落在哪个容器里。target 为 `<body>` 时，`body.closest(任何标记)` 必然返回 `null`，因为 `<body>` 在最外层，上面没有这些标记。

### 2.6 `preventDefault()` 与「消费（consume）」

`event.preventDefault()` 告诉浏览器「这个事件已经被处理，请忽略它的默认行为」（例如阻止输入框里敲 Tab 移焦点、阻止 `Esc` 关弹窗）。

本项目的代码里，「消费一个按键（`consume`）」就是指调用 `preventDefault()`；消费后 `event.defaultPrevented` 变为 `true`，后续处理者据此知道这一按已经有人处理。**谁消费了，谁就是这一按的 owner**，这是这套快捷键体系判断归属的核心机制。
