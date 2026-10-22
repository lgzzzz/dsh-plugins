# 边界与依赖契约

> 本文件是 [dsh-keyboard-shortcuts 说明](../dsh-keyboard-shortcuts.md) 的第 6 册：与内置命令的对照表、已知边界与失败模式、依赖的非正式契约。

-----

## 6. 与内置命令的对照

### 6.1 固定键

| 场景 | 内置命令（没有插件时） | 本插件（装了之后） |
|---|---|---|
| 任意焦点位置按八条固定键 | Web/Linux 上多数命令没有默认绑定；Web/macOS、Web/Windows 上部分组合与默认绑定重叠，焦点不在目标区域时 `noFocus` | 固定行占用组合，命中后调官方命令；面板全屏与关页在 Web 上先走活动 dock pane 回退 |
| `session.new`（`⌘⌥N` / `Ctrl+Alt+N`） | Web/macOS、Web/Windows 有默认绑定；Web/Linux 无 | 固定行调官方 `session.new`；焦点在 `.xterm` 内时由捕获阶段调用同一个官方命令 |
| `pane.fullscreen.toggle`（`⌘⌥Enter`） | 焦点不在可见 dock pane 内时 `noFocus`，消费但不动作 | 固定行 + Web 免聚焦回退：右栏展开、`commandTarget()` 能解析时直接 `toggleFullscreen()`；面板已聚焦时交回官方命令 |
| `page.close`（`⌘⌥,`） | Web 上默认是 `⌘⌥W`，焦点不在面板内时 `noFocus` | 固定行 + Web 免聚焦回退：能解析出可关目标时直接 `closeTarget()`；模态、折叠、不可关或面板已聚焦时交回官方命令 |
| 焦点已在面板内，按全屏 / 关页固定键 | 正常全屏 / 关页 | 让位，官方命令执行；插件不重复动作 |
| 模态弹窗打开，按全屏 / 关页固定键 | 全屏命令被 `blocked`；关页命令关掉最上面那层弹窗 | 全屏交回官方命令；关页让位给官方 `closeTopModal()` |
| 右栏折叠，按全屏 / 关页固定键 | `noFocus` | 不动作；全屏 / 关页都交回官方命令 |
| 固定键被按住重复 | 官方 `dispatch` 消费但不重复执行 | 固定行先消费；重复按只消费、不动作 |
| 内置同组合的可配置命令 | — | 进入冲突态、按键派发不再执行它；固定行仍按命令 id 调官方命令 |
| 桌面端（Desktop） | 可配置键位由原生键盘桥派发 | 固定行照常注册；全屏 / 关页 / 分屏的 DOM 免聚焦桥不安装，避免同一次按键执行两次 |

### 6.2 分屏与其余免聚焦桥

| 场景 | 内置命令（没有插件时） | 本插件（装了之后） |
|---|---|---|
| 焦点在输入框，按 `⌘\` / `Ctrl+\` | `noFocus`，消费但不动作 | 取活动 dock pane，正常分屏 |
| 焦点已在面板内，按 `⌘\` / `Ctrl+\` | 正常分屏 | 让位，不动作、不消费 |
| `pane.split` 被改绑 / 解绑 / 冲突 / 缺席 | 跟随设置 | 跟随设置；`enabledBinding` 不通过就不接管 |
| 焦点在 `<body>`，连按两下 `Esc` | 第一下就被丢弃，无动作 | 主视图会话停止 |
| 焦点在 composer，连按两下 `Esc` | 正常停止 | 让位，不动作、不消费 |
| 有待答审批 / 提问时按 `Esc` | 不停止 | 审批：拒绝；提问：取消卡片；都不停止回合 |
| 焦点在审批详情区，按 `Enter` / `Esc` | 面板自己作答 | 让位，不动作、不消费 |
| 焦点在过程卡片上，按 `Enter` / `Esc` | 卡片自己折叠 / 选中；审批无人处理 | 捕获阶段先作答并吞掉这一按，卡片收不到、也不留焦点边框 |
| 焦点在提问卡片自己的答案文本域，按 `Esc` | 无人处理 | 取消 / 收起卡片（`dismiss()`），不调 `answer()` |
| 全屏右栏上按裸 `Esc` | 无人处理 | 吞掉这一按并折叠右栏；待答卡片被浮层盖住时不在这一按上作答 |
| 按 `⌘⌥J` / `Ctrl+Alt+J` | 无命令占用 | 主视图会话的 composer 输入面 `focus()` |
| 按 `⌘⌥K` / `Ctrl+Alt+K` | Web 上属内置 `session.search` | 固定行占用：把键盘交给右栏当前显示的页面；搜索被挤成冲突 |
| 按 `⌘⌥←/→` / `Ctrl+Alt+←/→` | 无命令占用 | 切换右栏页面，并把键盘交给新页面 |
| 按 `⌘↑/↓` / `Ctrl+↑/↓` | 无命令占用 | 在左侧栏前三个工作区当前显示的会话行之间切换 |
| 按 `⌘⌥↑/↓` / `Ctrl+Alt+↑/↓` | 无命令占用 | 只在活跃会话（行上有状态点）之间切换 |

-----

## 7. 已知边界与失败模式

| 情况 | 行为 | 机制与失败表现 |
|---|---|---|
| `shortcuts.registry` 缺席 | 八条官方固定键完全不安装并告警一次；五条自挂键仍安装 | `registry` 是官方快捷键服务实例上的内部字段，公开接口没有「按 id 调命令」。插件做结构检查，缺席时告警而不是自己执行动作 |
| `shortcuts.observeFixedInput` 缺席 | 各桥各告警一次、不安装 | 固定输入是这些桥唯一的投递通道 |
| `sidebarRight` 服务缺席 | 全屏 / 关页 / 分屏 / 聚焦右栏页面 / 页面循环与全屏关栏的侧栏相关部分不安装；停止、审批、提问、聚焦输入框、会话导航照常 | 这些桥通过 `ctx.inject([... 'sidebarRight'])` 等侧栏服务；服务不到，回调不运行 |
| Desktop 运行时 | 全屏 / 关页的免聚焦回退不创建，分屏桥告警跳过；固定行仍注册，停止、审批、提问、J/K/箭头照常 | Desktop 的可配置键位由 Electron 原生桥派发，DOM 侧再执行一次会让全屏 / 关页 / 分屏各发生两次 |
| Web/Linux 上的内置默认绑定 | 分屏、内置 `page.close`、`session.search` 等没有默认绑定；固定键不受影响 | 上游默认键位表按 `desktop\|web` × `macos\|windows\|linux` 六档声明，缺档即未绑定；`registerFixed` 不查这张表 |
| 固定键与官方默认可配置键重叠 | `session.new`、`sidebar.left.toggle`、`pane.fullscreen.toggle` 的固定键与默认键相同；`workspace.openLocal` 的固定键占 `Ctrl+Alt+P`（原属 `workspace.files`）；`sidebar.right.toggle` 的固定键占 `Ctrl+Alt+O`（原属 `workspace.add`）；`page.close` 的固定键占 `Ctrl+Alt+,`（原属 `settings.open`） | 与固定行重叠的可配置命令进入冲突态：`workspace.files` / `workspace.add` / `settings.open` 等需要另用按钮或在设置里改绑。固定行只读；要改键位只能改 `src/shortcuts.ts` 后重新构建 |
| `⌘⌥K` 与 `session.search` 撞键 | `session.search` 显示冲突、按键不再打开搜索 | 固定行是唯一够得着终端交棒那一格的通道；删除 `focus-page` 固定行或给搜索改绑即恢复。上游「恢复全部默认」的校验也建立在冲突表上，有冲突时会以 `conflict` 失败 |
| 终端内按固定键 / J / K / 箭头 | 捕获阶段先拦下，不送进 shell | `.xterm` 在自己的处理器里 `stopPropagation()`，事件到不了 window 冒泡上的固定通道；各桥在捕获阶段判定。分屏没有终端捕获：终端内的 `⌘\` / `Ctrl+\` 不保证到达固定通道 |
| 焦点在侧栏容器内、但不在 pane 内 | 全屏 / 关页 / 分屏都不回退 | 官方 `commandTarget()` 对陈旧侧栏标记返回 `undefined`，与内置 `command.stale` 同向 |
| 右栏折叠，按全屏 / 关页 / 分屏 / 页面切换 / 聚焦右栏页面 | 不动作（页面切换 / 聚焦右栏页面不消费） | 折叠时没有「当前显示的页面」；浮动面板不在这些键的范围内 |
| 活动面板是空的（没有页面可关） | 官方 `page.close` 返回 `noFocus` | `canCloseTarget()` 为假时插件不接管，交回官方命令 |
| 只挂着停靠 guide，按关页键 | 收成侧栏 | 这是 `closeTarget()` 自己的语义，与焦点在面板内时按同一键一致 |
| 免聚焦关页之后的键盘位置 | 键盘不动 | `closeWithPaneFocus` 只在关之前焦点就在 pane 里时才转移焦点 |
| 主视图持有会话数 ≠ 1（正在切换） | 停止 / 审批 / 提问 / 聚焦输入框都不动作 | 当前会话有歧义；各桥要求 `retainedBy.mainView` 恰好一个 |
| 待答交互属于别的会话 | 停止 / 审批 / 提问都不认领 | 只看主视图当前会话发布的 `pendingInteraction` |
| 会话无 `running` / 已 `removed` / 子代理不可续 | 不停止 | 与内置 `currentTurn` 同一批门槛 |
| 某会话 scope 上没有 `conversation` | 每次按键告警、不停止 | `conversation.cancel()` 是唯一入口 |
| `cancel()` / `answer()` / `dismiss()` 拒绝 | 捕获并告警，不冒泡 | 避免未处理的 Promise 拒绝污染运行时；这一按已消费的归属不回退 |
| 两按之间轮次恰好结束并立刻开启新轮次 | 500ms 窗口内仍会停到新轮次 | 插件只用 `(sessionId, generation)`，没有公开的 `turn` 身份 |
| 焦点在 `editable` / `terminal` 区域按审批键 | 不代答、不消费 | 输入控件与 IME 保持自己的按键；正常路径上审批面板已把 composer 隐掉 |
| 焦点在提问卡片之外的文本控件按 `Esc` | 控件自己处理 | 提问桥只认目标落在当前提问卡片根内 |
| 提问包没装载（桌面端即如此） | 无提问卡片可关 | 提问桥 no-op；没有提问包就永远没有提问域的 `pendingInteraction` |
| 全屏右栏标记或服务读数陈旧 | 不动作、不消费 | 两侧读数不一致时调用 `toggleExpanded()` 可能在折叠态下反而展开 |
| 带修饰键的 `Esc` | 不关栏 | 关栏桥只认裸 `Esc` |
| 页面循环 / 会话导航 / 聚焦右栏页面在终端内 | 捕获阶段拦下并执行，不让转义序列进 shell | 与固定键同一条捕获机制 |
| 会话导航的候选 | 只取左侧栏此刻渲染出来的会话行 | 折叠工作区、被「展开更多」挡住的行、归档行、搜索过滤、窄侧栏、单列表分组都不算候选 |
| 「未分组」桶 | 不进候选 | 分组键是空串，不是工作区 |
| 当前会话不在候选里 | `↓` 落候选首、`↑` 落候选尾 | 当前会话由 `retainedBy.mainView` 给出 |
| 活跃池为空 / 只剩当前会话 | 不动作，但消费 | 不退回全部候选；常规导航由另一对会话键负责 |
| 光标键组合在 Web 上被官方标为保留 | 固定键照常收到 | `bindingIssue` 只限制可配置命令；固定行不受限制 |
| 上游改了 `data-*` 锚点 | 对应桥退化为 no-op 或候选变空 | `check-css.mjs` 在构建后逐条 grep 上游产物，缺一条就显式失败并写明退化后果 |
| 消息滚动口缺 `[data-composer-seat]` / composer 高度为 0 | PageUp/PageDown/Space 不接管，保持原生 | 翻页补偿要求可见消息带 `clientHeight - composerHeight > 0`；`conversation-scroll` / `composer-seat` 两条 DOM 契约兜住锚点 |
| 多栏同时可见、目标与焦点都不在滚动口内 | 不接管 | 只按目标 / 当前焦点解析，或采用页面上唯一可见的滚动口；无法判定时不猜归属 |
| 消息滚动口内按 Space | 吞掉，不翻页 | 原生 Space 同样按整个滚动口翻页；输入框、按钮、终端、模态层与还能滚动的内层容器保持原生 |

告警前缀统一为 `[dsh-keyboard-shortcuts]`，方便在控制台过滤。

-----

## 8. 依赖的非正式契约

本插件**不重述上游已有的类型**：物理按键手势 / 绑定 / 两类快捷键目录行取自 `@deepseek-ai/dsh-client-shortcuts`（`NormalizedBinding` 走 `/protocol` 入口），会话目录、会话绑定与列表快照取自 `@deepseek-ai/dsh-api-session-controller/client`，会话 UI 状态与 `pendingInteraction` 槽位取自 `@deepseek-ai/dsh-client-ui-session/client`，待答审批取自 `@deepseek-ai/dsh-client-ui-approval/client` 的 `PendingApproval` / `ApprovalDecision`，待答提问取自 `@deepseek-ai/dsh-client-ui-user-questions/client` 的 `PendingQuestion`，会话级 `cancel()` 与 composer 输入面 `conversation.input`（`SessionInputResolver` / `SessionInput`）取自 `@deepseek-ai/dsh-client-ui-conversation/client` 的 `IConversation`，Sidebar 面取自 Cordis 上的 `Context['sidebarRight']`。会话导航面把 `uiWorkspace` 声明为 Cordis 注入依赖、再按结构读 `scope.get('uiWorkspace')`。全部类型都是 `import type`，打包时被擦除。

下面列的是**不是正式对外契约**的事实。若上游改名，本插件会**退化成 no-op（不误动作）**，并在诊断里说明；`css-contract.json` 在构建后逐条校验可 grep 的锚点。

1. 八条官方命令 id：`session.new`、`sidebar.left.toggle`、`workspace.openLocal`、`sidebar.right.toggle`、`workspace.files`、`terminal.new`、`pane.fullscreen.toggle`、`page.close`；
2. `page.close` 的 `modals` 包含 `settings` / `shortcuts` / `other`，弹窗下它的语义是关掉最上面那层；
3. 八条固定行 id 为 `dsh-keyboard-shortcuts.<command.id>`，五条自挂固定行 id 为 `dsh-keyboard-shortcuts.focus-composer` / `.focus-page` / `.page-cycle` / `.session-cycle` / `.session-active-cycle`；它们都通过 `registerFixed()` 声明，存在即预约；
4. `approval.allow` / `approval.reject` 这两条官方固定行与「预约的组合就是审批决定键」的语义；
5. `pendingInteraction` 槽位可被别的域复用，因此审批桥运行时确认 `kind === 'approval'`、`key` 为字符串、`answerable === true`、`answer` 为函数；提问桥确认 `kind` 为 `question` 或 `plan-review`、带 `dismiss()`；
6. DOM 锚点：`[data-conversation-session]` / `[data-conversation-region]`（停止归属）、`[data-approval-key]`（审批面板根与让位）、`[data-question-key]` / `[data-plan-review-key]`（提问卡片根）、`[role="dialog"][aria-modal="true"], [role="menu"]`（模态）、`data-dsh-automatic-focus` 与主题的 `outline:none` 规则（无环聚焦）、`.xterm` / `.xterm-helper-textarea`（终端与输入面）、`[data-sidebar-right-session]` / `[data-sidebar-right-panel="fullscreen"]` / `[data-sidebar-right-open]`（右栏）、`[data-conversation-scroll]` / `[data-composer-seat]`（消息滚动口与 composer 座位）、`[data-dockkit-pane]` / `[data-dockkit-float]` / `[data-dockkit-pane-active]` / `[data-dockkit-float-active]` / `[data-dockkit-strip-tabs]` / `[data-dockkit-tab]`（dockkit）、`[data-row-key="workspace:…"]` / `[data-row-key="session:…"]` 与归档行的 `aria-description`（侧栏候选）；
7. `retainedBy.mainView` 的语义（与 `UiSession.isMain` 同源）；
8. `conversation.input.for(scope)` 返回的 `SessionInput.focus()`（光标还原）与 `conversation.cancel()`；
9. `sidebarRight` 的 `focusedTarget` / `commandTarget` / `isExpanded` / `isTargetCurrent` / `toggleFullscreen` / `split` / `canCloseTarget` / `closeTarget` / `toggleExpanded` / `mounted` / `tabsIn` / `active` / `focus`；
10. `uiWorkspace.startSession(workspaceId?)` 与 `openSession(sessionId)`；
11. `sessions.list` 的 `ids` / `byId` / `retainedBy` 与 `uiSession.sessionStatus` 的 `running` / `pendingInteraction` / `completionUnread`；
12. 官方快捷键服务实例上的内部字段 `registry.invoke(id, context)`；公开接口没有这一项，插件做结构检查，缺席时告警并不安装固定行；
13. `shortcuts.stopSequenceMs` 作为双按窗口；
14. `registerFixed` 只按平台规范化 `primary`，不查 Web 保留表，也不与其它固定行判冲突；
15. `shortcuts.registry.invoke()` 的 `context` 接受 `region` / `modal` / `target` / `source`，命令自己按 `resolve()` 决定是否执行；
16. 消息滚动口的 `clientHeight` 包含底部 sticky 的 composer；`[data-composer-seat]` 的 `offsetHeight` 就是被遮住的高度，翻页补偿按 `clientHeight - composerHeight - 50` 计算步长；
