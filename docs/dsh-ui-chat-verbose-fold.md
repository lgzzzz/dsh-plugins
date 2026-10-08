# dsh-ui-chat-verbose-fold

不 fork 官方 `@deepseek-ai/dsh-client-ui-chat`,在运行时把 **Verbose 工作详情模式**改成「折叠已完成轮次」。插件只等 `slots`,把 `conversation.view#chat` 注入面里的 `hooks.presentation` 快照原地改成折叠后的策略,已经绑定的选择器随之读到折叠值,不需要重挂载。装进 web profile 后刷新 GUI 页面即生效:Verbose 模式下已完成的轮次应折叠;失败路径都是安全 no-op 并各告警一次(前缀 `[dsh-ui-chat-verbose-fold]`),不会拦下官方组件。它依赖 ui-chat 的内部形状(`conversation.view` 的 id `chat`、`hooks.presentation`、字段 `mode` / `foldCompletedTurns`),不是稳定公共契约,上游改形状时补丁退化为 no-op 并由告警提示。

-----

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 行为差异与影响面](dsh-ui-chat-verbose-fold/01-behavior-difference.md) | 要改的字段所在位置,以及可用的扩展面 |
| [2. 工作原理与失败模式](dsh-ui-chat-verbose-fold/02-how-it-works-and-failure-modes.md) | 复用 slot 的活对象原地改写 `getSnapshot`;各失败路径的安全 no-op |
| [3. 构建、测试与启用](dsh-ui-chat-verbose-fold/03-build-test-and-enable.md) | 构建 / 测试命令、`test/` 三组测试、启用方式 |
