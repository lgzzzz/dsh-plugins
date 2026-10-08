# dsh-ui-chat-verbose-fold

不 fork 官方 `@deepseek-ai/dsh-client-ui-chat`,在运行时把 **Verbose 工作详情模式**改成「折叠已完成轮次」。

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 行为差异与影响面](dsh-ui-chat-verbose-fold/01-behavior-difference.md) | 要改的字段所在位置,以及可用的扩展面 |
| [2. 工作原理与失败模式](dsh-ui-chat-verbose-fold/02-how-it-works-and-failure-modes.md) | 复用 slot 的活对象原地改写 `getSnapshot`;各失败路径的安全 no-op |
| [3. 构建、测试与启用](dsh-ui-chat-verbose-fold/03-build-test-and-enable.md) | 构建 / 测试命令、`test/` 三组测试、启用方式 |
