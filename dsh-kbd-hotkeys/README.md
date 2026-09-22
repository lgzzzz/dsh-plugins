# dsh-kbd-hotkeys

DSH Web 全局快捷键插件（client-only，无宿主逻辑、无 react 依赖）。单一 `document`
捕获阶段 `keydown` 监听，按**三态分发**（`StateName`）：

- **`card`** — 当前会话有审批 / 问答 / 计划评审卡片待处理：按键服务于卡片；
- **`editing`** — 焦点在可编辑元素（input / textarea / contenteditable）：只保留带修饰键的
  全局组合，不干扰文本编辑；
- **`browse`** — 其余（浏览对话）：全部导航键生效。

## 键位（macOS 为 ⌘，Win/Linux 为 Ctrl；`mod` 同时吸收 ctrlKey 与 metaKey）

| 按键 | 功能 | 态 |
| --- | --- | --- |
| `Enter` | 审批：允许一次；问答：下一题（非末题且当前题已作答）/ 末题提交（全部题目完成后）；计划评审：确认执行 | `card` |
| `Esc` | 审批：拒绝；否则停止当前会话运行中的交互树（自身 + 运行中的直系子代理） | 任意 |
| `1`–`9` | 问答：选择第 N 项（**只改选中态，不翻题**）；计划评审：`1`/`2`/`3` = 确认 / 拒绝 / 去聊 | `card` |
| `←` / `→` | 问答：上一题 / 下一题（只切题号、草稿保留；首/末题不循环且不吞键） | `card` |
| `⌘/Ctrl+/` | 快捷键速查表 | 任意 |
| `⌘/Ctrl+B` | 开关**左**侧栏（`layout.toggleSidebar`） | `browse` / `editing` |
| `⌘/Ctrl+O` | 开关**右**侧栏（`sidebarRight.toggleExpanded`） | `browse` / `editing` |
| `⌘/Ctrl+Alt+←` / `→` | 右栏当前面板的标签：上一个 / 下一个（循环；单标签不吞键） | 任意 |
| `⌘/Ctrl+,` | 右栏关闭当前面板的**当前标签**（无可关标签时只 no-op，但键位恒被吞、不留给浏览器） | 任意 |
| `⌘/Ctrl+\` | 右栏定位文件浏览器：打开 / 聚焦该页并置顶（同时展开右栏） | 任意 |
| `⌘/Ctrl+L` | 右栏定位终端：已有终端则聚焦（多个终端时优先当前激活的那个，没有当前激活的落第一个）并把 DOM 焦点移进 xterm，一个都没有才新建；**不重排** | 任意 |
| `⌘/Ctrl+J` | 聚焦对话输入框（J = Jump）；`editing` 时需焦点**不在** composer 内 | `browse` / `editing` |
| `⌘/Ctrl+N` | 新建会话并跳转（`uiWorkspace.startSession()`，同侧栏「新建会话」按钮） | 任意 |
| `⌘/Ctrl+Alt+↑` / `↓` | 上一个 / 下一个**活跃会话**（沿侧栏顺序**循环**，到尽头回绕） | 任意 |
| `⌘/Ctrl+K` | 工作区浮窗：最近活跃的 10 个工作区（`↑`/`↓` 选择、`Enter` 切换、`Esc` 关闭） | 任意 |
| `⌘/Ctrl+I` | 近期对话浮窗：最近交互的 10 个会话、按工作区分组（`↑`/`↓` 跨组、`Enter` 打开） | 任意 |
| `⌘/Ctrl+M` | 模型浮窗（`↑`/`↓` 选择、`Enter` 切换、`⇧Tab` 调强度、`Esc` 关闭） | 任意 |
| `⇧Tab` | 循环切换当前模型的思考强度（无强度档 / 只有一档 / 目录不可用即 no-op 不吞键） | `browse` / `editing`（`editing` 需焦点在 composer 内） |

- 「任意」= 三态均允许。带修饰键的组合与卡片占用的**裸** `←`/`→`/数字键不冲突，故右栏
  与浮窗类动作在 `card` 态照常生效。
- 分档：**单修饰键 `mod+键` 给全局动作**（`B` 左栏、`O` 右栏、`K` 工作区、`I` 近期对话、
  `M` 模型、`N` 新建会话、`J` 焦点跳转、`\` 文件浏览器、`L` 终端、`,` 关标签、`/` 速查表）；
  **`mod+alt` 留给导航**（`←`/`→` 右栏标签、`↑`/`↓` 活跃会话）。
- 审批与问答的 `Enter`/`Esc`/数字键/方向键是**固定分发的单键**，不参与 `bindings` 自定义。
- 活跃会话 = 正在运行（`running`）∪ 有待处理交互 ∪ 刚完成未查看（`uiSession.sessionStatus` 的 `completionUnread`）。
- `⌘/Ctrl+Alt+↑`/`↓` 在**活跃会话之间**沿侧栏顺序循环：跳过非活跃会话，走到可见轴尽头
  **回绕**到另一端；锚点（当前会话）**不作落点**，故除当前会话外没有活跃会话时 no-op 不吞键。
- `Esc` 双职责：有审批卡片时拒绝并吞键；否则只停止运行中的会话树，**不吞键**。
- **`⌘/Ctrl+,`（关标签）恒吞键**：该键位完全归插件——没有当前标签、上游拒关独占停靠的引导页、
  右栏 / store 链路整条不可用时都只 no-op，仍照常 `preventDefault`，浏览器不会因它执行
  「打开设置」等默认行为。其余动作仍遵循「no-op 不吞键」。

## 动作触发路径（服务 / DOM）

动作全部走**服务面**；DOM 只有三处：`document` 捕获阶段 `keydown`（快捷键入口）、
`editing` 态的事件目标判定（`isEditableTarget` / `isComposerTarget` 的 `contains`）、
插件自建自管的浮层。两处**元素级**操作：`composer.focus` 用服务链路给出的元素
（`shell.editor.getRootElement()`，零选择器查询）；`sidebarRight.terminal` 按 store 给出的
`paneId` 做**唯一一处选择器查询**（`[data-dockkit-pane="<paneId>"]` 内的
`textarea.xterm-helper-textarea`）。

| 动作 | 服务接口 / 取数 |
| --- | --- |
| `approval.allow` / `approval.reject` | `uiSession.pendingInteractions.getSnapshot()`（私有字段 `pendingSnapshot` 仅作兼容回退）→ `PendingApproval.answer('allowed-once' \| 'rejected')` |
| `question.*`（通用问答） | 卡片自己的 Session 级 slot store（`dsh-client-ui-user-questions` 的 `createQuestionDraftStore`，挂在 `conversation.composer` 注册项）：数字键 = 上游 `choose()` 的选中语义（**去掉自动翻题**）；`←`/`→` = pager `nav.prev`/`nav.next`（`replaceProgress(index ± 1, drafts)`，不循环）；`Enter` = `continueFlow()` 推进，末题仅在全部题目完成后 `answer({answers:[…]})`。取数：`slots.entries('conversation.composer')` → 会话作用域绑定（`src/scope-binding.ts`）→ `slots.resolveStore`；任一环不可用即 no-op（无降级） |
| `question.*`（计划评审） | 同一待处理表的 `PendingQuestion`；`1` = 确认、`2` = 拒绝、`3` = 去聊天里说、`Enter` = 确认。标签取自 `questions[0].intent.approve`，与卡片按钮顺序无关 |
| `card` 态判定 | 当前会话是否命中 `uiSession.pendingInteractions` 快照（无 DOM 查询） |
| `sidebar.toggle` | `layout.toggleSidebar()`（宽屏在默认宽与 0 间切换，窄屏翻转 `narrowExpanded`） |
| `sidebarRight.toggle` | `sidebarRight.toggleExpanded()`（与右栏头部折叠按钮同一入口；右侧 seat 自行同步 AppFrame 轨道） |
| `sidebarRight.tabPrev` / `tabNext` | 右栏会话级 slot store：`slots.entries('rightbar.session')` → 会话作用域绑定（`src/scope-binding.ts`）→ `slots.resolveStore` → `bySession[sid].layout` 的 `activePaneId` 面板 `tabs`/`activeTabId`；切换调 `sidebarRight.focus(tabId)`。**只在当前面板内循环**，单标签 / 无面板 no-op 不吞键 |
| `sidebarRight.closeTab` | 与切标签同源取当前面板当前标签，调 `sidebarRight.close(tabId)`；调完回读同一活实例确认标签已从 `layout.tabs` 消失，仍在（上游拒关 / 服务面在别的会话）即只 no-op——**吞键与动作结果无关**（见下） |
| `sidebarRight.files` | `sidebarRight.openTab('files')`（按目标面板去重：已有则聚焦、没有则创建；`openContent` 恒先展开右栏）；再经同一 store 的 `actions.placeTab(sessionId, tabId, paneId, 0)` 置顶（与标签拖拽同一入口，**不用** `replaceTab`）；已在首位不调用 |
| `sidebarRight.terminal` | 终端是 `multiple: true` 页、上游每次 `openTab` 铸带 UUID 的 `contentId`、**不按 (kind, contentId) 去重**，故认页由插件读 store 完成（`record.kind === 'terminal'` 或 `sidebar://terminal[/…]` 地址；当前面板优先，再扫其余**停靠**面板，浮窗不参与）。**已有** → `sidebarRight.focus(tabId)`；`layout.expanded === false` 时补 `toggleExpanded()`；若该终端本来就是所在面板的当前标签且右栏已展开，再按 `paneId` 做元素级聚焦。**没有** → `openTab('terminal')` 新建（上游自动聚焦）。**不重排、不置顶** |
| `composer.focus` | 当前会话（`uiSession.current`）→ `sessions.binding(id).ctx` → `conversation.input.for(actx)`（缺席回退 `InputHub.shell(id)`）→ `shell.editor.getRootElement()` → `focus({preventScroll:true})`。`editing` 态另有 `contains` 门闸：焦点已在 composer 内则不重复聚焦但**仍吞键** |
| `session.new` | `uiWorkspace.startSession()`（无参）；不触碰 composer 草稿 |
| `session.prev` / `next` | `sessions.list` 快照 + `sidebar.workspaces` 注册项的侧栏视图 store（顺序，root 作用域传 `undefined`）；锚点 = 当前会话（`uiSession.current`），跳转调 `uiWorkspace.openSession(id)`（`sessions.open` 自 0.1.6-alpha.2 起已删除）。顺序**逐条复刻上游 0.1.7-alpha.1 渲染序**（含置顶前置、归档沉底、归档筛选、fork 紧随其源、blank 顶前）；从锚点沿方向扫**其他**会话（锚点自身不作落点），跳过非活跃、到轴尽头**回绕**（循环一圈无其他活跃会话 / 锚点不在可见轴即 no-op）；顺序读不到**不跳转**（无降级） |
| `session.recent` | 插件自建浮窗。列表 = `sessions.list` 快照 + `workspaces.list` 快照分组 + `src/session-order.ts`；`Enter`/点击调 `uiWorkspace.openSession(sessionId)`（必须以**方法**形式调用；无回退，`sessions.open` 已删除）。**归档会话不列出**（恒按 `default` 口径取数，不跟随侧栏 `archivedFilter`）；`openRecentSession` 仍先查归档集合做防御（命中即 `return false`、不调 `openSession`，与上游 `guardedOpen` 同款门闸） |
| `workspace.pick` | 插件自建浮窗。列表 = `workspaces.list` 快照 + `sessions.list` 快照派生（按组内可见会话最新的 `updatedAt` 降序取前 10，当前工作区强制保留；见 `src/workspace-switcher.ts`）；`Enter`/点击调 `uiWorkspace.openWorkspace(workspaceId)`（= 侧栏分组「＋」的连接工作区路径） |
| `model.pick` | 插件自建浮窗。`ctx.modelDirectories.directoryFor(当前会话)`（与 `/model` 弹层、composer 模型座位**同一份** per-session 目录）→ `load()` → `store.getSnapshot().groups` 按宿主顺序展开；提交调 `directory.select(selection)`，每行选择复刻上游 `selectionOf` |
| `model.effortNext` | 同一目录实例上循环：候选档复刻上游 `effortChoices`（`[Default（仅当模型无 defaultEffort）] + reasoning.efforts`），当前档 = `current.reasoningEffort ?? reasoning.defaultEffort`；`select` 只改强度 |
| `session.stop` | 当前会话（`uiSession.current`）→ `sessions.binding(id).session.cancel()`；直系子代理（**仅 `origin === 'subagent'`，fork 不算**）由 `sessions.list` 快照的**两源并集**枚举（`byId` 里 `origin === 'subagent'` 的行 ∪ `projectionsBySession[parent].values.subagentCatalog`，0.1.7-alpha.1 起取代已删除的 `subagentsByParent`）；one-shot 跳过 |
| `help.toggle` | 插件自建纯 DOM 速查表 |

浮层（`src/overlay.ts`，纯 DOM）：速查表 / 工作区 / 近期对话 / 模型同一时刻只有一个，
互切直接换面板；打开时按键进入**模态分发**（浮层未处理的按键一律吞掉）。

- **面板恒不透明**：官方 `--dsw-specific-menu` 本体带 alpha（`#f8f9fa94` / `#30313680`，
  约 50–58%），且官方一律配 `backdrop-filter: var(--dsw-menu-backdrop-filter)`（40px 磨砂）
  使用；本插件不引磨砂，直接铺会透出背后的遮罩。故面板底色写成
  `background-color: var(--dsw-alias-bg-base)` + `background-image: linear-gradient(<菜单 token> ×2)`
  的叠加：合成结果不透明，色值与「今天所见的磨砂面」基本相同（浅色 ≈ `#fbfcfc`、
  深色 ≈ `#222327`）。回归断言在 `test-services.mjs`（「面板底色不透明」）。

服务注入：`['sessions', 'uiSession', 'layout', 'sidebarRight', 'workspaces', 'slots',
'conversation', 'uiWorkspace', 'modelDirectories']`（全部判空后才消费）。

## 近期对话浮窗的列表规则（`src/recent-sessions.ts`）

- **分组** = `workspaces.list` 快照的宿主顺序；无归属会话落末尾**无标题组**（`workspaces`
  缺席时全部落入该组）。
- **组内顺序** = `updatedAt` 降序、id 升序决胜（即使侧栏切到手动排序）。
- **可见性** = 复刻上游 `sessionVisible` 的 **`default` 口径**（排除子代理、归档、非当前空白行），
  **再加**：连**当前空白会话**也裁掉（本插件唯一的产品偏离）。归档会话**恒不列出**，
  不跟随侧栏 `archivedFilter`：本浮窗的动作只有「打开」，而归档会话一律打不开，
  列出它们只会得到「关窗、无导航、无提示」的死行；取消归档后自然回到列表。
- **条数上限 = 最近交互的 10 个（全局口径）**：先按最近更新取前 10、再按工作区分组，故
  某个工作区可能整组不出现（不留空标题）。当前会话**强制纳入**（不在前 10 时顶掉第 10 名）。
  面板带 `dsh-kbd-panel--recent`，`max-height` 由 `64vh` 抬到 `calc(88vh - 24px)`。
- **初始高亮** = 当前会话所在行；当前会话本身**不列出**（新建空白会话、归档等被可见性裁掉）
  时落**同工作区**的第一行（归属复刻上游 `owningGroupKey`：没有任何工作区登记即无归属组，
  也按同组处理）；该工作区整组未上榜 / 无当前会话才退回首行。
- **打开**：`openRecentSession` 先查归档集合，命中即返回 false、不调 `uiWorkspace.openSession`
  （与上游 `guardedOpen` 同款门闸）。因列表已恒不列出归档行，该分支只在「行已列出后被归档」
  的竞态下触发，属防御性约束。

## 工作区浮窗的列表规则（`src/workspace-switcher.ts`）

- **活跃度** = 该工作区组内可见会话里最新的 `updatedAt`；无可见会话（或 `sessions.list`
  不可读）为 `-Infinity`，沉底但仍按宿主顺序列出。
- **可见性** = 与近期对话同判据（`sessionVisible(..., keepBlank=false)` 且跟随侧栏 `archivedFilter`）：
  排除子代理、归档（按筛选）、空白会话；会话成员取自 `workspaces.list` 各项的 `sessionIds`。
- **顺序** = 活跃度降序，同活跃度保持宿主顺序（确定性）。
- **条数上限 = 10（全局口径）**：先按活跃度取前 10，当前会话所属工作区不在榜内时
  **强制保留**（顶掉第 10 名、排在第 10 行），与近期对话强制纳入当前会话同口径；
  总工作区数 ≤ 10 时全部列出，只是按活跃度重排。
- **初始高亮** = 当前会话所属工作区所在行（无归属 / 无当前会话时落首行）。
- 只列已登记的 `workspaces.list` 工作区，未分组桶不在其中；行上的 `N 个会话` 仍是该
  工作区登记的会话总数（含被可见性裁掉的会话）。

## 上游 API 依赖（0.1.7-alpha.1）

`session.stop`（Esc）与所有「按当前会话取数」的动作共用 `src/session-view.ts`：

- **当前会话** = `uiSession.current.getSnapshot().key`（视图层选择，0.1.6-alpha.2 起由
  `dsh-client-ui-session` 承载）；源不可读时回退 `sessions.list` 快照里
  `retainedBy.mainView > 0` 的那一行（与上游 `publishMain` 同判据）。
- **完成未读** = `uiSession.sessionStatus.getSnapshot().get(id).completionUnread`。
- **会话作用域绑定**（解析会话级 slot store 时传给 `slots.resolveStore`）= `src/scope-binding.ts`：
  `uiSession.bindingSource({ sessionId, binding: sessions.binding(sessionId) })` 的
  `getSnapshot()`（0.1.6-alpha.2 起 `uiSession.resolve(sessionId)` 已删除；上游只校验
  `reference.binding` 与 `sessions.binding(sessionId)` 同一，缺席投影的 `key` 为 undefined）。
  这一环缺失时所有会话级 store 取数（问答草稿、右栏标签 / 终端认页）整条 no-op/退化。
- **直系子代理枚举**（`session.stop`）= `src/actions.ts` 的 `childIdsByParent`，并集两源：
  ① `sessions.list` 快照 `byId` 里 **`origin === 'subagent'`** 且 `parentId === 父` 的行
  （`dsh-api-session-controller` 在投影循环与 scopes 循环里都会给子代理行补
  `parentId` + `origin: 'subagent'`，故这条同步可读）；
  ② `projectionsBySession[父].values.subagentCatalog`（投影已加载时的权威名册）。
  两源并集去重；任一源不可读只按另一源走，皆不可读则退化为「只停当前会话」。
  **`origin` 判据不可省**：fork 经 `parentSession` 共享 lineage 字段但**不写 `origin`**
  （`dsh-session` 的 `fork()` / `dsh-api-session-controller` 的 fork 路径都只写
  `parentSession` + `isSeeded`），它是独立会话，与上游 `runningDescendants`
  （`dsh-subagent`，用于 `workspace/session-stop`）同一判据；只按 `parentId` 建边会把
  运行中的 fork 当子树取消（0.1.6-alpha.2 走子代理目录、fork 不可达，故属迁移引入的行为回归）。
- **侧栏渲染序**（`session.prev`/`next`，`src/sidebar-order.ts`）= 上游 workspace 浏览器
  0.1.7-alpha.1 管线：成员集（workspace 分组取 `sessionIds`，无归属与 flat 取全量）→
  `orderBy === 'manual'` 走 `reconcileManualOrder`（存档序 → 置顶前置 → 普通按最近更新 →
  归档沉底 → 新 fork 紧随其源），否则按最近更新 → `pinCurrentBlank` →
  可见性（`archivedFilter`）→ `sectionMembers`（blank → 置顶 → 其余）。所需的
  `pinnedSessionIds` / `archivedSessionIds` 取自 `workspaces.list` 快照，
  `archivedFilter` 取自视图 store（`dsh.workspace.view.v5`）。
  **缺摘要成员（`byId[id] === undefined`）不参与定序**（存档序里已有的仍保留原位），
  与上游 `orderByRecency` 的丢弃语义一致：否则该成员留在结果里会让 `placeFork` 的
  `result.includes(parentId)` 误判为真，把一个可见 fork 重定位（可观察的顺序偏离）。
- 已删除、不得再引用：快照字段 `current` / `currentAddress` / `summary.completed`，
  **0.1.7-alpha.1 起另删** `sessions.list` 快照字段 `subagentsByParent` / `jobsBySession`
  与服务方法 `setSubagentCatalogOpen()` / `refreshSubagents()`（改由 `projectionsBySession`
  与 `refreshProjections()` 承载）；服务方法 `sessions.open()` / `openSubagent()` /
  `clear()` / `uiSession.resolve()`。

## 自定义键位

`localStorage["dsh-kbd-hotkeys:v1"]`（JSON），与默认表**浅合并**，改完刷新页面生效：

```json
{ "bindings": { "sidebar.toggle": "mod+alt+s", "session.next": "mod+alt+j" } }
```

- 动作 id 见 `src/config.ts` 的 `DEFAULT_BINDINGS`；未注册的 id 会被忽略。除固定分发动作外
  各自独立可覆盖。
- 固定分发动作（`approval.*` / `question.option|prev|next|submit`，见 `FIXED_KEYS`）不可
  自定义，`loadConfig` 会剔除同名键位。
- 组合键写法：`mod` + `alt` + `shift` + 键名（字母 / 数字 / `enter` / `escape` / `tab` /
  `arrow*` / `pageup` / `pagedown` / `;` 等），如 `"Cmd+M"`。配置其他字段一律忽略。

## 已知限制

- **浏览器保留键**：`⌘/Ctrl+O`（打开文件）、`⌘/Ctrl+K`（地址栏搜索）、Win/Linux `Ctrl+J`
  （下载页）、`⌘/Ctrl+L`（地址栏）、`⌘/Ctrl+M`（部分系统）由插件在捕获阶段
  `preventDefault` 后接管；**焦点不在本页面时**浏览器仍按默认处理。`⌘/Ctrl+N`
  （新建窗口）最硬：多数浏览器**不把该键派发给页面**，Win/Linux 可能始终打开新窗口
  （macOS `⌃N` 通常可用）。不生效时用 `localStorage` 改绑。
- **`⌘/Ctrl+Alt+↑`/`↓` 可能被系统级快捷键抢占**：部分 Windows 机器上 `Ctrl+Alt+方向键` 是
  显卡驱动（Intel 屏幕旋转）的热键，在操作系统层就被消费、页面收不到 `keydown`，插件的
  `preventDefault` 无从生效。完全没反应时先关掉该驱动热键，或在 `localStorage` 里改绑
  （如 `{"bindings":{"session.prev":"mod+alt+pageup","session.next":"mod+alt+pagedown"}}`）。
- **`⌘/Ctrl+,` 在 macOS 上可能被菜单截获**：`⌘,` 是 Chrome / Safari 的「设置 / 偏好设置」
  菜单键，与 `⌘N` 同理（菜单键先由菜单系统消费，可能不派发给页面；页面收不到 `keydown`
  时插件的 `preventDefault` 无从生效）；`⌃,` 通常可用（`mod` 兼收 `ctrlKey`）。被截获时用
  `localStorage` 改绑。
- **`⌘/Ctrl+L` 与终端清屏同键**：焦点在右栏终端时 `Ctrl+L` 被插件抢走，清屏可用
  shell 的 `clear`。
- **`⌘/Ctrl+I` 抢走 contenteditable 的斜体**；**`⌘/Ctrl+J` 抢走终端的 `⌃J`**（= LF，
  与 `Enter` 同义，换行请按 `Enter`）。
- **`mod` 同时吸收 ctrlKey 与 metaKey**：macOS 上 `⌃X` 与 `⌘X` 等价（所有 `mod+` 动作）。
- **审批卡片抢占输入框**：当前会话有审批卡片时，焦点在输入框里 `Enter` 也是「允许一次」、
  `Esc` 也是「拒绝」。
- **问答卡片焦点在自定义输入框时不接管**（交回卡片，`←`/`→` 用于移动光标）；数字键选中后
  **不翻题**，`←`/`→` 不循环，末题仅在全部题目完成后结算（未完成即 no-op 且不跳回）。
  计划评审请求未提供「拒绝」选项时 `2` 为空操作。
- **`composer.focus` 依赖 composer 已渲染**：目标会话输入框未挂载（空白 / hero 会话、
  composer 被 block）时 `getRootElement()` 为 `null`，动作 no-op 不吞键。
- **右栏动作依赖右栏已挂载且该会话开过面板**：`rightbar.session` 注册项、会话级 store、
  `bySession[sessionId]` 任一缺失即 no-op 不吞键（可先按 `⌘/Ctrl+O` 展开一次）。
  标签切换只覆盖**当前面板**，单标签不吞键；**关闭标签（`⌘/Ctrl+,`）是唯一例外**：上述
  任一环缺失、独占停靠的引导页被上游拒关、面板内没有当前标签，都照样吞键。
- **文件浏览器置顶只作用于它所在的停靠面板**（优先当前面板）；上游「页唯一性按面板」，
  跨面板可能各有一份；极窄窗口下右栏会被上游再折叠回去。
- **终端定位不重排、不置顶**；多个终端时优先当前激活的那个，没有当前激活的落第一个（面板内
  以标签顺序、跨面板以当前面板优先），浮窗里的终端不参与认页。若 slots / 会话作用域绑定
  （`uiSession.bindingSource` + `sessions.binding`）整条链路不可用则无从判重，退化为每次按键
  `openTab('terminal')` 新建一个（与直接调上游一致）；已有终端而 `focus` 面缺失 / 抛错只
  no-op，绝不重复开。
- **工作区浮窗的「切换」= 连接工作区**：`uiWorkspace.openWorkspace` 复用该工作区已挂载的
  空白会话、没有就新建（与侧栏分组「＋」一致），不保证打开上一次的对话；列表只含已登记的
  工作区（活跃度前 10，当前工作区强制保留），未分组桶与榜单外的工作区不在其中，需要时用侧栏。
- **模型浮窗只对普通会话可用**（`subagentAddress(id) === undefined`）；目录是宿主代数的
  共享目录，只列已公告的模型、不显示模型描述（上游 `/model` 有本地化描述）。
  `⇧Tab` 只在候选档中**向前**循环，且 `editing` 态只在焦点位于 composer 内时接管。
- 浮窗 `↑`/`↓` 越界 clamp、不循环；空态时 `Enter` 不消费（由浮层模态吞掉）。
- **归档会话在近期对话浮窗里恒不列出**（有意偏离侧栏 `show` / `only` 口径）：`⌘/Ctrl+I`
  只用于「打开」，而归档会话在被上游 `guardedOpen` 同款门闸拒绝后只会表现为
  「浮窗关闭、不发生导航、无提示」，且行结构（`RecentSessionRowLike`）没有归档标记字段，
  留着就是无标记的死行。**要先在侧栏对该会话「取消归档」才能打开**（取消后自动回到列表）。
  `openRecentSession` 仍保留归档检查，覆盖「行已列出后被归档」的竞态。工作区浮窗
  （`⌘/Ctrl+K`）不受影响，其活跃度仍跟随侧栏筛选。
- **工作区浮窗的活跃度口径跟随归档筛选**：`only` 下「活跃度」只由归档会话的 `updatedAt`
  决定（`default` 不算归档、`show` 两者都算），这是 0.1.7-alpha.1 起侧栏带筛选后的新语义；
  行内 `sessionCount` 仍是宿主全量条数、不随筛选收缩（纯展示字段，不参与排序与切换）。

## 构建与验证

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → lib/client.js（入仓，禁手改）
npm run check       # node --check 产物与宿主
```

诊断脚本（纯 Node，无需浏览器）；桩按 **0.1.7-alpha.1 契约**装配
（当前会话只经 `uiSession.current` 提供、快照里没有 `current`、`sessions` 没有 `open`，
完成未读只经 `uiSession.sessionStatus`，会话作用域绑定只经
`uiSession.bindingSource(reference)`——桩复刻上游「`reference.binding` 与
`sessions.binding(sessionId)` 同一才物化」的校验，退化用例显式声明该面缺席；
子代理名册只经 `byId` 的 `origin === 'subagent'` + `parentId` 与 `projectionsBySession`，
快照里**没有** `subagentsByParent`；`origin` 缺席而 `parentId` 有值的行是 fork，桩必须保留
这一区分）：

- `node test-services.mjs` — 服务级动作路径：审批 / 问答 / 计划评审与 `card` 态判定（问答
  断言落在卡片草稿 store 上）；两个侧栏开关；右栏标签切换 / 关闭当前标签 / 文件浏览器定位
  与置顶 / 终端定位（含认页不重复 `openTab`、多个终端时聚焦当前激活的那个、没有当前激活即
  落第一个、折叠补 `toggleExpanded`、元素级聚焦注入假面板）；新建会话（必须调
  `uiWorkspace.startSession`）、聚焦输入框（J = Jump 的三态与门闸）、会话跳转（Esc 停止会话树）；
  工作区（活跃度排序 / 前 10 / 当前工作区保留）/ 近期对话 / 模型三个浮窗的列表顺序、分页上限、
  确认路径与空态；`⇧Tab` 候选档与编辑态门闸；各动作的无降级边界。
- `node test-order.mjs` — 0.1.7 契约与顺序面（纯 Node Type Stripping 直载 `src/*.ts`，无需构建）：
  `stopCurrentSessionTree` 的子代理枚举（`origin === 'subagent'` 行 × 投影名册并集、隔代递归、
  one-shot 跳过、两源去重、**fork 不递归取消**、来源缺失的降级、锚点不可读 no-op）；
  `sessionRowVisible` 的 `archivedFilter` 三分支；
  `reconcileOrder`（存档序 / 置顶前置 / 归档沉底 / fork 紧随其源 / **缺摘要成员剔除**）；
  `sectionMembers` 分区；
  `sidebarOrderedSessionIds` 端到端（workspace|flat × default|show|only × updated|manual）；
  `recentSessionsView` 恒不列出归档行（default|show|only 三档一致）与 `openRecentSession` 的归档拒绝。
- `node test-dispatch.mjs` — 会话跳转分发：按侧栏顺序（分组 / flat / 权威来源不可用时
  no-op、`uiSession.current` 缺席时回退 `retainedBy.mainView`）、**循环回绕**（首 / 末行两端、
  跳过非活跃会话、锚点自身不作落点、除当前会话外无活跃会话即 no-op 不吞键）与两个侧栏开关的
  键位、态闸门。

## 加载（用户操作）

```sh
cd <仓库根>/dsh-kbd-hotkeys
dsh plugin --profile web add link:.
# 首次挂载（组合变更）需重启 App 生效
```

卸载：`dsh plugin --profile web remove dsh-kbd-hotkeys`。挂载后只改浏览器半部时，
`npm run build` 后由 client-hmr（500ms 轮询）自动推给已打开的页面，无需重启 / 刷新；
宿主半部 `index.ts`（空宿主）改动仍需重启。
