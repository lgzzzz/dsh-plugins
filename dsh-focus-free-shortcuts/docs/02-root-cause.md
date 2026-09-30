# 根因：归属判定读焦点

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 2 册：键盘事件怎么走、命令怎么判断「你想操作谁」，以及为什么必须先点一下。

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
- 桌面端（Desktop）macOS/Windows 上，可配置键位不走这段 DOM 监听，而是由 Electron 的原生键盘桥派发，所以那段代码会在 `if (native) return` 提前返回（后面 [第 5 节](03-solution-overview-and-pane-keys.md) 会再解释这对插件意味着什么）。

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
