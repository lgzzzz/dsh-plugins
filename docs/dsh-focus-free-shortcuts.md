# dsh-focus-free-shortcuts

让「全屏 / 分屏」「关闭当前页面」「连按两下 `Esc` 停止」「审批面板 `Enter` 允许一次 / `Esc` 拒绝」「提问卡片 `Esc` 取消 / 关闭」这些快捷键**不再需要先点一下**目标区域;另外新增 `⌘⌥J`(macOS) / `Ctrl+Alt+J`(Windows/Linux)(把键盘拉回输入框)、`⌘⌥K` / `Ctrl+Alt+K`(把键盘交给**右侧栏当前显示**的那一页 —— 通常是终端,于是不必先点进 `.xterm` 才能打字)、`⌘⌥←` / `Ctrl+Alt+←`、`⌘⌥→` / `Ctrl+Alt+→`(切换右侧栏当前显示的页面,并把键盘落到新页面)、`⌘↑` / `Ctrl+↑`、`⌘↓` / `Ctrl+↓`(在左侧栏前三个工作区**当前显示出来**的会话行之间导航)与 `⌘⌥↑` / `Ctrl+Alt+↑`、`⌘⌥↓` / `Ctrl+Alt+↓`(**只在活跃会话之间**切换),并给内置的「新建会话」`⌘⌥N` / `Ctrl+Alt+N` 补上终端那一格。

**焦点在终端里时也能用**:`⌘⌥J` / `Ctrl+Alt+J`、`⌘⌥K` / `Ctrl+Alt+K`(终端里交棒是无操作,但这一按不该被当成输入送进 shell)、`⌘⌥←/→` / `Ctrl+Alt+←/→`、两对会话键、`⌘⌥N` / `Ctrl+Alt+N`(内置 `session.new`)与 `⌘⌥M` / `Ctrl+Alt+M`(见 [dsh-workspace-quick-switch](../dsh-workspace-quick-switch/))在 `.xterm` 内同样生效 —— 终端在自己的 textarea 处理器里对经手的按键 `stopPropagation()`,事件到不了 window 上的键盘通道,所以这几条各自在 window **捕获阶段**另挂一个 `keydown` 监听,在事件进入终端前判定,命中即吞掉这一按(`preventDefault()+stopPropagation()`),既不误动作也不把它当成终端输入送进 shell。

免掉的聚焦动作:把焦点点进右侧栏 dock pane(`⌘⌥Enter` 全屏、`⌘\` 分屏、Web 上的 `⌘⌥W` / `Ctrl+Alt+W` 关闭当前页面)、点进输入框(`Esc` `Esc` 停止)、点进审批详情区(`Enter` 允许一次、`Esc` 拒绝)。

关闭当前页面与面板键同类(内置命令存在、只是够不着),但它多一处只在 Web 上成立:Web 上它的默认键位是 `⌘⌥W`(macOS) / `Ctrl+Alt+W`(Windows/Linux)(`⌘W` 被浏览器占着),未聚焦右侧栏时内置 `resolve()` 直接 `blocked / command.noFocus`(提示「请先聚焦右侧面板」)。插件在固定通道里用同一条 `commandTarget()` 活动 dock pane 回退解析归属,只关页面、不关窗口 —— 窗口那一半是 Desktop 的 `⌘W`,本来就免聚焦。折叠、模态弹窗、焦点已在面板内、页面不可关时一律让位,归属与内置逐条对齐(细节见 [第 3 册第 5.5 节](dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md))。

审批键还覆盖焦点停在一张过程卡片上的情形(工具卡的 `div[role="button"][tabindex="0"]`、轨迹行的 `tr[tabindex="0"]`):卡片自己会用 `Enter` 折叠 / 选中并先 `preventDefault()`,插件因此在 window **捕获阶段**先拦下 `Enter` / `Esc`,答审批并让卡片收不到这一按;作答会把键盘交回输入框、应用随即切到「键盘模态」,所以插件同时给那张卡片打上官方的「无环聚焦」标记(`data-dsh-automatic-focus`),卡片保持焦点却不留边框。

提问卡片是这几类里唯一的例外:它自己没绑 `Esc`,唯一出口是面板上的关闭 / 取消按钮(调 `PendingQuestion.dismiss()`);有待答提问时这一按本来没有主人(内置停止序列与本插件的停止桥都以「有待答交互」为门槛拒绝,且都不消费)。插件把这一按接过来,按面板按钮自己的语义取消:没有工具调用线索的阻塞式提问 → 以 `ASK_CANCELLED` 结束整组等待;带工具调用线索的提问 → 只收起面板,问题仍可从它的工具调用行重新打开。

`⌘⌥J` / `Ctrl+Alt+J`、`⌘⌥←/→` / `Ctrl+Alt+←/→`、`⌘↑/↓` / `Ctrl+↑/↓` 与 `⌘⌥↑/↓` / `Ctrl+Alt+↑/↓` 是官方没有任何命令占用的键,插件各挂一条固定键(`dsh-focus-free-shortcuts.focus-composer` / `dsh-focus-free-shortcuts.page-cycle` / `dsh-focus-free-shortcuts.session-cycle` / `dsh-focus-free-shortcuts.session-active-cycle`),走同一条固定输入通道把键盘交还给 composer、把右侧栏切到下一张页面、或在左侧栏前三个工作区当前显示出来的会话之间切换。

`⌘⌥K` / `Ctrl+Alt+K`(`dsh-focus-free-shortcuts.focus-page`)是唯一一条**有意占用内置键位**的固定键:Web 上内置 `session.search`(会话搜索)的默认键位就是 `primary+alt+K`,固定行一挂上,那一行在快捷键设置里就变成「冲突」、按键不再打开搜索(需要保留搜索就自己给它改绑;桌面端 `session.search` 是 `⌘K` / `Ctrl+K`,与本键不相干)。连带代价:上游把「恢复全部默认」的校验也建立在这份冲突表上,改动过快捷键时点它会以冲突失败 —— 这是固定行占住内置默认键位的必然副作用,删掉本条固定行即恢复(见 [第 6 册第 7 节](dsh-focus-free-shortcuts/06-boundaries-and-contracts.md))。换来的能力是:固定行是唯一够得着终端那一格的通道,而这条键的主要用场正是"把键盘交进右侧栏当前显示的那一页"。交棒复用页面切换键的 `focusShownPage`:定位该会话的右栏根节点、选出可见 pane、页面自持键盘就不抢,否则聚焦 pane 并下探到页面自己的输入面(终端的 `.xterm-helper-textarea`);右栏折叠、屏幕上没有会话、可见 pane 尚未渲染时按各自的边界让位(细节见 [第 3 册第 5.6 节](dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md) 与 [第 6 册](dsh-focus-free-shortcuts/06-boundaries-and-contracts.md) 第 6 / 7 节)。

`⌘⌥N` / `Ctrl+Alt+N` 不一样:它是官方**可配置命令** `session.new`(Web 上的默认键位,桌面端是 `⌘N` / `Ctrl+N`)的键,插件不注册固定行、也不开固定输入观察者,只补内置命令够不着的终端那一格 —— 捕获阶段拦下 `.xterm` 内的这一按,调用与内置 `run()` 同一个 `uiWorkspace.startSession()`(不带参数 = 沿用当前 / 最近的工作区)。键位读**生效目录**,所以改绑 / 解绑 / 冲突都立刻跟随(与页面关闭桥跟随 `page.close` 同一条约定)。

页面切换键还顺带修掉两个上游的视觉抖动。其一:右栏页签行只在**当前选中**那条页面所在的 host 里渲染,所以每次换页签都是新的 chip box,`scrollLeft` 从 0 开始;kit 自己那次"把活动芯片滚进视野"本应在首帧之前完成,却被页签行的 `scroll-behavior: smooth` 变成"先回到最左、再迅速滑过去"的动画。其二:kit 那次修正以 **0** 为起点,于是目标芯片一定落在视野最右缘、把来源顶出去,"我从哪儿切过来"就看不见了。插件注入一条只作用于右侧栏的 `scroll-behavior: auto` 规则把它瞬时化,并在切页前后**保持观察窗口**(切页前记下页签行滚到的位置,新 chip box 挂载后先放回去,只有目标芯片不在窗口里时才最小推移)——于是相邻来回切时整行**完全不动**,来源页签仍在视野里(纯视图补偿,不消费按键、不改任何归属判定,鼠标点页签同样受益;细节见 [第 3 册第 5.4 节](dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md))。

两条会话键共用同一份候选,差别只在池子:`⌘↑` / `Ctrl+↑` 与 `⌘↓` / `Ctrl+↓` 在候选里环状步进;`⌘⌥↑` / `Ctrl+Alt+↑` 与 `⌘⌥↓` / `Ctrl+Alt+↓` 只走候选里的**活跃会话** —— 活跃 = 行上有状态点的会话(运行中 / 待交互 / 已完成未读那一颗绿点;回合以出错收场时运行状态同样由 true 变 false 并亮起同一颗绿点,所以这类会话也在池里,DSH 的会话状态面没有独立的「出错」状态)。没有活跃会话、或活跃池里只剩当前会话时,这对键不动作、也不消费,常规导航交给 `⌘↑` / `Ctrl+↑` 与 `⌘↓` / `Ctrl+↓`。

会话切换的候选**不从服务面推导**,而是直接读左侧栏此刻渲染出来的会话行(`[data-row-key="session:…"]`):折叠的工作区、被每分组 5 行上限挡在「展开更多」之后的会话、归档行、「未分组」桶、搜索过滤与窄侧栏下的列表都不算候选 —— 也就是说,能按快捷键走到的,恰好是眼睛能看到、点一下就能打开的那批行(详见 [第 6 册](dsh-focus-free-shortcuts/06-boundaries-and-contracts.md) 第 8 节)。

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 行为差异与影响面](dsh-focus-free-shortcuts/01-behavior-difference.md) | 六条「按下去没反应」的快捷键:前五条要先聚焦,最后一条(提问卡片 `Esc`)是既有键在那个状态下没有主人;DOM / 焦点 / `keydown` / `closest()` / `preventDefault()` 预备知识 |
| [2. 归属判定](dsh-focus-free-shortcuts/02-ownership-resolution.md) | 键盘事件的完整链路;面板命令、页面关闭命令、停止序列与审批面板各自的归属判定;提问卡片的判定 |
| [3. 固定输入通道与面板键桥接](dsh-focus-free-shortcuts/03-fixed-input-and-pane-keys.md) | 机制总览;固定输入通道与「消费即让位」;`enabledBinding`;`handlePaneInput`;`handlePageCloseInput`;右栏页签行的滚动补偿 |
| [4. 停止桥接(`Esc Esc`)](dsh-focus-free-shortcuts/04-stop-sequence-bridge.md) | `handleStopInput`;轮次身份(turn identity);双按序列;归属不重叠 |
| [5. 审批键桥接(`Enter` / `Esc`)](dsh-focus-free-shortcuts/05-approval-key-bridge.md) | `handleApprovalInput`;面板 / 审批桥 / 提问桥 / 停止序列的归属不重叠;提问卡片取消桥的 `editable` 放宽与 `dismiss()` |
| [6. 边界与依赖契约](dsh-focus-free-shortcuts/06-boundaries-and-contracts.md) | 与内置命令的对照表;已知边界与失败模式;依赖的非正式契约 |
| [7. 构建、测试与启用](dsh-focus-free-shortcuts/07-build-test-and-enable.md) | 构建 / 测试命令;`test/` 分组;上游 DOM 锚点契约校验(`check-css.mjs`);启用与撤销 |
