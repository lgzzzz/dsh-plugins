# 解决思路总览与面板键桥接

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 3 册：整体方案，以及面板键（全屏 / 分屏）的桥接实现。

---

## 4. 解决思路总览

既然根因是"归属判定读焦点"，那就**换一个不依赖焦点的归属判定来源**，同时**只在确定自己该接管时才出手**，避免和内置命令打架。

本插件做的四件事：

1. **不注册任何可配置命令**：不往 shortcut catalog 里加可配置命令，因此没有默认键位、没有冲突、不需要改设置。（例外：聚焦输入框与页面循环这两把键官方不存在，插件各为它们挂一条**固定键**——只读预约、不可改绑，见下面第 4 点。固定键与可配置命令是两套目录，不产生"改设置"负担。）
2. **挂在固定输入通道上，先于内置命令观察每一次按键**，并能在合适的时候 `consume()`（= 接管这一按）。
3. **用不读焦点的来源做归属判定**：
   - 面板键 → 用 `sidebarRight.commandTarget()` 的"活动 dock pane"回退（这正是 `sidebar.right.toggle` 那个"在哪儿按都能展开侧栏"的键用的同一机制）；
   - 停止 → 用 `sessions.list` 里"主视图正在持有的会话"来定位要停的会话，再调该会话上的 `conversation.cancel()`；
   - 审批键 → 用同一条"主视图持有的会话"取出它当前发布的 `pendingInteraction`（`{ kind: 'approval', answerable, answer() }`），再调面板按钮用的同一个 `answer()`；
   - 聚焦输入框 → 用同一条"主视图持有的会话"找到它的 scope，再经 `conversation.input.for(scope)` 取到 composer 的输入面，调它的 `focus()`（与应用自己在遮罩结束后把键盘还给输入框用的是同一个操作，光标位置也会还原）；
   - 页面切换 → 用 `sidebar.mounted`（右侧栏正在画的会话）取页面列表（`tabsIn`）与当前页（`active()`），`focus(tabId)` 切页（与点击芯片同一操作、记入布局历史）；store commit 通常异步渲染，所以切页后**在下一帧**把键盘交给新显示的页面（`focusShownPage`，页面自聚焦如终端时则不抢）。

   页面切换比其它四组多一条**捕获阶段拦截**：固定输入通道挂在 window 的冒泡监听上，而终端在它自己的 textarea 处理器里对每个经手的键 `preventDefault()+stopPropagation()`——焦点在终端里时，按键根本到不了通道。所以这组桥还在 window **捕获阶段**挂了一个 keydown 监听（早于一切冒泡/目标处理器），只对会落进 `.xterm` 的按键拦下（命中判定后 `preventDefault()+stopPropagation`，顺带不让终端把 `\x1b[1;7D`/`\x1b[1;7C` 塞给 shell），其余按键放行给通道；两路共用同一个判定。这就是"焦点在终端里依然能切页"的实现方式。

下面从 [第 5 节](03-solution-overview-and-pane-keys.md) 起把这些机制一条一条展开（面板键 → [第 4 册](04-stop-sequence-bridge.md) 停止序列 → [第 5 册](05-approval-key-bridge.md) 审批键），聚焦输入框与页面循环这两把新键的逐行说明放在 [第 6 册](06-comparison-boundaries-contracts.md) 的对照与边界里。

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
- **⑤ 面板折叠 → 无面板可全屏/分屏。** 折叠时右侧栏根本没有展开的面板，任何目标都无从谈起。此时正确的做法是先用 `sidebar.right.toggle`（展开键）展开——展开动作会聚焦活动 pane（更精确地说：聚焦的是 **pane 容器**，终端页需要再靠第 5 组里的"展开补位"把键盘交到 xterm 输入面，见下文 `page-cycle.ts`），之后内置命令就能用了。
- **⑥ 免聚焦解析目标。** 走到这里，说明焦点不在面板内，内置命令会 `noFocus` 放弃，插件接手。`sidebar.commandTarget(element)` 是官方公开方法，逻辑是：
  1. 先 `focusedTarget(element)`——但前面 ④ 已经确认它是 `undefined`；
  2. 若 `element.closest("[data-sidebar-right-session]")` 命中（target 在侧栏容器内，但不在 pane 内）→ **刻意返回 `undefined`，不回退**（官方注释："stale sidebar markup never falls back to another pane"，防止对陈旧的侧栏标记误回退到另一个面板）；
  3. 否则 → 返回"**当前屏会话的活动 dock pane**"（`activeDockPaneId` 对应的那个 pane，及其活动 tab 的 occurrence 与导航版本）。

  第 3 步的"活动 dock pane 回退"就是 `sidebar.right.toggle`（展开键）能"在任何地方按都生效"的同一机制。
- **⑦ 先消费，再动作。** 因为这一按若不消费，等轮到内置 `dispatch` 时它会 `noFocus` 并自己 `consume()`——插件必须抢先把这一按标记为"我处理了"，否则这一按会被两家同时处理（语义上"每按一个 owner"被破坏）。
- **⑧ 重复键（长按自动重复）→ 消费但不执行。** 与内置 `dispatch` 的语义一致：`consume()` 后 `if (!gesture.repeat) run()`。即：按住不放产生的一连串 repeat 事件，只消费不重复触发动作。
- **⑨ 目标过期兜底。** 从"读到 target"到"真正执行"之间可能有别的渲染发生（会话切换、tab 变化等）。`isTargetCurrent` 校验"当前屏会话、pane、tab、导航版本"是否仍与捕获时一致，不一致就放弃。虽然 `toggleFullscreen` / `split` 内部也会再校验一次，但插件在这里先兜一道，和面板控件的行为保持一致。
- **⑩ 执行。** 全屏 → `toggleFullscreen(target)`；分屏 → `split(target.paneId)`。这两个方法内部还会各自做预算/宽度/可见性校验，不满足就静默不做（与内置命令同一条路径）。
