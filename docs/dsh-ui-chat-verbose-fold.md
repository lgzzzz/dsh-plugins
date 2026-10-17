# dsh-ui-chat-verbose-fold

让「工作步骤展示 = 完全展开」也遵守「工作步骤收起时机」，并在过程行收起时守住阅读位置。官方 `ui-chat` 的完全展开策略把 `foldCompletedTurns` 设为 `false`，整轮折叠的渲染路径全部短路，收起时机虽然仍被保存和传入策略，却没有消费者。本插件在浏览器运行时只把 verbose 的这一个字段投影为 `true`，保留 `stepGrouping: 'none'` 与用户选择的 `collapseTiming`，因此完全展开模式继续以「无组头的独立步骤行」呈现，同时已完成的轮次按设置收起过程行，最终答案不受影响。运行中、中断和失败的轮次保持展开，读者手动展开过的轮次也保持展开。

装进 web profile 后，两种收起时机都有可见差异：

| 收起时机 | 完成一轮后 | 下一次输入到达后 |
| --- | --- | --- |
| 回答结束后 | 该轮的过程行立即收起，只留可展开的轮次抬头 | 保持收起 |
| 下次有新消息时 | 最新一轮的过程行保持展开 | 最新一轮收起，更早的轮次保持收起 |

两种时机的收起都不会把正在读的内容顶走：视口未跟底、且阅读线下方有可见锚点时，正在读的内容停在原处；没有可见锚点时（常见于视口被折叠段占满），回退到最后一条用户消息，把它的顶边对齐到阅读线下方；视口停在底部跟随时，仍停在底部。策略投影的失败路径是安全 no-op：没有 `slots` 服务时跳过投影，找不到 `conversation.view#chat` 时在有界窗口后告警一次，注入面缺少 `hooks.presentation` 时告警一次并原样返回。滚动补偿独立安装、独立降级，见[第 4 册](dsh-ui-chat-verbose-fold/04-reading-anchor.md)。

它依赖 `ui-chat` 的内部形状（槽 `conversation.view`、id `chat`、`hooks.presentation`、字段 `mode` / `foldCompletedTurns`）与一组 `data-chat-*` DOM 锚点，包括用户消息行的 `data-chat-flow-kind="user"`；这些不是稳定公共契约。上游改形状时补丁退化为 no-op，`check-css.mjs` 会把这类退化提前变成显式失败。

-----

## 分册目录

| 分册 | 内容 |
| --- | --- |
| [1. 原因：收起时机为什么没有消费者](dsh-ui-chat-verbose-fold/01-root-cause.md) | 官方策略表、设置行与四个消费点，以及完全展开模式短路它们的条件 |
| [2. 方案：只投影一个字段](dsh-ui-chat-verbose-fold/02-solution-and-boundaries.md) | 运行时投影、为什么保留 `stepGrouping: 'none'`、与 fork / CSS 方案的对比、边界情况 |
| [3. 构建、测试与启用](dsh-ui-chat-verbose-fold/03-build-test-and-enable.md) | 构建 / 类型检查 / 测试命令、测试分组、挂载与验证步骤 |
| [4. 阅读位置：收起时如何不顶走内容](dsh-ui-chat-verbose-fold/04-reading-anchor.md) | 即时折叠为什么跳、阅读线与锚点行（含视口相交守卫）、显回—测量—复原—测量算法、跳过条件与失败模式 |
