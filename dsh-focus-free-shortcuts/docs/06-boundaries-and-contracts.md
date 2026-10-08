# 边界与依赖契约

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 6 册：与内置命令的对照表、已知边界与失败模式、依赖的非正式契约。

---

## 6. 与内置命令的对照

| 场景 | 内置命令（没有插件时） | 本插件（装了之后） |
|---|---|---|
| 焦点在输入框，按 `⌘⌥Enter` | `noFocus`，消费但不动作 | 取活动 dock pane，正常全屏 |
| 焦点已在面板内，按 `⌘⌥Enter` | 正常全屏 | 让位，不动作、不消费 |
| 面板折叠，按 `⌘⌥Enter` | 无动作 | 无动作（先用展开键展开，展开会顺手聚焦活动 pane） |
| 焦点在侧栏容器内、但不在 pane 内（如侧栏边距） | `noFocus` | `commandTarget` 按官方语义返回 `undefined`，无动作 |
| 内置键位被改绑 | 跟随新键 | 同样跟随新键（读生效绑定） |
| 内置键位被解绑 / 被系统保留 / 冲突中 | 不响应 | 不响应（`enabledBinding` 返回 `undefined`） |
| 模态弹窗打开，按面板键 | 消费并 `blocked`（modal） | 让位，不动作、不消费 |
| 焦点在输入框，按 `⌘⌥W`（Windows/Linux 为 `Ctrl+Alt+W`） | `noFocus`（提示「请先聚焦右侧面板」），消费但不动作 | 取活动 dock pane，关掉它的当前页（与内置 `run()` 同一个 `closeTarget()`） |
| 焦点已在面板内，按 `⌘⌥W` / `Ctrl+Alt+W` | 正常关页 | 让位，不动作、不消费 |
| 面板折叠，按 `⌘⌥W` / `Ctrl+Alt+W` | 无动作 | 无动作（没有"当前显示的页面"；停靠面板在折叠时本来也解析不到目标） |
| 焦点在侧栏容器内、但不在 pane 内（如侧栏边距），按 `⌘⌥W` / `Ctrl+Alt+W` | `blocked / command.stale` | `commandTarget` 对陈旧标记返回 `undefined`，同样无动作 |
| 活动面板是空的（没有页面可关） | `noFocus`，消费但不动作 | 不动作、不消费（`canCloseTarget` 为假），这一按仍由内置命令收场 |
| 只挂着那块停靠 guide，按 `⌘⌥W` / `Ctrl+Alt+W` | 焦点在面板内时收成侧栏（`closeTarget` 自己的语义） | 焦点不在面板内时同样收成侧栏（同一个动词，行为一致） |
| 模态弹窗打开，按 `⌘⌥W` / `Ctrl+Alt+W` | 关闭最上面那层弹窗（`page.close` 声明了模态） | 让位，不动作、不消费：仍由内置命令关弹窗 |
| `page.close` 键位被改绑 / 解绑 / 冲突 | 跟随新键 / 不响应 | 同样跟随 / 不响应（读生效绑定，与面板键同一套 `enabledBinding`） |
| 桌面端（Desktop）按 `⌘W` | 焦点在面板内则关页，否则关窗口 | **不安装页面关闭桥**；Desktop 上这条命令本来就免聚焦 |
| 桌面端（Desktop）按 `⌘⌥W` | 无此绑定（Desktop 的 `page.close` 是 `⌘W`） | 无动作（本桥在 Desktop 不安装） |
| 焦点在 composer，`Esc Esc` | 正常停止 | 让位，不动作、不消费 |
| 焦点在 `<body>`（点过空白处），`Esc Esc` | 第一下 Esc 就被丢弃，无动作 | 主视图会话停止 |
| 存在待答交互（审批/提问） | 不停止 | 不停止 |
| 焦点在审批详情区，按 `Enter` / `Esc` | 面板自己作答（允许一次 / 拒绝） | 让位，不动作、不消费（目标落在 `[data-approval-key]` 内） |
| 焦点在 `<body>`（审批把 composer 隐掉后焦点退回），按 `Enter` | 无人处理（面板收不到这一按） | 主视图会话的审批：允许一次 |
| 同上，按 `Esc` | 无人处理 | 主视图会话的审批：拒绝（一下即拒，不走双按停止） |
| 焦点停在某张**过程卡片**上（工具卡 `div[role="button"][tabindex="0"]` / 轨迹行 `tr[tabindex="0"]`），按 `Enter` | 卡片自己折叠 / 选中：卡片自己的 React 处理器先跑并 `preventDefault()`，这一按冒泡到固定通道时已被认领，审批无人处理 | 主视图会话的审批：允许一次，且**卡片收不到这一按**（捕获路先 `stopPropagation()` 再作答，卡片不再折叠 / 选中） |
| 同上，按 `Esc` | 无人处理（卡片只绑 `Enter` / `Space`，这一按冒泡到固定通道后由审批桥拒绝） | 主视图会话的审批：拒绝（捕获路合规则由捕获路拦下，否则固定通道接手；两条路互斥，不双答） |
| 同上，作答之后那张卡片的外观 | 卡片被再次折叠 / 选中；作答后可能留下一圈焦点边框（作答把键盘交回 composer，应用切到键盘模态，`html[data-input-modality]` 一变，卡片平时透明的 `:focus-visible` 环就显形了） | 卡片收不到这一按、**且不留焦点边框**：桥在拿走这一按的同时给该控件打上 `data-dsh-automatic-focus`（官方"无环聚焦"标记），焦点未移动，环不显形；下一次 Tab / 方向键导航或失焦即恢复正常焦点样式 |
| 有待答审批时按 `Esc` | 不停止（`currentTurn()` 因待答返回 `undefined`） | 不停止，改为拒绝该审批 |
| 有待答提问时按 `Esc` | 不停止（`currentTurn()` 因待答返回 `undefined`），也没有任何一方取消卡片（卡片自己完全不绑 `Esc`） | 不停止，改为取消该提问（调卡片关闭 / 取消按钮的同一个 `dismiss()`，一下即取消，不走双按停止） |
| 待答提问是提问卡片（`kind === 'question'`）里"带工具调用线索"的那一类（`dismissal === 'hide'`） | 无人处理 | `dismiss()` 只收起面板：请求继续、倒计时照跑，问题仍可从它的 `ask_user_question` 工具调用行重新打开 |
| 待答提问是提问卡片（`kind === 'question'`）里 Host 未命名（请求没带 `wait`、没有 call id）的阻塞式请求 | 无人处理 | `dismiss()` 以 `ASK_CANCELLED` 结束整组等待（与按钮「取消」/「放弃整组问题」/「Dismiss all questions」同一语义） |
| 待答提问的 `kind === 'plan-review'`（`exit_plan_mode` 的 Approve / Request changes 卡片） | 无人处理 | `Esc` 调 `dismiss()`——就是「Request changes」按钮的那个动词：带工具调用线索时只收起面板（`hide`，计划仍可从工具调用行重开），Host 未命名时把等待拒绝为 `ASK_CANCELLED` 并把 composer 交回给用户写反馈 |
| 从 `ask_user_question` 工具调用行重新打开的**只读 review 卡片**（已定局的提问回看） | 无人处理 | 这类卡片没有作答通道、没有倒计时，`dismiss()` 是 `card.remove`（移除卡片）。它可以承载 `question` 或 `plan-review` 两种 `kind`，所以"活卡片 / 只读回看"不是靠 `kind` 分辨，而是上游 `review !== undefined` 的那条渲染路径 |
| 焦点在提问卡片自己的答案文本域（`editable`）里，按 `Esc` | 该文本域自己处理（它只绑 `Enter`，所以实际无动作） | 照常取消卡片（提问桥放宽到 `editable`，但只认这一张卡片；见第 5 册第 5.7.1 节） |
| 焦点在提问卡片之外的文本控件（侧栏搜索框、重命名框），按 `Esc` | 控件自己处理 | 控件自己处理（归属收口到"这一张卡片"之外，不消费） |
| 有待答提问时按 `Enter` | 卡片自己处理（只认卡片选项 / 字段上的 `Enter`，焦点不在卡片里则无人处理） | 卡片自己处理：提问桥只看 `Esc`，完全不碰 `Enter` |
| 主视图持有会话数 ≠ 1（正在切换），有待答提问 | 无人处理 | 不取消、不消费（提问卡片属于哪个会话有歧义） |
| 待答提问属于别的会话（如后台子代理） | 无人处理 | 不取消、不消费；主视图自己没有待答提问时这一按归停止序列 |
| 提问包（`@deepseek-ai/dsh-client-ui-user-questions`）没装载（桌面端即如此：该包声明 `dsh.client.platform: "web"`） | 无提问卡片可关 | 提问桥 no-op，不消费：没有提问包就永远不会发布提问域的 `pendingInteraction` |
| 审批面板聚焦在"拒绝"按钮上，按 `Enter` | 触发按钮自身（拒绝） | 让位，仍是拒绝（目标在面板内） |
| 焦点在输入控件 / 终端内，按 `Enter` / `Esc` | 控件自己处理 | 审批键：控件自己处理（`region !== 'page'` 直接否决）；提问键：仅当 target 落在**这一张**提问卡片内（它的答案文本域正是 `editable`）才接管，其余照旧归控件 |
| 审批插件没装载（固定行缺席） | 无审批可答 | 审批桥 no-op，不消费 |
| 桌面端（Desktop）按面板键 | native 通道派发 | **不安装面板桥**（见第 7 节） |
| 桌面端 `Esc Esc` / 审批键 / 提问卡片 `Esc` | DOM 固定通道驱动，正常；提问卡片是 Web 独有特性，桌面端根本没有这张卡片 | 停止桥、审批桥与提问桥照常安装，正常；提问桥在桌面端是 no-op——没有卡片就没有提问域的 `pendingInteraction`，也没有会重复处理的那一按 |
| 按 `⌘⌥J`（macOS）/ `Ctrl+Alt+J`（Windows/Linux）（任意焦点位置） | 没有任何命令占用，浏览器默认无动作 | 主视图会话的 composer 输入面 `focus()`：键盘回到输入框，光标还原 |
| 焦点已在输入框，按 `⌘⌥J` / `Ctrl+Alt+J` | 无动作 | 重新聚焦（幂等，光标不动） |
| 焦点在文本控件 / 终端内的 `⌘⌥J` / `Ctrl+Alt+J` | 控件自己处理 | 文本控件内接管；终端内由 window 捕获阶段的钩子接管（在事件进入终端前 `preventDefault()+stopPropagation()`），冒泡通道仍对终端让位 |
| 模态层打开，按 `⌘⌥J` / `Ctrl+Alt+J` | 模态层掌权 | 让位，不动作、不消费 |
| 主视图会话数 ≠ 1 或没有会话，按 `⌘⌥J` / `Ctrl+Alt+J` | — | 不动作、不消费（没有可聚焦的 composer） |
| 任意焦点位置按 `⌘⌥→` / `⌘⌥←`（macOS）/ `Ctrl+Alt+→` / `Ctrl+Alt+←`（Windows/Linux） | 没有任何命令占用，浏览器默认无动作 | 右侧栏切成当前页的下一页 / 上一页（环状）；切完把键盘交给新显示的页面（页面自聚焦如终端时则不抢，只补位） |
| 焦点在文本控件里按 `⌘⌥←/→` / `Ctrl+Alt+←/→` | 控件自己处理（本组合无动作） | 照常切页并消费（不看 `defaultPrevented`、不限制 region） |
| 焦点在终端里按 `⌘⌥←/→` / `Ctrl+Alt+←/→` | 终端把箭头当普通输入处理并 `preventDefault()+stopPropagation()`（事件到不了固定通道） | 捕获阶段在 `.xterm` 之前拦下并照常切页 |
| 右侧栏折叠，按 `⌘⌥←/→` / `Ctrl+Alt+←/→` | 无动作 | 不动作、不消费（没有"当前显示的页面"；与面板键同一条边界） |
| 只有一张页面 / 没有活动页 / 没有会话，按 `⌘⌥←/→` / `Ctrl+Alt+←/→` | 无动作 | 不动作、不消费（没有可切的目标） |
| 模态层打开，按 `⌘⌥←/→` / `Ctrl+Alt+←/→` | 模态层掌权 | 让位，不动作、不消费 |
| 任意焦点位置按 `⌘↓` / `⌘↑`（macOS）/ `Ctrl+↓` / `Ctrl+↑`（Windows/Linux） | 没有任何命令占用（官方唯一带方向键的固定行是菜单的裸 `↑` / `↓`，与本组合的修饰键集合不相交）；文本框里浏览器默认做自己的光标移动 | 在左侧栏前三个工作区**当前显示出来**的会话行之间环状切换（`↓` 往显示顺序的后一个、`↑` 往前一个）；当前会话不在候选里时 `↓` 落候选首、`↑` 落候选尾；切换调 `uiWorkspace.openSession()`，与点击侧栏那一行同一操作 |
| 任意焦点位置按 `⌘⌥↓` / `⌘⌥↑` / `Ctrl+Alt+↓` / `Ctrl+Alt+↑` | 没有任何命令占用，浏览器默认无动作 | **只在活跃会话之间**环状切换：池子是候选里带状态点的会话（运行中 / 待交互 / 已完成未读）；当前会话不在活跃池里时 `↓` 落活跃池首、`↑` 落活跃池尾；切换动词同上 |
| 候选里没有任何活跃会话（没有行带状态点） | 无动作 | 不动作、不消费：活跃池是空的，不退回全部候选（常规导航是 `⌘↑/↓` / `Ctrl+↑/↓` 自己那一条） |
| 活跃池里唯一那个活跃会话**正是**当前会话 | 无动作 | 不动作、不消费（没有可切的目标），同样不退回全部候选 |
| 候选只有一个、或算出来的目标就是当前会话，按这两对键中的任意一对 | 无动作 | 不动作、不消费（没有可切的目标） |
| 焦点在文本控件里按这两对键 | `⌘↓/↑`（文档首 / 尾）/ `Ctrl+↓/↑`（按段移动光标）是浏览器自己的默认行为；`⌘⌥↓/↑` / `Ctrl+Alt+↓/↑` 无动作 | 照常切换并消费（不看 `defaultPrevented`、不限制 region）——命中候选时这一按不再落到光标上 |
| 焦点在终端里按这两对键 | 终端把按键当普通输入处理并 `preventDefault()+stopPropagation()`（事件到不了固定通道） | 捕获阶段在 `.xterm` 之前拦下并照常切换，顺带不让 `\x1b[1;5A` / `\x1b[1;5B`（Windows/Linux 的 `Ctrl+方向键`）与 `\x1b[1;7A` / `\x1b[1;7B`（Windows/Linux 的 `Ctrl+Alt+方向键`）进 shell；macOS 上同样的行是 `⌘↑/↓` 与 `⌘⌥↑/↓`，xterm 不为它们产出这些序列，但捕获钩子照常运行 |
| 工作区折叠 / 会话藏在「展开更多」之后 / 列表带搜索词 / 侧栏收起成窄栏 / 分组方式为「单列表」，按这两对键 | 无动作（那时也没有会话行可点） | 不动作、不消费：候选就是「此刻渲染出来的会话行」，这些情况下没有候选 |
| 会话已归档，按这两对键 | 点那一行只弹「已归档，不可打开」的提示，不切换 | 不动作、不消费：归档行不进候选（按 `aria-description` 标记识别） |
| 模态层打开，按这两对键 | 模态层掌权 | 让位，不动作、不消费 |
| 焦点在终端里按 `⌘⌥N` / `Ctrl+Alt+N`（内置 `session.new`） | 终端把按键当普通输入处理并 `preventDefault()+stopPropagation()`（事件到不了 DOM 通道），内置命令的 `regions` 也不含 `terminal` | 捕获阶段在 `.xterm` 之前拦下并调用与内置 `run()` 同一个 `uiWorkspace.startSession()`（不带参数 = 沿用当前 / 最近的工作区），顺带不让 Windows/Linux 上的 AltGr 把这一按变成字符送进 shell |
| 焦点在页面 / 文本控件里按 `⌘⌥N` / `Ctrl+Alt+N` | 内置 `session.new` 自己处理（`regions` 含 `page` 与 `editable`） | 让位：本桥的捕获钩子只认 `.xterm`，不注册固定键也不开观察者，页面 / 文本控件里的这一按完全归内置命令 |
| `session.new` 被改绑 / 解绑 / 有 issue / 存在冲突，焦点在终端里按原键位 | — | 不动作、不吞事件：键位读**生效目录**（`enabledBinding`），改绑后跟随新键，解绑 / 冲突后让位（与页面关闭桥跟随 `page.close` 同一条约定） |
| `uiWorkspace` 服务缺席 | — | `session.new` 桥停在注入等待里（不告警、不安装）：`ctx.inject(['shortcuts', 'uiWorkspace'])` 等到服务真正可用才跑，形状不符（没有 `startSession`）时告警一次并整体不安装 |
| 模态层打开，按 `⌘⌥N` / `Ctrl+Alt+N` | 模态层掌权 | 让位，不动作、不吞事件 |
| 任意焦点位置按 `⌘⌥K` / `Ctrl+Alt+K` | Web 上这是内置 `session.search`（会话搜索）的默认键位：焦点在页面 / 文本控件时打开搜索框；终端里 xterm 会把它当输入吞掉 | 本插件的固定行占用这一按：把键盘交给右栏**当前显示**的那一页（终端落到 `.xterm-helper-textarea`）。内置搜索键因此被挤成「冲突」——设置里给 `session.search` 亮红、按键不再打开搜索，需自行给搜索改绑（见第 7 节） |
| 焦点在文本控件里按 `⌘⌥K` / `Ctrl+Alt+K` | 控件自己处理（本组合在控件里无动作） | 照常交棒并消费（不看 `defaultPrevented`、不限制 region） |
| 焦点在终端里按 `⌘⌥K` / `Ctrl+Alt+K` | 终端把它当输入处理 | 捕获阶段在 `.xterm` 之前拦下并吞掉；交棒此时是无操作（键盘本来就在终端里），顺带不让这一按进 shell |
| 页面已自持键盘（终端自聚焦），按 `⌘⌥K` / `Ctrl+Alt+K` | — | 交棒幂等：不抢焦点，但这一按仍被消费（否则会被当作终端输入送进 shell） |
| 右侧栏折叠，按 `⌘⌥K` / `Ctrl+Alt+K` | 无动作 | 不动作、不消费（折叠时没有"当前显示的页"；与面板键 / 页面切换键同一条边界） |
| 屏幕上没有会话（全局面板 / 切换中），按 `⌘⌥K` / `Ctrl+Alt+K` | — | 不动作、不消费（没有可交棒的右栏） |
| 面板已展开、可见 pane 尚未渲染，按 `⌘⌥K` / `Ctrl+Alt+K` | — | 消费但不动焦点（"先消费再动作"；下一次按即可交棒） |
| 模态层打开，按 `⌘⌥K` / `Ctrl+Alt+K` | 模态层掌权 | 让位，不动作、不消费 |
| 桌面端（Desktop）按 `⌘⌥K` | Desktop 的 `session.search` 是 `primary+K`（`⌘K` / `Ctrl+K`），`⌘⌥K` 没有占用 | 本桥同样安装（固定行是插件自己的，不经原生派发）；与 `⌘K` 搜索互不相干 |

---

## 7. 已知边界与失败模式

| 情况 | 行为 | 机制与失败表现 |
|---|---|---|
| Desktop 运行时 | 面板桥与页面关闭桥都不安装并各告警一次；停止桥、审批桥与提问桥照常安装（提问桥在桌面端为 no-op） | 桌面端 macOS/Windows 的可配置键位由 Electron 原生键盘桥派发，DOM 侧的 `consume()` 压不住那一次派发，两边都动作会来回抵消（全屏两次 / 关两次）。页面关闭桥在桌面端还多一条理由：`page.close` 在 Desktop 上未聚焦面板时走 `closeWindow()`，本来就免聚焦，不需要桥。而停止序列、审批键与提问卡片取消在两端都由 DOM 固定通道驱动（`installKeyboard` 的 `fixed?.()` 在 native 分支 `return` **之前**执行），并且都不是可配置绑定。提问卡片本身是 **Web 独有**的客户端特性（`@deepseek-ai/dsh-client-ui-user-questions` 声明 `dsh.client.platform: "web"`）：桌面端没有人发布提问域的 `pendingInteraction`。 |
| `sidebarRight` 服务缺席 | 面板桥、页面关闭桥与聚焦右栏页面桥都不安装，插件整体仍 no-op，不抛 | 三条桥都通过 `ctx.inject(['shortcuts', 'sidebarRight'], ...)` 依赖侧栏服务，服务不存在时注入不解析、这几段逻辑根本不跑；停止桥独立，不受影响。 |
| `shortcuts.observeFixedInput` 缺席 | 各告警一次，不安装 | 各桥都挂在固定输入通道上，没有这个 API 就没有可挂的点。提问桥的告警原文是 `shortcuts service exposes no observeFixedInput; question bridge not installed`，页面关闭桥是 `... page close bridge not installed`，聚焦右栏页面桥是 `... focus-page key not installed`，各桥各留一行、互不冒充。 |
| 主视图持有会话数 ≠ 1（正在切换） | 不停止 | `mainViewSessionId` 要求恰好一个会话被主视图 retain。切换过程中可能出现两个会话同时被 retain 的瞬间，此时"当前会话"有歧义，这一下不响应。 |
| 会话无 `running` / 已 `removed` / 子代理不可续 / 有待答交互 | 不停止 | 这些是内置 `currentTurn` 的同一批门槛。 |
| 某会话 scope 上没有 `conversation` | 告警一次，不发停止 | `conversation.cancel()` 是停止的唯一入口；服务缺失时无法停，只能告警。 |
| `cancel()` 拒绝（返回 rejected Promise） | 捕获并告警，不冒泡 | 避免未处理的 Promise 拒绝污染控制台/运行时。 |
| 两按之间轮次恰好结束并立刻开启新轮次 | 500ms 窗口内仍会停到新轮次 | 内置序列要求两按的 `(sessionId, turn, generation, region)` 全同，其中 `turn` 能区分"轮次 A"和"轮次 B"；插件只用 `(sessionId, generation)`，轮次身份不是公开事实。所以"第一下在轮次 A 结束前、第二下落在刚开的新轮次 B"这种窗口内，插件仍会停 B，内置则会因 `turn` 变化而复位。 |
| 焦点在侧栏容器内、但不在 pane 内 | `commandTarget` 返回 `undefined`，无动作 | 官方 `commandTarget` 对"target 在 `[data-sidebar-right-session]` 内但不在 pane 内"的陈旧标记**不回退**（防止误回退到另一面板），此时与内置一样不动作。面板键与页面关闭键共用这一条。 |
| 右侧栏折叠，按 `⌘⌥W` / `Ctrl+Alt+W` | 不动作、不消费 | 折叠时没有"当前显示的页面"。内置 `focusedTarget` 对**停靠**面板同样解析不到（`sidebarTargetFromElement` 对 `host === 'dock' && !layout.expanded` 返回 `undefined`），插件再补一条同向的 `isExpanded()` 守卫。折叠时仍被绘制的只有浮动面板，而那种情形焦点本就落在浮动面板内、让位给内置命令。 |
| 活动面板是空的（没有页面可关），按 `⌘⌥W` / `Ctrl+Alt+W` | 不动作、不消费 | `canCloseTarget(target)` 是官方"这个目标现在能不能关"的判定（`isTargetCurrent(target) && target.tabId !== undefined`），为假时插件不消费 —— 这一按仍由内置命令收场（Web 上 `blocked / command.noFocus` 并自行消费），归属不回退、也不多关一页。 |
| 只挂着那块停靠 guide，按 `⌘⌥W` / `Ctrl+Alt+W` | 收成侧栏（收起右栏），不是"无动作" | 这是 `closeTarget()` 自己的语义（`canCloseTab` 为假时 `setExpanded(false)`），与焦点在面板内时按同一键完全一致；插件只调同一个动词，不额外决定。 |
| 模态弹窗打开，按 `⌘⌥W` / `Ctrl+Alt+W` | 让位，不动作、不消费（弹窗仍由内置命令关掉） | 与面板键不同：`page.close` **声明了模态**（`modals: ["settings", "shortcuts", "other"]`），弹窗下这一按的内置语义是 `closeTopModal(document)`。插件若不设这条守卫，就会越过弹窗去关后台页面。 |
| 焦点在终端内，按 `⌘⌥W` / `Ctrl+Alt+W` | 若该组合被 xterm 消费，事件到不了固定通道 | 与面板键同一条限制：本桥没有终端捕获钩子（只有页面循环与会话导航两桥有）。macOS 的 `⌘⌥W` 不产出转义序列、照常落地；Windows/Linux 上 `Ctrl+Alt` 常被当作 AltGr，个别布局 / 终端会把它吞掉，此时不落地、也不误动作。 |
| 免聚焦关页之后的键盘位置 | 键盘不动 | 官方 host 的 `closeWithPaneFocus` 只在"关之前焦点就在这个 pane 里"时才把焦点交给存活面板；焦点在 composer / 别处时它提交完变更就返回。所以"焦点在输入框按 `⌘⌥W` 关页"不会把键盘吸进右侧栏。 |
| 主视图持有会话数 ≠ 1（正在切换），有待答审批 | 不代答 | `presentedApproval` 只认被主视图唯一保留的那个会话；歧义时这一下不响应。 |
| 待答审批属于别的会话（如后台子代理） | 不代答 | composer 顶替面板只渲染"当前会话"的待答交互；别的会话的审批在这条路上没有可见面板。 |
| 待答交互不是审批（如提问） | 不代答 | `pendingInteraction` 这个槽位是复用域；`asAnswerableApproval` 要求 `kind === 'approval'`，别的域留给它自己的 UI（提问域由第 6 组的提问桥接手，见第 5 册第 5.6.3、5.7.1 节）。 |
| 审批已作答 / 已撤销 / 被中止（`answerable === false`） | 不代答、不消费 | 请求已定局，再答会被 `PendingApproval` 的锁拒绝；插件提前让位，把这一按留给别的 owner。 |
| 焦点停在过程卡片上（工具卡 / 轨迹行，卡片自己会用 `preventDefault()` 消费 `Enter`） | 照常代答，并吞掉这一按 | 固定通道是 window **冒泡**监听，晚于卡片自己的 React 处理器——那一按到不了它，或者到了也已读成"被消费"。审批桥另挂 window **捕获**监听，在卡片之前读到同一按，命中即 `preventDefault() + stopPropagation()`：卡片完全收不到，审批照常作答。 |
| 作答后按下的那个控件 | 保留焦点，但**不画焦点边框**（打上 `data-dsh-automatic-focus`） | 作答会把键盘交回 composer，应用随即切到键盘模态（`input-modality` 跟踪器的"按键之后焦点落到别的控件"分支），此后 `:focus-visible` 的环色不再是透明，被按下的控件会因此显出一圈边框。桥在拿走按键的同时给该控件打上官方"无环聚焦"标记，焦点位置不变；下一次 Tab / 方向键导航或失焦时按官方同一套释放规则摘除标记，恢复正常焦点样式。若上游改了这个属性名，最坏情形是边框照旧出现，不误动作。 |
| 审批键被按下时焦点在 `editable` 或 `terminal` 区域 | 不代答、不消费 | 与面板自己的守卫同源："输入控件与 IME 候选保持自己的按键"。正常路径上 composer 已被顶替隐藏、焦点退回 `<body>`（`page`）。 |
| 模态层打开时按审批键 | 不代答、不消费 | 模态层之上的按键属于模态层（Web/Linux 的模态层本来就会挡住后台命令）；此时审批面板在模态层之下。 |
| `answer()` 拒绝（返回 rejected Promise） | 捕获并告警，不冒泡 | 与 `cancel()` 同理，避免未处理的 Promise 拒绝污染控制台/运行时。 |
| 待答提问是提问卡片（`kind === 'question'`）里"带工具调用线索"的那一类（`dismissal === 'hide'`） | `Esc` 只收起面板；问题本身没有被拒绝，仍可从它的工具调用行重新打开（同第 6 节对照表） | `dismiss()` 对这类卡片走的是 `hide`：请求原样等待、倒计时继续，面板只是从 composer 座位撤下。这条语义来自上游包，插件只调用这一个动词。 |
| 待答提问是提问卡片（`kind === 'question'`）里 Host 未命名（请求没带 `wait`、没有 call id）的阻塞式请求 | `Esc` 以 `ASK_CANCELLED` 结束整组等待（同第 6 节对照表） | 这类请求没有可返回的工具调用行，`dismiss()` 的语义就是把整个等待拒绝为 `ASK_CANCELLED`（卡片那个按钮自己的标签是「取消」/「放弃整组问题」/「Dismiss all questions」）。`Esc` 与点那个按钮同义。 |
| 待答提问的 `kind === 'plan-review'`（`exit_plan_mode` 的 Approve / Request changes 卡片） | `Esc` 调 `dismiss()`，与「Request changes」按钮同义 | 这是**活着的** plan-review 展示：`dismiss()` 就是那个按钮的动词——带工具调用线索时收起面板（计划仍在，可从工具调用行重开），Host 未命名时以 `ASK_CANCELLED` 结束等待并把 composer 交回给用户写反馈。 |
| 从 `ask_user_question` 工具调用行重新打开的只读 review 卡片（已定局的提问回看） | `Esc` 直接移除卡片（同第 6 节对照表） | 这类卡片没有作答通道、没有倒计时，`dismiss()` 是 `card.remove`；它可以携带 `question` 或 `plan-review` 两种 `kind`，所以 `asDismissableQuestion` 不试图用 `kind` 分辨"活卡片 / 只读回看"——两种情形都由同一个 `dismiss()` 收场。 |
| 焦点在 `editable` 区域，但不是这张提问卡片（侧栏搜索框、重命名框） | 不取消、不消费，控件保留自己的 `Esc` | 卡片自己的答案字段是 `<textarea>`（`region` 为 `editable`），所以准入不排 `editable`；"这一按属不属于本卡片"改由 `questionCardOwnsTarget` 收口——`closest('[data-question-key], [data-plan-review-key]')` 要命中，且该元素**自身**的属性值必须等于本次待答提问的 `key`。放行准入不等于放行所有文本控件。 |
| 焦点在提问卡片自己的答案文本域里，有待答提问 | 照常取消卡片 | 那个文本域的 `keydown` 只处理 `Enter`（自由文本问题还会自动聚焦它），`Esc` 在这里同样没有别的 owner。 |
| 焦点在终端内，且有待答提问 | 不取消、不消费，终端保留自己的 `Esc` | 与其它几条 `Esc` 桥同一门槛 `context.region !== 'terminal'`：终端的 `Esc` 属于终端（可能是它自己的取消 / 中断语义）。 |
| 模态层打开，且有待答提问 | 不取消、不消费 | `context.modal === null`；模态层之上的按键属于模态层。 |
| 主视图持有会话数 ≠ 1（正在切换），有待答提问 | 不取消 | `presentedQuestion` 只认被主视图唯一保留的那个会话；歧义时这一下不响应，也不关错卡片。 |
| 待答提问属于别的会话（如后台子代理） | 不取消、不消费 | 提问卡片是 composer 顶替，只渲染"当前会话"的待答提问；别的会话的提问在这个屏上没有卡片。主视图自己没有待答提问时，这一按落回停止序列（同第 6 节对照表）。 |
| 待答交互不是提问域（`kind === 'approval'` 或别的域） | 不取消、不消费 | `asDismissableQuestion` 要求 `kind` 是 `question` 或 `plan-review`；审批域归审批桥（`asAnswerableApproval` 只认 `kind === 'approval'`）。两个域共用同一个槽位、靠 `kind` 分工，所以同一按不可能被两条桥同时认领。 |
| 上游提问包 `@deepseek-ai/dsh-client-ui-user-questions` 没装载 | 提问桥 no-op，不消费（同第 6 节对照表） | 没有提问包就永远不会有提问域的 `pendingInteraction` 发布出来，`presentedQuestion` 恒为 `undefined`，这一按归停止序列或无人。桥本身仍会安装——它只依赖固定输入通道，不依赖提问包的运行时存在。桌面端正属于这一类（该包声明 `dsh.client.platform: "web"`）：桥照常装上，但永远没有卡片可关。 |
| `dismiss()` 拒绝（返回 rejected Promise） | 捕获并告警（`question <key> was not cancelled:`），不冒泡 | 与 `cancel()` / `answer()` 同理，避免未处理的 Promise 拒绝污染控制台 / 运行时；这一按的归属（已消费）不回退。 |
| 卡片已经关闭 / `dismiss()` 已在关闭中 | 幂等，最多再调一次同一个动词 | 关闭中的卡片会把自己从注册表移除，之后 `presentedQuestion` 就取不到了；`dismiss()` 自身对重复调用也幂等（与面板按钮同源），所以就算时序上多按一下也不会重复取消。 |
| 按 `⌘⌥J` / `Ctrl+Alt+J` 时 `conversation.input` 不存在或 `for()` 抛错 | 告警一次，不消费 | 聚焦只有 `conversation.input.for(scope).focus()` 一条公开入口；scope 不是被保留的会话代际（切换中）时 `for()` 会抛，此时不动，也不聚焦错会话。 |
| Windows/Linux 布局把 `Ctrl+Alt`（AltGr）留给输入字符 | 若该组合被系统/布局吞掉，`Ctrl+Alt+J` 到不了 page | 固定行声明的是逻辑 `primary+alt`：macOS 上落成 `⌘⌥`，`⌘⌥` 系组合不被浏览器保留给字符输入，所以 AltGr 之忧不存在于 macOS；Windows/Linux 上仍是 `Ctrl+Alt`，个别布局会把 `Ctrl+Alt` 当 AltGr 用并吞掉这一按，此时该按不落地、也不误动作。 |
| 右侧栏折叠 / 只有一张页面 / 没有活动页 / 没有会话，按 `⌘⌥←/→` / `Ctrl+Alt+←/→` | 不动作、不消费 | 折叠时没有"当前显示的页面"可切换；页面数少于两张、当前页不在列表、或没有 on-screen 会话时没有可切的目标。这与面板键的"折叠即让位"同一条边界。 |
| 按 `⌘⌥K` / `Ctrl+Alt+K` 与内置 `session.search` 撞键 | **有意为之**：Web 上 `session.search` 的默认键位就是 `primary+alt+K`，本固定行一挂上，它在快捷键目录里就变成冲突（`effectiveShortcuts` 把固定行算进 `conflicts`） | 插件在 `shortcuts.registerFixed` 处占用这一按；设置里 `session.search` 显示「已被『聚焦右栏页面』占用」、按键不再打开搜索（搜索项本身仍可从左侧栏入口打开）。**连带副作用**：上游把"恢复全部默认"的校验也建立在这份冲突表上（`edit({type:'reset-all'})` 只要有任何一行带冲突就返回 `conflict`），所以在用户改动过快捷键、按钮可用的状态下点「恢复全部默认」会以冲突失败 —— 这是"固定行占住某个内置默认键位"必然的代价，删掉本条固定行（或上游把搜索挪到别的键位）后立即恢复。之所以仍选这个键：固定行是唯一够得着终端那一格的通道，而"聚焦右栏页面"的主要用场正是终端。 |
| 按 `⌘⌥K` / `Ctrl+Alt+K` 时右栏已展开、但可见 pane 尚未渲染 | 消费但不动焦点 | `focusPageTarget` 只要求"行在 + 右栏展开 + 有会话"，随后 `focusShownPage` 在 DOM 里找不到可见 pane 就返回 `false`。与页面切换键同一条纪律：**先消费再动作**，避免这一按落到输入控件或那条冲突的内置命令上；下一次按即可交棒。 |
| 右栏折叠、屏幕上只有一块**浮动**面板，按 `⌘⌥K` / `Ctrl+Alt+K` | 不动作、不消费 | 本键的"当前显示的页"与面板键 / 页面切换键同一口径：折叠态没有"右栏显示的页"，浮动面板不在范围内（即便它在屏幕上可见）。焦点在浮动面板内时，`⌘⌥K` 仍会被 xterm 吞掉（终端内那一格照常由捕获路吞下、不让它进 shell）。 |
| 显示器上那一页没有自己的输入面（如 diff / 文件预览），按 `⌘⌥K` / `Ctrl+Alt+K` | 消费，键盘交给 pane 容器 | `focusShownPage` 只对终端的 `.xterm-helper-textarea` 下探；其它页交棒到 pane 元素本身（dockkit 的 pane 容器可聚焦），与点一下面板同效。`readOnly` 的终端视为页面自己拒绝键盘，只聚焦 pane 容器。 |
| macOS 上按 `⌘⌥K` 是否会被 IME / 死键让位 | 不让位：`K` 在美式 / ABC 布局里**不是** dead key | 键盘适配器把 `event.key === 'Dead'` 读成 `composing`，本桥的准入会让位。实测（`UCKeyTranslate` 对当前布局）：Option+K 返回 `dead_key_state=0`、字符 `U+02DA`；Option+N / Option+E 才是 dead key（`dead_key_state≠0`，分别是 `˜` / `´`）。这也是上游只为 `KeyN` 写 `commandDeadKey` 特例、而 `session.search` 的 `⌘⌥K` 一直正常的原因。若用户的输入源把 Option+K 定义成 dead key（某些非美式布局），该平台上这一键会退化成不动作（不误动作）—— 与其它固定键同一条边界。 |
| 页面循环顺序 | 按 `tabsIn()`（`layout.tabs` 的记录顺序，≈ 打开顺序）循环，跨分屏 / 浮动 pane 一起循环 | 切页走公开服务面（`tabsIn` / `active` / `focus`），没有可读的 DOM 条带顺序；拖拽改序后循环顺序保持记录顺序不变。 |
| 终端里按 `⌘⌥←/→` / `Ctrl+Alt+←/→` | 照常切页并消费 | Windows/Linux 上 xterm 对"方向键 + 修饰"产出 `\x1b[1;7D` / `\x1b[1;7C` 转义序列并 `preventDefault()+stopPropagation()`——事件到不了 window 冒泡上的固定通道，观察者收不到、也就没法动作（macOS 上同一行是 `⌘⌥←/→`，xterm 不为它产出该序列，但事件同样要靠捕获阶段先看到）。所以本桥在 window **捕获阶段**另挂一个 keydown 监听（早于一切目标 / 冒泡处理器），**只**对会落进 `.xterm` 的按键拦下：判定与通道共用 `pageCycleTarget`，命中即 `preventDefault()+stopPropagation` 吞掉、顺带不让转义序列进 shell，未命中就放行。文本控件不吞箭头键，仍走通道；两条路共用同一判定、互斥不双触发。 |
| 其它也会 `stopPropagation` / `preventDefault` 的本地控件（若有） | 该按到不了通道，或到了也已读成"被消费" | 页面循环桥的捕获钩子**只认 `.xterm`**：它抢的是 `⌘⌥←/→` / `Ctrl+Alt+←/→`，那是终端唯一会为它停掉事件的组合，若将来出现别的会吞这对方向键的控件，需在同一钩子里补上它的范围。审批桥的捕获钩子则是**全 page 区域抢 `Enter` / `Esc`**（准入与让位同固定通道），所以"自己消费 `Enter` 的过程卡片"这一类已经由它兜住。 |
| 切页后的自动聚焦 | 只补位、不抢键盘 | `sidebar.focus()` 提交的是 store 变更，React 异步渲染，所以桥在**下一帧**才定位新显示的 pane（`[data-sidebar-right-session]` 根 + 带 `-active` 标记的可见 pane）。若新页面自己聚焦了（终端 body 在 `visible` 变化时聚焦 xterm），`document.activeElement` 已落在 pane 内，桥不碰键盘。 |
| 快捷键**展开**右栏（`sidebar.right.toggle`） | 面板确认展开后把键盘交到活动页自己的输入面（终端的 xterm） | 内置 toggle 走 `openWithPaneFocus`：`flushSync` 提交展开后**同步**聚焦活动 **pane 容器**——这一步发生在终端"`visible` 变化时自聚焦"之后，把刚落到 xterm 的焦点顶掉，此后 `visible` / `writable` 不再变化，终端不会二次自聚焦。补位**不假定展开与按键同步**：以 50ms 间隔有界轮询（≤800ms）`sidebar.isExpanded()`，面板一确认展开就在下一帧调用 `focusShownPage`；当焦点停在 pane 容器本身、而该页有输入面（`.xterm-helper-textarea`，`readOnly` 视为页面自己拒绝）时补位聚焦它；页面内部控件已持键盘则仍不碰。这一按**不消费**，owner 仍是内置 toggle；窗口内面板始终没展开则放弃（如按键被别的消费）。 |
| 换页签时页签行的滚动位置 | 跨切换保持观察窗口：相邻来回切时整行不动、能看见来源页签；也不再"先回到最左、再迅速滑到该页签" | dockkit 的 `TabLayout` 给每个 tab 一个 host，页签行只在**当前选中**那条 tab 的 host 里渲染，所以换页签必然是旧 chip box 卸载、新 chip box 挂载，新元素 `scrollLeft` 天然是 0（位置不跨重挂载保留）。kit 的 `useActiveChipInView` 在挂载 commit 的 layout 阶段做"**从 0 出发**的最小可见"修正：`scrollLeft = 0` 时左分支不可能成立，于是目标芯片一定被推到视野最右缘，来源（上一次的目标，本也在最右）被挤出视野；而 `.stripTabs` 的 `scroll-behavior: smooth` 又把这次写入变成从 0 开始的动画。插件注入 `[data-sidebar-right-session] [data-dockkit-strip-tabs] { scroll-behavior: auto }` 让写入瞬时，并在 `sidebar.focus()` 之前记下当前 chip box 的 `scrollLeft`、在下一帧里先还回去、只有目标不在窗口里时才做最小推移（见第 3 册第 5.4 节）。这一步**复刻**了 kit 的"最小可见 + 24px 边缘余量"（本插件唯一一处复刻上游几何的地方，因为要的语义是"以旧窗口为起点"）；跨 pane、目标尚未渲染、没记下窗口时不动作，走 kit 原规则。只覆盖插件自己驱动的切换：鼠标点芯片、别处命令切页仍走 kit 原规则（它们此前也是如此）。若上游改了 `[data-dockkit-strip-tabs]` / `[data-dockkit-tab]` / `[data-sidebar-right-session]` 任一标记，规则匹配不到、窗口也记不下：页签行照旧"重置 + 滑动 + 目标贴最右"，不误动作；若上游改了渐隐带宽度，最坏是目标与边缘的间距观感不同。 |
| 会话导航的候选口径：**只看左侧栏此刻渲染出来的会话行** | 不切换、不消费 | 候选不是从服务面推导的，而是读 `[data-row-key]` 行：折叠的工作区不渲染会话行、每个分组默认最多渲染 5 行（多出来的挡在「展开更多」按钮之后）、搜索过滤把列表区换成搜索结果（没有行标记）、窄 / 收起侧栏时整个列表区不渲染、「单列表」分组模式根本没有工作区分组行。这些都不是故障，而是「没被展示出来就不切」这条规则本身；副作用是候选会随侧栏的展开状态、分组方式与搜索词实时变化。两条会话键共用同一份候选，只是池子不同。 |
| 「未分组」桶里的会话 | 不进候选 | 「未分组」桶的分组键是空串，不是工作区：它既不占前三个名额，也不贡献候选。 |
| 左侧栏此刻没有渲染出任何会话行（或只有一个且已是当前会话） | 不动作、不消费 | 没有候选就没有可切的目标；只有一个候选且它就是当前会话时，「切」到自己没有意义，同样不动作、不消费。 |
| 当前会话不在候选里（它在第四个 / 别的工作区） | `⌘↑/↓` / `Ctrl+↑/↓`：`↓` 落候选首、`↑` 落候选尾；`⌘⌥↑/↓` / `Ctrl+Alt+↑/↓`：`↓` 落活跃池首、`↑` 落活跃池尾 | 当前会话由 `sessions.list` 的 `retainedBy.mainView` 给出；它不在池子里时按「进入池子」处理，方向决定落在哪一端。 |
| 「活跃」的判定口径 | 只有行上有状态点的会话进 `⌘⌥↑/↓` / `Ctrl+Alt+↑/↓` 的池子 | 三项状态事实取并集，全部读 `uiSession.sessionStatus`：`pendingInteraction !== undefined`（待审批 / 计划待审 / 待回答）、`completionUnread === true`（已完成未读那一颗绿点）、`running === true`（状态表读数缺席时退回会话目录的 `running`）。回合以出错收场时运行状态同样由 true 变 false 并亮起同一颗绿点，所以这类会话在池子里——DSH 的会话状态面**没有**独立的「出错」状态，桥不去猜一个不存在的读数。子智能体还在跑的会话也不进池子（那是行上的另一个 occupant，不是会话自己的状态）。 |
| 活跃池里唯一的活跃会话**正是**当前会话 | 不动作、不消费 | 池子里只剩当前会话，再按也没有可切的目标；**不**退回全部候选——常规导航是 `⌘↑/↓` / `Ctrl+↑/↓` 自己那一条，两条键各守各的池子。 |
| `primary+↓/↑`（不带 `Alt`，即 macOS `⌘↓/↑` / Windows/Linux `Ctrl+↓/↑`）在 Web 上被官方标为保留组合 | 固定键照常收到这一按 | `bindingIssue` 对 `runtime === 'web'` 的方向键组合返回 `reserved`，因此用户**不能**把某个可配置命令分配到 `⌘↓/↑` / `Ctrl+↓/↑`（macOS 的 `⌘` 形态与 Windows/Linux 的 `control` 形态一样受这条保留约束；固定行不受限制——`registerFixed` 只做规范化，不查保留表）。代价是命中候选时这一按会从文本框手里拿走浏览器自己的默认光标移动：没有候选、或目标就是当前会话时桥不消费，光标照常移动。 |
| 上游改了行标记 / 分组结构 / 归档标记 | 最坏情形是候选变空（不动作），不误动作 | 候选依赖三项文档事实：`[data-row-key]` 的 `workspace:` / `session:` 两种前缀（只有 Workspace browser 发布这个属性）、行的归属（HoverCard 包装下的「父节点的最近 `div` 祖先 = 分组容器；容器里第一个工作区行 = 它的分组行」）、归档行的 `aria-description` 标记。认不出归属的行直接丢掉，绝不猜它属于谁。 |
| `uiWorkspace` 服务缺席（没有 Workspace browser 的客户端） | 两条会话固定行都不安装，不告警 | 会话导航面由 Workspace browser 所在的客户端包提供；没有它既没有侧栏行、也没有可切换的动作。该服务名与其余三项一样声明在 `ctx.inject` 的依赖列表里：`ctx.get` 默认只认**已激活**的服务，而 Workspace browser 的客户端包依赖一长串服务（`layout` / `remote.directoryPicker` 等），激活可能晚于本插件，采样一次会把「还没激活」错判成「缺席」。 |
| `uiWorkspace` 在、但公开面形状不符（上游改了 `openSession` 的方法名） | 两条会话固定行都不安装，告警一次 | 本插件不把该包声明成类型依赖，只按结构读 `scope.get('uiWorkspace').openSession`（见下面第 21 条）；注入只保证服务来了，形状仍要运行时确认。 |
| 终端内按 `⌘↓/↑` / `Ctrl+↓/↑` 或 `⌘⌥↓/↑` / `Ctrl+Alt+↓/↑` | 照常切换并消费 | 与页面循环同一条机制：`.xterm` 内的 keydown 到不了固定通道的 window 冒泡监听，所以桥在 window **捕获阶段**另挂一个 keydown 监听，只对会落进 `.xterm` 的按键拦下（判定与通道路径共用 `sessionCyclePlan`，它一次解析出命中的是哪一条行、走哪个池子），其余按键放行。 |
| 会话切换后键盘落在哪里 | 键盘留在原地，桥不搬焦点 | 与点击那一行同一效果：`uiWorkspace.openSession()` 只换主视图会话，不聚焦任何人；新会话的 composer 是否取键盘由应用自己决定（页面切换键的「补位聚焦新页面」是另一条规则，见第 6 节）。 |

告警前缀统一为 `[dsh-focus-free-shortcuts]`，方便在控制台过滤。

---

## 8. 依赖的非正式契约

本插件**不重述上游已有的类型**：物理按键手势 / 绑定 / 两类快捷键目录行取自 `@deepseek-ai/dsh-client-shortcuts`（`NormalizedBinding` 走 `/protocol` 入口），会话目录、会话绑定与列表快照取自 `@deepseek-ai/dsh-api-session-controller/client`，会话 UI 状态与 `pendingInteraction` 槽位取自 `@deepseek-ai/dsh-client-ui-session/client`，待答审批取自 `@deepseek-ai/dsh-client-ui-approval/client` 的 `PendingApproval` / `ApprovalDecision`，待答提问取自 `@deepseek-ai/dsh-client-ui-user-questions/client` 的 `PendingQuestion`，会话级 `cancel()` 与 composer 输入面 `conversation.input`（`SessionInputResolver` / `SessionInput`）取自 `@deepseek-ai/dsh-client-ui-conversation/client` 的 `IConversation`，Sidebar 面取自 Cordis 上的 `Context['sidebarRight']`。会话导航面则把 `uiWorkspace` 声明为 Cordis 注入依赖、再按结构读 `scope.get('uiWorkspace')`（上游 `UiWorkspace` 的公开面，本插件不为它多拉一个类型依赖，见下面第 21 条）。全部类型都是 `import type`，打包时被擦除（客户端纯度门看不到它们）。

下面列的则是**不是正式对外契约**的事实，都与官方代码同源，但官方没有承诺"永不变名"。若上游改名，本插件会**退化成 no-op（什么都不做，但绝不误动作）**，并在诊断里说明。这份清单同时被 `check-css.mjs` 在构建后逐条 grep 上游构建产物（`css-contract.json`，见第 7 册第 9.1 节）：改名 / 搬走会在构建期显式失败并打印"哪条契约退化成什么"，而不是等到运行时静默退化。

1. 命令 id `pane.fullscreen.toggle` / `pane.split` / `page.close`（与官方 `shortcuts.register` 处同源）与它们"声明了哪些模态"的事实（`page.close` 的 `modals` 非空，弹窗下内置语义是关掉最上面那层弹窗）；
2. DOM 标记 `[data-conversation-session]` / `[data-conversation-region]`（与官方 stop guard 同源）；
3. `retainedBy.mainView` 的语义（与 `UiSession.isMain` 同源）；
4. 固定快捷键 id `approval.allow` / `approval.reject`（与官方 `shortcuts.registerFixed` 处同源）与其"预约的物理组合就是审批决定键"的语义；
5. DOM 标记 `[data-approval-key]`（与官方审批面板根节点、以及内置 stop guard 的让位选择器同源）；
6. `pendingInteraction` 槽位的**运行时**形状：类型就是官方的 `PendingApproval`，但该槽位可被别的域复用，所以 `asAnswerableApproval` 仍在运行时确认 `kind === 'approval'`、`key` 为字符串、`answerable === true`、`answer` 为函数之后才代答；
7. 固定键 id `dsh-focus-free-shortcuts.focus-composer` 与它声明的逻辑组合 `primary+alt+KeyJ`（`registerFixed` 按设备平台规范化成生效的物理绑定：macOS 落成 `meta+alt+KeyJ`（`⌘⌥J`），Windows/Linux 落成 `control+alt+KeyJ`（`Ctrl+Alt+J`）；本插件自己在 `shortcuts.registerFixed` 处声明，约定是"存在即预约、跟随挂载行"，同 `approval.allow` / `approval.reject` 的语义）；
8. `conversation.input`（`SessionInputResolver.for(scope)`）与它返回的 `SessionInput.focus()` 语义——与应用在遮罩结束后把键盘还给 composer 用的是同一个操作，光标还原；若上游改了这个入口，聚焦键退化为 no-op 并告警；
9. 固定键 id `dsh-focus-free-shortcuts.page-cycle` 与它声明的两个逻辑组合 `primary+alt+ArrowLeft` / `primary+alt+ArrowRight`（`registerFixed` 按平台落成 `meta+alt`（macOS `⌘⌥←/→`）或 `control+alt`（Windows/Linux `Ctrl+Alt+←/→`）；本插件自己在 `shortcuts.registerFixed` 处声明；同一行两个绑定 = 上一页 / 下一页两个方向，约定同第 7 条）；
10. DOM 标记 `[data-sidebar-right-session]` / `[data-dockkit-pane]` / `[data-dockkit-float]`（含 `-active` 后缀与 `data-sidebar-right-open`）——自动聚焦步的 pane 选择与官方 `visibleSidebarPane` 同源；该函数不在包 `/client` 的公开导出里，所以按同一份标记重写"活动标记优先、否则第一块可见 pane"的三选逻辑。`[data-sidebar-right-session]` 同时出现在**会话包装 div 与内层面板 div** 上（同 id、嵌套）：会话根按"取带 `data-sidebar-right-open` 者、否则取最深者"复刻 `closest()` 的"最内层 owner"语义（内层面板才带 `data-sidebar-right-open` 并持有 panes）。若上游改了标记，聚焦退化为只切页不聚焦（no-op），不误动作。
11. 终端的 `.xterm` 类——与官方键盘适配器判定 `terminal` 区域用的是同一个类（同为 `dsh-client-ui-sidebar-terminal` 的 xterm 根）。捕获阶段拦截**只**认 `closest('.xterm')` 命中的按键，其余按键一律放行给固定通道；每条桥的两路共用同一个判定（`pageCycleTarget` / `sessionCyclePlan` / `focusComposerTarget` / `sessionNewPress`），互斥不双触发。若上游改了终端根类名，终端内这些键会退化（该按到不了通道、捕获钩子也不再认它），但不会误动作。
12. 模态选择器 `[role="dialog"][aria-modal="true"], [role="menu"]`——与 `@deepseek-ai/dsh-client-ui-primitives` 的 `modalSelector` 同源。捕获阶段跑在键盘适配器算出 `context.modal` **之前**，桥自行按这份选择器复推"当前是否有模态层"，再交给共享判定，使两路的模态否决一致。若上游改了选择器，最坏情形是捕获路径在模态层打开时仍切页（与通道路径的否决不一致），不误动作。
13. `pendingInteraction` 槽位的**提问域运行时形状**：类型就是 `@deepseek-ai/dsh-client-ui-user-questions/client` 的 `PendingQuestion`，但该槽位是复用的，所以 `asDismissableQuestion` 仍在运行时确认 `kind` 为 `'question'` 或 `'plan-review'`、`key` 为字符串、`dismiss` 为函数之后才代关（第 6 条是审批侧的同一条约定；两侧共用同一个槽位、靠 `kind` 分工，谁都不越界）。
14. DOM 标记 `[data-question-key]` / `[data-plan-review-key]`（提问卡片两处根节点携带请求 key 的属性名）：`questionCardOwnsTarget` 先用 `closest('[data-question-key], [data-plan-review-key]')` 找到卡片，再要求**该元素自身的属性值恰好等于本次待答提问的 `key`**——因此过期卡片、另一次调用的 review 卡片、以及没有 `getAttribute` 的裸节点都匹配不上。若上游改了标记名、或把 key 挪到子节点上，`editable` 区域内的 `Esc` 会退化成"不再取消"（不误动作），而卡片之外的文本控件本来就保留自己的 `Esc`。
15. `PendingQuestion.dismiss()` 的语义（卡片关闭 / 取消按钮调用的同一个公开动词），按上游卡片的形状分三种：提问卡片（`kind === 'question'`）带工具调用线索时是 `hide`——只收起面板，请求继续等待、倒计时照跑，`ask_user_question` 的工具调用行能重新打开它；同一 `kind` 里 Host 未命名（没带 `wait`，因而没有 call id）的阻塞式请求则把整个等待拒绝为 `ASK_CANCELLED`（按钮自己的标签是「取消」/「放弃整组问题」/「Dismiss all questions」）；**活着的** plan-review 卡片（`kind === 'plan-review'`，`exit_plan_mode` 的 Approve / Request changes）的 `dismiss()` 就是「Request changes」按钮的动词，同样是"带线索收起面板 / 未命名以 `ASK_CANCELLED` 结束等待并把 composer 交回写反馈"；而从 `ask_user_question` 工具调用行重新打开的只读 review 卡片（`review !== undefined`，可承载两种 `kind`）是回看、没有作答通道也没有倒计时，`dismiss()` 就是 `card.remove`。插件**只**调这一个动词、从不调 `answer()`，所以 `Esc` 与"点关闭 / 取消按钮"永远同义；若上游改了 `dismiss()` 的语义，取消行为会跟着变（但不会变成代答）。
16. **焦点环的两块拼图**（`src/focus-ring.ts`；两处都与官方同源、都必须同时成立才会画出边框）：
    - `html[data-input-modality]` 属性由 shell（`@deepseek-ai/dsh-client-ui-primitives` 的 `src/input-modality.ts`，随 web 前端 bundle 在**页面加载时**注册，早于任何客户端插件）发布：`pointerdown` 发布 `pointer`；**非组字的导航键**（Tab / 方向键 / Home / End / PageUp / PageDown），或**非组字按键之后焦点落在另一个控件上**，发布 `keyboard`；同一个控件重新聚焦不算。
    - 焦点环本身来自 `@deepseek-ai/dsh-client-ui-theme` 的 `focus.css`：`:focus-visible{outline-color:var(--dsw-focus-ring-color,…);outline-width:var(--dsw-focus-ring-width)}`，并在 `html[data-input-modality=pointer] body :focus-visible:not(:read-write)` 下把环色设为透明——所以指针模态下不画环，键盘模态下才画。
    17. `data-dsh-automatic-focus` 标记（官方 `focusWithoutRing(element)` 用的同一个属性）：主题的 `base.css` 把它翻成 `[data-dsh-automatic-focus]:focus{outline:none}`，官方在 blur 或导航键（Tab / 方向键 / Home / End）时移除标记、恢复正常焦点样式。本插件在"把按键从某个控件手里拿走"之后给该控件打上同一标记，从而**不移动焦点**地去掉那圈边框，并按同一套释放规则在 `src/focus-ring.ts` 里自行摘除（本 bundle 不引入 primitives 的运行时依赖）。若上游改了这个属性名或释放规则，最坏情形是边框照旧出现，不误动作。
18. DOM 标记 `[data-row-key]`（Workspace browser 的行标记）与它的取值：分组行 `workspace:<workspaceId>`、「未分组」桶同样是 `workspace:`（键为空串）、会话行 `session:<sessionId>`，另有两种**不是会话**的行 `empty`（空列表占位）与 `overflow:<groupKey>`（「展开更多」按钮）。只有 Workspace browser 发布这个属性（轨迹视图用的是 `data-trajectory-row-key`、搜索结果是普通 `role="treeitem"`、子代理下拉也没有），所以会话导航桥全文档扫一遍不会收到别处的行。若上游改了标记名，候选退化为空（不动作、不误动作）。
19. 分组结构与归属判定：每个分组渲染成「分组容器 `div` > 自己的分组行 →（嵌套子分组）→ 自己名下的会话行 →（「展开更多」行）」，而分组行与会话行外面各包着一层 HoverCard 的 `span`。会话导航桥据此归属：**会话行父节点的最近 `div` 祖先就是分组容器，容器里第一个工作区行就是它自己的分组行**。嵌套子分组排在父分组自己的会话行之前，所以「工作区树」模式下父分组自己的会话行仍归父分组；「单列表」模式下会话行的最近 `div` 祖先是列表本身、里面没有工作区行，这些行直接丢掉。
20. 归档行标记 `aria-description`（官方只对归档行写「已归档，不可打开」的提示文案）与官方 `guardedOpen` 的语义（打开归档行只弹提示、不切换）。会话导航桥据此把归档行排除在候选之外。若上游改用别的标记，最坏情形是归档行回到候选里——按下去弹一次提示、不切换会话，仍然不误动作。
21. `uiWorkspace.openSession(sessionId)` 的语义（上游 `UiWorkspace` 的公开面里本插件唯一要用的动词：选中一个会话并把它的 Conversation 显示出来，与点击侧栏那一行完全同路，只换主视图、不聚焦任何人）。本插件不为它多拉一个类型依赖，但把 `uiWorkspace` 写进会话导航桥的注入依赖列表，等服务**激活**后再按结构读 `scope.get('uiWorkspace')` 的 `openSession`（`ctx.get` 默认只认已激活的服务；Workspace browser 的客户端包激活可能晚于本插件，采样一次会把「还没激活」误判成「缺席」而永不安装）。服务缺席（没有 Workspace browser 的客户端）时 Cordis 不跑桥的回调，整条桥不安装、也不告警；服务在而形状不符（上游改了这个方法名）时告警一次 `uiWorkspace service unavailable; session-cycle keys not installed`、整条桥同样不安装。
22. 固定键 id `dsh-focus-free-shortcuts.session-cycle` 与它声明的两个逻辑组合 `primary+ArrowUp` / `primary+ArrowDown`（走全部候选，macOS 落成 `⌘↑` / `⌘↓`、Windows/Linux 落成 `Ctrl+↑` / `Ctrl+↓`），以及 `dsh-focus-free-shortcuts.session-active-cycle` 与它声明的 `primary+alt+ArrowUp` / `primary+alt+ArrowDown`（只走活跃池，macOS 落成 `⌘⌥↑` / `⌘⌥↓`、Windows/Linux 落成 `Ctrl+Alt+↑` / `Ctrl+Alt+↓`）：两条行都由本插件自己在 `shortcuts.registerFixed` 处声明，约定同第 7 / 9 条（存在即预约、跟随挂载行；同一行两个绑定 = 两个方向）。两条行的归属靠修饰键集合互斥（有没有 `Alt`），所以同一按至多命中一条。活跃池的三项状态事实（`pendingInteraction` / `running` / `completionUnread`）取自官方 `SessionStatus` 类型，是有类型保证的公开读数——本插件只做「任一成立即活跃」的并集，不引入自己的状态表。
23. DOM 标记 `[data-dockkit-strip-tabs]`（dockkit 放在页签行 chip box 上的稳定标记）、`[data-dockkit-tab]`（每个页面芯片，取值即 tab id）与它们的右侧栏会话根 `[data-sidebar-right-session]`：`src/strip-scroll.ts` 靠这三项标记把 `scroll-behavior: auto` 只作用在右侧栏的 chip box 上，并做切页前后的"窗口保持"（记 / 还 `scrollLeft`，目标不在窗口里时按"最小可见 + 24px 边缘余量"推移）。芯片查找与 `page-cycle.ts` 的 `sidebarRoot` 同一条纪律：**不把 id 拼进选择器**，取回候选后按属性值比较，并要求芯片的最近会话根就是本次会话（页面 id 由各面自己铸造，不跨面比较）。样式刻意不写 dockkit 的哈希类名、不用 `!important`（两个属性选择器的特异性已高于类规则）。第 3 步的"最小可见 + 24px"是本插件唯一一处复刻上游几何的地方——上游那条规则以 0 为起点，插件要的语义是"以旧窗口为起点"，只能自己算；若上游改了渐隐带宽度，最坏是目标芯片与边缘的间距观感不同、不误动作。若上游改了任一标记，规则匹配不到、窗口也记不下，整体退化成 kit 原来的行为（重置 + 滑动 + 目标贴最右），同样不误动作。样式标签按持有者计数共享一个 `<style>`（`data-plugin-css="dsh-focus-free-shortcuts/strip-scroll"`），复用到已有标签时不由本实例摘除，本实例插入的标签在最后一个持有者卸载时移除。
24. 命令 id `session.new`（与官方 `shortcuts.register` 处同源）、它 Web 上的默认绑定 `primary+alt+KeyN`（macOS `⌘⌥N`、Windows/Linux `Ctrl+Alt+N`；桌面端是 `primary+KeyN`）与它的 `regions` 只有 `page` / `editable` 这一事实：`src/session-new.ts` 只在**捕获阶段**、且目标落在 `.xterm` 内时按**生效目录**里那一行当前的绑定出手（`enabledBinding` + `bindingMatches`，所以改绑 / 解绑 / 有 issue / 冲突都立刻跟随），其余位置一概让位。若上游改了这个命令 id，本桥读不到行、退化为 no-op（不误动作）；若上游把 `terminal` 加进 `regions` 并让适配器在终端里也能收到这一按，本桥会与内置命令同时动作 —— 那时应当整条删掉（它的存在理由只是补内置够不着的那一格）。
25. `uiWorkspace.startSession(workspaceId?)` 的语义（上游 `UiWorkspace` 的公开面：走一次"新建会话"流程并导航到那个会话，不带参数 = 沿用当前 / 最近的工作区；就是内置 `session.new` 的 `run()` 调的那一个动词）。与第 21 条同一条纪律：把 `uiWorkspace` 写进注入依赖列表、等服务**激活**后再按结构读 `scope.get('uiWorkspace')` 的 `startSession`（`ctx.get` 默认只认已激活的服务，采样一次会把「还没激活」误判成「缺席」）。服务缺席时 Cordis 不跑桥的回调，整条桥不安装、也不告警；服务在而形状不符（上游改了这个方法名）时告警一次 `uiWorkspace service unavailable; session.new key not bridged into the terminal`、整条桥同样不安装。
26. 固定键 id `dsh-focus-free-shortcuts.focus-page` 与它声明的逻辑组合 `primary+alt+KeyK`（`registerFixed` 按设备平台规范化成生效的物理绑定：macOS 落成 `meta+alt+KeyK`（`⌘⌥K`），Windows/Linux 落成 `control+alt+KeyK`（`Ctrl+Alt+K`）；本插件自己在 `shortcuts.registerFixed` 处声明，约定同第 7 / 9 / 22 条：存在即预约、跟随挂载行）。交棒本身**不引入新的 DOM 锚点**：它复用第 10 条（`[data-sidebar-right-session]` / `[data-dockkit-pane]`（含 `-active`）/ `data-sidebar-right-open`）、第 11 条（`.xterm`）与页面切换桥的 `.xterm-helper-textarea` 下探，判定函数就是 `page-cycle.ts` 导出的 `focusShownPage`（同一份实现，两条键共用）。另有一条**与上游命令目录相撞**的非正式事实：Web 上 `session.search` 的默认绑定是 `primary+alt+KeyK`，本固定行会让它变成冲突行（见第 6 / 7 节）。若上游把 `session.search` 挪到别的键位，冲突消失、本键不受影响；若上游改了 pane / 会话根 / 终端标记，交棒退化为 no-op（最坏是只消费、不动键盘），不误动作。
