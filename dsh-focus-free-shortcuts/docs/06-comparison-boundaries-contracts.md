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
| 有待答审批时按 `Esc` | 不停止（`currentTurn()` 因待答返回 `undefined`） | 不停止，改为拒绝该审批 |
| 审批面板聚焦在"拒绝"按钮上，按 `Enter` | 触发按钮自身（拒绝） | 让位，仍是拒绝（目标在面板内） |
| 焦点在输入控件 / 终端内，按 `Enter` / `Esc` | 控件自己处理 | 控件自己处理（`region !== 'page'` 直接否决） |
| 审批插件没装载（固定行缺席） | 无审批可答 | 审批桥 no-op，不消费 |
| 桌面端（Desktop）按面板键 | native 通道派发 | **不安装面板桥**（见第 7 节） |
| 桌面端 `Esc Esc` / 审批键 | DOM 固定通道驱动，正常 | 停止桥与审批桥照常安装，正常 |
| 按 `Ctrl+Alt+J`（任意焦点位置） | 没有任何命令占用，浏览器默认无动作 | 主视图会话的 composer 输入面 `focus()`：键盘回到输入框，光标还原 |
| 焦点已在输入框，按 `Ctrl+Alt+J` | 无动作 | 重新聚焦（幂等，光标不动） |
| 焦点在文本控件 / 终端内的 `Ctrl+Alt+J` | 控件自己处理 | 文本控件内接管（这正是这把键的目的）；终端内让位 |
| 模态层打开，按 `Ctrl+Alt+J` | 模态层掌权 | 让位，不动作、不消费 |
| 主视图会话数 ≠ 1 或没有会话，按 `Ctrl+Alt+J` | — | 不动作、不消费（没有可聚焦的 composer） |

---

## 7. 已知边界与失败模式

每一条都说明"为什么"，而不只是"是什么"。

| 情况 | 行为 | 为什么 |
|---|---|---|
| Desktop 运行时 | 面板桥不安装并告警一次；停止桥照常安装 | 桌面端 macOS/Windows 的可配置键位由 Electron 原生键盘桥派发，DOM 侧的 `consume()` 压不住那一次派发，两边都动作会来回抵消（全屏两次）。而停止序列在两端都由 DOM 固定通道驱动（`installKeyboard` 的 `fixed?.()` 在 native 分支 `return` **之前**执行），所以停止桥可以照常装。 |
| `sidebarRight` 服务缺席 | 面板桥不安装，插件整体仍 no-op，不抛 | 面板桥通过 `ctx.inject(['shortcuts', 'sidebarRight'], ...)` 依赖侧栏服务，服务不存在时注入不解析、这段逻辑根本不跑；停止桥独立，不受影响。 |
| `shortcuts.observeFixedInput` 缺席 | 各告警一次，不安装 | 整个方案都建立在固定输入通道上；没有这个 API 就没有可挂的点，只能放弃。 |
| 主视图持有会话数 ≠ 1（正在切换） | 不停止 | `mainViewSessionId` 要求恰好一个会话被主视图 retain。切换过程中可能出现两个会话同时被 retain 的瞬间，此时"当前会话"有歧义，宁可这一下不响应，也不停错会话。 |
| 会话无 `running` / 已 `removed` / 子代理不可续 / 有待答交互 | 不停止 | 这些是内置 `currentTurn` 的同一批门槛；不满足说明"没有可停的轮次"或"此时不该停"。 |
| 某会话 scope 上没有 `conversation` | 告警一次，不发停止 | `conversation.cancel()` 是停止的唯一入口；服务缺失时无法停，只能告警。 |
| `cancel()` 拒绝（返回 rejected Promise） | 捕获并告警，不冒泡 | 避免未处理的 Promise 拒绝污染控制台/运行时。 |
| 两按之间轮次恰好结束并立刻开启新轮次 | 500ms 窗口内仍会停到新轮次 | 内置序列要求两按的 `(sessionId, turn, generation, region)` 全同，其中 `turn` 能区分"轮次 A"和"轮次 B"；插件只用 `(sessionId, generation)`，轮次身份不是公开事实。所以"第一下在轮次 A 结束前、第二下落在刚开的新轮次 B"这种窗口内，插件仍会停 B，内置则会因 `turn` 变化而复位。 |
| 焦点在侧栏容器内、但不在 pane 内 | `commandTarget` 返回 `undefined`，无动作 | 官方 `commandTarget` 故意对"target 在 `[data-sidebar-right-session]` 内但不在 pane 内"的陈旧标记**不回退**（防止误回退到另一面板），插件尊重这个语义，此时与内置一样不动作。 |
| 主视图持有会话数 ≠ 1（正在切换），有待答审批 | 不代答 | `presentedApproval` 只认被主视图唯一保留的那个会话；歧义时宁可这一下不响应，也不答错请求。 |
| 待答审批属于别的会话（如后台子代理） | 不代答 | composer 顶替面板只渲染"当前会话"的待答交互；别的会话的审批在插件这条路上没有可见面板，代答等于替用户做了一个他没看见的决定。 |
| 待答交互不是审批（如提问） | 不代答 | `pendingInteraction` 这个槽位是复用域；`asAnswerableApproval` 要求 `kind === 'approval'`，别的域留给它自己的 UI。 |
| 审批已作答 / 已撤销 / 被中止（`answerable === false`） | 不代答、不消费 | 请求已定局，再答会被 `PendingApproval` 的锁拒绝；插件提前让位，把这一按留给别的 owner。 |
| 审批键被按下时焦点在 `editable` 或 `terminal` 区域 | 不代答、不消费 | 与面板自己的守卫同源："输入控件与 IME 候选保持自己的按键"。正常路径上 composer 已被顶替隐藏、焦点退回 `<body>`（`page`），所以这条不会挡住用户的正常操作。 |
| 模态层打开时按审批键 | 不代答、不消费 | 模态层之上的按键属于模态层（Web/Linux 的模态层本来就会挡住后台命令）；此时审批面板在模态层之下，代答会越过用户正在看的界面。 |
| `answer()` 拒绝（返回 rejected Promise） | 捕获并告警，不冒泡 | 与 `cancel()` 同理，避免未处理的 Promise 拒绝污染控制台/运行时。 |
| 按 `Ctrl+Alt+J` 时 `conversation.input` 不存在或 `for()` 抛错 | 告警一次，不消费 | 聚焦只有 `conversation.input.for(scope).focus()` 一条公开入口；scope 不是被保留的会话代际（切换中）时 `for()` 会抛，此时宁可不动，也不聚焦错会话。 |
| macOS/Linux 布局把 `Ctrl+Alt`（AltGr）留给输入字符 | 若该组合被系统/布局吞掉，`Ctrl+Alt+J` 到不了 page | 官方把 macOS Web 的 `alt` 非主修饰组合标记为 reserved 正是这个原因；本键的浏览器形态是 `control+alt`，定位以 Windows/Linux 主场景，若个别布局拦截该组合，这一按不会落地，也不误动作。 |

告警前缀统一为 `[dsh-focus-free-shortcuts]`，方便在控制台过滤。

---

## 8. 依赖的非正式契约

本插件**不重述上游已有的类型**：物理按键手势 / 绑定 / 两类快捷键目录行取自 `@deepseek-ai/dsh-client-shortcuts`（`NormalizedBinding` 走 `/protocol` 入口），会话目录、会话绑定与列表快照取自 `@deepseek-ai/dsh-api-session-controller/client`，会话 UI 状态与 `pendingInteraction` 槽位取自 `@deepseek-ai/dsh-client-ui-session/client`，待答审批取自 `@deepseek-ai/dsh-client-ui-approval/client` 的 `PendingApproval` / `ApprovalDecision`，会话级 `cancel()` 与 composer 输入面 `conversation.input`（`SessionInputResolver` / `SessionInput`）取自 `@deepseek-ai/dsh-client-ui-conversation/client` 的 `IConversation`，Sidebar 面取自 Cordis 上的 `Context['sidebarRight']`。全部是 `import type`，打包时被擦除（客户端纯度门看不到它们）。

下面列的则是**不是正式对外契约**的事实。它们都与官方代码同源，但官方没有承诺"永不变名"。若上游改名，本插件会**退化成 no-op（什么都不做，但绝不误动作）**，并在诊断里说明。

1. 命令 id `pane.fullscreen.toggle` / `pane.split`（与官方 `shortcuts.register` 处同源）；
2. DOM 标记 `[data-conversation-session]` / `[data-conversation-region]`（与官方 stop guard 同源）；
3. `retainedBy.mainView` 的语义（与 `UiSession.isMain` 同源）；
4. 固定快捷键 id `approval.allow` / `approval.reject`（与官方 `shortcuts.registerFixed` 处同源）与其"预约的物理组合就是审批决定键"的语义；
5. DOM 标记 `[data-approval-key]`（与官方审批面板根节点、以及内置 stop guard 的让位选择器同源）；
6. `pendingInteraction` 槽位的**运行时**形状：类型就是官方的 `PendingApproval`，但该槽位可被别的域复用，所以 `asAnswerableApproval` 仍在运行时确认 `kind === 'approval'`、`key` 为字符串、`answerable === true`、`answer` 为函数之后才代答；
7. 固定键 id `dsh-focus-free-shortcuts.focus-composer` 与它预约的物理组合 `control+alt+KeyJ`（本插件自己在 `shortcuts.registerFixed` 处声明；约定是"存在即预约、跟随挂载行"，同 `approval.allow` / `approval.reject` 的语义）；
8. `conversation.input`（`SessionInputResolver.for(scope)`）与它返回的 `SessionInput.focus()` 语义——与应用在遮罩结束后把键盘还给 composer 用的是同一个操作，光标还原；若上游改了这个入口，聚焦键退化为 no-op 并告警。
