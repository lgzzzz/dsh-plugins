# 固定输入通道与面板键桥接

> 本文件是 [dsh-focus-free-shortcuts 说明](../dsh-focus-free-shortcuts.md) 的第 3 册：固定输入通道、归属判定来源与让位条件，以及面板键（全屏 / 分屏）的桥接实现。

-----

## 4. 机制总览

插件不往 shortcut catalog 里注册可配置命令，因此没有默认键位、没有键位冲突、不需要改设置。例外是插件自己挂的五条固定键：其中四条（聚焦输入框、页面循环与会话导航）在官方目录里不存在对应命令，插件各为它们挂一条**只读预约、不可改绑**的固定键（会话导航占两条——全部候选一条、只走活跃会话一条）；第五条 `dsh-focus-free-shortcuts.focus-page`（`⌘⌥K` / `Ctrl+Alt+K`）**有意占用** Web 上内置 `session.search` 的默认键位，因此在 Web 上会制造一处冲突（见 [第 5.6 节](03-fixed-input-and-pane-keys.md)）。固定键与可配置命令是两套目录。

插件挂在固定输入通道上先于内置命令观察每一次按键，确定该自己接管时调用 `consume()`；归属判定只读不依赖焦点的来源。各按键组的判定来源与执行的操作：

| 按键组 | 归属判定来源 | 执行 |
|---|---|---|
| 面板键（全屏 / 分屏） | `sidebarRight.commandTarget()` 的"活动 dock pane"回退 | `toggleFullscreen(target)` / `split(target.paneId)` |
| 页面关闭键（`page.close`） | 同一条"活动 dock pane"回退（`commandTarget()`），再加 `canCloseTarget()` | `closeTarget(target)`（与内置 `page.close` 的 `run()` 同一个动词；只关页面，不含 Desktop 的"关窗口"那一半） |
| 停止（`Esc Esc`） | `sessions.list` 里"主视图正在持有的会话" | 该会话上的 `conversation.cancel()` |
| 审批键 | 同一条"主视图持有的会话"当前发布的 `pendingInteraction`（`{ kind: 'approval', answerable, answer() }`） | `answer()`（面板按钮用的同一个方法） |
| 提问卡片 | 同一条 `pendingInteraction`，收窄到提问域：`kind` 为 `question` / `plan-review`、`key` 是字符串、带 `dismiss()` | `dismiss()`（卡片关闭 / 取消按钮用的同一个方法，**从不**调 `answer()`） |
| 聚焦输入框 | 同一条"主视图持有的会话"的 scope，经 `conversation.input.for(scope)` 取到 composer 输入面 | 该输入面的 `focus()`（光标位置一并还原）；焦点在终端里时由捕获钩子投递同一判定（见第 4 节） |
| 页面切换 | `sidebar.mounted`（右侧栏正在画的会话）的页面列表 `tabsIn` 与当前页 `active()` | `focus(tabId)` 切页（与点击芯片同一操作，记入布局历史）；切页后在**下一帧**执行 `focusShownPage` 把键盘交给新显示的页面，页面自聚焦（如终端）则不抢。页签行另有两处补偿：注入一条作用域限定在右侧栏的样式规则消掉"先回到最左、再迅速滑过去"的动画，并在切页前后保持观察窗口（切页前记下 chip box 的位置，下一帧先还回去、只有目标不在窗口里时才最小推移）（见第 5.4 节） |
| 聚焦右栏页面（`⌘⌥K` / `Ctrl+Alt+K`） | 插件自己的固定行 `dsh-focus-free-shortcuts.focus-page` 占用这一按（`fixedRowOwns`），且右栏展开、`sidebar.mounted` 有会话 | `focusShownPage(sessionId)`：与页面切换键共用同一条交棒判定（页面自持键盘就不抢，否则聚焦可见 pane 并下探页面自己的输入面，终端即 `.xterm-helper-textarea`）；不换页 |
| 会话导航 | 左侧栏此刻渲染出来的会话行：`[data-row-key="workspace:…"]` / `session:…` 两类行里取前三个工作区的会话行；当前会话由 `sessions.list` 的 `retainedBy.mainView` 给出，活跃与否读 `uiSession.sessionStatus` | `uiWorkspace.openSession(id)`（与点击侧栏那一行同一操作）；`⌘↑/↓`（macOS）/ `Ctrl+↑/↓`（Windows/Linux）（`session-cycle`）在全部候选里环状走，`⌘⌥↑/↓`（macOS）/ `Ctrl+Alt+↑/↓`（Windows/Linux）（`session-active-cycle`）只走候选里带状态点的活跃会话（运行中 / 待交互 / 已完成未读） |
| 新建会话（内置 `session.new`） | **生效目录**里 `session.new` 当前那一行（`enabledBinding`，改绑 / 解绑 / 冲突即刻跟随）；不注册固定键 | `uiWorkspace.startSession()`（与内置 `run()` 同一个动词，不带参数 = 沿用当前 / 最近的工作区）；只在终端内投递，页面 / 文本控件里仍归内置命令 |

审批桥与提问桥读的是同一个槽位、靠 `kind` 分工，所以两者不会认领同一按。

聚焦输入框、聚焦右栏页面、页面切换、会话导航与新建会话另有 window **捕获阶段**的 keydown 监听（早于一切冒泡 / 目标处理器）。固定输入通道挂在 window 的冒泡监听上，而终端在自己的 textarea 处理器里对每个经手的键 `preventDefault()+stopPropagation()`，焦点在终端里时按键根本到不了通道。捕获监听只对会落进 `.xterm` 的按键拦下（命中判定后 `preventDefault()+stopPropagation`，顺带不让终端把 `\x1b[1;7D`/`\x1b[1;7C`、`\x1b[1;7A`/`\x1b[1;7B`（Windows/Linux 的 `Ctrl+Alt+方向键`）与 `\x1b[1;5A`/`\x1b[1;5B`（Windows/Linux 的 `Ctrl+方向键`）这类转义序列塞给 shell；`Ctrl+Alt+J` / `Ctrl+Alt+M` / `Ctrl+Alt+N` 在 Windows/Linux 上常被当作 AltGr 输入字符，同样在这里被截下），其余按键放行给通道；两路共用同一个判定。

> 五条自挂固定键的捕获路径只在 `.xterm` 内出手，所以它们与冒泡通道互斥、一次按键最多只被处理一次：命中即 `stopPropagation()`，window 冒泡上的固定通道再也看不到这一按。聚焦输入框那条的冒泡准入（`focusComposerEligible`）仍对 `terminal` 区域让位 —— 终端那一半只由捕获路径负责。`session.new` 没有固定通道那一半（插件不为内置命令注册固定键、也不开观察者），页面 / 文本控件里的这一按仍由内置命令自己处理。

下面逐条展开：面板键见 [第 5.3 节](03-fixed-input-and-pane-keys.md)，页签行的滚动补偿见 [第 5.4 节](03-fixed-input-and-pane-keys.md)，页面关闭键见 [第 5.5 节](03-fixed-input-and-pane-keys.md)，聚焦右栏页面键见 [第 5.6 节](03-fixed-input-and-pane-keys.md)；停止序列见 [第 4 册](04-stop-sequence-bridge.md)，审批键与提问卡片见 [第 5 册](05-approval-key-bridge.md)；聚焦输入框、页面切换、会话导航与新建会话的行为对照与边界见 [第 6 册](06-boundaries-and-contracts.md)。

-----

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

### 5.4 页签行的滚动：`strip-scroll.ts`（瞬时到位 + 跨切换保持观察窗口）

**现象**（换页签与鼠标点芯片同路，两步都在上游，插件只收拾可见的部分）：

1. 页签行先回到最左端，然后迅速滑到新的活动页签；
2. 目标页签一定落在**视野最右缘**：来源页签（上一次的目标，本来也在最右）被挤出视野，"我从哪儿切过来"看不见了。

**机制**：

1. dockkit 的 `TabLayout` 给**每个 tab 一个 host**，而页签行（`TabStrip`）只在**当前选中**那条 tab 的 host 里渲染 —— 所以每次选中变化都是旧 chip box 卸载、新 chip box 挂载，新元素的 `scrollLeft` 天然是 `0`（滚动位置不跨重挂载保留，也没有任何地方保存它）；
2. kit 自己的 `useActiveChipInView` 在挂载 commit 的 layout 阶段做一次"**从 0 出发**的最小可见"修正：`scrollLeft = 0` 时左分支不可能成立，于是它总是把目标芯片的右缘推倒盒内 24px 处（`STRIP_FADE`）—— 现象 2 就是这一步的必然结果；
3. 而 `.stripTabs` 声明了 `scroll-behavior: smooth`，于是第 2 步从"首帧前的一次瞬时写入"变成"从 0 开始的一段动画" —— 现象 1。

**补偿**：插件做两件事（`src/strip-scroll.ts`），都落在首帧绘制之前，中间态永远不会被画出来。

**其一，注入一条规则把缓动关掉**（`STRIP_SCROLL_CSS`）：

```css
/* dsh-focus-free-shortcuts:右栏页签行的滚动瞬时到位(不缓动)。 */
[data-sidebar-right-session] [data-dockkit-strip-tabs] { scroll-behavior: auto; }
```

- 只作用于**右侧栏**（`[data-sidebar-right-session]`）：对话区那套同样由 dockkit 渲染的条带不受影响；
- 用属性选择器而不是 dockkit 的哈希类名；两个属性选择器的特异性（0，2，0）高于类规则（0，1，0），与样式表顺序无关，所以不需要 `!important`；
- 标签按持有者计数共享一个 `<style>`：同一文档里已有同一份规则（dev / HMR 下旧实例留下的标签）就复用它且不由本实例摘除；本实例插入的标签在最后一个持有者卸载时移除。没有 `document`、或 document 承载不了标签（极简 / 假 DOM）时整段是 no-op；
- 代价：kit 在"开 / 关 / 移动页签"时的滑动过渡也一并变成瞬时 —— 纯装饰差异，换来的是滚动位置永远不需要"先回到起点、再修正"。

**其二，切页前后保持观察窗口**（`captureStripScroll` / `restoreStripScroll`，在页面切换桥的 `switchPage` 里接线）：

1. **切页前**（`sidebar.focus()` 之前，那之后当前页就换人了）找到当前活动芯片所在的 chip box，记下 `{ boxId, scrollLeft }`；浮动 pane 没有条带、页面尚未挂载、没有 document 时记不下，切页照常；
2. **切页后**（页面切换桥本来就有的那次 `requestAnimationFrame`，`focusShownPage` 之前）找到新活动芯片的 chip box；`boxId` 相同（还是同一条条带）时先把记下的 `scrollLeft` 放回去；
3. 再做一次**以旧窗口为起点**的最小可见修正：目标芯片不在窗口里时才推移，并留 24px 边缘余量 ——

```ts
box.scrollLeft = position.left
const bounds = box.getBoundingClientRect(), rect = chip.getBoundingClientRect()
if (rect.left < bounds.left) box.scrollLeft += rect.left - bounds.left - 24
else if (rect.right > bounds.right) box.scrollLeft += rect.right - bounds.right + 24
```

以 1..10 十颗、盒里容三颗、旧窗口 `scrollLeft = 400`（看见 t5/t6/t7）为例：

| 切到 | kit 单独（从 0 出发） | 本插件（从旧窗口出发） |
|---|---|---|
| t6（左邻，在旧窗口内） | 324：t6 落到最右缘，来源 t7 只剩 24px | 400：**行完全不动**，来源 t7 仍在视野里 |
| t5（旧窗口最左） | 224 | 400：零位移 |
| t7（原来那颗） | 424 | 400：零位移 |
| t2（旧窗口左侧） | 0 | 76：最小左移，目标贴左缘留 24px（kit 那个 0 是"顺手也对"，但它把整个窗口甩到了最左） |
| t9（旧窗口右侧） | 624 | 624：与 kit 同值 |

两侧规则的差异其实只有两类：目标**已在旧窗口内**时本插件不动（kit 会把它推到最右缘，就是本文开头那个现象 2），目标在旧窗口**左侧**时 kit 从 0 出发没有左分支可用、本插件做最小左移。目标在旧窗口**右侧**时两者恒等 —— 最小推移量都等于"芯片右缘 − 盒宽 + 24"，与起点无关。

页面循环一次只改选中、不改页签集合，所以同一条条带的内容宽度不变，旧位置可以直接复用；跨 `boxId`（跳到另一个 pane，或目标落在浮动 pane 的标题上）、目标芯片尚未渲染、没记下窗口时都不动作，交给 kit 原来的规则 —— 只覆盖插件自己驱动的切换（鼠标点芯片、别处命令切页仍走 kit 原规则）。

第 3 步是本插件**唯一**一处复刻上游几何的地方（"最小可见" + 24px 边缘余量）：上游那条规则以 0 为起点，插件要的语义是"以旧窗口为起点"，只能自己算。若上游改了渐隐带宽度，最坏情形是目标芯片与边缘的间距观感不同，不误动作。

这条补偿与按键归属完全无关：不消费按键、不改变让位条件，鼠标点页签同样受益（只是那一路没有"旧窗口"可记，走 kit 原规则）。

### 5.5 页面关闭键桥接：`handlePageCloseInput` 逐行

`page.close`（"关闭当前页面／窗口"）与面板键是同一族的可配置命令，也走同一条活动 dock pane 回退；差别只在行动词（`closeTarget` 而不是 `toggleFullscreen` / `split`）与两处额外的让位条件（模态与"关不掉"）。

```ts
function handlePageCloseInput(shortcuts, sidebar, input) {
  const gesture = input.gesture
  const context = input.context

  if (gesture.composing || gesture.defaultPrevented) return   // ①
  if (context.modal !== null) return                          // ②

  if (!pageCloseFor(shortcuts.catalog.getSnapshot(), gesture)) return   // ③

  const element = context.target ?? document.activeElement
  if (sidebar.focusedTarget(element) !== undefined) return    // ④
  if (!sidebar.isExpanded()) return                           // ⑤

  const target = sidebar.commandTarget(element)               // ⑥
  if (target === undefined) return

  if (!sidebar.canCloseTarget(target)) return                 // ⑦

  input.consume()                                             // ⑧
  if (gesture.repeat) return                                  // ⑨
  sidebar.closeTarget(target)                                 // ⑩
}
```

逐行说明（①③④⑤⑥⑧⑨ 与 [第 5.3 节](03-fixed-input-and-pane-keys.md) 的面板键逐行同义，不再重复）：

- **②** `context.modal !== null` → 返回。这里与面板键的动机不同：`page.close` 的 `modals` 是 `["settings", "shortcuts", "other"]`，**声明了模态** —— 弹窗打开时内置派发用同一条命令关掉最上面那层弹窗（`closeTopModal(document)`），所以这一按归弹窗，插件必须让位，否则会越过弹窗去关后台页面。
- **③** `pageCloseFor` 经 `enabledBinding` 判定这一按是否**恰好**命中 `page.close` 当前生效的键位。Web 上是官方默认的 `primary+alt+W`（macOS `⌘⌥W` / Windows `Ctrl+Alt+W`；上游没有声明 `web:linux` 的默认值，Web/Linux 上这一行未绑定，本桥随之不接管），Desktop 上是 `primary+W`；用户改绑后跟随新键，解绑 / 被保留 / 冲突时不接管。
- **⑤** `!sidebar.isExpanded()` → 返回。折叠时没有"当前显示的页面"，且内置的 `focusedTarget` 对**停靠**面板同样解析不到（`sidebarTargetFromElement` 对 `host === 'dock' && !layout.expanded` 返回 `undefined`）——两者同向。唯一在折叠时仍被绘制的是浮动面板，而那种情形焦点本来就落在浮动面板内、由 ④ 让位给内置命令。
- **⑦** `canCloseTarget(target)` 是官方"这个目标现在能不能关"的判定（`isTargetCurrent(target) && target.tabId !== undefined`），内置 `resolve()` 也用同一个词。为假（活动面板是空的、或身份已变）时不消费：这一按仍由内置命令收场（Web 上解析为 `blocked / command.noFocus` 并自行消费），插件不抢归属，也不多关。
- **⑩** `closeTarget(target)` 与内置 `run()` 调的是同一个动词：目标页可移除就移除（走它的资源清理处理器），活动面板只剩那块停靠 guide 时收成侧栏（`setExpanded(false)`）。插件**不调** `closeWindow()` —— 那是 Desktop 分支的语义；本桥只在 Web 安装，所以 Web 上永远只关页面、不关窗口。这一动词也不搬键盘：官方 host 的 `closeWithPaneFocus` 只在"关之前焦点就在这个 pane 里"时才把焦点交给存活的面板（`retain`），焦点在 composer / 别处时它提交完变更就返回 —— 免聚焦关页之后键盘仍在原处，不会因为关掉一页而被吸进右侧栏。

**为什么只装 Web**：`page.close` 在 Desktop 上是 `primary+W`，未聚焦面板时内置 `resolve()` 直接走 `closeWindow()`，**本来就免聚焦**（见 [第 1 册](01-behavior-difference.md) 第 1 节）。而 Desktop 的可配置键位由 Electron 原生键盘桥派发，DOM 侧 `consume()` 压不住那一次派发，两边都动作会关两次。所以本桥与面板键桥同一条边界：只在 `shortcuts.runtime === 'web'` 时安装，Desktop 记一行 warn 后退出。

### 5.6 聚焦右栏页面键桥接：`handleFocusPageInput` 逐行

`⌘⌥K`（macOS）/ `Ctrl+Alt+K`（Windows/Linux）是插件自己挂的固定行（`dsh-focus-free-shortcuts.focus-page`，group `application`），动作只有一个：把键盘交给右栏**此刻显示**的那一页 —— 通常是终端，于是不必先点一下 `.xterm` 才能打字。它与页面切换键（`page-cycle.ts` 的 `⌘⌥←/→`）共用同一条交棒判定：`page-cycle.ts` 导出的 `focusShownPage(sessionId)`（定位该会话的右栏根节点 → 选出可见 pane → 页面自持键盘就不抢，否则聚焦 pane 并下探到页面自己的输入面，例如终端的 `.xterm-helper-textarea`）。差别只在"换不换页"：页面循环键先切页再交棒，本键不切页。

```ts
function handleFocusPageInput(shortcuts, sidebar, input) {
  const target = focusPageTarget(shortcuts, sidebar, input.gesture, input.context)
  if (target === undefined) return     // ①
  input.consume()                      // ②
  focusPage(target.sessionId)          // ③
}

function focusPageTarget(shortcuts, sidebar, gesture, context) {
  if (!focusPageEligible(gesture, context)) return undefined       // ④
  if (!fixedRowOwns(shortcuts.fixedCatalog.getSnapshot(), FOCUS_PAGE_ID, gesture)) return undefined  // ⑤
  if (!sidebar.isExpanded()) return undefined                     // ⑥
  const sessionId = sidebar.mounted.getSnapshot()
  if (sessionId === undefined) return undefined                   // ⑦
  return { sessionId }
}
```

- **①** 判定不通过时**不消费**：这一按留给别的 owner（折叠态下它落在内置 `session.search` 的冲突条目上，由快捷键服务吞掉、不弹错）。
- **②** 先消费再动作 —— 与其余固定行桥同一条纪律：这一按归本桥，不再进输入控件，也不触发同一个键位上那条冲突的内置命令。
- **③** `focusPage()` 就是 `focusShownPage()`：交棒是**幂等**的。键盘本来就在那一页里（终端自聚焦）时不重复聚焦，但仍然消费 —— 否则这一按会被 xterm 当成终端输入送进 shell。要补位的情形是"pane 容器自己持有焦点、而页面有输入面"（例如展开右栏之后键盘停在 pane 上），这一步会继续下探到 `.xterm-helper-textarea`；`readOnly` 的终端视为页面自己拒绝键盘，不再下探。
- **④** 准入与页面循环键**完全一致**：页面 / 文本控件 / 终端都放行，已被消费（`defaultPrevented`）的照常处理，只排除组字中、自动重复与模态层。捕获路径与固定通道共用这一个函数。
- **⑤** `fixedRowOwns` 只认本插件自己挂的那一条行：行不存在（插件整体没装 / 已卸载）就不动作。固定行的存在本身就是占用，被重绑 / 摘除以行本身为准。
- **⑥** 右栏折叠 → 不动作、不消费：折叠态没有"当前显示的页"，这与面板键、页面关闭键、页面切换键同一条边界（折叠时仍被绘制的只有浮动面板，本键不把它当作"右栏显示的页"）。
- **⑦** 屏幕上没有会话（全局面板占着主列，或会话正在切换）→ 不动作。

终端那一半与另外两条桥同形：落在 `.xterm` 内的 keydown 到不了 window 上的 fixed-input 监听（终端在自己的 textarea 处理器里 `stopPropagation()`），所以本桥另装 window **捕获阶段**的 keydown，在事件进入终端前判定。命中即 `preventDefault() + stopPropagation()`：交棒此时是无操作（键盘本来就在终端里），但这一按不再被 xterm 翻译成终端输入送进 shell。未命中就放行，事件原样交给 xterm。

**这条键位是有意"挤掉"内置会话搜索的**：Web 上 `session.search` 的默认键位就是 `primary+alt+K`（Desktop 上是 `primary+K`），固定行一挂上，那一行在快捷键目录里就变成冲突（`effectiveShortcuts` 把固定行算进 `conflicts`），按键不再打开搜索、设置里会给搜索项亮红，需要用户自行给搜索改绑。之所以仍然选它：固定行是唯一够得着终端那一格的通道（机制见 [第 4 节](03-fixed-input-and-pane-keys.md)），而"聚焦右栏页面"的主要用场正是终端。
