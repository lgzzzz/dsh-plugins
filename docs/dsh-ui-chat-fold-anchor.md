# dsh-ui-chat-fold-anchor

不 fork 官方 `@deepseek-ai/dsh-client-ui-chat`，在运行时把「自动折叠把阅读位置顶走」这件事补回来：ui-chat 收起过程组时只给行加上 `hidden`（取值 `until-found`），自己不做任何滚动位置补偿，位置交给浏览器的原生滚动锚定；浏览器不支持 `overflow-anchor`（Safari）或该能力被关掉时，折叠掉的高度就没人补。插件认这条 `hidden` 信号，在属性变化的微任务里把这一批行临时显回来量一次折叠前的几何、再按原样隐藏量第二次，把两次之差写回滚动位置。装进 web profile 后刷新 GUI 页面即生效：折叠结束后正在看的那段内容停在原处，而不是被顶走被折叠掉的高度。失败路径都是安全 no-op——没有滚动口、阅读线上没有可用锚点、锚点行本身被折叠掉时，插件什么都不写。它依赖 ui-chat 的内部契约（`hidden="until-found"` 的写法、`data-chat-*` DOM 锚点），不是稳定公共契约，上游改形状时补丁退化为 no-op，并由 `pnpm check:css` 显式失败。

-----

## 分册目录

| 分册 | 内容 |
|---|---|
| [1. 行为差异与影响面](dsh-ui-chat-fold-anchor/01-behavior-difference.md) | 装与不装各看到什么；这条折叠路径缺什么；哪些折叠不需要补 |
| [2. 工作原理与失败模式](dsh-ui-chat-fold-anchor/02-how-it-works-and-failure-modes.md) | 三条 DOM 信号、纯逻辑与 DOM 的分工、时序、逐条失败路径与已知边界 |
| [3. 构建、测试与启用](dsh-ui-chat-fold-anchor/03-build-test-and-enable.md) | 构建 / 测试 / 契约校验命令、三组 Node 测试与浏览器实测装置、挂载方式 |

-----

## 进一步探索

- [docs/README.md](README.md) —— 本仓库的构建、挂载与校验命令。
- [dsh-ui-chat-verbose-fold](dsh-ui-chat-verbose-fold.md) —— 让 Verbose 模式折叠已完成轮次的姊妹插件：它决定「折什么」，本插件管「折叠时位置不动」。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端半部的加载顺序与 `immediately` 的含义。
- [DSH 组件 CSS 架构](dsh-css-architecture.md) —— `data-*` 锚点与设计令牌这两类稳定契约的背景。

<details>
<summary>Dev Note</summary>

插件的浏览器半部是 `src/client.ts`（入口 `apply()`，只做装配与清理）+ `src/viewport.ts`（DOM 适配：认 `hidden` 信号、选锚点、读写滚动口）+ `src/fold-anchor.ts`（纯记账，能在假探针上直接测）；上游契约钉在 `contract.json` 里，由同目录 `check-css.mjs` 逐条校验。行为实测装置在 `test/browser/`，跑法见[第 3 册](dsh-ui-chat-fold-anchor/03-build-test-and-enable.md)。

</details>
