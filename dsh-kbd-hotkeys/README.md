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
| `⌘/Ctrl+Alt+←` / `→` | **右侧栏**当前面板的标签：上一个 / 下一个（循环；只有一个标签时不吞键） | 任意 |
| `⌘/Ctrl+Alt+\` | **右侧栏**定位文件浏览器：打开（不存在时创建）/ 聚焦该页并置顶（`openTab('files')`，同时展开右栏） | 任意 |
| `⌘/Ctrl+I` | 聚焦对话**输入框**（走 `conversation.input` 取 composer 的 editor 宿主元素后 `focus()`） | `browse` |
| `⌘/Ctrl+Alt+↑` / `↓` | 上一个 / 下一个**活跃会话** | 任意 |
| `⌘/Ctrl+Alt+K` | 打开**工作区浮窗**（浮窗内 `↑`/`↓` 选择、`Enter` 切换、`Esc` 关闭） | 任意 |
| `⌘/Ctrl+Alt+M` | 打开**模型浮窗**：选择本会话使用的模型（浮窗内 `↑`/`↓` 选择、`Enter` 切换、`⇧Tab` 调思考强度、`Esc` 关闭） | 任意 |
| `⇧Tab` | 循环切换当前模型的**思考强度**（模型无强度档 / 只有一档 / 目录不可用时 no-op 且不吞键） | `browse` / `editing`（`editing` 时需焦点在 composer 内） |

> 「任意」= 三态均允许（动作 `states` 为 `['card','editing','browse']`）。
> 两个侧栏开关为 `['browse','editing']`：输入框聚焦时同样生效（带修饰键的组合不干扰
> 文本编辑，符合 `editing` 态「只保留带修饰键的全局组合」的规则）；右栏标签切换、
> 文件浏览器定位、工作区浮窗与模型浮窗都是**任意态**（含 `card`）——卡片占用的是**裸**
> `←` / `→` / 数字键，与带 `mod+alt` 的组合键不冲突。
> **聚焦输入框只放行 `browse`**：焦点已经在输入框里时该动作没有意义（`editing`），
> 且 contenteditable 里的 `⌘/Ctrl+I` 是浏览器「斜体」默认行为（`execCommand`，
> 绕过 Lexical 直接改 DOM），放行会与编辑器状态打架；卡片态同理（卡片自己的输入框
> 归卡片管）。`mod` 在 `comboOf` 里同时吸收 `ctrlKey` 与 `metaKey`，所以 macOS 上
> **⌃I 与 ⌘I 都能触发**（用户按 Ctrl+I 的习惯在 mac 上按 ⌃I 即可），Win/Linux 就是
> Ctrl+I；两平台浏览器 DevTools 都带 `Shift`（⌘⌥I / Ctrl+Shift+I），不冲突。
>
> **为什么左栏拿 `⌘/Ctrl+B`、右栏拿 `⌘/Ctrl+Alt+B`**（主键给主面板）：
> ① `⌘/Ctrl+B` 开关侧栏是跨应用肌肉记忆（VS Code / Slack / 各类编辑器一致）——把
> 「已经被训练过的反射」留给最基础的左栏（导航主面板），右栏只需要多记一个 `Alt`；
> ② 命名同源：上游不带限定词的 `sidebar` / `sidebarCol` 就指左栏
> （`layout.toggleSidebar()`），右栏是派生的 `rightbar`（`rightbarShown` /
> `rightbarTrack`）——主键给「本名」，叠加修饰键给「限定名」；
> ③ 越常用越省力：`⌘/Ctrl+B` 比 `⌘/Ctrl+Alt+B` 更短、更好按，自然该给使用频率更高、
> 更基础的左栏；`Alt` 这一档留给上下文面板（右栏）。
> 若实际用下来右栏更常用，互换只需改 `src/config.ts` 的两行 `DEFAULT_BINDINGS`，或用
> `localStorage` 覆盖单个动作的键位（见「自定义键位」）。
>
> **右栏标签切换为什么是 `⌘/Ctrl+Alt+←` / `→`**：它属于右栏（`rightbar`）这一档，
> 所以沿用右栏的 `mod+alt` 修饰键档；方向键天然表达「上一个 / 下一个」，与
> `⌘/Ctrl+Alt+↑/↓`（**活跃会话**跳转）同族但不同轴——会话轴在左栏、标签轴在右栏，
> 左右配对。右栏标签**循环**：末个按 `→` 回到第一个、首个按 `←` 到最后一个
> （标签条 chip 点击是任意跳，热键是「轮到下一个」，循环才闭合滚动语义）；
> 面板只有一个标签时**不循环回自身**——no-op 且不吞键，把按键交回页面，
> 避免「按了没反应还吃掉按键」。三态均生效（含 `card`）：卡片打开时同样能切右栏标签，
> 因为卡片占用的是**裸** `←` / `→`，带 `mod+alt` 的组合键与它不冲突，本动作无需让路。
>
> **定位右栏文件浏览器为什么是 `⌘/Ctrl+Alt+\`**：它同属右栏（`rightbar`）这一档
> （`mod+alt`），反斜杠在主键区右端、不与同档的方向键抢位。语义是「打开 + 归位」而不是
> 「开关」：**该面板还没有文件浏览器页就创建它，已经开着就只是聚焦并归位**（幂等），
> 所以不需要一个 toggle 键位。上游公开面只提供 `openTab(kind)`（落位是目标面板**末尾**），
> **没有**「插到第 N 位」的落位参数，因此置顶走的是**标签拖拽的同一入口**——会话级 slot
> store 实例上的 `actions.placeTab(sessionId, tabId, paneId, 0)`；**绝不使用 `replaceTab`**
> （那会 `closeTab` 掉被顶掉的那个 tab，可能丢掉编辑器的未保存修改）。三态均生效：
> `mod+alt` 与卡片的裸键、与文本编辑都不冲突。
> 已知限制：Win/Linux 上 `Ctrl+Alt` 即 AltGr（本插件按 `event.code` 的**物理键位**
> `Backslash` 命中，与布局产出什么字符无关）；极窄窗口下上游会把「挤不下」的右栏
> 再折叠回去（与右栏头部展开按钮同一条路）。
>
> **工作区浮窗为什么是 `⌘/Ctrl+Alt+K`**：它同样属于 `mod+alt` 这一档（右栏开关 /
> 右栏标签 / 文件浏览器 / 活跃会话跳转都在这一档），`K` 取「工作区（Work-space）」联想，
> 不与同档的方向键、`B`、`\` 抢位。语义是「**列表 → 选中 → 切换**」三步：
> 打开后 `↑`/`↓` **只移动高亮**（不触发导航，避免每按一次就连接一个工作区），
> `Enter`（或鼠标点行）才调 `uiWorkspace.openWorkspace(workspaceId)`——
> 也就是侧栏工作区分组上「＋」新建会话走的**同一条**「连接工作区」路径：
> 复用该工作区已有的空白会话，没有就新建一个再打开（详见「已知限制」）；
> `Esc` 关闭，再按一次 `⌘/Ctrl+Alt+K` 也关闭（开关语义），浮窗内按 `⌘/Ctrl+/`
> 直接换成速查表。列表取自 `workspaces.list` 快照的**宿主顺序**（与侧栏分组顺序同源，
> 不重排），初始高亮 = 当前会话所属工作区，该行带「当前」标记。
> 三态均生效：`mod+alt` 与卡片的裸键、与文本编辑都不冲突。
>
> **模型浮窗为什么是 `⌘/Ctrl+Alt+M`**：与工作区浮窗同属 `mod+alt` 这一档，
> `M` 取「模型（Model）」联想，不与同档的方向键、`B`、`\`、`K` 抢位。语义与工作区浮窗
> 同形：`↑`/`↓` 只移动高亮，`Enter`（或鼠标点行）才提交，`Esc` / 再按一次同组合键关闭。
> 关键点是**同源**——列表、当前选择与提交都走 `/model` 弹层、composer 模型座位用的
> **同一个** per-session 模型目录（`ctx.modelDirectories.directoryFor(sessionId)`），
> 所以浮窗里切换之后，composer 上的模型标签会同步变化，反之亦然（见「实现要点」）。
> 浮窗内 `⇧Tab` 也能调强度（只更新顶部「当前」行，不重画列表）。
>
> **思考强度循环为什么是 `⇧Tab`**：上游 composer 座位把强度档收在「模型菜单 →
> Effort」二级面板里，**没有默认键位**；`⇧Tab` 空着、且「在模型上按 Tab 循环档位」
> 是不少 Agent 客户端的既有习惯。循环集合与上游座位的 `effortChoices` **逐字一致**
> （模型有 `defaultEffort` 时不含「提供方默认档」），当前档 = `reasoningEffort ??
> defaultEffort`。它只放行 `browse` / `editing`，且 `editing` 态还有一道**元素级门闸**：
> 只有焦点落在 **composer 自己的编辑区内**才接管——`⇧Tab` 是文本编辑的核心键
> （反向移动焦点；右侧栏 Monaco 里是反向缩进），焦点在设置面板输入框、Monaco 的隐藏
> `textarea` 等其它可编辑元素时一律放行、交回该处默认行为。
> no-op（模型无推理元数据 / 只有一档 / 目录不可用 / 子代理会话）时**不吞键**。
>
> 审批与问答的 `Enter` / `Esc` / 数字键 / 方向键是**固定分发的单键**，不参与
> `bindings` 自定义（见「自定义键位」）。
> `⌘/Ctrl+Alt+\` 绑定的是**停靠面板**里的文件浏览器页（不存在则创建、已存在则聚焦并
> 置顶），本插件不含任何浮窗形态的文件浏览器。
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
- 右栏标签切换（`⌘/Ctrl+Alt+←` / `→` → `sidebarRight.focus(tabId)`，见
  `src/sidebar-tabs.ts`）：上游右栏的公开面只有 `active()`（当前标签）与
  `focus(tabId)`（聚焦某标签），**没有** next/prev 动词、也无法枚举标签；标签顺序只
  存在于右栏自己的**会话级 slot store**里（`createSidebarRightStore`，快照
  `{ bySession: { <sessionId>: { layout } } }`，`layout` 为 docking kit 的 `LayoutState`）。
  于是切标签 = 「读权威 store 拿顺序 + 调公开的 `focus`」，与标签条（chip）点击**同一
  入口**；取数即 AGENTS.md 的 slot store 三步范式：
  `slots.entries('rightbar.session')` 注册项上的 store handle
  （seat 行注册：`ctx.slots.register({ name: 'rightbar.session', …, store })`）
  → `uiSession.resolve(sessionId)` 作用域绑定 → `slots.resolveStore(handle, binding)`
  活实例 → `getSnapshot().bySession[sessionId].layout`；
  顺序与当前项取自 `layout.nodes[layout.activePaneId]`（即**当前面板**，与上游
  `active()` 同源）的 `tabs` / `activeTabId`，落点 id 取自 `layout.tabs[tabId].id`。
  **只在当前面板内切**（分屏的其它面板不参与）、**循环**（`(active ± 1 + n) % n`）、
  面板只有一个标签 / 无标签 / `activePaneId` 非 pane 节点 / 该会话尚无面板一律
  no-op 且**不吞键**；**无降级**：任一环不可用（`sidebarRight` 或 `slots` 或
  `uiSession.resolve` 缺失、注册项无 store、`resolveStore` 抛
  `store handle is not registered`、快照缺 `bySession`）即 no-op，不猜顺序、不碰 DOM。
  态闸门为**任意态**：问答卡片只用**裸** `←` / `→`（固定分发，见上面的
  `question.prev` / `question.next`），带 `mod+alt` 的组合键与它不在同一个 combo 上，
  所以卡片打开时本动作照常生效。
- 定位右栏文件浏览器（`⌘/Ctrl+Alt+\` → `src/sidebar-tabs.ts` 的
  `revealRightSidebarFiles`）：两步，各走一个上游入口。
  ① **打开/创建/聚焦** = 公开的 `sidebarRight.openTab('files')`——`files` 是
  `dsh-client-ui-sidebar-files` 注册的**页类型** kind（也就是引导页里「工作区文件」
  那一格，由 `dsh-web-app` bundle 常驻挂载）；上游 store 的 `openContent` 恒先
  `planSetExpanded(true)`，所以一次调用即「**展开右栏** + 打开/聚焦」，插件不必也不该
  再调 `toggleExpanded()`（那会把本来开着的右栏关掉）。页类型按**目标面板**
  （`activeDockPaneId`）去重：该面板已有文件浏览器页就只聚焦它，**没有就在面板末尾
  创建**（公开面无 index）——这正是「不存在则创建一个」的落点。
  ② **置顶** = 同一份会话级 slot store 的**活实例动作面**
  `actions.placeTab(sessionId, tabId, paneId, 0)`——与标签条**拖拽**同一入口
  （seat 的 `intentsFor.placeTab`），落地为 dockkit `reorderTab`（同面板）/
  `moveTab`（跨面板）/ `unfloat`（源为浮窗），是上游声明的写集动词；
  `index` 已在上游 clamp。标签栏顺序就是 `pane.tabs` 数组顺序（strip 渲染
  `r.tabs.map(…)`，chip 带 `data-dockkit-tab`），所以「首位」= `tabs[0]`。
  取数路径与切标签**共用** `slots.entries('rightbar.session')` →
  `uiSession.resolve(sessionId)` → `slots.resolveStore(handle, binding)`（本轮把
  `rightbarTabsState` 收敛为返回 `{ instance, snapshot }` 的 `rightbarStore`，
  读顺序取 `snapshot`、写置顶取 `instance.actions`）。
  语义与边界：**已在首位**时上游 `planPlaceTab` 不产生任何 op（零提交、零历史），
  插件也不调 `placeTab`；只认**停靠**面板（浮窗不碰），**优先当前面板**（本次
  `openTab` 的落点），别的分屏面板里已有的文件树 tab **不搬过来**——搬过去会被上游
  `arriving()` 判为重复页而 `closeTab`，所以跨面板可能各有一份（上游「页唯一性按
  面板」的既定语义）。**无降级**：`openTab` 抛错（无挂载会话面 / `files` 类型未注册）
  → no-op 且**不吞键**；打开成功但任一取数环不可用（无 `slots`、无作用域绑定、
  `resolveStore` 抛错、实例无 `actions.placeTab`）→ 只静默跳过置顶，**不回退**到 DOM
  或 `replaceTab`，打开本身照旧吞键（该按键确实做了事）。
- 工作区浮窗（`⌘/Ctrl+Alt+K` → `src/workspace-switcher.ts` + `src/overlay.ts`）：
  列表与切换各走一个**公开服务面**，浮窗 DOM 由插件自建自管（纯 DOM，不消费 react）。
  ① **列表** = `workspaces.list.getSnapshot().items`，按**宿主顺序**原样展开
  （`dsh-client-ui-workspace` 的 `groupByWorkspace` 就是逐项遍历同一份 `items`，
  侧栏分组顺序与它同源）；主标签 = 工作区 `title`，为空时回退路径末段
  （复刻上游 `workspaceTitleOf` 的「最后一个非空段」，同时接受 `/` 与 `\`），
  次行 = 规范路径（与主标签相同时省略），`当前` 标记 = 当前会话在该工作区的
  `sessionIds` 名下（与侧栏高亮当前会话所属分组同一判据），右侧显示会话数。
  ② **切换** = 公开的 `uiWorkspace.openWorkspace(workspaceId)`（服务由
  `dsh-client-ui-workspace` 提供）——「连接工作区」的规范路径：复用该工作区已挂载的
  空白会话，没有就 `sessions.create({ workspaceId })` 新建一个再打开，与侧栏分组上的
  「＋」、首屏工作区导航**同一条代码路径**。
  ③ **浮窗交互**（`overlay.ts`）：`↑`/`↓` 只在列表内移动高亮（越界 clamp，不循环，
  **不触发导航**），`Enter` / 行内 `mousedown` 才确认（先关浮窗再切，导航是异步的），
  `Esc` 或再按一次同组合键关闭；同一时刻只有一个浮层（`help` | `workspace`），
  互切直接换面板；浮层打开时按键进入**模态分发**（未处理的按键一律吞掉，避免误触
  页面快捷键）。列表**每次打开时重新取数**（工作区增删、当前工作区变化即时反映）。
  **无降级**：`workspaces` 服务缺席 / 快照缺 `items` → 空态浮窗（Enter 不切换）；
  `uiWorkspace` 缺席或 `openWorkspace` 抛错（未知 workspaceId / 无挂载会话面）→
  确认时 no-op，**不回退**到 DOM 点击侧栏分组。
- 模型浮窗（`⌘/Ctrl+Alt+M`）与思考强度循环（`⇧Tab`，`src/model-picker.ts` +
  `src/overlay.ts`）：两个动作共用**上游同一个** per-session 模型目录实例。
  ① **服务面**：`ctx.modelDirectories`（`ModelDirectoryResolver`，由 `dsh-web-app`
  bundle 常驻挂载的 `@deepseek-ai/dsh-client-ui-model-selection` 提供）的
  `directoryFor(sessionId)`。上游 `/model` 弹层（`commandUi` 的 `popupSelect`
  贡献）与 composer 的 `conversation.input.model` 座位**都**经它取目录
  （该包 `service.d.ts`：*the ONE state both selection entries share*），所以本插件
  的切换与两个上游入口共用同一份内存态、同一条 `session.selectModel` 提交路径，
  不是镜像。
  ② **列表 / 当前选择** = `directory.load()` 拉一次宿主代数目录后读
  `directory.store.getSnapshot()`；行 = `state.groups` 按**宿主顺序原样展开**
  （提供方分组标题 + 组内模型顺序都不重排），行主标签 = 模型名、次行 = 提供方名，
  当前行带「当前」标记且为初始高亮；`state.failures`（目录加载失败的提供方）
  **不占行**，只折成列表下方的小字计数。
  ③ **每行的完整选择** = 上游弹层 `selectionOf` 的**同一条规则**：`provider` /
  `model` 取自所在分组，`reasoningEffort` 取「当前选择已落在该模型上时的
  `current.reasoningEffort`」否则取 `model.reasoning.defaultEffort`
  （无 `defaultEffort` 时**省略**该字段）——不自行发明默认档。
  ④ **⇧Tab 的循环集合** = 上游座位 `effortChoices` 的同一条规则：
  `[Default（仅当模型没有 defaultEffort 时才是一个可选档）] + reasoning.efforts`；
  当前档 = `current.reasoningEffort ?? reasoning.defaultEffort`（上游 `effectiveEffort`，
  不在候选里时从候选首项重新开始）；只改 `reasoningEffort`、`provider` / `model` 沿用
  当前选择（与上游 `chooseEffort` 同形）。
  ⑤ **浮窗交互**（`overlay.ts`）：`↑`/`↓` 越界 clamp（不循环），`Enter` / 行内
  `mousedown` 才提交（先关浮窗再提交，提交是异步的），`Esc` 或再按一次同组合键关闭，
  浮窗内 `⇧Tab` 就地循环（只更新顶部「当前」行，列表与高亮不动）。同一时刻只有一个
  浮层（`help` | `workspace` | `model`），互切直接换面板；列表是**异步**取的
  （先绘制「正在加载模型目录…」），落地时用**渲染序号守卫**丢弃过期结果
  （浮窗已关闭 / 已换成别的浮层的那次渲染作废）。
  **无降级**：`modelDirectories` 服务缺席 / 无当前会话 / 当前会话是被寻址的子代理
  （上游 `available` 的判据 `sessions.subagentAddress(id) === undefined`）/
  `directoryFor` 抛错（未知会话、无挂载会话面）→ 浮窗显示空态、`⇧Tab` no-op 且
  **不吞键**；`load()` 拒绝 → 浮窗照常打开、底部小字给出原因；`select()` 拒绝 →
  浮窗照常关闭（失败详情落在目录 store 上，与两个上游入口共用同一份错误态）。
  全程不碰 DOM 取模型数据、**不回退**到点击 composer 的模型标签。
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
- **工作区浮窗的「切换」= 连接工作区，不一定是「打开上一次的对话」**：
  `uiWorkspace.openWorkspace` 的语义是复用该工作区**已挂载的空白会话**，没有就
  `sessions.create({ workspaceId })` **新建一个空白会话**再打开（这正是侧栏分组上
  「＋」的行为）。所以从一个有历史对话的工作区切过去，落点是它的空白新会话而不是
  最近那次对话；最近的对话仍在侧栏该分组里，点一下即可。
- **工作区浮窗只列已登记的工作区**：`workspaces.list` 快照的宿主顺序（侧栏分组的
  同一份数据）。侧栏末尾那个「未分组（Ungrouped）」桶**不是工作区**，没有
  `workspaceId`，故不在浮窗里，也无法被「切换」。
- **工作区浮窗依赖 `uiWorkspace` 服务**：它由 `dsh-web-app` bundle 常驻挂载的
  `dsh-client-ui-workspace` 提供。该服务缺席时浮窗仍可打开（列表照常），但确认
  切换为 no-op（不崩、不回退 DOM）；宿主侧工作区列表还在 `pending`（首屏未拿到基线）
  时列表为空态，稍后重开即可。
- **上游把 composer 聚焦接上后本插件可再简化**：`commandUi.bindComposerFocus(id, fn)`
  就是上游为此预留的注册口（注释写的是「overlay wiring binds the textarea focus
  here」），当前构建里没有任何调用方；等上游补上「触发侧」或新增
  `conversation.focusComposer()` 之后，本动作可退化为一次纯服务调用。
- **右栏标签切换只覆盖「当前面板」**：`←` / `→` 在 `layout.activePaneId` 指向的那块
  面板内轮转（与上游 `active()` / 标签条的「当前」同源）；分屏出来的第二块面板需要
  先点它（或点它的标签）成为当前面板，热键才会切它。浮层面板（float）不参与轮转。
- **右栏标签切换依赖右栏插件已挂载且该会话开过面板**：`rightbar.session` 注册项
  （`slots.entries` 找不到）、右栏自己那份会话级 store（`slots.resolveStore` 抛
  `store handle is not registered`）、或该会话尚无 `bySession[sessionId]`
  （从未展开过右栏、空白/hero 会话）时动作 no-op 且**不吞键**（无降级：不猜顺序、
  不碰 DOM）。此时 `⌘/Ctrl+Alt+B` 先展开右栏即可。
- **单个标签时不吞键**：面板只有一个标签（或没有标签）时 `←` / `→` 不循环回自身，
  no-op 并把按键交回页面——避免「按了没反应还吃掉按键」。
- **`card` 态下右栏标签照常可切**：卡片占用的方向键是**裸** `←` / `→`（问答翻题），
  `⌘/Ctrl+Alt+←/→` 是另一个 combo，两者互不影响；同理输入框聚焦（`editing`）时也生效。
- **文件浏览器页本身由上游提供**：`files` 这个页类型来自 `dsh-web-app` bundle 常驻挂载的
  `@deepseek-ai/dsh-client-ui-sidebar-files`（引导页里的「工作区文件」）。该行缺席时
  `openTab('files')` 会抛 `no tab type is registered as "files"`，本动作兜住并
  no-op（**不吞键**），不会退化成任何 DOM 操作。
- **文件浏览器置顶只作用于它所在的那个停靠面板**：优先**当前面板**（本次 `openTab`
  的落点）。若文件树页同时存在于另一个分屏面板，那里那个 tab 保持不动（上游「页唯一性
  按**面板**」的语义，跨面板可能各有一份）；浮窗里的文件树 tab 也不被挪动、不被关闭。
  两个已知的上游行为沿用：Win/Linux 上 `Ctrl+Alt` 即 AltGr（按物理键位 `Backslash`
  命中）；极窄窗口下右栏会被上游按「挤不下」的规则再折叠回去（与右栏头部展开按钮
  同一条路，见 `dsh-client-ui-layout` 的 `canShow: normal.rightbar > 0`）。
- **模型浮窗只对「普通会话」可用**：上游 `directoryFor` 要求该会话有已挂载的 scope
  与 binding，且模型选择 RPC 只对**非子代理**会话开放（`subagentAddress(id) ===
  undefined`）。被寻址的子代理会话（继续对话的子会话）打开浮窗显示空态、
  `⇧Tab` no-op 且不吞键——这与上游两个入口一致：`/model` 命令对子代理会话
  `available: false`，composer 座位同样不暴露。
- **模型浮窗的目录是「宿主代数」的共享目录**：`groups` / `failures` 来自
  `ModelCatalogDirectory`（按宿主连接代数缓存，`llm/adapters-updated`、
  `settings/document-updated`、`credentials/reference-updated` 时刷新）。目录成员
  资格是**参考性**的（上游 `routable` 与目录成员无关），所以浮窗只列公告出来的模型；
  某个路由在服务但没被公告时不会出现在列表里（但与两个上游入口看到的是同一份数据）。
- **模型浮窗不显示模型描述**：上游 `/model` 弹层会给两个内置 DeepSeek 模型做
  **本地化描述**（它把宿主描述串与自己的英文词典逐字比对后换成中文），本插件不复制
  那份词典，因此浮窗只显示「模型名 + 提供方名」——要读描述请用 `/model`。
- **`⇧Tab` 在 `editing` 态只在 composer 内接管**：焦点在设置面板的输入框、右侧栏
  Monaco 的隐藏 `textarea` 等其它可编辑元素时，`⇧Tab` 一律交回该处默认行为
  （反向移动焦点 / 反向缩进），不会切模型强度。若在 composer 内按了没反应，说明当前
  模型没有推理元数据或只有一档（此时按键同样不被吞掉）。
- **`⇧Tab` 的方向是单向的**：只在候选档里**向前**循环（末档回到首档）。要反向
  （或换成别的键）请用 `localStorage` 覆盖 `model.effortNext`，本插件暂不提供
  「上一档」动作。
- **模型浮窗依赖 `modelDirectories` 服务**：它由 `dsh-web-app` bundle 常驻挂载的
  `@deepseek-ai/dsh-client-ui-model-selection` 提供。该行缺席（服务未注册）时
  浮窗仍可打开但显示空态，`⇧Tab` no-op（不崩、不回退 DOM）。

服务注入：`['sessions', 'uiSession', 'layout', 'sidebarRight', 'workspaces', 'slots', 'conversation', 'uiWorkspace', 'modelDirectories']`
（全部判空后才消费；`slots` 用于读侧栏视图 store（会话跳转顺序）、问答草稿 store
与右栏标签 store（`rightbar.session` 的标签顺序 + 置顶用的 `actions.placeTab`），
`layout` 用于 `⌘/Ctrl+B` 开关左栏，
`sidebarRight` 用于 `⌘/Ctrl+Alt+B` 开关右栏、`⌘/Ctrl+Alt+←/→` 聚焦右栏标签与
`⌘/Ctrl+Alt+\` 定位（打开/创建/置顶）文件浏览器，
`conversation` 用于 `⌘/Ctrl+I` 取 composer 的 editor 宿主元素与 `⇧Tab` 的编辑态门闸，
`uiWorkspace` 用于 `⌘/Ctrl+Alt+K` 工作区浮窗确认时连接/切换工作区，
`modelDirectories` 用于 `⌘/Ctrl+Alt+M` 模型浮窗取目录与 `⇧Tab` 循环思考强度——
与 `/model` 弹层、composer 模型座位共用**同一份** per-session 目录实例）。
无宿主逻辑（`index.ts` 为占位空宿主），无 react 依赖（速查表、工作区浮窗与模型浮窗
都是纯 DOM 浮层）。

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
  （`sidebar.toggle` 左栏 / `sidebarRight.toggle` 右栏）、右栏标签切换
  （`sidebarRight.tabPrev` / `sidebarRight.tabNext`）、定位文件浏览器并置顶
  （`sidebarRight.files`）、工作区浮窗（`workspace.pick`）、模型浮窗
  （`model.pick`）、思考强度循环（`model.effortNext`）与聚焦输入框
  （`composer.focus`）各自独立可覆盖。
  > 未注册的动作 id 写在 `bindings` 里不会触发：分发前先查动作注册表
  > （`ACTION_BY_ID`），未注册即忽略。
- **固定分发动作不可自定义**：`approval.allow` / `approval.reject` /
  `question.option` / `question.prev` / `question.next` / `question.submit`
  （见 `src/config.ts` 的 `FIXED_KEYS`）由分发器按卡片类型固定分发，`bindings`
  里的同名键位会被 `loadConfig` 剔除，固定单键改不回来，也不需要手动清理。
- 组合键写法：`mod`（⌘/Ctrl）+ `alt` + 键名（字母/数字/`enter`/
  `backspace`/`escape`/`tab`/`arrow*`/`pageup`/`pagedown`/`;` 等），如
  `"Cmd+Alt+M"`；`model.effortNext` 的默认值 `"shift+tab"` 是本插件**唯一**使用
  `shift` 作修饰键的默认键位（解析器一直兼容 `shift` 写法：`"cmd+shift+m"` 等）。
  配置中其他字段一律忽略：快捷键默认启用、无总开关。
- 未实现（预留后续）：readline 编辑键（`Ctrl+A/E/K/U`、`Alt+B/F/D`）、
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
                         # 以及 ⌘/Ctrl+Alt+←/→ 右栏标签切换：标签顺序必须取自
                         # rightbar.session 注册项的会话级 store（bySession[sessionId].layout
                         # 的 activePaneId 面板）、切换必须调 sidebarRight.focus，首末标签循环、
                         # 单标签与任一环不可用一律 no-op 不吞键、card 态仍生效（裸方向键归卡片）；
                         # 以及 ⌘/Ctrl+Alt+\ 定位右栏文件浏览器并置顶：必须调公开的
                         # sidebarRight.openTab('files')（不存在时创建 / 已存在时聚焦，即
                         # 「定位 + 缺则创建」），置顶必须调同一份会话级 store 实例的
                         # actions.placeTab(sessionId, tabId, paneId, 0)（与标签拖拽同一入口）、
                         # 已在首位不调 placeTab、只作用于停靠面板且优先当前面板（浮窗与别的
                         # 分屏面板不搬动）、openTab 抛错时 no-op 不吞键、取数失败只跳过置顶；
                         # 以及 ⌘/Ctrl+I 聚焦输入框：binding.ctx 原样传给 input.for、只认 browse 态、
                         # for 缺席回退 shell(id)、任一环缺失/抛错一律 no-op 不吞键；
                         # 以及 ⌘/Ctrl+Alt+K 工作区浮窗：列表按宿主顺序渲染（title / 路径末段 /
                         # 当前标记 / 会话数）、初始高亮 = 当前会话所属工作区、↑↓ 只移动高亮
                         # （不触发导航）且越界 clamp、Enter/点击才调 uiWorkspace.openWorkspace、
                         # Esc 与同组合键关闭、⌘/ 换成速查表、空列表与 workspaces 缺席为空态、
                         # uiWorkspace 缺席或抛错时确认 no-op、card/editing 态仍可用、键位可覆盖）
                         # 以及 ⌘/Ctrl+Alt+M 模型浮窗 + ⇧Tab 循环思考强度：目录必须按
                         # ctx.modelDirectories.directoryFor(当前会话) 取、行按宿主顺序展开
                         # （提供方分组标题 + 当前标记 + 初始高亮）、每行完整选择复刻上游
                         # selectionOf（无 defaultEffort 时不带 reasoningEffort）、Enter 调
                         # directory.select；⇧Tab 的循环集合复刻上游 effortChoices（有
                         # defaultEffort 时不含 Default 档）、当前档 = current.reasoningEffort
                         # ?? defaultEffort、末档回到首档、浮窗内 ⇧Tab 只更新「当前」行；
                         # 无推理元数据 / 只有一档 / 服务或缺 / 无会话 / 子代理 / directoryFor
                         # 抛错一律 no-op 且不吞键；load() 拒绝 → 空态 + 失败小字、select()
                         # 拒绝 → 浮窗照关；editing 态另需焦点落在 composer 内（isComposerTarget）
node test-dispatch.mjs   # 分发链路：⌘/Ctrl+Alt+↑/↓ 按侧栏顺序跳转（分组 / flat / 来源不可用 no-op）
                         # 与两个侧栏开关的键位 / browse·editing 态闸门
```

## 加载（用户操作）

```sh
cd <仓库根>/dsh-kbd-hotkeys
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
