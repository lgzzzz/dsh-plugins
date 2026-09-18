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
| `⌘/Ctrl+.` | 右栏关闭当前面板的**当前标签**（上游拒关独占停靠的引导页时不吞键） | 任意 |
| `⌘/Ctrl+\` | 右栏定位文件浏览器：打开 / 聚焦该页并置顶（同时展开右栏） | 任意 |
| `⌘/Ctrl+L` | 右栏定位终端：已有则聚焦并把 DOM 焦点移进 xterm，没有才新建；**不重排** | 任意 |
| `⌘/Ctrl+J` | 聚焦对话输入框（J = Jump）；`editing` 时需焦点**不在** composer 内 | `browse` / `editing` |
| `⌘/Ctrl+N` | 新建会话并跳转（`uiWorkspace.startSession()`，同侧栏「新建会话」按钮） | 任意 |
| `⌘/Ctrl+Alt+↑` / `↓` | 上一个 / 下一个**活跃会话**（沿侧栏顺序） | 任意 |
| `⌘/Ctrl+K` | 工作区浮窗：最近活跃的 10 个工作区（`↑`/`↓` 选择、`Enter` 切换、`Esc` 关闭） | 任意 |
| `⌘/Ctrl+I` | 近期对话浮窗：最近交互的 10 个会话、按工作区分组（`↑`/`↓` 跨组、`Enter` 打开） | 任意 |
| `⌘/Ctrl+M` | 模型浮窗（`↑`/`↓` 选择、`Enter` 切换、`⇧Tab` 调强度、`Esc` 关闭） | 任意 |
| `⇧Tab` | 循环切换当前模型的思考强度（无强度档 / 只有一档 / 目录不可用即 no-op 不吞键） | `browse` / `editing`（`editing` 需焦点在 composer 内） |

- 「任意」= 三态均允许。带修饰键的组合与卡片占用的**裸** `←`/`→`/数字键不冲突，故右栏
  与浮窗类动作在 `card` 态照常生效。
- 分档：**单修饰键 `mod+键` 给全局动作**（`B` 左栏、`O` 右栏、`K` 工作区、`I` 近期对话、
  `M` 模型、`N` 新建会话、`J` 焦点跳转、`\` 文件浏览器、`L` 终端、`.` 关标签、`/` 速查表）；
  **`mod+alt` 留给导航**（`←`/`→` 右栏标签、`↑`/`↓` 活跃会话）。
- 审批与问答的 `Enter`/`Esc`/数字键/方向键是**固定分发的单键**，不参与 `bindings` 自定义。
- 活跃会话 = 正在运行（`running`）∪ 有待处理交互 ∪ 刚完成未查看（`uiSession.sessionStatus` 的 `completionUnread`）。
- `Esc` 双职责：有审批卡片时拒绝并吞键；否则只停止运行中的会话树，**不吞键**。

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
| `question.*`（通用问答） | 卡片自己的 Session 级 slot store（`dsh-client-ui-user-questions` 的 `createQuestionDraftStore`，挂在 `conversation.composer` 注册项）：数字键 = 上游 `choose()` 的选中语义（**去掉自动翻题**）；`←`/`→` = pager `nav.prev`/`nav.next`（`replaceProgress(index ± 1, drafts)`，不循环）；`Enter` = `continueFlow()` 推进，末题仅在全部题目完成后 `answer({answers:[…]})`。取数：`slots.entries('conversation.composer')` → `uiSession.resolve(sessionId)` → `slots.resolveStore`；任一环不可用即 no-op（无降级） |
| `question.*`（计划评审） | 同一待处理表的 `PendingQuestion`；`1` = 确认、`2` = 拒绝、`3` = 去聊天里说、`Enter` = 确认。标签取自 `questions[0].intent.approve`，与卡片按钮顺序无关 |
| `card` 态判定 | 当前会话是否命中 `uiSession.pendingInteractions` 快照（无 DOM 查询） |
| `sidebar.toggle` | `layout.toggleSidebar()`（宽屏在默认宽与 0 间切换，窄屏翻转 `narrowExpanded`） |
| `sidebarRight.toggle` | `sidebarRight.toggleExpanded()`（与右栏头部折叠按钮同一入口；右侧 seat 自行同步 AppFrame 轨道） |
| `sidebarRight.tabPrev` / `tabNext` | 右栏会话级 slot store：`slots.entries('rightbar.session')` → `uiSession.resolve(sessionId)` → `slots.resolveStore` → `bySession[sid].layout` 的 `activePaneId` 面板 `tabs`/`activeTabId`；切换调 `sidebarRight.focus(tabId)`。**只在当前面板内循环**，单标签 / 无面板 no-op 不吞键 |
| `sidebarRight.closeTab` | 与切标签同源取当前面板当前标签，调 `sidebarRight.close(tabId)`；调完回读同一活实例确认标签已从 `layout.tabs` 消失，仍在（上游拒关 / 服务面在别的会话）即 no-op 不吞键 |
| `sidebarRight.files` | `sidebarRight.openTab('files')`（按目标面板去重：已有则聚焦、没有则创建；`openContent` 恒先展开右栏）；再经同一 store 的 `actions.placeTab(sessionId, tabId, paneId, 0)` 置顶（与标签拖拽同一入口，**不用** `replaceTab`）；已在首位不调用 |
| `sidebarRight.terminal` | 终端是 `multiple: true` 页、上游每次 `openTab` 铸带 UUID 的 `contentId`、**不按 (kind, contentId) 去重**，故认页由插件读 store 完成（`record.kind === 'terminal'` 或 `sidebar://terminal[/…]` 地址；当前面板优先，再扫其余**停靠**面板，浮窗不参与）。**已有** → `sidebarRight.focus(tabId)`；`layout.expanded === false` 时补 `toggleExpanded()`；若该终端本来就是所在面板的当前标签且右栏已展开，再按 `paneId` 做元素级聚焦。**没有** → `openTab('terminal')` 新建（上游自动聚焦）。**不重排、不置顶** |
| `composer.focus` | 当前会话（`uiSession.current`）→ `sessions.binding(id).ctx` → `conversation.input.for(actx)`（缺席回退 `InputHub.shell(id)`）→ `shell.editor.getRootElement()` → `focus({preventScroll:true})`。`editing` 态另有 `contains` 门闸：焦点已在 composer 内则不重复聚焦但**仍吞键** |
| `session.new` | `uiWorkspace.startSession()`（无参）；不触碰 composer 草稿 |
| `session.prev` / `next` | `sessions.list` 快照 + `sidebar.workspaces` 注册项的侧栏视图 store（顺序，root 作用域传 `undefined`）；锚点 = 当前会话（`uiSession.current`），跳转调 `uiWorkspace.openSession(id)`（`sessions.open` 自 0.1.6-alpha.2 起已删除）。锚点不在可见轴 / 方向尽头无活跃会话即 no-op；顺序读不到**不跳转**（无降级） |
| `session.recent` | 插件自建浮窗。列表 = `sessions.list` 快照 + `workspaces.list` 快照分组 + `src/session-order.ts`；`Enter`/点击调 `uiWorkspace.openSession(sessionId)`（必须以**方法**形式调用；无回退，`sessions.open` 已删除） |
| `workspace.pick` | 插件自建浮窗。列表 = `workspaces.list` 快照 + `sessions.list` 快照派生（按组内可见会话最新的 `updatedAt` 降序取前 10，当前工作区强制保留；见 `src/workspace-switcher.ts`）；`Enter`/点击调 `uiWorkspace.openWorkspace(workspaceId)`（= 侧栏分组「＋」的连接工作区路径） |
| `model.pick` | 插件自建浮窗。`ctx.modelDirectories.directoryFor(当前会话)`（与 `/model` 弹层、composer 模型座位**同一份** per-session 目录）→ `load()` → `store.getSnapshot().groups` 按宿主顺序展开；提交调 `directory.select(selection)`，每行选择复刻上游 `selectionOf` |
| `model.effortNext` | 同一目录实例上循环：候选档复刻上游 `effortChoices`（`[Default（仅当模型无 defaultEffort）] + reasoning.efforts`），当前档 = `current.reasoningEffort ?? reasoning.defaultEffort`；`select` 只改强度 |
| `session.stop` | 当前会话（`uiSession.current`）→ `sessions.binding(id).session.cancel()`（递归直系 `kind==='child'` 子代理；one-shot 跳过） |
| `help.toggle` | 插件自建纯 DOM 速查表 |

浮层（`src/overlay.ts`，纯 DOM）：速查表 / 工作区 / 近期对话 / 模型同一时刻只有一个，
互切直接换面板；打开时按键进入**模态分发**（浮层未处理的按键一律吞掉）。

服务注入：`['sessions', 'uiSession', 'layout', 'sidebarRight', 'workspaces', 'slots',
'conversation', 'uiWorkspace', 'modelDirectories']`（全部判空后才消费）。

## 近期对话浮窗的列表规则（`src/recent-sessions.ts`）

- **分组** = `workspaces.list` 快照的宿主顺序；无归属会话落末尾**无标题组**（`workspaces`
  缺席时全部落入该组）。
- **组内顺序** = `updatedAt` 降序、id 升序决胜（即使侧栏切到手动排序）。
- **可见性** = 复刻上游 `sessionVisible`（排除子代理、归档、非当前空白行），**再加**：
  连**当前空白会话**也裁掉（本插件唯一的产品偏离）。
- **条数上限 = 最近交互的 10 个（全局口径）**：先按最近更新取前 10、再按工作区分组，故
  某个工作区可能整组不出现（不留空标题）。当前会话**强制纳入**（不在前 10 时顶掉第 10 名）。
  面板带 `dsh-kbd-panel--recent`，`max-height` 由 `64vh` 抬到 `calc(88vh - 24px)`。
- **初始高亮** = 当前会话所在行（当前是空白 / 被过滤 / 无当前会话时落首行）。

## 工作区浮窗的列表规则（`src/workspace-switcher.ts`）

- **活跃度** = 该工作区组内可见会话里最新的 `updatedAt`；无可见会话（或 `sessions.list`
  不可读）为 `-Infinity`，沉底但仍按宿主顺序列出。
- **可见性** = 与近期对话同判据（`sessionVisible(..., keepBlank=false)`）：排除子代理、
  归档、空白会话；会话成员取自 `workspaces.list` 各项的 `sessionIds`。
- **顺序** = 活跃度降序，同活跃度保持宿主顺序（确定性）。
- **条数上限 = 10（全局口径）**：先按活跃度取前 10，当前会话所属工作区不在榜内时
  **强制保留**（顶掉第 10 名、排在第 10 行），与近期对话强制纳入当前会话同口径；
  总工作区数 ≤ 10 时全部列出，只是按活跃度重排。
- **初始高亮** = 当前会话所属工作区所在行（无归属 / 无当前会话时落首行）。
- 只列已登记的 `workspaces.list` 工作区，未分组桶不在其中；行上的 `N 个会话` 仍是该
  工作区登记的会话总数（含被可见性裁掉的会话）。

## 上游 API 依赖（0.1.6-alpha.2）

`session.stop`（Esc）与所有「按当前会话取数」的动作共用 `src/session-view.ts`：

- **当前会话** = `uiSession.current.getSnapshot().key`（视图层选择，0.1.6-alpha.2 起由
  `dsh-client-ui-session` 承载）；源不可读时回退 `sessions.list` 快照里
  `retainedBy.mainView > 0` 的那一行（与上游 `publishMain` 同判据）。
- **完成未读** = `uiSession.sessionStatus.getSnapshot().get(id).completionUnread`。
- 已删除、不得再引用：快照字段 `current` / `currentAddress` / `summary.completed`，
  服务方法 `sessions.open()` / `openSubagent()` / `clear()`。

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
  标签切换 / 关闭只覆盖**当前面板**，单标签与「独占停靠的引导页」均不吞键。
- **文件浏览器置顶只作用于它所在的停靠面板**（优先当前面板）；上游「页唯一性按面板」，
  跨面板可能各有一份；极窄窗口下右栏会被上游再折叠回去。
- **终端定位不重排、不置顶**；浮窗里的终端不参与认页。若 slots / 作用域绑定整条链路
  不可用则无从判重，退化为每次按键 `openTab('terminal')` 新建一个（与直接调上游一致）；
  已有终端而 `focus` 面缺失 / 抛错只 no-op，绝不重复开。
- **工作区浮窗的「切换」= 连接工作区**：`uiWorkspace.openWorkspace` 复用该工作区已挂载的
  空白会话、没有就新建（与侧栏分组「＋」一致），不保证打开上一次的对话；列表只含已登记的
  工作区（活跃度前 10，当前工作区强制保留），未分组桶与榜单外的工作区不在其中，需要时用侧栏。
- **模型浮窗只对普通会话可用**（`subagentAddress(id) === undefined`）；目录是宿主代数的
  共享目录，只列已公告的模型、不显示模型描述（上游 `/model` 有本地化描述）。
  `⇧Tab` 只在候选档中**向前**循环，且 `editing` 态只在焦点位于 composer 内时接管。
- 浮窗 `↑`/`↓` 越界 clamp、不循环；空态时 `Enter` 不消费（由浮层模态吞掉）。

## 构建与验证

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → lib/client.js（入仓，禁手改）
npm run check       # node --check 产物与宿主
```

诊断脚本（纯 Node + 最小 DOM 桩，无需浏览器）；桩按 **0.1.6-alpha.2 契约**装配
（当前会话只经 `uiSession.current` 提供、快照里没有 `current`、`sessions` 没有 `open`，
完成未读只经 `uiSession.sessionStatus`）：

- `node test-services.mjs` — 服务级动作路径：审批 / 问答 / 计划评审与 `card` 态判定（问答
  断言落在卡片草稿 store 上）；两个侧栏开关；右栏标签切换 / 关闭当前标签 / 文件浏览器定位
  与置顶 / 终端定位（含认页不重复 `openTab`、折叠补 `toggleExpanded`、元素级聚焦注入假
  面板）；新建会话（必须调 `uiWorkspace.startSession`）、聚焦输入框（J = Jump 的三态与
  门闸）、会话跳转（Esc 停止会话树）；工作区（活跃度排序 / 前 10 / 当前工作区保留）/ 近期对话 /
  模型三个浮窗的列表顺序、分页上限、确认路径与空态；`⇧Tab` 候选档与编辑态门闸；各动作的无降级边界。
- `node test-dispatch.mjs` — 会话跳转分发：按侧栏顺序（分组 / flat / 权威来源不可用时
  no-op、`uiSession.current` 缺席时回退 `retainedBy.mainView`）与两个侧栏开关的键位、
  态闸门。

## 加载（用户操作）

```sh
cd <仓库根>/dsh-kbd-hotkeys
dsh plugin --profile web add link:.
# 首次挂载（组合变更）需重启 App 生效
```

卸载：`dsh plugin --profile web remove dsh-kbd-hotkeys`。挂载后只改浏览器半部时，
`npm run build` 后由 client-hmr（500ms 轮询）自动推给已打开的页面，无需重启 / 刷新；
宿主半部 `index.ts`（空宿主）改动仍需重启。
