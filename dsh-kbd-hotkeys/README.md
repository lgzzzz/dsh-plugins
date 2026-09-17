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
| `⌘/Ctrl+B` | 开关**左**侧栏（走 `layout.toggleSidebar`） | `browse` / `editing` |
| `⌘/Ctrl+O` | 开关**右**侧栏（`sidebarRight.toggleExpanded`，与右栏头部折叠按钮同一入口） | `browse` / `editing` |
| `⌘/Ctrl+Alt+←` / `→` | **右侧栏**当前面板的标签：上一个 / 下一个（循环；只有一个标签时不吞键） | 任意 |
| `⌘/Ctrl+.` | **右侧栏**关闭当前面板的**当前标签**（`sidebarRight.close(tabId)`；上游拒关「独占停靠的引导页」时不吞键） | 任意 |
| `⌘/Ctrl+\` | **右侧栏**定位文件浏览器：打开（不存在时创建）/ 聚焦该页并置顶（`openTab('files')`，同时展开右栏） | 任意 |
| `⌘/Ctrl+L` | **右侧栏**定位终端：已有终端页就聚焦它并**把 DOM 焦点移进 xterm**（折叠时顺带展开右栏），没有才新建（`openTab('terminal')`）；**不重排** | 任意 |
| `⌘/Ctrl+J` | 聚焦对话**输入框**（「焦点跳转」，J = Jump：走 `conversation.input` 取 composer 的 editor 宿主元素后 `focus()`） | `browse` / `editing`（`editing` 时需焦点**不在** composer 内） |
| `⌘/Ctrl+N` | **新建会话并跳转**（调公开的 `uiWorkspace.startSession()`，与侧栏「新建会话」按钮同一条服务调用） | 任意 |
| `⌘/Ctrl+Alt+↑` / `↓` | 上一个 / 下一个**活跃会话** | 任意 |
| `⌘/Ctrl+K` | 打开**工作区浮窗**（浮窗内 `↑`/`↓` 选择、`Enter` 切换、`Esc` 关闭） | 任意 |
| `⌘/Ctrl+I` | 打开**近期对话浮窗**：最近交互的 **10 个**会话、按工作区分组，初始光标落在当前会话（浮窗内 `↑`/`↓` 跨组选择、`Enter` 打开会话、`Esc` 关闭） | 任意 |
| `⌘/Ctrl+M` | 打开**模型浮窗**：选择本会话使用的模型（浮窗内 `↑`/`↓` 选择、`Enter` 切换、`⇧Tab` 调思考强度、`Esc` 关闭） | 任意 |
| `⇧Tab` | 循环切换当前模型的**思考强度**（模型无强度档 / 只有一档 / 目录不可用时 no-op 且不吞键） | `browse` / `editing`（`editing` 时需焦点在 composer 内） |

> 「任意」= 三态均允许（动作 `states` 为 `['card','editing','browse']`）。
> 两个侧栏开关为 `['browse','editing']`：输入框聚焦时同样生效（带修饰键的组合不干扰
> 文本编辑，符合 `editing` 态「只保留带修饰键的全局组合」的规则）；聚焦输入框同为
> `['browse','editing']`，但 `editing` 态另有一道元素级门闸（见下条）；右栏标签切换、
> 文件浏览器定位、终端定位、新建会话、工作区浮窗与模型浮窗都是**任意态**（含 `card`）——卡片
> 占用的是**裸** `←` / `→` / 数字键，与带修饰键的组合键不冲突。
> **聚焦输入框放行 `browse` 与 `editing`**：`editing` 态另有一道**元素级**门闸——
> 「焦点在可编辑元素里」并不等于「焦点在 composer 里」。右侧栏**终端**（xterm 的隐藏
> `.xterm-helper-textarea`）与 **Monaco**（`.inputarea` textarea）都把 DOM 焦点放在一个
> 真实的 `<textarea>` 上，`isEditableTarget` 只看 tagName，于是焦点在那里时同样被判成
> `editing`；而此时的意图恰恰是「跳回对话输入框」。因此 `editing` 态只在焦点**不在**
> composer 自己的编辑区内时接管（判据 = 对服务链路取来的宿主元素做一次 `contains`，
> 与 `⇧Tab` 的门闸**同一取元素链路、方向相反**），焦点已在 composer 内时放行不吞键。
> 卡片态不放行：卡片自己的输入框归卡片管。键位是 `⌘/Ctrl+J`，属单修饰键这一档
> （`J` = **Jump**，焦点跳转；取代旧的 `⌘/Ctrl+I`）。`editing` 态下焦点已在 composer 内时
> 不重复聚焦，但该组合键**仍被吞掉**：旧键位 `I` 在那一位放行是为了保住 contenteditable
> 的「斜体」默认行为（`execCommand`，绕过 Lexical 直接改 DOM），`J` 在 composer 里没有
> 等价的默认行为，放行只会让 Win/Linux 浏览器的 `Ctrl+J`（打开下载页）跑出来。
> `mod` 在 `comboOf` 里同时吸收 `ctrlKey` 与 `metaKey`，所以 macOS 上
> **⌃J 与 ⌘J 都能触发**，Win/Linux 就是 `Ctrl+J`（其浏览器保留键问题见「已知限制」）。
> 代价是终端里的 `⌃J`（= `0x0A`，LF；readline 的 newline，与 `Enter` 同义）不再送给
> shell，要换行请按 `Enter`。
>
> **键位分两档**：**单修饰键 `mod+键` 给全局动作**（`B` 左栏、`O` 右栏、`K` 工作区、
> `I` 近期对话、`M` 模型、`N` 新建会话、`J` 焦点跳转、`\` 文件浏览器、`L` 终端、
> `/` 速查表），**`mod+alt`
> 这一档留给导航**（`←`/`→` 右栏标签、`↑`/`↓` 活跃会话）。
>
> **新建会话为什么是 `⌘/Ctrl+N`**：`N`（New）是跨应用肌肉记忆（浏览器、编辑器、
> 终端的新建都是它），语义就是侧栏的「新建会话」按钮——调公开的
> `uiWorkspace.startSession()`（同一服务、同一无参形态：继承当前 / 最近的工作区，
> 创建或复用其空白会话并打开）。三态放行：
> 新建会话与当前会话是否有待回应卡片、焦点是否在输入框都无关，带修饰键的组合也
> 既不占用卡片的**裸**数字 / `←` / `→` / `Enter`，也不干扰文本编辑。
> 浏览器把 `⌘/Ctrl+N` 当作「新建窗口」保留键，见下文「已知限制」。
>
> **为什么左栏是 `⌘/Ctrl+B`、右栏是 `⌘/Ctrl+O`**：
> ① `⌘/Ctrl+B` 开关侧栏是跨应用肌肉记忆（VS Code / Slack / 各类编辑器一致），把
> 「已经被训练过的反射」留给最基础的左栏（导航主面板，也对应上游不带限定词的
> `sidebar` / `sidebarCol` → `layout.toggleSidebar()`）；
> ② 右栏取 `O`（**Open panel**——打开/开合右栏面板；上游叫 `rightbar`——
> `rightbarShown` / `rightbarTrack`），与左栏的 `B` **同档不同键**：两者都是
> 「`mod+字母`」的等长组合，不再有「谁要多按一个修饰键」的层级差；
> ③ 右栏的方向键（`mod+alt+←/→`）留给**右栏内部**的标签轴、`mod+alt+↑/↓` 留给
> **左栏**的会话轴，`O` 只做开关、不占任何轴。
> 两个动作 id 各自独立，互换只改 `src/config.ts` 的两行 `DEFAULT_BINDINGS`，或用
> `localStorage` 覆盖单个动作的键位（见「自定义键位」）。
>
> **右栏标签切换为什么是 `⌘/Ctrl+Alt+←` / `→`**：方向键天然表达「上一个 / 下一个」，
> 与 `⌘/Ctrl+Alt+↑/↓`（**活跃会话**跳转）同族但不同轴——会话轴在左栏、标签轴在右栏，
> 左右配对，所以这一对留在 `mod+alt` 档（也是右栏唯一还用 `alt` 的动作）。
> 右栏标签**循环**：末个按 `→` 回到第一个、首个按 `←` 到最后一个
> （标签条 chip 点击是任意跳，热键是「轮到下一个」，循环才闭合滚动语义）；
> 面板只有一个标签时**不循环回自身**——no-op 且不吞键，把按键交回页面，
> 避免「按了没反应还吃掉按键」。三态均生效（含 `card`）：卡片打开时同样能切右栏标签，
> 因为卡片占用的是**裸** `←` / `→`，带 `mod+alt` 的组合键与它不冲突，本动作无需让路。
>
> **关闭右栏当前标签为什么是 `⌘/Ctrl+.`**：句点键 `.` 在多数应用里就是「取消 / 关闭」
> 的联想键（macOS 的 `⌘.` 即「取消」），且它落在**单修饰键**这一档、不与右栏标签轴
> （`mod+alt+←/→`）抢位。语义 =「关掉**当前面板的当前标签**」：读取与标签切换**同源**的
> 会话级 slot store 布局（`bySession[sessionId].layout` 的 `activePaneId` → `activeTabId`），
> 再调公开的 `sidebarRight.close(tabId)`——与标签 chip 上的关闭按钮、标签菜单里的
> 「关闭」**同一入口**（上游会跑该页类型注册的关闭钩子，并拒关「**独占停靠**的引导页」）。
> 关完立即**回读同一份活实例**确认该标签真的从布局里消失：没消失（上游拒关 / 调用落到
> 了别的会话面）就当作 no-op、**不吞键**，所以插件不必自己复制上游那套「能不能关」的
> 判定。三态均生效：`mod+.` 与卡片的裸键、与文本编辑都不冲突。
>
> **定位右栏文件浏览器为什么是 `⌘/Ctrl+\`**：与右栏开关同属单修饰键这一档，
> 反斜杠在主键区右端、不与 `mod+alt` 那一档的方向键抢位。语义是「打开 + 归位」而不是
> 「开关」：**该面板还没有文件浏览器页就创建它，已经开着就只是聚焦并归位**（幂等），
> 所以不需要一个 toggle 键位。上游公开面只提供 `openTab(kind)`（落位是目标面板**末尾**），
> **没有**「插到第 N 位」的落位参数，因此置顶走的是**标签拖拽的同一入口**——会话级 slot
> store 实例上的 `actions.placeTab(sessionId, tabId, paneId, 0)`；**绝不使用 `replaceTab`**
> （那会 `closeTab` 掉被顶掉的那个 tab，可能丢掉编辑器的未保存修改）。三态均生效：
> `mod+` 与卡片的裸键、与文本编辑都不冲突。
> 已知限制：浏览器把 `⌘/Ctrl+O`（打开本地文件）与 `⌘/Ctrl+K`（地址栏搜索）当作保留键，
> 详见下文「已知限制」中的快捷键冲突；极窄窗口下上游会把「挤不下」的右栏
> 再折叠回去（与右栏头部展开按钮同一条路）。
>
> **定位右栏终端为什么是 `⌘/Ctrl+L`**：与右栏开关（`O`）、文件浏览器定位（`\`）同属
> 单修饰键这一档，`L` 取「（Termina）**L**」联想，且 `mod` 在 `comboOf` 里同时吸收
> `ctrlKey` 与 `metaKey`，所以 macOS 上 **⌃L 与 ⌘L 都能触发**、Win/Linux 就是 `Ctrl+L`。
> 语义与文件浏览器**同形但少一步**：**已有终端页就只聚焦它（必要时展开右栏）、并把
> DOM 焦点移进终端，没有才新建**，重复按不会堆积终端；唯一差异是**不做置顶**——终端页是
> `multiple: true` 的页类型（`dsh-client-ui-sidebar-terminal` 注册 `kind: 'terminal'` +
> `multiple: true`），用户可能同时开着好几个，热键不替用户决定标签顺序。
> 这里**不能**像文件浏览器那样直接 `openTab(kind)` 了事：上游对 `multiple` 页给**每次**
> 打开都铸一个带随机 UUID 的 `contentId`（`sidebar://terminal/<uuid>`），`planOpenContent`
> 因此**不按 (kind, contentId) 去重**——直接调 `openTab('terminal')` 会**每按一次多开一个
> 终端**。所以「认页」由插件自己读会话级 slot store 的布局完成（`record.kind ===
> 'terminal'`；记录字段与上游 `pageKind` 同源），已有就调公开的 `sidebarRight.focus(tabId)`
> （`focus` 只改激活标签、**不动**展开态，所以折叠时补一步公开的 `toggleExpanded()`；
> `expanded` 读不到时**不动**展开态，不做「猜状态再 toggle」这种可能把开着的右栏关掉的事），
> 没有才调公开的 `openTab('terminal')` 新建（那一步上游 `openContent` 恒先
> `planSetExpanded(true)`）。删除/关闭终端仍是上游自己的事，本插件只负责「定位」。
>
> **为什么还要自己聚焦终端内容**：上游 `focus(tabId)` 只聚焦「标签」（把 store 里的激活
> 标签改成它），**不**把 DOM 焦点移进终端；终端内容的聚焦由 `dsh-client-ui-sidebar-terminal`
> 的 TerminalBody 自己完成，而那个 effect 的依赖是 `[visible, state.writable]`——**终端页
> 本来就在右栏显示着**（标签已是当前标签、右栏已展开）时依赖不变、effect 不重跑，于是按
> `⌘/Ctrl+L` 时焦点还留在原处（典型：对话输入框），这正是本插件补这一步的原因：终端
> **已经是所在面板的当前标签**时，再按 store 这笔布局给出的 `paneId` 找
> `[data-dockkit-pane="<paneId>"]`，聚焦其内容里的 xterm 隐藏输入框
> `textarea.xterm-helper-textarea`（xterm 的 `Terminal.focus()` 就是聚焦它；`.xterm` 自身
> 没有 tabindex）。取元素是**有界**的：只用布局给的 `paneId`——不遍历标签、不搜索全文档、
> 不合成事件、不点击；面板里同一时刻只渲染**激活标签**的 body，所以命中的必然是这笔布局
> 的那个终端。标签原本不是当前标签（或右栏由折叠被展开）时 `visible` 会翻转、上游自己就会
> 聚焦，本插件**不代劳**（避免与上游抢焦点）。任何一环缺失（找不到面板元素 / 面板里还没有
> xterm）都只是少这一步——标签聚焦已经发生，按键照旧被吞掉。
>
> 三态均生效：`mod+` 与卡片的裸键、与文本编辑都不冲突。
> 已知限制：`⌘/Ctrl+L` 是浏览器「聚焦地址栏」的保留键（Win/Linux 的 `Ctrl+L` 尤甚），
> 且终端里 `Ctrl+L` 原本是 shell 的清屏（readline `clear-screen`），都会被本插件抢走，
> 详见下文「已知限制」。
>
> **工作区浮窗为什么是 `⌘/Ctrl+K`**：属单修饰键这一档，`K` 取「工作区（Work-space）」
> 联想（`mod+alt` 那档只留方向键轴）。语义是「**列表 → 选中 → 切换**」三步：
> 打开后 `↑`/`↓` **只移动高亮**（不触发导航，避免每按一次就连接一个工作区），
> `Enter`（或鼠标点行）才调 `uiWorkspace.openWorkspace(workspaceId)`——
> 也就是侧栏工作区分组上「＋」新建会话走的**同一条**「连接工作区」路径：
> 复用该工作区已有的空白会话，没有就新建一个再打开（详见「已知限制」）；
> `Esc` 关闭，再按一次 `⌘/Ctrl+K` 也关闭（开关语义），浮窗内按 `⌘/Ctrl+/`
> 直接换成速查表。列表取自 `workspaces.list` 快照的**宿主顺序**（与侧栏分组顺序同源，
> 不重排），初始高亮 = 当前会话所属工作区，该行带「当前」标记。
> 三态均生效：带修饰键的组合与卡片的裸键、与文本编辑都不冲突。
>
> **近期对话浮窗为什么是 `⌘/Ctrl+I`**：属单修饰键这一档，`I` 取「（**I**nput / 会话）」
> 联想，与 `⌘/Ctrl+K`（工作区）、`⌘/Ctrl+M`（模型）并列；`mod` 在 `comboOf` 里同时吸收
> `ctrlKey` 与 `metaKey`，所以 macOS 上 **⌃I 与 ⌘I 都能触发**，Win/Linux 就是 `Ctrl+I`
> （这个键曾短暂是「聚焦输入框」，现已改绑到 `⌘/Ctrl+J`，见上）。语义是
> 「**列表 → 选中 → 打开**」，与工作区浮窗同形但落点是**会话**：
> 打开后 `↑`/`↓` **只移动高亮**（跨工作区分组连续移动，不打开会话——避免连按就连开
> 一串），`Enter`（或鼠标点行）才调公开的 `uiWorkspace.openSession(sessionId)`——与侧栏
> 点会话行、搜索结果行是**同一条**上游调用（`sessions.open` **加** `layout.selectPanel(null)`，
> 所以即使此刻有一个全局主面板占着主区、按 Enter 也会切回对话视图）；`uiWorkspace`
> 缺席 / 无 `openSession` 时回退 `sessions.open`。`Esc` 关闭，再按一次 `⌘/Ctrl+I` 也关闭
> （开关语义），浮窗内按 `⌘/Ctrl+/` 直接换成速查表。
> 列表规则（见 `src/recent-sessions.ts`，每次打开现取）：
> ① **分组** = `workspaces.list` 快照的**宿主顺序**（与侧栏工作区分组同源），
> 不属于任何工作区的会话落在末尾的**无标题组**；`workspaces` 服务缺席 / 快照缺 `items`
> 时全部会话落入该组（仍是可用列表，**不假装没有会话**）；
> ② **组内顺序** = **最近更新在前**（`updatedAt` 降序，id 升序决胜）——即
> `orderBy === 'updated'` 的默认轴（上游切回 `updated` 时会清空本地手动顺序账号，
> 所以这就是默认顺序）；
> ③ **可见性** = 逐字复刻上游 `sessionVisible` 的行规则（排除子代理行 `origin ===
> 'subagent'`、归档行、非当前空白行），**再加一条本插件的产品选择：连当前空白会话也
> 一并裁掉**——空白会话是「新会话」的占位行、不是对话，列进「近期对话」只会得到一个
> 空壳落点（侧栏顺序仍按上游语义保留当前空白行）；
> ④ **行** = 会话 `displayTitle`（上游投影：durable 标题 → 目录末段 → 会话 id，恒非空；
> 缺失时再回退 `title` / 会话 id）+ 状态标记（**待回应** → **运行中** → **完成**，
> 与侧栏的绿色「完成」提醒同源）；
> ⑤ **条数上限 = 最近交互的 10 个（全局口径）**：先把**全部**可见会话按最近更新排序、
> 取前 10 个，**再**按工作区分组渲染——所以列表恒不超过 10 行（工作区一多也不会撑爆
> 浮窗，某个工作区可能因此整组不出现，且不留空标题）。这是「全局 10 个」而不是
> 「每个工作区各 10 个」；当前会话除此之外还有一条**强制纳入**规则：它若不在前 10 名
> （例如刚切回一个很久没动的旧会话），就顶掉第 10 名，保证它一定在列表里、初始光标
> 一定落在它上面（空白 / 归档 / 子代理会话不参与该规则，它们本就不列入）；
> 与此配套，浮窗面板的高度上限由 `64vh` 抬到 `calc(88vh - 24px)`（仅近期对话浮窗带
> `dsh-kbd-panel--recent` 修饰类），10 行整屏看全、不出现内部滚动条；
> ⑥ **初始高亮** = 当前会话所在行（当前是空白会话、或被过滤掉、或无 `current` 时落在首行）。
> `sessions` 服务缺席 / 快照缺 `ids` → 空态浮窗（提示「当前没有可打开的对话」）；
> `open` 缺失或抛错 → 确认时 no-op、浮窗照关。**任何一环都不回退 DOM 查询。**
> 三态均生效：带修饰键的组合与卡片的裸键、与文本编辑都不冲突。
> 已知限制：`Ctrl+I` 是 contenteditable 里浏览器默认的「斜体」键
> （`execCommand('italic')`），会被本插件 `preventDefault` 抢走（详见「已知限制」）；
> 需要斜体请用编辑器自带的格式入口。
>
> **模型浮窗为什么是 `⌘/Ctrl+M`**：与工作区浮窗同在单修饰键这一档，
> `M` 取「模型（Model）」联想，与 `⌘/Ctrl+K` 并列。语义与工作区浮窗
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
> `⌘/Ctrl+\` 绑定的是**停靠面板**里的文件浏览器页（不存在则创建、已存在则聚焦并
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

**DOM 约定**：除 `document` 捕获阶段的 `keydown` 监听（全部快捷键的入口）、`editing`
态的事件目标判定（`isEditableTarget` / `isComposerTarget` 的 `contains`）、以及插件自建
自管的浮层（速查表 / 工作区 / 近期对话 / 模型）之外，动作一律走上游**服务面**。两处
**元素级**操作
是例外，且都只对「上游服务或 store 已经指明的那一个元素」动手：`⌘/Ctrl+J` 的 composer
聚焦（元素来自服务链路 `conversation.input.for(...).shell.editor.getRootElement()`，
**零选择器查询**），以及 `⌘/Ctrl+L` 的终端聚焦（**唯一一处选择器查询**——按 store 给出的
`paneId` 在 dockkit 面板里找 xterm 的隐藏输入框，见下文终端定位那一节；不遍历标签、
不搜索全文档、不合成事件、不点击）。

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
- 右栏开关（`⌘/Ctrl+O` → `sidebarRight.toggleExpanded()`）：与右栏头部的折叠按钮
  （`[data-sidebar-right-toggle]`）**同一入口**——反转**当前会话**右栏面板的展开态。
  展开态是 `dsh-client-ui-sidebar-right` 的会话级 store 状态：右侧 seat 重渲染后由
  自己的 `useLayoutEffect` 调 `layout.openRightbar(track, fullscreen)` /
  `closeRightbar()`，把 AppFrame 的右栏轨道同步过来（见该包 `lib/client.js` 的
  `RightbarSeat → syncPresentation`），故**一次服务调用即完成「面板 + 轨道」的开合**，
  插件无需自己调右栏那两个 layout 方法。
  控制器在无挂载会话面（空白/hero 会话、右栏插件缺席）时 `require()` 抛错，插件兜住
  → **no-op 且不吞键**（无降级：不碰 DOM 里那个折叠按钮）。
- 右栏标签切换（`⌘/Ctrl+Alt+←` / `→` → `sidebarRight.focus(tabId)`，见
  `src/sidebar-tabs.ts`）：上游右栏的公开面只有 `active()`（当前标签）、
  `focus(tabId)`（聚焦某标签）与 `close(tabId)`（关某标签），**没有** next/prev 动词、
  也无法枚举标签；标签顺序只
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
- 关闭右栏当前标签（`⌘/Ctrl+.` → `src/sidebar-tabs.ts` 的 `closeRightSidebarTab`）：
  取数与切标签**同源**（同一份会话级 slot store 的 `bySession[sessionId].layout`），
  当前标签 = `layout.nodes[layout.activePaneId].activeTabId`（**当前面板**的**当前标签**，
  且必须真在该面板的 `tabs` 里；失配即无当前标签）。关闭走公开的
  `sidebarRight.close(tabId)`——与标签 chip 的关闭按钮、标签菜单「关闭」
  （seat 的 `closeTab`）**同一入口**，上游会先跑该页类型注册的关闭钩子
  （`registerCloseHandler`，失败即保留标签），并自动拒关「**独占停靠**的引导页」
  （`canCloseTab` + `soleDockedTab`：关掉它右栏会整体收起，上游不让）。
  插件**不复制**这套可行性判定，而是**关完回读同一份活实例**、确认该标签已从
  `layout.tabs` 消失：消失才算处理（吞键），没消失（上游拒关、或服务面在别的会话上）
  就返回 no-op 且**不吞键**；回读失败（`getSnapshot` 缺失 / 抛错）按「仍在」处理，
  宁可放行也不吃掉按键。上游 store 的动作是同步提交（`defineStore` → `setState`），
  所以这里的回读看到的就是这次调用的结果。**无降级**：`sidebarRight` 缺席、无 `close`
  动词、取数三步任一环不可用、当前标签缺失、`close` 抛错（无挂载会话面）一律 no-op
  且不吞键，不碰 DOM（DOM 里根本没有可点的关闭按钮——插件只用 store 与公开服务面）。
- 定位右栏文件浏览器（`⌘/Ctrl+\` → `src/sidebar-tabs.ts` 的
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
- 定位右栏终端（`⌘/Ctrl+L` → `src/sidebar-tabs.ts` 的 `revealRightSidebarTerminal`）：
  与文件浏览器定位**同一条取数链路**（会话级 slot store 的
  `bySession[sessionId].layout`），但**认页更宽、动作更少**——先认页再决定要不要打开。
  ① **认页**：终端是 `multiple: true` 的页类型（`dsh-client-ui-sidebar-terminal`：
  `ctx.sidebarRightTabs.register({ kind: 'terminal', multiple: true, … })`），上游
  `placeTab` 对 `multiple` 页写 `contentId = sidebar://terminal/<随机 UUID>`，于是
  `planOpenContent` **不会**按 (kind, contentId) 去重（这正是 `pageKind` 对
  `multiple` 页返回 `undefined` 的原因）。所以这里自己判记录：`record.kind === 'terminal'`
  或记录地址是终端页地址（`sidebar://terminal` / `sidebar://terminal/<uuid>` 前缀）。
  扫描顺序与文件浏览器一致：**当前面板**（`layout.activePaneId`）优先、再按布局键顺序扫
  其余**停靠**面板，浮窗（`host === 'float'`）不参与；面板内**优先当前激活**的那个终端，
  否则取面板里的第一个。
  ② **已有 → 只聚焦 + 元素级聚焦**：调公开的 `sidebarRight.focus(held.tabId)`（与标签
  chip 点击同一入口；`tabId` 就是布局记录里的键，上游 `focus` 按它查表）。`focus`
  **不动展开态**，所以 store 里 `layout.expanded === false` 时再调一次公开的
  `toggleExpanded()`（与右栏头部折叠按钮同一入口，seat 会据此同步 AppFrame 的右栏轨道）；
  `expanded` 既不是 `true` 也不是 `false`（读不到）时**不动**——宁可少做一步，也不做
  「猜状态再 toggle」这种可能把开着的右栏关掉的事。**不置顶、不重排**：终端是
  `multiple` 页，可能开着多个，热键不替用户决定顺序（这与文件浏览器那一步刻意不同）。
  随后，如果这笔布局里的终端**已经是所在面板的当前标签、且右栏此刻已展开**
  （`held.current && layout.expanded !== false`；该判据在 `toggleExpanded` 之前取，
  因为那一步会翻转展开态），再补一次
  **元素级聚焦** `focusTerminalScreen(held.paneId)`：上游 `focus(tabId)` 只聚焦「标签」，
  终端内容的 DOM 焦点由 TerminalBody 自己的 effect（依赖 `[visible, state.writable]`）
  完成，而「终端本来就显示着」时该依赖不变、effect 不重跑，焦点仍会留在原处（典型：
  对话输入框）——这正是本动作要修的场景。取元素是**有界**的：按 store 给出的 `paneId`
  找 `[data-dockkit-pane="<paneId>"]`（dockkit 把面板节点 id 原样写在属性上），再取面板
  内容里的 `textarea.xterm-helper-textarea` 并 `focus({ preventScroll: true })`；面板里
  同一时刻只渲染**激活标签**的 body，所以命中的必然是这笔布局的那个终端；不遍历标签、
  不搜索全文档、不合成事件、不点击、不读文本。标签原本不是当前标签（或右栏由上面的
  `toggleExpanded` 从折叠翻成展开）时 `visible` 会翻转、上游自己就会聚焦，插件**不代劳**。
  聚焦失败（找不到面板元素 / 面板里还没有 xterm / `focus` 抛错）只是少这一步，不影响
  返回值（标签聚焦已经发生、按键照旧被吞掉）。这是本插件唯一一处选择器查询（见
  「实现要点」开头的 DOM 约定）。
  ③ **没有 → 新建**：调公开的 `openTab('terminal')`，落到当前停靠面板末尾；上游
  `openContent` 恒先 `planSetExpanded(true)`，故一次调用即「展开右栏 + 新建」，
  插件不必也不该再调 `toggleExpanded()`（那会把本来开着的右栏关掉）。新建这一条不自己
  聚焦：xterm 随新终端 body 一起挂载、`visible` 由 `false` 翻成 `true`，上游的自动聚焦
  effect 会跑（起初 `writable` 还是 `false` 时，等它翻成 `true` 会再跑一次）。
  **无降级**：`openTab` 抛错（无挂载会话面 / `terminal` 类型未注册）→ no-op 且
  **不吞键**；`focus` 抛错（无挂载会话面）→ no-op 不吞键，且**不**退化成再开一个终端；
  已有终端而 `focus` 面缺失 → 同样 no-op 不吞键（宁可不动，也不重复开终端）。
  唯一「读不到就多做」的例外是 slots / 会话作用域绑定整条链路不可用：此时无从判重，
  退化为按 `openTab('terminal')` 新建（与上游 `openTab` 同一行为，见「已知限制」）。
- 工作区浮窗（`⌘/Ctrl+K` → `src/workspace-switcher.ts` + `src/overlay.ts`）：
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
  `Esc` 或再按一次同组合键关闭；同一时刻只有一个浮层（`help` | `workspace` | `recent`
  | `model`），互切直接换面板；浮层打开时按键进入**模态分发**（未处理的按键一律吞掉，
  避免误触页面快捷键）。列表**每次打开时重新取数**（工作区增删、当前工作区变化即时反映）。
  **无降级**：`workspaces` 服务缺席 / 快照缺 `items` → 空态浮窗（Enter 不切换）；
  `uiWorkspace` 缺席或 `openWorkspace` 抛错（未知 workspaceId / 无挂载会话面）→
  确认时 no-op，**不回退**到 DOM 点击侧栏分组。
- 近期对话浮窗（`⌘/Ctrl+I` → `src/recent-sessions.ts` + `src/overlay.ts`）：与工作区
  浮窗同形（列表 → 选中 → 确认），但列表是**按工作区分组的会话**、确认是**打开会话**。
  ① **分组**：`workspaces.list` 快照的**宿主顺序**逐组渲染（与侧栏工作区分组同源），
  组内成员来自该工作区的 `sessionIds`；不属于任何工作区的会话落在末尾的**无标题组**
  （渲染端省略标题行）。`workspaces` 服务缺席 / 快照缺 `items` 时全部会话落入该组——
  仍是可用的列表，**不假装没有会话**。
  ② **组内顺序** = `updatedAt` 降序、id 升序决胜（`compareRecency`，逐字复刻上游
  `orderByRecency`）。这就是 `orderBy === 'updated'` 的默认轴：上游在切回 `updated`
  时会清空本地手动顺序账号，所以默认态下与侧栏组内顺序一致；用户切到 `manual`
  手动排序后本浮窗仍按最近更新排（它回答的是「近期对话」，不是「侧栏第几行」）。
  ③ **可见性** = `src/session-order.ts` 的 `sessionRowVisible`（逐字复刻上游
  `sessionVisible` 的行规则：排除 `origin === 'subagent'`、归档行、非当前空白行），
  **再加一条本插件的产品选择**（`sessionVisible(..., keepBlank = false)`）：连**当前**
  空白会话也一并裁掉——空白会话是「新会话」的占位行、不是对话，列进来只会得到一个
  空壳落点。侧栏顺序（`sidebar-order.ts`）不传 `keepBlank`，仍按上游语义保留当前
  空白行，故两个动作互不影响。
  ④ **行** = 会话 `displayTitle`（上游投影：durable 标题 → 目录末段 → 会话 id，恒非空；
  缺失时再回退 `title` / 会话 id）+ 状态标记（**待回应** → **运行中** → **完成**，
  三选一，无标记时留空）+ `当前` 标记（当前会话）；次行 = 会话 `cwd`（与主标签相同
  时省略）。
  ⑤ **条数上限** = **最近交互的 10 个**（全局口径）：全部可见会话先按 `updatedAt` 降序
  取前 10 个，**再**按工作区分组渲染，故列表恒不超过 10 行、某个工作区可能整组不出现
  （不留空标题）。当前会话还有一条**强制纳入**：它不在前 10 名时顶掉第 10 名，保证
  它一定在列表里（否则 `initialIndex` 会悄悄退回首行，「光标落在当前会话」落空）；
  空白 / 归档 / 子代理会话不占名额（它们本就不列入）。**高度**：面板带
  `dsh-kbd-panel--recent` 修饰类，`max-height` 从其它浮窗的 `64vh` 抬到
  `calc(88vh - 24px)`（backdrop 顶部留白 `12vh`，底部再留 `24px`）；面板高度本身仍是
  **内容尺寸**，所以 10 行 + 组标题 + 页眉/页脚在常见窗口下**无需滚动即可整屏看全**，
  只有内容真的超过视口可用高度时列表才内部滚动；其余三个浮窗（速查表 / 工作区 / 模型）
  仍用 `64vh`。
  ⑥ **浮窗交互**：`↑`/`↓` 在**整份列表**上**跨工作区分组**连续移动高亮（越界 clamp，
  不循环，**不打开会话**——避免连按就连开一串），`Enter` / 行内 `mousedown` 才调公开的
  `uiWorkspace.openSession(sessionId)`（先关浮窗再打开；上游这一条 = `sessions.open` +
  `layout.selectPanel(null)`，故与侧栏点会话行完全一致，有全局主面板打开时也会切回
  对话视图）；`uiWorkspace` 缺席 / 无 `openSession` 时回退同一份服务实例上的
  `sessions.open`。两个动词都必须以**方法**形式调用（它们是上游类实例的原型方法，
  摘下来会丢 `this` 抛错）。`Esc` 或再按一次 `⌘/Ctrl+I` 关闭，
  浮窗内 `⌘/Ctrl+/` 直接换成速查表。初始高亮 = 当前会话所在行（当前是空白会话 / 无
  `current` / 当前会话被过滤掉时落在首行）。
  **无降级**：`sessions` 服务缺席 / 快照缺 `ids` → 空态浮窗（提示「当前没有可打开的
  对话」，Enter 不消费、由模态吞掉）；`open` 缺失或抛错（未知 id）→ 确认时 no-op、
  浮窗照关。**不回退**到 DOM 点击侧栏会话行。
- 模型浮窗（`⌘/Ctrl+M`）与思考强度循环（`⇧Tab`，`src/model-picker.ts` +
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
  浮层（`help` | `workspace` | `recent` | `model`），互切直接换面板；列表是**异步**取的
  （先绘制「正在加载模型目录…」），落地时用**渲染序号守卫**丢弃过期结果
  （浮窗已关闭 / 已换成别的浮层的那次渲染作废）。
  **无降级**：`modelDirectories` 服务缺席 / 无当前会话 / 当前会话是被寻址的子代理
  （上游 `available` 的判据 `sessions.subagentAddress(id) === undefined`）/
  `directoryFor` 抛错（未知会话、无挂载会话面）→ 浮窗显示空态、`⇧Tab` no-op 且
  **不吞键**；`load()` 拒绝 → 浮窗照常打开、底部小字给出原因；`select()` 拒绝 →
  浮窗照常关闭（失败详情落在目录 store 上，与两个上游入口共用同一份错误态）。
  全程不碰 DOM 取模型数据、**不回退**到点击 composer 的模型标签。
- 聚焦输入框（`⌘/Ctrl+J`，J = Jump 焦点跳转）：**上游没有可触发的「聚焦 composer」服务面**——`conversation`
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
  态门闸在 `src/client.ts`：`browse` 态恒可用；`editing` 态用同一份
  `composerRoot` 做一次 `contains` 判定（`isComposerTarget`，与 `⇧Tab` 的门闸同一个
  函数、方向相反）——焦点**不在** composer 内时执行聚焦（右栏终端 / Monaco / 设置面板
  输入框），焦点已在 composer 内时不重复聚焦，但仍吞掉该组合键（不放行给浏览器）。
  > **为什么不能只调 `editor.focus()`**：lexical 0.49 的 `LexicalEditor.focus()`
  > 只做「克隆选区置 dirty + 打 `FOCUS_TAG` + 注册回调」，**没有** DOM 聚焦调用；
  > 真正的 `rootElement.focus()` 在选区调和器里，且只在「当前 DOM 选区已等于目标
  > 选区」的分支中执行——DOM 选区落在 composer 之外时（刚在正文里点选过文本）
  > 它不会把键盘焦点移回输入框。所以取宿主元素后直接 `focus()` 才是可靠原语。
- 新建会话（`⌘/Ctrl+N` → `src/actions.ts` 的 `startNewSession`）：一次服务调用，
  `uiWorkspace.startSession()`（无参）；侧栏「新建会话」按钮走的是**同一个**方法的
  `startSession(workspaceId)` 形态。所以本动作没有另造一套「新建空白会话」逻辑，也不触碰
  composer 草稿（不像「把命令写进输入框再提交」那样会冲掉用户已输入的内容）。
  **无降级**：`uiWorkspace` 服务缺席 / 无 `startSession` / 抛错（无挂载会话面）
  一律 no-op 且**不吞键**，**不回退**到 DOM 点击侧栏按钮。
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
- **聚焦输入框的可编辑目标分两类**：`editing` 态只在焦点**不在** composer 内时执行聚焦
  （`browse` 态恒可用）。于是焦点在右侧栏**终端** / **Monaco** / 设置面板输入框里时，
  `⌘/Ctrl+J` 能把焦点拉回对话输入框；而焦点已在 composer 自己的编辑区里时不重复聚焦
  （该动作无事可做），但组合键仍被吞掉。从旧键位 `I` 改到 `J` 的行为差异：`I` 在
  composer 里本来要保住浏览器的「斜体」默认行为（`execCommand('italic')` 直接改 DOM，
  绕过 Lexical），而 `J` 没有等价的默认行为，放行只会触发 Win/Linux 浏览器的「下载」页。
  注意旧键位 `I` 现在**另有用途**（`⌘/Ctrl+I` = 近期对话浮窗），所以 composer 里的
  `Ctrl+I` 斜体依旧不可用（会被浮窗抢走，见下文「已知限制」）。
- **焦点跳转会占用终端的 `⌃J`**：xterm 把 `⌃J` 编码成 `0x0A`（LF；readline 的
  newline，与 `Enter` 同义），本插件会在那里接管并跳回输入框，所以终端里的 `⌃J`
  不再送到 PTY——要换行请按 `Enter`。若更看重终端里的 `⌃J`，用 `localStorage`
  把 `composer.focus` 改绑到别的组合即可。
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
- **近期对话浮窗只列「对话」，不列空白会话**：空白会话（`blank`，即侧栏那个「新会话」
  占位行）一律不列出——包括**当前**选中的那个空白会话。这是本插件在产品规则上对上游
  `sessionVisible` 的唯一偏离（上游保留当前空白行）；需要空白新会话请用侧栏分组上的
  「＋」或 `⌘/Ctrl+N`。
- **近期对话浮窗的组内顺序恒为「最近更新」**：即使侧栏切到**手动排序**
  （`orderBy === 'manual'`，视图 store 里的 `sessionOrderByAccount` 记录拖拽结果），
  本浮窗仍按 `updatedAt` 降序排——它回答的是「近期对话」，不是「侧栏第几行」。
  按侧栏当前顺序跳转请用 `⌘/Ctrl+Alt+↑/↓`（那一个动作读的就是侧栏视图 store）。
- **近期对话浮窗最多列 10 行，且是「全局 10 个」**：先按最近更新取全部可见会话的前 10 个，
  再按工作区分组，所以 (a) 某个工作区的会话若都在 10 名开外，该组整组不出现（不留空标题）；
  (b) 想找的旧会话可能不在列表里——用侧栏或 `⌘/Ctrl+Alt+↑/↓` 找它。当前会话是唯一例外：
  它一定在列表里（不在前 10 名时顶掉第 10 名），因为初始光标必须落在它上面；这条强制纳入
  不会让行数超过 10。浮窗高度随之抬到 `calc(88vh - 24px)`（基线 `64vh`），10 行 + 组标题 +
  页眉/页脚在常见窗口高度下整屏可见、无需滚动；窗口非常矮时（内容超过视口可用高度）仍
  退化为列表内部滚动，不会溢出屏幕。
- **近期对话浮窗依赖 `workspaces` / `sessions` / `uiWorkspace` 服务**：`sessions` 缺席
  或快照缺 `ids` 时浮窗是空态（提示「当前没有可打开的对话」）；`workspaces` 缺席或快照
  缺 `items` 时全部会话落入**无标题组**（仍可打开，只是没有分组标题）；确认打开优先走
  `uiWorkspace.openSession`（侧栏点会话行的同一条上游调用），该服务 / 动词缺席时回退
  `sessions.open`；两者都缺失、或抛错（未知 id）时确认 no-op、浮窗照关。任何一环都
  **不回退 DOM**。
- **近期对话浮窗的 `↑` / `↓` 不循环**：与工作区 / 模型浮窗一致，首行按 `↑`、末行按
  `↓` 为 no-op（停在原行并吞键，浮窗仍处于模态分发）。浮窗内 `Enter` 打开的是**高亮行**，
  空态时不消费 `Enter`（由浮层模态吞掉）。
- **`⌘/Ctrl+I` 会抢走 contenteditable 的「斜体」**：`Ctrl+I` 是浏览器默认的
  `execCommand('italic')` 键，本插件在 document 捕获阶段先 `preventDefault`，所以
  在 composer、卡片自定义输入框等可编辑区域里按 `⌃I` / `⌘I` 会打开近期对话浮窗而
  **不会**把文字变斜体。需要斜体请用编辑器自己的格式入口；若更看重该默认键，
  用 `localStorage` 把 `session.recent` 改绑到别的组合即可（见「自定义键位」）。
- **`⌘/Ctrl+I` 在 macOS 上同时吸收 `⌃I` 与 `⌘I`**：`comboOf` 把 `ctrlKey` 与 `metaKey`
  都归一化成 `mod`，所以两个键都能触发（Win/Linux 只有 `Ctrl+I`）。这是本插件所有
  `mod+` 动作的共同行为。
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
  不碰 DOM）。此时 `⌘/Ctrl+O` 先展开右栏即可。
- **单个标签时不吞键**：面板只有一个标签（或没有标签）时 `←` / `→` 不循环回自身，
  no-op 并把按键交回页面——避免「按了没反应还吃掉按键」。
- **`card` 态下右栏标签照常可切**：卡片占用的方向键是**裸** `←` / `→`（问答翻题），
  `⌘/Ctrl+Alt+←/→` 是另一个 combo，两者互不影响；同理输入框聚焦（`editing`）时也生效。
- **关闭当前标签只覆盖「当前面板」的当前标签**：与切标签同源，其它分屏面板、浮窗里的
  标签都不受影响（要关它们先切过去）。当前面板没有激活标签（面板空 / `activeTabId`
  失配）时 no-op 且不吞键。
- **关闭当前标签依赖右栏插件已挂载且该会话开过面板**：与切标签同一批前置条件
  （`rightbar.session` 注册项、会话级 store、`bySession[sessionId]`）。任一环不可用时
  no-op 且**不吞键**——此时 `⌘/Ctrl+O` 先展开右栏即可。另注意上游 `sidebarRight.close`
  作用在**已挂载会话面**上，所以插件在调用后回读布局确认；若服务面落在别的会话上
  （当前标签未被删除）则同样按 no-op 放行，不会误吞按键。
- **「独占停靠的引导页」关不掉，且此时不吞键**：右栏只剩引导页（guide）这一个停靠标签时
  上游拒绝关闭（关掉它右栏会整体收起，`canCloseTab` / `soleDockedTab`）。插件调完
  `close` 后回读发现标签仍在，就返回 no-op、把按键交回页面——与切标签「单个标签不吞键」
  一致的取舍。引导页与其它标签共存时照常可关。
- **文件浏览器页本身由上游提供**：`files` 这个页类型来自 `dsh-web-app` bundle 常驻挂载的
  `@deepseek-ai/dsh-client-ui-sidebar-files`（引导页里的「工作区文件」）。该行缺席时
  `openTab('files')` 会抛 `no tab type is registered as "files"`，本动作兜住并
  no-op（**不吞键**），不会退化成任何 DOM 操作。
- **文件浏览器置顶只作用于它所在的那个停靠面板**：优先**当前面板**（本次 `openTab`
  的落点）。若文件树页同时存在于另一个分屏面板，那里那个 tab 保持不动（上游「页唯一性
  按**面板**」的语义，跨面板可能各有一份）；浮窗里的文件树 tab 也不被挪动、不被关闭。
  另一个已知的上游行为沿用：极窄窗口下右栏会被上游按「挤不下」的规则再折叠回去
  （与右栏头部展开按钮同一条路，见 `dsh-client-ui-layout` 的
  `canShow: normal.rightbar > 0`）。
- **终端定位靠插件自己「认页」，因为它不是上游意义上的「页」**：`terminal` 是
  `multiple: true` 的页类型，上游给每次 `openTab` 都铸一个带 UUID 的 `contentId`，
  不做 (kind, contentId) 去重。因此「已有终端就只聚焦」这一步是**本插件**读会话级
  slot store 的布局判断出来的，不是上游的揭示语义。**代价**：若该取数链路整条不可用
  （`slots` 服务缺席、注册项无 store、`uiSession.resolve` 返回 `undefined`、
  `resolveStore` 抛 `store handle is not registered`、该会话尚无面板），插件无从判重，
  会退化为**每次按键 `openTab('terminal')` 新建一个终端**（与直接调上游 `openTab`
  的行为一致）——想避免堆积，先按 `⌘/Ctrl+O` 展开一次右栏让会话面板物化，或检查
  `rightbar.session` 注册项是否在位。反过来，已有终端而 `focus` 面缺失 / 抛错时
  **只** no-op（不吞键、绝不重复开终端）。
- **终端定位不重排标签**：与文件浏览器定位不同，`⌘/Ctrl+L` 不会把终端 tab 挪到标签栏
  首位——终端是 `multiple` 页，用户可能同时开着多个，热键只「定位」、不替用户决定顺序。
  浮窗（float）里的终端 tab 同样不参与认页：当前面板与其它停靠面板都没有终端时，
  它会**新建**一个停靠终端，而不是把浮窗里的拉回来。
- **终端页本身由上游提供**：`terminal` 这个页类型来自 `dsh-web-app` bundle 常驻挂载的
  `@deepseek-ai/dsh-client-ui-sidebar-terminal`（引导页里「新建终端」那一格，其后端
  会话由 `dsh-api-terminal-controller` 提供）。该行缺席时 `openTab('terminal')` 会抛
  `no tab type is registered as "terminal"`，本动作兜住并 no-op（**不吞键**），不会退化
  成任何 DOM 操作。
- **终端「聚焦内容」这一步依赖两个上游事实**（都是插件唯一的选择器查询所依赖的）：
  ① 终端内容的 DOM 焦点由上游 TerminalBody 的 effect（依赖 `[visible, state.writable]`）
  完成，所以「终端本来就显示着」时它不会重跑——插件据此补 `focusTerminalScreen`；
  ② dockkit 把面板节点 id 原样写成 `[data-dockkit-pane]` 属性、xterm 的隐藏输入框是
  `textarea.xterm-helper-textarea`。若上游改了其中之一（属性名 / 元素结构），效果是
  **少一次内容聚焦**（标签仍被聚焦、按键仍被吞掉），不会报错、也不会退化到点击或事件
  合成——用「自定义键位」换绑或提 issue 即可。另注意：终端**不是**当前标签时插件刻意
  不代劳（`visible` 翻转后上游自己会聚焦），所以那种情况下是由上游把焦点移进终端的。
- **`⌘/Ctrl+L` 与浏览器地址栏、终端清屏同键**：Chrome / Edge / Firefox 把 `Ctrl+L`
  （macOS `⌘L`）绑成「聚焦地址栏」。本插件在 `document` 捕获阶段先 `preventDefault()`，
  命中的按键在**页面内**不会触发地址栏；但该键属浏览器保留键，**焦点不在本页面时**
  （地址栏已聚焦、页面失焦）浏览器仍按自己的默认处理。macOS 上 `⌃L` 一般未被浏览器
  占用，因此即使 `⌘L` 被截获，`⌃L` 也能触发（`comboOf` 两者归一成同一个 `mod+l`）。
  另需注意：终端里 `Ctrl+L` 原本是 shell 的清屏（readline `clear-screen`），焦点在
  右栏终端时本插件会**抢走**该组合；要清屏可用 shell 的 `clear` 命令，或经
  `localStorage` 把 `sidebarRight.terminal` 改绑到别的组合（见「自定义键位」）。
- **浏览器保留键**：`⌘/Ctrl+O`（打开本地文件）、`⌘/Ctrl+K`（地址栏搜索）以及
  Win/Linux 的 `Ctrl+J`（打开下载页）都是浏览器自己的快捷键，`⌘/Ctrl+M`
  （旧式静音/最小化）在部分系统上也留给窗口管理器。本插件在
  `document` 的**捕获阶段**监听，命中的动作会先 `preventDefault()` +
  `stopPropagation()` 再执行，因此在页面内这几组键由插件接管；但**焦点不在本页面时**
  （地址栏已聚焦、页面失焦）浏览器仍按自己的默认处理——此时先点一下页面再按即可。
  **`⌘/Ctrl+N`（新建会话）是最硬的一例**：Chrome / Edge / Safari 把它绑成「新建窗口」，
  且该保留键在多数浏览器里**不派发给页面**（页面收不到 keydown，`preventDefault` 无从下手），
  因此 Win/Linux 的 `Ctrl+N` 在浏览器标签页里可能始终打开新窗口；macOS 上
  `⌘N` 同样被浏览器截获，而 `⌃N`（`comboOf` 也吸收 ctrlKey）通常能到达页面。
  若在你的浏览器上不生效，用 `localStorage` 把 `sidebar.toggle`（左栏）/
  `sidebarRight.toggle`（右栏）/ `workspace.pick` / `model.pick` /
  `sidebarRight.files` / `sidebarRight.terminal` / `sidebarRight.closeTab` / `session.new` /
  `composer.focus` 任一动作改成别的组合即可
  （见「自定义键位」）。
- **焦点跳转（`⌘/Ctrl+J`）在 Win/Linux 与浏览器的「下载」键同键**：Chrome / Edge /
  Firefox 把 `Ctrl+J` 绑成「打开下载页」。本插件在页面捕获阶段先 `preventDefault()`，
  命中的按键不会触发下载页；但该键仍属浏览器自己的快捷键，**焦点不在本页面时**浏览器
  照旧处理。macOS 的 `⌘J` 一般未被浏览器占用（Chrome 的下载页是 `⇧⌘J`、DevTools
  控制台是 `⌥⌘J`），`⌃J` 同样能触发。在终端 / Monaco 里本插件会**抢走**该组合
  （终端里 `⌃J` 原本等于 LF / 换行，见上）。本插件在这些地方接管，是因为「焦点在某个
  可编辑元素里」并不等于「焦点在 composer 里」；而焦点已在 composer 内时按键仍被吞掉，
  以免 Win/Linux 浏览器的下载页被放行。macOS 上 `⌃J` 与 `⌘J` 都归一化成同一个
  `mod+j`。不合口味的话经 `localStorage` 改绑 `composer.focus` 即可。
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
  终端 / Monaco 的隐藏 `textarea` 等其它可编辑元素时，`⇧Tab` 一律交回该处默认行为
  （反向移动焦点 / 反向缩进），不会切模型强度。若在 composer 内按了没反应，说明当前
  模型没有推理元数据或只有一档（此时按键同样不被吞掉）。与 `⌘/Ctrl+J` 共用同一份
  `contains` 判定（`isComposerTarget`），但**方向相反**：`⇧Tab` 只在焦点**在** composer
  内时接管，`⌘/Ctrl+J` 只在焦点**不在** composer 内时执行聚焦。
- **`⇧Tab` 的方向是单向的**：只在候选档里**向前**循环（末档回到首档）。要反向
  （或换成别的键）请用 `localStorage` 覆盖 `model.effortNext`，本插件暂不提供
  「上一档」动作。
- **模型浮窗依赖 `modelDirectories` 服务**：它由 `dsh-web-app` bundle 常驻挂载的
  `@deepseek-ai/dsh-client-ui-model-selection` 提供。该行缺席（服务未注册）时
  浮窗仍可打开但显示空态，`⇧Tab` no-op（不崩、不回退 DOM）。

服务注入：`['sessions', 'uiSession', 'layout', 'sidebarRight', 'workspaces', 'slots', 'conversation', 'uiWorkspace', 'modelDirectories']`
（全部判空后才消费；`slots` 用于读侧栏视图 store（会话跳转顺序）、问答草稿 store
与右栏标签 store（`rightbar.session` 的标签顺序 + 文件浏览器置顶用的 `actions.placeTab`
+ 终端定位用的布局认页），
`layout` 用于 `⌘/Ctrl+B` 开关左栏，
`sidebarRight` 用于 `⌘/Ctrl+O` 开关右栏、`⌘/Ctrl+Alt+←/→` 聚焦右栏标签、
`⌘/Ctrl+\` 定位（打开/创建/置顶）文件浏览器与 `⌘/Ctrl+L` 定位（聚焦标签 + 聚焦
终端内容 / 缺则新建）终端，
`conversation` 用于 `⌘/Ctrl+J` 取 composer 的 editor 宿主元素与 `⇧Tab` 的编辑态门闸，
`uiWorkspace` 用于 `⌘/Ctrl+K` 工作区浮窗确认时连接/切换工作区、`⌘/Ctrl+N`
新建会话（`startSession`，与侧栏「新建会话」按钮同一条服务调用），
`modelDirectories` 用于 `⌘/Ctrl+M` 模型浮窗取目录与 `⇧Tab` 循环思考强度——
与 `/model` 弹层、composer 模型座位共用**同一份** per-session 目录实例）。
`⌘/Ctrl+I` 近期对话浮窗不新增注入：它复用 `sessions`（列表快照 + `open`）、
`workspaces`（分组）与 `uiSession`（「待回应」标记），取数见 `src/recent-sessions.ts`。
无宿主逻辑（`index.ts` 为占位空宿主），无 react 依赖（速查表、工作区浮窗、近期对话浮窗
与模型浮窗都是纯 DOM 浮层）。

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
  （`sidebarRight.files`）、定位终端（`sidebarRight.terminal`）、新建会话（`session.new`）、
  工作区浮窗（`workspace.pick`）、近期对话浮窗（`session.recent`）、
  模型浮窗（`model.pick`）、思考强度循环（`model.effortNext`）与聚焦输入框
  （`composer.focus`）各自独立可覆盖。
  > 未注册的动作 id 写在 `bindings` 里不会触发：分发前先查动作注册表
  > （`ACTION_BY_ID`），未注册即忽略。
- **固定分发动作不可自定义**：`approval.allow` / `approval.reject` /
  `question.option` / `question.prev` / `question.next` / `question.submit`
  （见 `src/config.ts` 的 `FIXED_KEYS`）由分发器按卡片类型固定分发，`bindings`
  里的同名键位会被 `loadConfig` 剔除，固定单键改不回来，也不需要手动清理。
- 组合键写法：`mod`（⌘/Ctrl）+ `alt` + 键名（字母/数字/`enter`/
  `backspace`/`escape`/`tab`/`arrow*`/`pageup`/`pagedown`/`;` 等），如
  `"Cmd+M"`（`alt` 可省，默认表里多数动作就是单修饰键）；`model.effortNext` 的默认值
  `"shift+tab"` 是本插件**唯一**使用 `shift` 作修饰键的默认键位（解析器一直兼容
  `shift` 写法：`"cmd+shift+m"` 等）。
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
                         # 另含 ⌘/Ctrl+B → layout.toggleSidebar（左栏）/ ⌘/Ctrl+O →
                         # sidebarRight.toggleExpanded（右栏）的两态调用、互不串场、自定义键位与无降级；
                         # 以及 ⌘/Ctrl+N 新建会话并跳转：必须调公开的 uiWorkspace.startSession
                         # （与侧栏「新建会话」同一条服务调用）、三态放行（含 card）、
                         # 服务缺席 / 无 startSession / 抛错一律 no-op 不吞键、键位可覆盖；
                         # 以及 ⌘/Ctrl+Alt+←/→ 右栏标签切换：标签顺序必须取自
                         # rightbar.session 注册项的会话级 store（bySession[sessionId].layout
                         # 的 activePaneId 面板）、切换必须调 sidebarRight.focus，首末标签循环、
                         # 单标签与任一环不可用一律 no-op 不吞键、card 态仍生效（裸方向键归卡片）；
                         # 以及 ⌘/Ctrl+. 关闭右栏当前标签：现场取自同一份会话级 store 布局的
                         # **当前面板当前标签**（多面板时只关当前面板那个、activeTabId 失配
                         # 不关）、关闭必须调公开的 sidebarRight.close(tabId)、关完回读布局
                         # 确认标签真的消失（桩里复刻上游 closeTab：独占停靠的 guide 拒关
                         # ⇒ 插件 no-op 不吞键；guide 与其它标签共存则可关）、
                         # 无标签 / 非 pane / 该会话无布局 / 服务·注册项·store·close 任一环
                         # 不可用一律 no-op 不吞键、card·editing 态生效、键位可覆盖；
                         # 以及 ⌘/Ctrl+\ 定位右栏文件浏览器并置顶：必须调公开的
                         # sidebarRight.openTab('files')（不存在时创建 / 已存在时聚焦，即
                         # 「定位 + 缺则创建」），置顶必须调同一份会话级 store 实例的
                         # actions.placeTab(sessionId, tabId, paneId, 0)（与标签拖拽同一入口）、
                         # 已在首位不调 placeTab、只作用于停靠面板且优先当前面板（浮窗与别的
                         # 分屏面板不搬动）、openTab 抛错时 no-op 不吞键、取数失败只跳过置顶；
                         # 以及 ⌘/Ctrl+J 聚焦输入框（J = Jump）：binding.ctx 原样传给 input.for、
                         # browse 态恒可用；editing 态只在焦点不在 composer 内时执行聚焦
                         # （右栏终端 / Monaco 的隐藏 textarea 属于这一类，焦点已在
                         # composer 内则不重复聚焦、但组合键仍被吞掉，不放行浏览器下载页）、
                         # ⌃J 与 ⌘J 都归一化成同一组合、
                         # for 缺席回退 shell(id)、任一环缺失/抛错一律 no-op 不吞键；
                         # （键位回归：⌘/Ctrl+I 不再是聚焦输入框的键位——不聚焦，但会被
                         # 近期对话浮窗吞掉）
                         # 以及 ⌘/Ctrl+K 工作区浮窗：列表按宿主顺序渲染（title / 路径末段 /
                         # 当前标记 / 会话数）、初始高亮 = 当前会话所属工作区、↑↓ 只移动高亮
                         # （不触发导航）且越界 clamp、Enter/点击才调 uiWorkspace.openWorkspace、
                         # Esc 与同组合键关闭、⌘/ 换成速查表、空列表与 workspaces 缺席为空态、
                         # uiWorkspace 缺席或抛错时确认 no-op、card/editing 态仍可用、键位可覆盖）
                         # 以及 ⌘/Ctrl+I 近期对话浮窗：按工作区分组渲染（组序 = workspaces
                         # 宿主顺序、组内 = 最近更新在前、无归属组无标题）、blank / 归档 /
                         # 子代理会话不列出、行带运行中 / 完成 / 当前标记、全局条数上限 =
                         # 最近交互的 10 个（13 个可见会话只渲染 10 行且裁掉最旧的 3 个、
                         # 整组被裁掉时不出现空标题、blank 不占名额）、当前会话不在前 10 名
                         # 时强制纳入并顶掉第 10 名（行数仍为 10）、初始高亮 = 当前
                         # 会话所在行（空白 current / 无 current → 首行）、↑↓ 跨组移动高亮
                         # 且越界 clamp 且**不打开会话**、Enter/点击才打开会话（有
                         # uiWorkspace.openSession 时优先走它、无该方法或抛错则回退
                         # 读 this 的 sessions.open——桩里的 open/openSession 都是
                         # 类方法形态，摘下来调用会丢 this 并 FAIL）、
                         # Esc 与同组合键关闭、⌘/ 换成速查表、空态与 sessions 缺席 / 缺 ids
                         # 为空态（Enter 不消费）、workspaces 缺席 / 缺 items 退化为无归属组、
                         # open 缺失或抛错时确认 no-op、card/editing 态仍可用、键位可覆盖）
                         # 以及 ⌘/Ctrl+M 模型浮窗 + ⇧Tab 循环思考强度：目录必须按
                         # ctx.modelDirectories.directoryFor(当前会话) 取、行按宿主顺序展开
                         # （提供方分组标题 + 当前标记 + 初始高亮）、每行完整选择复刻上游
                         # selectionOf（无 defaultEffort 时不带 reasoningEffort）、Enter 调
                         # directory.select；⇧Tab 的循环集合复刻上游 effortChoices（有
                         # defaultEffort 时不含 Default 档）、当前档 = current.reasoningEffort
                         # ?? defaultEffort、末档回到首档、浮窗内 ⇧Tab 只更新「当前」行；
                         # 无推理元数据 / 只有一档 / 服务或缺 / 无会话 / 子代理 / directoryFor
                         # 抛错一律 no-op 且不吞键；load() 拒绝 → 空态 + 失败小字、select()
                         # 拒绝 → 浮窗照关；editing 态另需焦点落在 composer 内（isComposerTarget）
                         # 以及 ⌘/Ctrl+L 定位右栏终端：terminal 是 multiple 页、上游每次
                         # openTab 都铸带 UUID 的 contentId、**不**按 (kind, contentId) 去重，
                         # 故认页必须由插件读会话级 store 的布局完成（kind === 'terminal' /
                         # sidebar://terminal/<uuid> 前缀）：已有终端 → 只调 sidebarRight.focus
                         # 且**不**再 openTab（重复按不堆积、不重排）、折叠时补一步 toggleExpanded
                         # （expanded 读不到则不动展开态）；没有才 openTab('terminal') 新建；
                         # 另含面板内优先当前激活的终端 / 跨停靠面板定位 / 浮窗不参与认页 /
                         # 各层不可用或抛错一律 no-op 不吞键（已有终端时不退化成再开一个）、
                         # card·editing 态生效、⌃L 与 ⌘L 归一化成同一组合、键位可覆盖；
                         # 以及 ⌘/Ctrl+L 的**元素级聚焦**：终端本来就是所在面板的当前标签、
                         # 且右栏已展开时（上游 TerminalBody 依赖 [visible, state.writable]
                         # 的自动聚焦 effect 不会重跑），插件按 store 给出的 paneId 找
                         # [data-dockkit-pane] 里 xterm 的 textarea.xterm-helper-textarea 并
                         # focus（注入假面板观察；分屏时只碰终端所在那个面板）；
                         # 终端不是当前标签 / 右栏折叠着时不代劳（交回上游 visible 翻转）、
                         # 面板里还没有 xterm / focus 抛错只是少这一步（不崩、仍吞键）
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
