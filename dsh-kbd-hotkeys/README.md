# dsh-kbd-hotkeys

DSH Web 降低鼠标依赖的全局快捷键插件（client-only）。

单一 `document` 捕获阶段 `keydown` 监听，按 **三态分发**（状态名即代码中的 `StateName`）：

- **`card`（卡片态）** — 当前会话有审批 / ask_user_question / 计划评审卡片待处理：
  按键服务于卡片；
- **`editing`（输入态）** — 焦点在可编辑元素（输入框 / textarea / contenteditable）：
  只保留带修饰键的全局组合，不干扰文本编辑；
- **`browse`（浏览态）** — 其余（浏览对话）：全部导航键生效。

## 键位表（默认，macOS 为 ⌘；Win/Linux 的 ⌘ = Ctrl）

| 按键 | 功能 | 态 |
| --- | --- | --- |
| `Enter` | 审批卡片：允许一次；问答卡片：下一题（非末题且当前题已作答）/ 末题提交（全部题目完成后）；计划评审：确认执行 | `card` |
| `Esc` | 审批卡片：拒绝；其余情况：停止当前会话的整棵运行中交互树（自身 + 运行中的直系子代理后代；one-shot 子代理跳过） | 任意 |
| `1`–`9` | 问答卡片：选择第 N 个选项（**只改选中态，不翻题**；计划评审：确认/拒绝/去聊） | `card` |
| `←` / `→` | 问答卡片：上一题 / 下一题（只切题号，草稿保留；首题按 `←`、末题按 `→` 不循环且不吞键） | `card` |
| `⌘/Ctrl+/` | 快捷键速查表 | 任意 |
| `⌘/Ctrl+B` | 开关**左**侧栏（主键；走 `layout.toggleSidebar`） | `browse` / `editing` |
| `⌘/Ctrl+Alt+B` | 开关**右**侧栏（派生键；走 `sidebarRight.toggleExpanded`，与右栏头部折叠按钮同一入口） | `browse` / `editing` |
| `⌘/Ctrl+I` | 聚焦对话**输入框**（走 `conversation.input` 取 composer 的 editor 宿主元素后 `focus()`） | `browse` |
| `⌘/Ctrl+Alt+↑` / `↓` | 上一个 / 下一个**活跃会话** | 任意 |

> 「任意」= 三态均允许（动作 `states` 为 `['card','editing','browse']`）。
> 两个侧栏开关均为 `['browse','editing']`：输入框聚焦时同样生效（带修饰键的组合不
> 干扰文本编辑，符合 `editing` 态「只保留带修饰键的全局组合」的规则）。
> **聚焦输入框只放行 `browse`**：焦点已经在输入框里时该动作没有意义（`editing`），
> 且 contenteditable 里的 `⌘/Ctrl+I` 是浏览器「斜体」默认行为（`execCommand`，
> 绕过 Lexical 直接改 DOM），放行会与编辑器状态打架；卡片态同理（卡片自己的输入框
> 归卡片管）。`mod` 在 `comboOf` 里同时吸收 `ctrlKey` 与 `metaKey`，所以 macOS 上
> **⌃I 与 ⌘I 都能触发**（用户按 Ctrl+I 的习惯在 mac 上按 ⌃I 即可），Win/Linux 就是
> Ctrl+I；两平台浏览器 DevTools 都带 `Shift`（⌘⌥I / Ctrl+Shift+I），不冲突。
>
> **为什么左栏拿 `⌘/Ctrl+B`、右栏拿 `⌘/Ctrl+Alt+B`**（主键给主面板）：
> ① `⌘/Ctrl+B` 开关侧栏是跨应用肌肉记忆（VS Code / Slack / 各类编辑器一致），也是本
> 插件最初就有的默认——把「已经被训练过的反射」留给最基础的左栏（导航主面板），
> 右栏只需要多记一个 `Alt`；
> ② 命名同源：上游不带限定词的 `sidebar` / `sidebarCol` 就指左栏
> （`layout.toggleSidebar()`），右栏是派生的 `rightbar`（`rightbarShown` /
> `rightbarTrack`）——主键给「本名」，叠加修饰键给「限定名」；
> ③ 越常用越省力：`⌘/Ctrl+B` 比 `⌘/Ctrl+Alt+B` 更短、更好按，自然该给使用频率更高、
> 更基础的左栏；`Alt` 这一档留给上下文面板（右栏）。
> 若实际用下来右栏更常用，互换只需改 `src/config.ts` 的两行 `DEFAULT_BINDINGS`，或用
> `localStorage` 覆盖单个动作的键位（见「自定义键位」）。
>
> 审批与问答的 `Enter` / `Esc` / 数字键 / 方向键是**固定分发的单键**，不参与
> `bindings` 自定义（见「自定义键位」）。
> 审批卡片的 `Enter` / `Esc` 只要当前会话有审批卡片就生效，**不受焦点位置影响**
> （审批卡片自身没有输入框）；问答卡片的单键在焦点位于输入框时交回输入框。
> 没有审批卡片时 `Esc` 保持原行为：停止当前会话树且不吞键。

活跃会话的定义：**正在运行（`running`）∪ 有待处理交互（`uiSession.pendingInteractions` 命中，即审批/问答/计划评审卡）∪ 刚完成未查看（`completed`，侧栏绿色「完成」提醒）**。
跳转沿**左侧侧栏里看到的顺序**（工作区分组 + 组内会话顺序）逐格扫描，落点是方向上
**最近的活跃会话**（当前会话本身不活跃时同样可用，落点即方向上最近的活跃会话）。
每次按键都重新取一次会话快照与侧栏顺序，不缓存；侧栏顺序读不到时**不跳转**
（无降级，不猜顺序）。

`Esc` 是双职责键：当前会话有待审批卡片时 = 拒绝（吞键）；否则只停止运行中的
会话树，**不吞键**，页面默认 `Esc` 行为（关弹层 / 退出编辑态）照常执行；
速查表浮层打开时由浮层优先关闭。

## 实现要点（源码核实结论）

**服务级（不触碰 DOM）**

- 审批：`uiSession.pendingInteractions.getSnapshot()`（公开观察面；同源的私有字段
  `pendingSnapshot` 仅作兼容回退）取当前会话的 `kind==='approval'` 载体，
  **`Enter` = 允许一次、`Esc` = 拒绝**，调 `answer('allowed-once' | 'rejected')`；
  单键固定分发（不走 `bindings`）。`card` 态判定与动作
  同源：只有当前会话命中审批载体时才吞键，无审批载体时 `Enter` / `Esc` 放行
  （`Esc` 继续走 `session.stop`）。
- 问答 / 计划评审：同一待处理表取 `PendingQuestion`（`kind==='question' | 'plan-review'`）：
  - **计划评审**：`1` = 确认执行、`2` = 拒绝、`3` = 去聊天里说、`Enter` = 确认执行。
    标签取自请求数据——`questions[0].intent.approve` 是确认标签、其余选项是拒绝标签，
    `cancel()` 对应「去聊天里说」。只认请求数据，与卡片底部按钮顺序无关。
  - **通用问答**：直接读写**卡片自己的 Session 级 slot store**
    （`dsh-client-ui-user-questions` 的 `createQuestionDraftStore`，挂在
    `conversation.composer` 链式 slot 的注册项上）——数字键 = 上游
    `QuestionFlow.choose()` 的**选中**语义（单选覆盖选中并清空自定义文本；多选切换
    该项），**但不再顺手翻题**（这是与上游的唯一差异：上游 `choose()` 单选会
    `index+1`，本插件把「选完自动跳」去掉，翻题改由 `←` / `→` 或 `Enter` 触发）；
    `←` / `→` = 上游卡片底部 pager 的 `nav.prev` / `nav.next` 语义
    （`replaceProgress(index ± 1, drafts)`：**只改题号、草稿原样保留**；上游在
    `index===0` / `index===末题` 时把按钮置为 `disabled`，故热键同样**不循环**，
    越界即 no-op 且不吞键）；`Enter` = 保留上游 `continueFlow()` 的**推进**语义
    （当前题未作答 → 不吞键；已作答且非末题 → 翻到下一题），末题则**仅在全部题目
    完成（已作答或显式跳过）后**按 store 里的草稿
    `answer({ answers: [{ id, selected, custom? }] })` 成批结算并 `clear()` 本次草稿；
    末题仍有未完成题时 no-op（不结算、不吞键，且**不跳回**未完成题——回跳请用 `←`）。
    因此**卡片会实时高亮 / 翻题，鼠标点选与键盘操作共用同一份状态**。
    取数路径见 `src/question-drafts.ts`：
    `slots.entries('conversation.composer')` 注册项（用注册项自带的 `select` 确认它是
    承载当前待处理交互的那一个）→ `uiSession.resolve(sessionId)` 作用域绑定 →
    `slots.resolveStore(handle, binding)` 活实例；任一环不可用即 no-op（无降级）。
- `card` 态判定：当前会话是否命中待处理交互表（服务级），不使用任何 DOM 查询，
  故不受卡片渲染时序影响。
- 左栏开关（`⌘/Ctrl+B` → `layout.toggleSidebar()`）：宽屏下在侧栏契约默认宽（280px）与
  0 之间切换，窄屏（`viewportWidth < 1024`）下只翻转 `narrowExpanded` 覆盖——即
  AppFrame 左列轨道本身。服务缺席时 no-op（不吞键）。
- 右栏开关（`⌘/Ctrl+Alt+B` → `sidebarRight.toggleExpanded()`）：与右栏头部的折叠按钮
  （`[data-sidebar-right-toggle]`）**同一入口**——反转**当前会话**右栏面板的展开态。
  展开态是 `dsh-client-ui-sidebar-right` 的会话级 store 状态：右侧 seat 重渲染后由
  自己的 `useLayoutEffect` 调 `layout.openRightbar(track, fullscreen)` /
  `closeRightbar()`，把 AppFrame 的右栏轨道同步过来（见该包 `lib/client.js` 的
  `RightbarSeat → syncPresentation`），故**一次服务调用即完成「面板 + 轨道」的开合**，
  插件无需自己调右栏那两个 layout 方法。
  控制器在无挂载会话面（空白/hero 会话、右栏插件缺席）时 `require()` 抛错，插件兜住
  → **no-op 且不吞键**（无降级：不碰 DOM 里那个折叠按钮）。
- 聚焦输入框（`⌘/Ctrl+I`）：**上游没有可触发的「聚焦 composer」服务面**——`conversation`
  契约（`send` / `updateQueue` / `cancel` / `loadOlder` / `input` / `blocks`）与
  `SessionInput` 契约（`setDraft` / `submit` / `state` …）都没有聚焦动词；
  `commandUi.bindComposerFocus(id, fn)` 语义对口但**只 bind 不 trigger**（触发方是
  slash 弹层的 Escape / 选中路径），当前构建里全仓无人调用它 → `focusHooks` 恒空；
  `ConversationViewRequest.focus` 是 trajectory 视图的 callId，不是 composer 焦点。
  因此路径是（`src/actions.ts` 的 `focusComposer`）：
  `sessions.list.getSnapshot().current` → `sessions.binding(id).ctx`
  → `conversation.input.for(actx)`（`for` 缺席时回退公开的 `InputHub.shell(id)`，
  两者返回同一个 `SessionInputShell`）→ `shell.editor.getRootElement()`
  → `focus({ preventScroll: true })`。
  只用服务链路给出的元素，**零选择器查询、零 DOM 遍历、零事件合成**；
  参数与上游 composer autofocus（`editor.getRootElement()?.focus({ preventScroll: true })`）
  一致。任一环缺失 / 抛错即 no-op（不吞键，**不回退到 DOM 查询**）。
  > **为什么不能只调 `editor.focus()`**：lexical 0.49 的 `LexicalEditor.focus()`
  > 只做「克隆选区置 dirty + 打 `FOCUS_TAG` + 注册回调」，**没有** DOM 聚焦调用；
  > 真正的 `rootElement.focus()` 在选区调和器里，且只在「当前 DOM 选区已等于目标
  > 选区」的分支中执行——DOM 选区落在 composer 之外时（刚在正文里点选过文本）
  > 它不会把键盘焦点移回输入框。所以取宿主元素后直接 `focus()` 才是可靠原语。
- 会话跳转（`⌘/Ctrl+Alt+↑/↓`）：在**活跃会话**之间跳转。活跃 =
  正在运行（`running`）∪ 有待处理交互（待处理交互表命中）∪
  刚完成未查看（`completed`）。
  **导航轴 = 侧栏可见顺序**（`src/sidebar-order.ts` 逐条复刻
  `dsh-client-ui-workspace` 的派生规则）：
  1. **分组**：`groupBy==='workspace'`（默认）按 `workspaces.list` 快照的宿主顺序逐组
     渲染（组内成员来自该工作区的 `sessionIds`），无归属会话落在末尾的 Ungrouped 桶；
     `groupBy==='flat'` 时是单列表。
  2. **组内顺序**：取自侧栏视图 store（`createWorkspaceViewStore`）的
     `sessionOrderByAccount[组 key]`——手动拖拽与 `orderBy==='updated'` 的活跃提升
     结果都在这里；再按上游 `reconciledSessionOrder` 与当前账号对账（新增会话追加末尾）。
     该 store 经 `slots.entries('sidebar.workspaces')` 注册项上的 store handle
     + `slots.resolveStore(handle, undefined)` 取**活实例**（与侧栏渲染同一份内存态；
     实例尚未创建时由上游 store 自身水合）。
  3. **可见性**：复刻上游 `sessionVisible`——剔除子代理（`origin==='subagent'`）、
     归档、非当前空白行。
  以当前会话在轴上的位置为锚，向目标方向扫描**最近**的活跃会话并
  `sessions.open(id)`；锚点不在可见轴 / 方向尽头无活跃会话时 no-op。
  **无降级**：顺序只有上面这一个权威来源（侧栏视图 store + `workspaces` 快照），
  任一项读不到（服务缺失、slot 未注册、store 不可解析、`groupBy` 非已知值、
  `workspaces` 快照缺 `items`）一律 no-op——宁可不动，也不按猜测的顺序跳转。
  > 只取**顺序**、不按分组折叠态（`groupExpansion`）与每组 5 行的折叠上限
  > （`COLLAPSED_SESSION_LIMIT`）裁剪：折叠组 / 超限行里的会话仍有确定的顺序位置，
  > 若一并裁掉就会变成「跳不到」。
- `Esc` 停止会话（动作 `session.stop`）：**仅在当前会话
  没有待审批卡片时生效**（有审批卡片时 `Esc` 已被审批拒绝占用并吞键）；起点 =
  `sessions.list.getSnapshot().current`，沿 `subagentsByParent[id].entries` 递归
  `kind==='child'` 的直系子代理（visited 去重），对每个节点 `sessions.binding(id)`
  → `session.getSnapshot().running === true` 时 `session.cancel()`；`subagent.address
  .mode === 'one-shot'` 的一次性子代理不可取消（跳过取消但仍继续递归其后代）；
  **不吞键**，`Esc` 的页面默认行为照常执行。

## 服务化后的已知限制

- **审批卡片的 `Enter` / `Esc` 会抢占输入框**：当前会话有审批卡片时，即使焦点在
  对话输入框里，`Enter` 也是「允许一次」、`Esc` 也是「拒绝」（审批卡片自身没有
  输入框，这样「直接按 Enter 同意」才成立）；此时 `Enter` 不会发送消息，需要正常
  发消息时请先处理掉审批卡片（或点卡片按钮）。
- **通用问答的焦点在卡片自定义文本框时不接管**：焦点在该输入框（无选项题会自动聚焦、
  有选项题点一下内联输入框也会聚焦）时，数字键 / `←` `→` / `Enter` 交回卡片自身处理
  （不吞键）——`←` `→` 此时用于移动光标，这是为了不干扰文本输入；请先把焦点移出输入框
  （`Esc` 或点击卡片空白处）再用热键切题。
- **通用问答的 `←` / `→` 不循环**：与上游 pager 按钮一致，首题按 `←`、末题按 `→`
  为 no-op（不吞键，页面默认行为照常）。计划评审是单题一次决策，方向键恒为 no-op。
- **通用问答的翻题入口是 `←` / `→` 与 `Enter`**：数字键选中后停在当前题（上游
  `choose()` 的单选自动 `index+1` 被刻意去掉）；`Enter` 仍可推进（当前题已作答且非
  末题 → 下一题），但末题时只负责结算——仍有未完成题则 no-op（不结算、不吞键、
  **不跳回**该题，回跳请用 `←`）。因此连按数字键不会「跳着答题」。
- 通用问答的草稿以卡片 store 为**唯一真源**，热键与鼠标点选可自由混用；`requestKey`
  不属于当前请求（上一次请求残留）时按上游 `initialProgress` 语义重建空进度。
- 计划评审键位语义以请求数据为准（`1`/`2`/`3` = 确认 / 拒绝 / 去聊天里说）；
  请求未提供「拒绝」选项时 `2` 为空操作。
- **聚焦输入框只在 `browse` 态生效**：焦点已经在任意可编辑元素里（`editing`）时
  `⌘/Ctrl+I` 不接管也不吞键——否则会在 contenteditable 里触发浏览器「斜体」
  （`execCommand('italic')` 直接改 DOM，绕过 Lexical）。若你在别的输入框里想跳到
  对话输入框，请先 `Esc` / 点击对话区域退出编辑态再按。
- **聚焦输入框依赖 composer 已渲染**：目标会话的输入框从未挂载（例如该会话从未在
  当前布局里显示过）时 `editor.getRootElement()` 为 `null`，动作 no-op（不吞键）；
  空白/hero 会话、composer 被 block 停用时同理。
- **上游把 composer 聚焦接上后本插件可再简化**：`commandUi.bindComposerFocus(id, fn)`
  就是上游为此预留的注册口（注释写的是「overlay wiring binds the textarea focus
  here」），当前构建里没有任何调用方；等上游补上「触发侧」或新增
  `conversation.focusComposer()` 之后，本动作可退化为一次纯服务调用。

服务注入：`['sessions', 'uiSession', 'layout', 'sidebarRight', 'workspaces', 'slots', 'conversation']`
（全部判空后才消费；`slots` 用于读侧栏视图 store（会话跳转顺序）与问答草稿 store，
`layout` 用于 `⌘/Ctrl+B` 开关左栏，`sidebarRight` 用于 `⌘/Ctrl+Alt+B` 开关右栏，
`conversation` 用于 `⌘/Ctrl+I` 取 composer 的 editor 宿主元素）。
无宿主逻辑（`index.ts` 为占位空宿主），无 react 依赖（速查表为纯 DOM 浮层）。

## 自定义键位

`localStorage["dsh-kbd-hotkeys:v1"]`（JSON）：

```json
{
  "bindings": {
    "sidebar.toggle": "mod+alt+s",
    "session.next": "mod+alt+j"
  }
}
```

- `bindings` 与默认表**浅合并**：只写想覆盖的动作 id（动作 id 见
  `src/config.ts` 的 `DEFAULT_BINDINGS`），改完刷新页面生效；两个侧栏动作
  （`sidebar.toggle` 左栏 / `sidebarRight.toggle` 右栏）与聚焦输入框
  （`composer.focus`）各自独立可覆盖。
  > 未注册的动作 id 写在 `bindings` 里不会触发：分发前先查动作注册表
  > （`ACTION_BY_ID`），未注册即忽略。
- **固定分发动作不可自定义**：`approval.allow` / `approval.reject` /
  `question.option` / `question.prev` / `question.next` / `question.submit`
  （见 `src/config.ts` 的 `FIXED_KEYS`）由分发器按卡片类型固定分发，`bindings`
  里的同名键位会被 `loadConfig` 剔除，固定单键改不回来，也不需要手动清理。
- 组合键写法：`mod`（⌘/Ctrl）+ `alt` + 键名（字母/数字/`enter`/
  `backspace`/`escape`/`arrow*`/`pageup`/`pagedown`/`;` 等），如 `"Cmd+Alt+M"`；
  默认键位一律不使用 `shift` 作为修饰键（解析器兼容 `shift` 写法，可自定义使用）。
  配置中其他字段一律忽略：快捷键默认启用、无总开关。
- 未实现（方案 P2，预留后续）：readline 编辑键（`Ctrl+A/E/K/U`、`Alt+B/F/D`）、
  `Esc Esc` 清空草稿、输入框历史反查、单键 `o`/`t`、权限模式循环（预留，默认不绑定）、
  Leader 前缀集。

## 构建

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → lib/client.js（入仓，禁手改）
npm run check       # node --check 产物与宿主
```

诊断脚本（非插件产物，纯 Node + 最小 DOM 桩，无需浏览器）：

```sh
node test-services.mjs   # 服务级动作路径：审批/问答/计划评审/card 态判定（DOM 桩不提供任何卡片；
                         # 问答断言直接落在卡片草稿 store 上——数字键必须写入 store、Enter 必须取自 store；
                         # 另含 ⌘/Ctrl+B → layout.toggleSidebar（左栏）/ ⌘/Ctrl+Alt+B →
                         # sidebarRight.toggleExpanded（右栏）的两态调用、互不串场、自定义键位与无降级；
                         # 以及 ⌘/Ctrl+I 聚焦输入框：binding.ctx 原样传给 input.for、只认 browse 态、
                         # for 缺席回退 shell(id)、任一环缺失/抛错一律 no-op 不吞键）
node test-dispatch.mjs   # 分发链路：⌘/Ctrl+Alt+↑/↓ 按侧栏顺序跳转（分组 / flat / 来源不可用 no-op）
                         # 与两个侧栏开关的键位 / browse·editing 态闸门
```

## 加载（用户操作）

```sh
cd /Users/lz/dsh-plugins/dsh-kbd-hotkeys
dsh plugin --profile web add link:.
# 首次挂载（组合变更）需重启 App 生效
```

卸载：`dsh plugin --profile web remove dsh-kbd-hotkeys`。

生效验证（读取宿主**当前公告**的插件图；单个 `/plugins/<id>/client.js` 不在公告组合内会 404）：

```sh
curl -s -N --max-time 3 http://127.0.0.1:3080/plugins/events | head -c 1500   # 首帧 graph 里找 dsh-kbd-hotkeys 的 rev
```

> 首次挂载（改 Profile / 组合）需重启 App；此后**只改浏览器半部**时，`npm run build`
> 落地新产物后由 `dsh-client-hmr`（每 500ms 轮询 mtime/size）自动推给已打开的页面，
> **无需重启、无需刷新**；宿主半部 `index.ts` 的改动仍需重启。
