# dsh-focus-free-shortcuts

让「全屏 / 分屏」和「连按两下 `Esc` 停止」这三个快捷键**不再需要先点一下**目标区域。

它免掉的正是这两个动作：把焦点点进右侧栏 dock pane（`⌘⌥Enter` 全屏、`⌘\` 分屏），以及把焦点点进输入框（`Esc` `Esc` 停止）。

## 分册目录

完整说明按内容拆成六册，建议按顺序阅读；只想动手的直接看第 6 册。

| 分册 | 内容 |
|---|---|
| [1. 问题与背景](docs/01-problem-and-background.md) | 三个「要先聚焦才生效」的快捷键；DOM / 焦点 / `keydown` / `closest()` / `preventDefault()` 预备知识 |
| [2. 根因：归属判定读焦点](docs/02-root-cause.md) | 键盘事件的完整链路；面板命令与停止序列各自的归属判定；为什么改键位 / 换绑定没用 |
| [3. 解决思路总览与面板键桥接](docs/03-solution-overview-and-pane-keys.md) | 整体方案；固定输入通道与「消费即让位」；`enabledBinding`；`handlePaneInput` 逐行解释 |
| [4. 停止桥接（`Esc Esc`）](docs/04-stop-sequence-bridge.md) | `handleStopInput` 逐行解释；轮次身份（turn identity）；双按序列；归属不重叠 |
| [5. 对照、边界与依赖契约](docs/05-comparison-boundaries-contracts.md) | 与内置命令的完整对照表；已知边界与失败模式；依赖的三条非正式契约 |
| [6. 构建、测试与启用](docs/06-build-test-and-enable.md) | 构建 / 测试命令；`test/` 分组；启用与撤销 |

> 阅读约定：各分册的章节号沿用拆分前的编号（第 1～10 节），跨册引用已改为指向对应分册的链接。
