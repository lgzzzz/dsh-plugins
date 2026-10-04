# 固定输入通道与面板键桥接

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 3 册：固定输入通道、归属判定来源与让位条件，以及面板键（全屏 / 分屏）的桥接实现。

---

## 4. 机制总览

插件不往 shortcut catalog 里注册可配置命令，因此没有默认键位、没有键位冲突、不需要改设置。例外是聚焦输入框、页面循环与会话循环三把固定键：官方目录里不存在这三条命令，插件各为它们挂一条**只读预约、不可改绑**的固定键。固定键与可配置命令是两套目录。

插件挂在固定输入通道上先于内置命令观察每一次按键，确定该自己接管时调用 `consume()`；归属判定只读不依赖焦点的来源。各按键组的判定来源与执行的操作：

| 按键组 | 归属判定来源 | 执行 |
|---|---|---|
| 面板键（全屏 / 分屏） | `sidebarRight.commandTarget()` 的"活动 dock pane"回退 | `toggleFullscreen(target)` / `split(target.paneId)` |
| 停止（`Esc Esc`） | `sessions.list` 里"主视图正在持有的会话" | 该会话上的 `conversation.cancel()` |
| 审批键 | 同一条"主视图持有的会话"当前发布的 `pendingInteraction`（`{ kind: 'approval', answerable, answer() }`） | `answer()`（面板按钮用的同一个方法） |
| 提问卡片 | 同一条 `pendingInteraction`，收窄到提问域：`kind` 为 `question` / `plan-review`、`key` 是字符串、带 `dismiss()` | `dismiss()`（卡片关闭 / 取消按钮用的同一个方法，**从不**调 `answer()`） |
| 聚焦输入框 | 同一条"主视图持有的会话"的 scope，经 `conversation.input.for(scope)` 取到 composer 输入面 | 该输入面的 `focus()`（光标位置一并还原） |
| 页面切换 | `sidebar.mounted`（右侧栏正在画的会话）的页面列表 `tabsIn` 与当前页 `active()` | `focus(tabId)` 切页（与点击芯片同一操作，记入布局历史）；切页后在**下一帧**执行 `focusShownPage` 把键盘交给新显示的页面，页面自聚焦（如终端）则不抢 |
| 会话切换 | 左侧栏此刻渲染出来的会话行：`[data-row-key="workspace:…"]` / `session:…` 两类行里取前三个工作区的会话行；当前会话由 `sessions.list` 的 `retainedBy.mainView` 给出，活跃与否读 `uiSession.sessionStatus` | `uiWorkspace.openSession(id)`（与点击侧栏那一行同一操作）；候选里活跃（运行中 / 待答）的会话优先 |

审批桥与提问桥读的是同一个槽位、靠 `kind` 分工，所以两者不会认领同一按。

页面切换与会话切换另有 window **捕获阶段**的 keydown 监听（早于一切冒泡 / 目标处理器）。固定输入通道挂在 window 的冒泡监听上，而终端在自己的 textarea 处理器里对每个经手的键 `preventDefault()+stopPropagation()`，焦点在终端里时按键根本到不了通道。捕获监听只对会落进 `.xterm` 的按键拦下（命中判定后 `preventDefault()+stopPropagation`，顺带不让终端把 `\x1b[1;7D`/`\x1b[1;7C`、`\x1b[1;7A`/`\x1b[1;7B` 这类转义序列塞给 shell），其余按键放行给通道；两路共用同一个判定。

下面逐条展开：面板键见 [第 5 节](03-fixed-input-and-pane-keys.md)，停止序列见 [第 4 册](04-stop-sequence-bridge.md)，审批键与提问卡片见 [第 5 册](05-approval-key-bridge.md)，聚焦输入框、页面循环与会话循环的逐行说明见 [第 6 册](06-boundaries-and-contracts.md)。

---

## 5. 实现细节（逐条展开）

### 5.1 固定输入通道：`observeFixedInput` 与"消费即让位"

`shortcuts.observeFixedInput(listener)` 把 `listener` 加进一个 `fixedListeners` 集合，返回一个取消订阅函数。每次 keydown，`installKeyboard` 都会在跑 `dispatch`（可配置命令）**之前**把这些 listener 全部调一遍，顺序是 `fixed?.()`（固定通道）→ `dispatch()`（可配置命令）。

`dispatch` 一开头就有：

```js
if (gesture.defaultPrevented || gesture.composing) return { status: "pass" }
```

只要固定通道里有人 `consume()`（即调用了 `preventDefault()`），等轮到 `dispatch` 时它读到 `event.defaultPrevented === true` 就立刻 `pass`，内置命令这一按不执行。

`fixedInput` 的包装长这样：

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

- `consumed` 是一个**本轮共享的标志**；
- 每个 listener 收到的 `consume` 是同一个包装：调用它做两件事——把 `consumed` 置 `true`，并调用最底层的 `input.consume()`（也就是 `event.preventDefault()`）；
- 每个 listener 读到的 `gesture.defaultPrevented` 是"原始值 **或** 之前是否已被消费"（`|| consumed`）。

多个固定 listener 是"多播"关系，但消费是共享的：谁先消费，后面的 listener 一看 `defaultPrevented` 为 `true` 就知道已被处理过，可以选择让位。插件的停止桥与内置 `response.stop`（它也在 `fixedListeners` 里）靠这一机制互斥。

### 5.2 读生效绑定：`enabledBinding`

面板键的键位是**可改的**，插件不硬编码 `⌘⌥Enter` / `⌘\`，而是读用户当前实际生效的绑定：`shortcuts.catalog.getSnapshot()` 的快捷键目录快照，每条记录形如 `{ id, binding, issue, conflicts, ... }`。

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

命令不存在、解绑、被保留或处于冲突时，插件都不接管；这些情况下内置 `dispatch` 也不会把它放进 `bindings` 表。插件跟随用户设置：改绑后跟随新键，解绑后放手。与内置 `refreshLabels` 的差异：插件在"启用"判定里不查 `config.status !== "loading"`，即首屏目录尚未读完时也会接管。

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

逐行说明：

- **①** `gesture.composing`（正在用输入法组字）或 `gesture.defaultPrevented`（这一按已被别的监听器消费）→ 返回。
- **②** `context.modal !== null`（有模态弹窗）→ 返回。面板命令的 `modals` 是空数组，弹窗下的按键由内置 `dispatch` 消费并 `blocked`。
- **③** `paneActionFor` 经 `enabledBinding` 判定这一按是否**恰好**命中 `pane.fullscreen.toggle` 或 `pane.split` 当前生效的键位；不是则返回。
- **④** `sidebar.focusedTarget(element) !== undefined`（焦点已在面板内）→ 返回且不消费，这一按由内置命令执行。插件再动一次会全屏两次、来回抵消。
- **⑤** `!sidebar.isExpanded()`（面板折叠）→ 返回。折叠时没有可全屏 / 分屏的面板，需先用 `sidebar.right.toggle` 展开；展开动作聚焦 pane 容器，终端页再靠页面补位把键盘交到 xterm 输入面（见 `page-cycle.ts`）。
- **⑥** `sidebar.commandTarget(element)` 免聚焦解析目标：
  1. 先 `focusedTarget(element)`——④ 已确认它是 `undefined`；
  2. `element.closest("[data-sidebar-right-session]")` 命中（target 在侧栏容器内、但不在 pane 内）→ **返回 `undefined`，不回退**（官方注释：`stale sidebar markup never falls back to another pane`）；
  3. 否则返回"当前屏会话的活动 dock pane"：`activeDockPaneId` 对应的那个 pane，及其活动 tab 的 occurrence 与导航版本。
  第 3 步的"活动 dock pane 回退"就是 `sidebar.right.toggle`（展开键）"在哪儿按都能生效"用的同一机制。
- **⑦** `input.consume()`：先消费再动作。不消费的话，内置 `dispatch` 会 `noFocus` 并自己 `consume()`，这一按被两家同时处理（破坏"每按一个 owner"）。
- **⑧** `gesture.repeat`（长按自动重复）→ 消费但不执行；与内置 `dispatch` 的语义一致：`consume()` 后 `if (!gesture.repeat) run()`。
- **⑨** `isTargetCurrent(target)` 校验"当前屏会话、pane、tab、导航版本"是否仍与捕获时一致，不一致就放弃。`toggleFullscreen` / `split` 内部还会各自再校验一次。
- **⑩** 全屏 → `toggleFullscreen(target)`；分屏 → `split(target.paneId)`。两个方法内部各自做预算 / 宽度 / 可见性校验，不满足就静默不做。
