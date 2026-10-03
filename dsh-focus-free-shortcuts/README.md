# dsh-focus-free-shortcuts

让「全屏 / 分屏」「连按两下 `Esc` 停止」「审批面板 `Enter` 允许一次 / `Esc` 拒绝」「提问卡片 `Esc` 取消 / 关闭」这些快捷键**不再需要先点一下**目标区域;另外新增 `Ctrl+Alt+J`(把键盘拉回输入框)与 `Ctrl+Alt+←` / `Ctrl+Alt+→`(切换右侧栏当前显示的页面,并把键盘落到新页面)。

免掉的聚焦动作:把焦点点进右侧栏 dock pane(`⌘⌥Enter` 全屏、`⌘\` 分屏)、点进输入框(`Esc` `Esc` 停止)、点进审批详情区(`Enter` 允许一次、`Esc` 拒绝)。

审批键还覆盖焦点停在一张过程卡片上的情形(工具卡的 `div[role="button"][tabindex="0"]`、轨迹行的 `tr[tabindex="0"]`):卡片自己会用 `Enter` 折叠 / 选中并先 `preventDefault()`,插件因此在 window **捕获阶段**先拦下 `Enter` / `Esc`,答审批并让卡片收不到这一按;作答会把键盘交回输入框、应用随即切到「键盘模态」,所以插件同时给那张卡片打上官方的「无环聚焦」标记(`data-dsh-automatic-focus`),卡片保持焦点却不留边框。

提问卡片是这几类里唯一的例外:它自己没绑 `Esc`,唯一出口是面板上的关闭 / 取消按钮(调 `PendingQuestion.dismiss()`);有待答提问时这一按本来没有主人(内置停止序列与本插件的停止桥都以「有待答交互」为门槛拒绝,且都不消费)。插件把这一按接过来,按面板按钮自己的语义取消:没有工具调用线索的阻塞式提问 → 以 `ASK_CANCELLED` 结束整组等待;带工具调用线索的提问 → 只收起面板,问题仍可从它的工具调用行重新打开。

`Ctrl+Alt+J` 与 `Ctrl+Alt+←/→` 是官方没有任何命令占用的键,插件各挂一条固定键(`dsh-focus-free-shortcuts.focus-composer` / `dsh-focus-free-shortcuts.page-cycle`),走同一条固定输入通道把键盘交还给 composer、或把右侧栏切到下一张页面。

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 行为差异与影响面](docs/01-problem-and-background.md) | 五条「按下去没反应」的快捷键:前四条要先聚焦,最后一条(提问卡片 `Esc`)是既有键在那个状态下没有主人;DOM / 焦点 / `keydown` / `closest()` / `preventDefault()` 预备知识 |
| [2. 归属判定](docs/02-root-cause.md) | 键盘事件的完整链路;面板命令、停止序列与审批面板各自的归属判定;提问卡片的判定 |
| [3. 固定输入通道与面板键桥接](docs/03-solution-overview-and-pane-keys.md) | 机制总览;固定输入通道与「消费即让位」;`enabledBinding`;`handlePaneInput` |
| [4. 停止桥接(`Esc Esc`)](docs/04-stop-sequence-bridge.md) | `handleStopInput`;轮次身份(turn identity);双按序列;归属不重叠 |
| [5. 审批键桥接(`Enter` / `Esc`)](docs/05-approval-key-bridge.md) | `handleApprovalInput`;面板 / 审批桥 / 提问桥 / 停止序列的归属不重叠;提问卡片取消桥的 `editable` 放宽与 `dismiss()` |
| [6. 边界与依赖契约](docs/06-comparison-boundaries-contracts.md) | 与内置命令的对照表;已知边界与失败模式;依赖的非正式契约 |
| [7. 构建、测试与启用](docs/07-build-test-and-enable.md) | 构建 / 测试命令;`test/` 分组;启用与撤销 |
