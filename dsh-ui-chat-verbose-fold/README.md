# dsh-ui-chat-verbose-fold

不 fork 官方 `@deepseek-ai/dsh-client-ui-chat`，在运行时把 **Verbose 工作详情模式**改成「折叠已完成轮次」。

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 它解决的问题](docs/01-problem.md) | 要改的是哪一行、为什么配置覆盖不到 |
| [2. 工作原理与失败模式](docs/02-how-it-works-and-failure-modes.md) | 复用 slot 的活对象原地改写 `getSnapshot`；各失败路径的安全 no-op |
| [3. 构建、测试与启用](docs/03-build-test-and-enable.md) | 构建 / 测试命令、`test/` 三组测试、启用方式 |
