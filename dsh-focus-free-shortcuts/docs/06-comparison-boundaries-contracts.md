# 与内置命令的对照、已知边界与依赖契约

> 本文件是 [dsh-focus-free-shortcuts 说明](../README.md) 的第 6 册：完整对照表、已知边界与失败模式、依赖的几条非正式契约。

---

## 6. 与内置命令的完整对照

| 场景 | 内置命令（没有插件时） | 本插件（装了之后） |
|---|---|---|
| 焦点在输入框，按 `⌘⌥Enter` | `noFocus`，消费但不动作 | 取活动 dock pane，正常全屏 |
| 焦点已在面板内，按 `⌘⌥Enter` | 正常全屏 | 让位，不动作、不消费 |
| 面板折叠，按 `⌘⌥Enter` | 无动作 | 无动作（先用展开键展开，展开会顺手聚焦活动 pane） |
| 焦点在侧栏容器内、但不在 pane 内（如侧栏边距） | `noFocus` | `commandTarget` 按官方语义返回 `undefined`，无动作 |
| 内置键位被改绑 | 跟随新键 | 同样跟随新键（读生效绑定） |
| 内置键位被解绑 / 被系统保留 / 冲突中 | 不响应 | 不响应（`enabledBinding` 返回 `undefined`） |
| 模态弹窗打开，按面板键 | 消费并 `blocked`（modal） | 让位，不动作、不消费 |
| 焦点在 composer，`Esc Esc` | 正常停止 | 让位，不动作、不消费 |
| 焦点在 `<body>`（点过空白处），`Esc Esc` | 第一下 Esc 就被丢弃，无动作 | 主视图会话停止 |
| 存在待答交互（审批/提问） | 不停止 | 不停止 |
| 焦点在审批详情区，按 `Enter` / `Esc` | 面板自己作答（允许一次 / 拒绝） | 让位，不动作、不消费（目标落在 `[data-approval-key]` 内） |
| 焦点在 `<body>`（审批把 composer 隐掉后焦点退回），按 `Enter` | 无人处理（面板收不到这一按） | 主视图会话的审批：允许一次 |
| 同上，按 `Esc` | 无人处理 | 主视图会话的审批：拒绝（一下即拒，不走双按停止） |
| 焦点停在某张**过程卡片**上（工具卡 `div[role="button"][tabindex="0"]` / 轨迹行 `tr[tabindex="0"]`），按 `Enter` | 卡片自己折叠 / 选中：卡片自己的 React 处理器先跑并 `preventDefault()`，等这一按冒泡到固定通道时已被认领，审批无人处理 | 主视图会话的审批：允许一次，且**卡片收不到这一按**（捕获路先 `stopPropagation()` 再作答，卡片不再折叠 / 选中） |
| 同上，按 `Esc` | 无人处理（卡片只绑 `Enter` / `Space`，这一按冒泡到固定通道后由审批桥按旧路拒绝） | 主视图会话的审批：拒绝（捕获路合规则由捕获路拦下，否则固定通道接手；两条路互斥，不双答） |
| 同上，作答之后那张卡片的外观 | 卡片被再次折叠 / 选中；作答后可能留下一圈焦点边框（作答把键盘交回 composer，应用切到键盘模态，`html[data-input-modality]` 一变，卡片原本透明的 `:focus-visible` 环就显形了） | 卡片收不到这一按、**且不留焦点边框**：桥在拿走这一按的同时给该控件打上 `data-dsh-automatic-focus`（官方"无环聚焦"标记），焦点未移动，环不显形；下一次 Tab / 方向键导航或失焦即恢复正常焦点样式 |
| 有待答审批时按 `Esc` | 不停止（`currentTurn()` 因待答返回 `undefined`） | 不停止，改为拒绝该审批 |
| 有待答提问时按 `Esc` | 不停止（`currentTurn()` 因待答返回 `undefined`），也没有任何一方取消卡片（卡片自己完全不绑 `Esc`） | 不停止，改为取消该提问（调卡片关闭 / 取消按钮的同一个 `dismiss()`，一下即取消，不走双按停止） |
| 待答提问是提问卡片（`kind === 'question'`）里"带工具调用线索"的那一类（`dismissal === 'hide'`） | 无人处理 | `dismiss()` 只收起面板：请求继续、倒计时照跑，问题仍可从它的 `ask_user_question` 工具调用行重新打开 |
| 待答提问是提问卡片（`kind === 'question'`）里 Host 未命名（请求没带 `wait`、没有 call id）的阻塞式请求 | 无人处理 | `dismiss()` 以 `ASK_CANCELLED` 结束整组等待（与按钮「取消」/「放弃整组问题」/「Dismiss all questions」同一语义） |
| 待答提问的 `kind === 'plan-review'`（`exit_plan_mode` 的 Approve / Request changes 卡片） | 无人处理 | `Esc` 调 `dismiss()`——就是「Request changes」按钮的那个动词：带工具调用线索时只收起面板（`hide`，计划仍可从工具调用行重开），Host 未命名时把等待拒绝为 `ASK_CANCELLED` 并把 composer 交回给用户写反馈 |
| 从 `ask_user_question` 工具调用行重新打开的**只读 review 卡片**（已定局的提问回看） | 无人处理 | 这类卡片没有作答通道、没有倒计时，`dismiss()` 是 `card.remove`（移除卡片）。它可以承载 `question` 或 `plan-review` 两种 `kind`，所以"活卡片 / 只读回看"不是靠 `kind` 分辨，而是上游 `review !== undefined` 的那条渲染路径 |
| 焦点在提问卡片自己的答案文本域（`editable`）里，按 `Esc` | 该文本域自己处理（它只绑 `Enter`，所以实际无动作） | 照常取消卡片（提问桥**刻意**放宽到 `editable`，但只认这一张卡片；见第 5 册第 5.7.1 节） |
| 焦点在提问卡片之外的文本控件（侧栏搜索框、重命名框），按 `Esc` | 控件自己处理 | 控件自己处理（归属收口到"这一张卡片"之外，不消费） |
| 有待答提问时按 `Enter` | 卡片自己处理（只认卡片选项 / 字段上的 `Enter`，焦点不在卡片里则无人处理） | 卡片自己处理：提问桥只看 `Esc`，完全不碰 `Enter` |
| 主视图持有会话数 ≠ 1（正在切换），有待答提问 | 无人处理 | 不取消、不消费（提问卡片属于哪个会话有歧义） |
| 待答提问属于别的会话（如后台子代理） | 无人处理 | 不取消、不消费；主视图自己没有待答提问时这一按照旧归停止序列 |
| 提问包（`@deepseek-ai/dsh-client-ui-user-questions`）没装载（桌面端即如此：该包声明 `dsh.client.platform: "web"`） | 无提问卡片可关 | 提问桥 no-op，不消费：没有提问包就永远不会发布提问域的 `pendingInteraction`，桌面端也因此不需要任何额外的运行时守卫 |
| 审批面板聚焦在"拒绝"按钮上，按 `Enter` | 触发按钮自身（拒绝） | 让位，仍是拒绝（目标在面板内） |
| 焦点在输入控件 / 终端内，按 `Enter` / `Esc` | 控件自己处理 | 审批键：控件自己处理（`region !== 'page'` 直接否决）；提问键：仅当 target 落在**这一张**提问卡片内（它的答案文本域正是 `editable`）才接管，其余照旧归控件 |
| 审批插件没装载（固定行缺席） | 无审批可答 | 审批桥 no-op，不消费 |
| 桌面端（Desktop）按面板键 | native 通道派发 | **不安装面板桥**（见第 7 节） |
| 桌面端 `Esc Esc` / 审批键 / 提问卡片 `Esc` | DOM 固定通道驱动，正常；提问卡片是 Web 独有特性，桌面端根本没有这张卡片 | 停止桥、审批桥与提问桥照常安装，正常；提问桥在桌面端是 no-op——没有卡片就没有提问域的 `pendingInteraction`，也没有会重复处理的那一按 |
| 按 `Ctrl+Alt+J`（任意焦点位置） | 没有任何命令占用，浏览器默认无动作 | 主视图会话的 composer 输入面 `focus()`：键盘回到输入框，光标还原 |
| 焦点已在输入框，按 `Ctrl+Alt+J` | 无动作 | 重新聚焦（幂等，光标不动） |
| 焦点在文本控件 / 终端内的 `Ctrl+Alt+J` | 控件自己处理 | 文本控件内接管（这正是这把键的目的）；终端内让位 |
| 模态层打开，按 `Ctrl+Alt+J` | 模态层掌权 | 让位，不动作、不消费 |
| 主视图会话数 ≠ 1 或没有会话，按 `Ctrl+Alt+J` | — | 不动作、不消费（没有可聚焦的 composer） |
| 任意焦点位置按 `Ctrl+Alt+→` / `Ctrl+Alt+←` | 没有任何命令占用，浏览器默认无动作 | 右侧栏切成当前页的下一页 / 上一页（环状）；切完把键盘交给新显示的页面（页面自聚焦如终端时则不抢，只补位） |
| 焦点在文本控件里按 `Ctrl+Alt+←/→` | 控件自己处理（本组合无动作） | 照常切页并消费（**刻意不看** `defaultPrevented`、不限制 region——“焦点在页面里快捷键依然有效”） |
| 焦点在终端里按 `Ctrl+Alt+←/→` | 终端把箭头当普通输入处理并 `preventDefault()+stopPropagation()`（事件到不了固定通道） | 捕获阶段在 `.xterm` 之前拦下并照常切页（这正是“焦点在终端里依然能切页”的实现方式） |
| 右侧栏折叠，按 `Ctrl+Alt+←/→` | 无动作 | 不动作、不消费（没有"当前显示的页面"；与面板键同一条边界） |
| 只有一张页面 / 没有活动页 / 没有会话，按 `Ctrl+Alt+←/→` | 无动作 | 不动作、不消费（没有可切的目标） |
| 模态层打开，按 `Ctrl+Alt+←/→` | 模态层掌权 | 让位，不动作、不消费 |

---

## 7. 已知边界与失败模式

每一条都说明"为什么"，而不只是"是什么"。

| 情况 | 行为 | 为什么 |
|---|---|---|
| Desktop 运行时 | 面板桥不安装并告警一次；停止桥、审批桥与提问桥照常安装（提问桥在桌面端为 no-op） | 桌面端 macOS/Windows 的可配置键位由 Electron 原生键盘桥派发，DOM 侧的 `consume()` 压不住那一次派发，两边都动作会来回抵消（全屏两次）。而停止序列、审批键与提问卡片取消在两端都由 DOM 固定通道驱动（`installKeyboard` 的 `fixed?.()` 在 native 分支 `return` **之前**执行），并且都不是可配置绑定，所以这三条桥可以照常装。不过提问卡片本身是 **Web 独有**的客户端特性（`@deepseek-ai/dsh-client-ui-user-questions` 声明 `dsh.client.platform: "web"`）：桌面端没有人发布提问域的 `pendingInteraction`，提问桥装上也没有可读的待答提问。所以这里不需要"是否只在 Web 安装"的运行时判断——这条桥压根没有可配置绑定可供原生桥重复派发，桌面端也不存在会被两家同时看到的那一按。 |
| `sidebarRight` 服务缺席 | 面板桥不安装，插件整体仍 no-op，不抛 | 面板桥通过 `ctx.inject(['shortcuts', 'sidebarRight'], ...)` 依赖侧栏服务，服务不存在时注入不解析、这段逻辑根本不跑；停止桥独立，不受影响。 |
| `shortcuts.observeFixedInput` 缺席 | 各告警一次，不安装 | 整个方案都建立在固定输入通道上；没有这个 API 就没有可挂的点，只能放弃。提问桥的告警原文是 `shortcuts service exposes no observeFixedInput; question bridge not installed`，各桥各留一行、互不冒充。 |
| 主视图持有会话数 ≠ 1（正在切换） | 不停止 | `mainViewSessionId` 要求恰好一个会话被主视图 retain。切换过程中可能出现两个会话同时被 retain 的瞬间，此时"当前会话"有歧义，宁可这一下不响应，也不停错会话。 |
| 会话无 `running` / 已 `removed` / 子代理不可续 / 有待答交互 | 不停止 | 这些是内置 `currentTurn` 的同一批门槛；不满足说明"没有可停的轮次"或"此时不该停"。 |
| 某会话 scope 上没有 `conversation` | 告警一次，不发停止 | `conversation.cancel()` 是停止的唯一入口；服务缺失时无法停，只能告警。 |
| `cancel()` 拒绝（返回 rejected Promise） | 捕获并告警，不冒泡 | 避免未处理的 Promise 拒绝污染控制台/运行时。 |
| 两按之间轮次恰好结束并立刻开启新轮次 | 500ms 窗口内仍会停到新轮次 | 内置序列要求两按的 `(sessionId, turn, generation, region)` 全同，其中 `turn` 能区分"轮次 A"和"轮次 B"；插件只用 `(sessionId, generation)`，轮次身份不是公开事实。所以"第一下在轮次 A 结束前、第二下落在刚开的新轮次 B"这种窗口内，插件仍会停 B，内置则会因 `turn` 变化而复位。 |
| 焦点在侧栏容器内、但不在 pane 内 | `commandTarget` 返回 `undefined`，无动作 | 官方 `commandTarget` 故意对"target 在 `[data-sidebar-right-session]` 内但不在 pane 内"的陈旧标记**不回退**（防止误回退到另一面板），插件尊重这个语义，此时与内置一样不动作。 |
| 主视图持有会话数 ≠ 1（正在切换），有待答审批 | 不代答 | `presentedApproval` 只认被主视图唯一保留的那个会话；歧义时宁可这一下不响应，也不答错请求。 |
| 待答审批属于别的会话（如后台子代理） | 不代答 | composer 顶替面板只渲染"当前会话"的待答交互；别的会话的审批在插件这条路上没有可见面板，代答等于替用户做了一个他没看见的决定。 |
| 待答交互不是审批（如提问） | 不代答 | `pendingInteraction` 这个槽位是复用域；`asAnswerableApproval` 要求 `kind === 'approval'`，别的域留给它自己的 UI（提问域由第 6 组的提问桥接手，见第 5 册第 5.6.3、5.7.1 节）。 |
| 审批已作答 / 已撤销 / 被中止（`answerable === false`） | 不代答、不消费 | 请求已定局，再答会被 `PendingApproval` 的锁拒绝；插件提前让位，把这一按留给别的 owner。 |
| 焦点停在过程卡片上（工具卡 / 轨迹行，卡片自己会用 `preventDefault()` 消费 `Enter`） | 照常代答，并吞掉这一按 | 固定通道是 window **冒泡**监听，晚于卡片自己的 React 处理器——那一按到不了它，或者到了也已读成"被消费"。所以审批桥另挂 window **捕获**监听，在卡片之前读到同一按，命中即 `preventDefault() + stopPropagation()`：卡片完全收不到，审批照常作答。 |
| 作答后按下的那个控件 | 保留焦点，但**不画焦点边框**（打上 `data-dsh-automatic-focus`） | 作答会把键盘交回 composer，应用随即切到键盘模态（`input-modality` 跟踪器的"按键之后焦点落到别的控件"分支），此后 `:focus-visible` 的环色不再是透明——被按下的控件自己没做错任何事，却会因此显出一圈边框。桥在拿走按键的同时给该控件打上官方"无环聚焦"标记，焦点位置不变；下一次 Tab / 方向键导航或失焦时按官方同一套释放规则摘除标记，恢复正常焦点样式。若上游改了这个属性名，最坏情形是边框照旧出现（回到修复前的观感），不误动作。 |
| 审批键被按下时焦点在 `editable` 或 `terminal` 区域 | 不代答、不消费 | 与面板自己的守卫同源："输入控件与 IME 候选保持自己的按键"。正常路径上 composer 已被顶替隐藏、焦点退回 `<body>`（`page`），所以这条不会挡住用户的正常操作。 |
| 模态层打开时按审批键 | 不代答、不消费 | 模态层之上的按键属于模态层（Web/Linux 的模态层本来就会挡住后台命令）；此时审批面板在模态层之下，代答会越过用户正在看的界面。 |
| `answer()` 拒绝（返回 rejected Promise） | 捕获并告警，不冒泡 | 与 `cancel()` 同理，避免未处理的 Promise 拒绝污染控制台/运行时。 |
| 待答提问是提问卡片（`kind === 'question'`）里"带工具调用线索"的那一类（`dismissal === 'hide'`） | `Esc` 只收起面板；问题本身没有被拒绝，仍可从它的工具调用行重新打开 | `dismiss()` 对这类卡片走的是 `hide`：请求原样等待、倒计时继续，面板只是从 composer 座位撤下。这条语义来自上游包，插件只调用这一个动词，不自行决定"取消到底发生了什么"。 |
| 待答提问是提问卡片（`kind === 'question'`）里 Host 未命名（请求没带 `wait`、没有 call id）的阻塞式请求 | `Esc` 以 `ASK_CANCELLED` 结束整组等待 | 这类请求没有可返回的工具调用行，`dismiss()` 的语义就是把整个等待拒绝为 `ASK_CANCELLED`（卡片那个按钮自己的标签是「取消」/「放弃整组问题」/「Dismiss all questions」）。`Esc` 必须与点那个按钮同义，才谈得上"把这一按接过来"，而不是"另做一件用户没要求的事"。 |
| 待答提问的 `kind === 'plan-review'`（`exit_plan_mode` 的 Approve / Request changes 卡片） | `Esc` 调 `dismiss()`，与「Request changes」按钮同义 | 这是**活着的** plan-review 展示：`dismiss()` 就是那个按钮的动词——带工具调用线索时收起面板（计划仍在，可从工具调用行重开），Host 未命名时以 `ASK_CANCELLED` 结束等待并把 composer 交回给用户写反馈。 |
| 从 `ask_user_question` 工具调用行重新打开的只读 review 卡片（已定局的提问回看） | `Esc` 直接移除卡片 | 这类卡片没有作答通道、没有倒计时，`dismiss()` 是 `card.remove`；它可以携带 `question` 或 `plan-review` 两种 `kind`，所以 `asDismissableQuestion` 不试图用 `kind` 分辨"活卡片 / 只读回看"——两种情形都由同一个 `dismiss()` 正确收场。 |
| 焦点在 `editable` 区域，但不是这张提问卡片（侧栏搜索框、重命名框） | 不取消、不消费，控件保留自己的 `Esc` | 卡片自己的答案字段是 `<textarea>`（`region` 为 `editable`），所以准入**刻意**不排 `editable`；"这一按属不属于本卡片"改由 `questionCardOwnsTarget` 收口——`closest('[data-question-key], [data-plan-review-key]')` 要命中，且该元素**自身**的属性值必须等于本次待答提问的 `key`。放行准入不等于放行所有文本控件。 |
| 焦点在提问卡片自己的答案文本域里，有待答提问 | 照常取消卡片 | 那个文本域的 `keydown` 只处理 `Enter`（自由文本问题还会自动聚焦它），`Esc` 在这里同样没有别的 owner；这正是放宽 `editable` 的目的。 |
| 焦点在终端内，且有待答提问 | 不取消、不消费，终端保留自己的 `Esc` | 与其它几条 `Esc` 桥同一门槛 `context.region !== 'terminal'`：终端的 `Esc` 属于终端（可能是它自己的取消 / 中断语义）。 |
| 模态层打开，且有待答提问 | 不取消、不消费 | `context.modal === null`；模态层之上的按键属于模态层，越过它去关下面的卡片等于替用户操作他没看见的界面。 |
| 主视图持有会话数 ≠ 1（正在切换），有待答提问 | 不取消 | `presentedQuestion` 只认被主视图唯一保留的那个会话；歧义时宁可这一下不响应，也不关错卡片。 |
| 待答提问属于别的会话（如后台子代理） | 不取消、不消费 | 提问卡片是 composer 顶替，只渲染"当前会话"的待答提问；别的会话的提问在这个屏上没有卡片，代关等于替用户取消了一个他没看见的问题。主视图自己没有待答提问时，这一按照旧落回停止序列。 |
| 待答交互不是提问域（`kind === 'approval'` 或别的域） | 不取消、不消费 | `asDismissableQuestion` 要求 `kind` 是 `question` 或 `plan-review`；审批域归审批桥（`asAnswerableApproval` 只认 `kind === 'approval'`）。两个域共用同一个槽位、靠 `kind` 分工，所以同一按不可能被两条桥同时认领。 |
| 上游提问包 `@deepseek-ai/dsh-client-ui-user-questions` 没装载 | 提问桥 no-op，不消费 | 没有提问包就永远不会有提问域的 `pendingInteraction` 发布出来，`presentedQuestion` 恒为 `undefined`，这一按照旧归停止序列或无人。桥本身仍会安装——它只依赖固定输入通道，不依赖提问包的运行时存在。桌面端正属于这一类（该包声明 `dsh.client.platform: "web"`）：桥照常装上，但永远没有卡片可关。 |
| `dismiss()` 拒绝（返回 rejected Promise） | 捕获并告警（`question <key> was not cancelled:`），不冒泡 | 与 `cancel()` / `answer()` 同理，避免未处理的 Promise 拒绝污染控制台 / 运行时；这一按的归属（已消费）不回退——半途把按键还回去，反而会留下"谁也接不住"的取消。 |
| 卡片已经关闭 / `dismiss()` 已在关闭中 | 幂等，最多再调一次同一个动词 | 关闭中的卡片会把自己从注册表移除，之后 `presentedQuestion` 就取不到了；`dismiss()` 自身对重复调用也幂等（与面板按钮同源），所以就算时序上多按一下也不会重复取消。 |
| 按 `Ctrl+Alt+J` 时 `conversation.input` 不存在或 `for()` 抛错 | 告警一次，不消费 | 聚焦只有 `conversation.input.for(scope).focus()` 一条公开入口；scope 不是被保留的会话代际（切换中）时 `for()` 会抛，此时宁可不动，也不聚焦错会话。 |
| macOS/Linux 布局把 `Ctrl+Alt`（AltGr）留给输入字符 | 若该组合被系统/布局吞掉，`Ctrl+Alt+J` 到不了 page | 官方把 macOS Web 的 `alt` 非主修饰组合标记为 reserved 正是这个原因；本键的浏览器形态是 `control+alt`，定位以 Windows/Linux 主场景，若个别布局拦截该组合，这一按不会落地，也不误动作。 |
| 右侧栏折叠 / 只有一张页面 / 没有活动页 / 没有会话，按 `Ctrl+Alt+←/→` | 不动作、不消费 | 折叠时没有"当前显示的页面"可切换；页面数少于两张、当前页不在列表、或没有 on-screen 会话时没有可切的目标。这与面板键的"折叠即让位"同一条边界。 |
| 页面循环顺序 | 按 `tabsIn()`（`layout.tabs` 的记录顺序，≈ 打开顺序）循环，跨分屏 / 浮动 pane 一起循环 | 切页走公开服务面（`tabsIn` / `active` / `focus`），就没有可读的 DOM 条带顺序；拖拽改序后循环顺序保持记录顺序不变。 |
| 终端里按 `Ctrl+Alt+←/→` | 照常切页并消费 | xterm 对“方向键 + 修饰”产出 `\x1b[1;7D` / `\x1b[1;7C` 转义序列并 `preventDefault()+stopPropagation()`——事件到不了 window 冒泡上的固定通道，观察者收不到、也就没法动作。所以本桥在 window **捕获阶段**另挂一个 keydown 监听（早于一切目标 / 冒泡处理器），**只**对会落进 `.xterm` 的按键拦下：判定与通道共用 `pageCycleTarget`，命中即 `preventDefault()+stopPropagation` 吞掉、顺带不让转义序列进 shell，未命中就放行。文本控件不吞箭头键，仍走通道；两条路共用同一判定、互斥不双触发。 |
| 其它也会 `stopPropagation` / `preventDefault` 的本地控件（若有） | 该按到不了通道，或到了也已读成"被消费" | 页面循环桥的捕获钩子**只认 `.xterm`**：它抢的是 `Ctrl+Alt+←/→`，那是终端唯一会为它停掉事件的组合，若将来出现别的会吞这对方向键的控件，需在同一钩子里补上它的范围。审批桥的捕获钩子则是**全 page 区域抢 `Enter` / `Esc`**（准入与让位同固定通道），所以"自己消费 `Enter` 的过程卡片"这一类已经由它兜住——焦点落在卡片上时那一按不会再被卡片吃掉。 |
| 切页后的自动聚焦 | 只补位、不抢键盘 | `sidebar.focus()` 提交的是 store 变更，React 异步渲染，所以桥在**下一帧**才定位新显示的 pane（`[data-sidebar-right-session]` 根 + 带 `-active` 标记的可见 pane）。若新页面自己聚焦了（终端 body 在 `visible` 变化时聚焦 xterm），`document.activeElement` 已落在 pane 内，桥不碰键盘。 |
| 快捷键**展开**右栏（`sidebar.right.toggle`） | 面板确认展开后把键盘交到活动页自己的输入面（终端的 xterm） | 内置 toggle 走 `openWithPaneFocus`：`flushSync` 提交展开后**同步**聚焦活动 **pane 容器**——这一步发生在终端"`visible` 变化时自聚焦"之后，把刚落到 xterm 的焦点顶掉，此后 `visible` / `writable` 不再变化，终端不会二次自聚焦。所以展开路径不能沿用"页面自聚焦就让位"的假设：补位**不假定展开与按键同步**，以 50ms 间隔有界轮询（≤800ms）`sidebar.isExpanded()`，面板一确认展开就在下一帧调用 `focusShownPage`；当焦点停在 pane 容器本身、而该页有输入面（`.xterm-helper-textarea`，`readOnly` 视为页面自己拒绝）时补位聚焦它；页面内部控件已持键盘则仍不碰。这一按**不消费**，owner 仍是内置 toggle；窗口内面板始终没展开则放弃（如按键被别的消费）。 |

告警前缀统一为 `[dsh-focus-free-shortcuts]`，方便在控制台过滤。

---

## 8. 依赖的非正式契约

本插件**不重述上游已有的类型**：物理按键手势 / 绑定 / 两类快捷键目录行取自 `@deepseek-ai/dsh-client-shortcuts`（`NormalizedBinding` 走 `/protocol` 入口），会话目录、会话绑定与列表快照取自 `@deepseek-ai/dsh-api-session-controller/client`，会话 UI 状态与 `pendingInteraction` 槽位取自 `@deepseek-ai/dsh-client-ui-session/client`，待答审批取自 `@deepseek-ai/dsh-client-ui-approval/client` 的 `PendingApproval` / `ApprovalDecision`，待答提问取自 `@deepseek-ai/dsh-client-ui-user-questions/client` 的 `PendingQuestion`，会话级 `cancel()` 与 composer 输入面 `conversation.input`（`SessionInputResolver` / `SessionInput`）取自 `@deepseek-ai/dsh-client-ui-conversation/client` 的 `IConversation`，Sidebar 面取自 Cordis 上的 `Context['sidebarRight']`。全部是 `import type`，打包时被擦除（客户端纯度门看不到它们）。

下面列的则是**不是正式对外契约**的事实。它们都与官方代码同源，但官方没有承诺"永不变名"。若上游改名，本插件会**退化成 no-op（什么都不做，但绝不误动作）**，并在诊断里说明。

1. 命令 id `pane.fullscreen.toggle` / `pane.split`（与官方 `shortcuts.register` 处同源）；
2. DOM 标记 `[data-conversation-session]` / `[data-conversation-region]`（与官方 stop guard 同源）；
3. `retainedBy.mainView` 的语义（与 `UiSession.isMain` 同源）；
4. 固定快捷键 id `approval.allow` / `approval.reject`（与官方 `shortcuts.registerFixed` 处同源）与其"预约的物理组合就是审批决定键"的语义；
5. DOM 标记 `[data-approval-key]`（与官方审批面板根节点、以及内置 stop guard 的让位选择器同源）；
6. `pendingInteraction` 槽位的**运行时**形状：类型就是官方的 `PendingApproval`，但该槽位可被别的域复用，所以 `asAnswerableApproval` 仍在运行时确认 `kind === 'approval'`、`key` 为字符串、`answerable === true`、`answer` 为函数之后才代答；
7. 固定键 id `dsh-focus-free-shortcuts.focus-composer` 与它预约的物理组合 `control+alt+KeyJ`（本插件自己在 `shortcuts.registerFixed` 处声明；约定是"存在即预约、跟随挂载行"，同 `approval.allow` / `approval.reject` 的语义）；
8. `conversation.input`（`SessionInputResolver.for(scope)`）与它返回的 `SessionInput.focus()` 语义——与应用在遮罩结束后把键盘还给 composer 用的是同一个操作，光标还原；若上游改了这个入口，聚焦键退化为 no-op 并告警；
9. 固定键 id `dsh-focus-free-shortcuts.page-cycle` 与它预约的两个物理组合 `control+alt+ArrowLeft` / `control+alt+ArrowRight`（本插件自己在 `shortcuts.registerFixed` 处声明；同一行两个绑定 = 上一页 / 下一页两个方向，约定同第 7 条）；
10. DOM 标记 `[data-sidebar-right-session]` / `[data-dockkit-pane]` / `[data-dockkit-float]`（含 `-active` 后缀与 `data-sidebar-right-open`）——自动聚焦步的 pane 选择与官方 `visibleSidebarPane` 同源；该函数不在包 `/client` 的公开导出里，所以按同一份标记重写"活动标记优先、否则第一块可见 pane"的三选逻辑。`[data-sidebar-right-session]` 同时出现在**会话包装 div 与内层面板 div** 上（同 id、嵌套）：会话根按"取带 `data-sidebar-right-open` 者、否则取最深者"复刻 `closest()` 的"最内层 owner"语义（内层面板才带 `data-sidebar-right-open` 并持有 panes）。若上游改了标记，聚焦退化为只切页不聚焦（no-op），不误动作。
11. 终端的 `.xterm` 类——与官方键盘适配器判定 `terminal` 区域用的是同一个类（同为 `dsh-client-ui-sidebar-terminal` 的 xterm 根）。捕获阶段拦截**只**认 `closest('.xterm')` 命中的按键，因为这是迄今唯一"通道必收不到"的本地控件；其余按键一律放行给固定通道，两路共用 `pageCycleTarget`，互斥不双触发。若上游改了终端根类名，终端内切页会退化（该按到不了通道、捕获钩子也不再认它），但不会误动作。
12. 模态选择器 `[role="dialog"][aria-modal="true"], [role="menu"]`——与 `@deepseek-ai/dsh-client-ui-primitives` 的 `modalSelector` 同源。捕获阶段跑在键盘适配器算出 `context.modal` **之前**，桥自行按这份选择器复推"当前是否有模态层"，再交给共享判定，使两路的模态否决一致。若上游改了选择器，最坏情形是捕获路径在模态层打开时仍切页（与通道路径的否决不一致），不误动作。
13. `pendingInteraction` 槽位的**提问域运行时形状**：类型就是 `@deepseek-ai/dsh-client-ui-user-questions/client` 的 `PendingQuestion`，但该槽位是复用的，所以 `asDismissableQuestion` 仍在运行时确认 `kind` 为 `'question'` 或 `'plan-review'`、`key` 为字符串、`dismiss` 为函数之后才代关（第 6 条是审批侧的同一条约定；两侧共用同一个槽位、靠 `kind` 分工，谁都不越界）。
14. DOM 标记 `[data-question-key]` / `[data-plan-review-key]`（提问卡片两处根节点携带请求 key 的属性名）：`questionCardOwnsTarget` 先用 `closest('[data-question-key], [data-plan-review-key]')` 找到卡片，再要求**该元素自身的属性值恰好等于本次待答提问的 `key`**——因此过期卡片、另一次调用的 review 卡片、以及没有 `getAttribute` 的裸节点都匹配不上。这是与官方提问卡片渲染之间的非正式契约：若上游改了标记名、或把 key 挪到子节点上，`editable` 区域内的 `Esc` 会退化成"不再取消"（不误动作），而卡片之外的文本控件本来就保留自己的 `Esc`。
15. `PendingQuestion.dismiss()` 的语义（卡片关闭 / 取消按钮调用的同一个公开动词），按上游卡片的形状分三种：提问卡片（`kind === 'question'`）带工具调用线索时是 `hide`——只收起面板，请求继续等待、倒计时照跑，`ask_user_question` 的工具调用行能重新打开它；同一 `kind` 里 Host 未命名（没带 `wait`，因而没有 call id）的阻塞式请求则把整个等待拒绝为 `ASK_CANCELLED`（按钮自己的标签是「取消」/「放弃整组问题」/「Dismiss all questions」）；**活着的** plan-review 卡片（`kind === 'plan-review'`，`exit_plan_mode` 的 Approve / Request changes）的 `dismiss()` 就是「Request changes」按钮的动词，同样是"带线索收起面板 / 未命名以 `ASK_CANCELLED` 结束等待并把 composer 交回写反馈"；而从 `ask_user_question` 工具调用行重新打开的只读 review 卡片（`review !== undefined`，可承载两种 `kind`）是回看、没有作答通道也没有倒计时，`dismiss()` 就是 `card.remove`。插件**只**调这一个动词、从不调 `answer()`，所以 `Esc` 与"点关闭 / 取消按钮"永远同义；若上游改了 `dismiss()` 的语义，取消行为会跟着变（但不会变成代答）。
16. **焦点环的两块拼图**（`src/focus-ring.ts` 为此而写，两处都与官方同源、都必须同时成立才会画出边框）：
    - `html[data-input-modality]` 属性由 shell（`@deepseek-ai/dsh-client-ui-primitives` 的 `src/input-modality.ts`，随 web 前端 bundle 在**页面加载时**注册，早于任何客户端插件）发布：`pointerdown` 发布 `pointer`；**非组字的导航键**（Tab / 方向键 / Home / End / PageUp / PageDown），或**非组字按键之后焦点落在另一个控件上**，发布 `keyboard`；同一个控件重新聚焦不算。
    - 焦点环本身来自 `@deepseek-ai/dsh-client-ui-theme` 的 `focus.css`：`:focus-visible{outline-color:var(--dsw-focus-ring-color,…);outline-width:var(--dsw-focus-ring-width)}`，并在 `html[data-input-modality=pointer] body :focus-visible:not(:read-write)` 下把环色设为透明——所以指针模态下不画环，键盘模态下才画。
    17. `data-dsh-automatic-focus` 标记（官方 `focusWithoutRing(element)` 用的同一个属性）：主题的 `base.css` 把它翻成 `[data-dsh-automatic-focus]:focus{outline:none}`，官方在 blur 或导航键（Tab / 方向键 / Home / End）时移除标记、恢复正常焦点样式。本插件在"把按键从某个控件手里拿走"之后给该控件打上同一标记，从而**不移动焦点**地去掉那圈边框，并按同一套释放规则在 `src/focus-ring.ts` 里自行摘除（本 bundle 不引入 primitives 的运行时依赖）。若上游改了这个属性名或释放规则，最坏情形是边框照旧出现（回到修复前的观感），不误动作。
