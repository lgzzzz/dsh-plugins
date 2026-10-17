# 方案：只投影一个字段

> 本文件是 [dsh-ui-chat-verbose-fold 说明](../dsh-ui-chat-verbose-fold.md) 的第 2 册：比较可选方案，说明推荐方案为什么只改 `foldCompletedTurns`，以及它的行为边界。

-----

## 四种可选方案

| 方案 | 做法 | 代价 | 结论 |
| --- | --- | --- | --- |
| fork `ui-chat` | 复制官方包，把 `POLICIES.verbose.foldCompletedTurns` 改为 `true` | 复制整套 Chat 渲染实现（约 2.7 万行），每次上游升级都要重放补丁、迁移测试 | 能生效，但维护成本最高 |
| 运行时策略投影 | 在浏览器里包装 `conversation.view#chat` 注入面的 `hooks.presentation`，只在 verbose 上把 `foldCompletedTurns` 投影为 `true` | 依赖 `ui-chat` 内部形状；上游改形状时退化为 no-op | **推荐**：改动面最小，不动官方包，不重注册组件 |
| CSS 隐藏 | 用选择器隐藏过程行 | 无法读取 `collapseTiming` 的实时值；没有可展开的轮次抬头；滚动、搜索和读屏状态都会失真 | 不可行 |
| 修改官方包安装产物 | 直接改 `node_modules` 里的 `lib/client.js` | 重装或升级即丢失，且无法审查 | 不可持续 |

长期看，最干净的修复在 `ui-chat` 上游：让 verbose 的 `foldCompletedTurns` 可配置，或让收起时机独立于展示模式。本插件是本地可立即生效、且不复制上游代码的方案。

-----

## 推荐方案：包装实时 presentation source

补丁只做三件事：

1. `slots.inject('conversation.view', ...)` 等待该槽被声明，然后扫描实时账本，按 `options.id === 'chat'` 找到 `ui-chat` 的 Chat 视图注册项。
2. 包装注册项的 `inject` 工厂；工厂返回的注入面里带着同一个 `hooks.presentation` observable，补丁原地改写它的 `getSnapshot`：

   ```ts
   const original = source.getSnapshot.bind(source)
   source.getSnapshot = () => foldCompletedForVerbose(original())
   ```

3. `foldCompletedForVerbose` 只在 `mode === 'verbose' && foldCompletedTurns !== true` 时返回 `{ ...policy, foldCompletedTurns: true }`；其余情况按原对象透传。

`ui-renderer` 的 `bindSnapshotSelector` 每次快照都重新读 `source.getSnapshot()`，因此包装后，**已经绑定**的 `usePresentation` 选择器也会立即读到新值，不需要重新挂载 Chat，也不需要清缓存。

投影对象按原始策略对象缓存在 `WeakMap` 里：官方对同一组 `(mode, collapseTiming)` 复用稳定策略对象，投影也应复用稳定对象，避免每次 `getSnapshot` 返回新对象造成选择器持续失配。

-----

## 为什么保留 `stepGrouping: 'none'`

只改 `foldCompletedTurns`，不改 `stepGrouping`，是为了保住完全展开模式自己的呈现方式：

| 行为 | compact / standard | detailed | 完全展开 + 本插件 |
| --- | --- | --- | --- |
| 过程组抬头 | 有，可折叠 | 有，历史轮次可折叠 | 无 |
| 打开的轮次 | 组内步骤 | 组内步骤 | 逐行显示独立步骤 |
| 已完成轮次 | 整轮收起 | 整轮收起 | 按收起时机整轮收起 |
| 收起后的入口 | 轮次抬头 | 轮次抬头 | 轮次抬头 |

如果把 `stepGrouping` 也改成 `history`，收起时机确实会多一个消费者，但完全展开模式会出现组头，和简洁 / 标准 / 详细的呈现趋同，失去该模式的意义。只打开整轮折叠可以让「无组头、逐行步骤」与「按设置收起」共存。

-----

## 对「完全展开」语义的明确改变

安装本插件后，「完全展开」不再表示「任何情况下都不收起」，而是：

- 轮次打开时，步骤不折进组头，逐行显示；
- 轮次完成后，按「工作步骤收起时机」决定何时把整轮过程行收起，最终答案仍然可见；
- 收起后仍可通过轮次抬头重新展开；
- 运行中、中断、失败的轮次保持展开；读者手动展开过的轮次保持展开。

这是让收起时机生效必须付出的语义调整。当前收起时机只有「回答结束后」和「下次有新消息时」两个选项，没有「不收起」；本插件让这两个选项都生效，因此不在完全展开模式下提供「永远不收起」。

-----

## 边界与失败模式

| 情况 | 行为 |
| --- | --- |
| `slots` 服务缺席，或 `ctx.get` 不可用 | 跳过策略投影；滚动补偿仍独立尝试安装 |
| 槽已声明，但 `conversation.view#chat` 还没注册 | 在约 1 秒的有界窗口内每 50ms 重扫；窗口内到齐就停止探测，走满窗口仍为空才 `console.warn` 一次 |
| 注入面没有 `hooks.presentation` | 告警一次，注入面原样返回；不会重复报「未找到」 |
| `presentation` source 被冻结，无法原地改写 | 告警一次，注入面原样返回；官方行为不变 |
| `slots.entries` 抛错 | 捕获并告警，不冒泡 |
| chat 注册项被替换 | `slots.subscribe` 的变化回调重新扫描，新注册项会被包装 |
| 补丁重复执行 | 已包装的 source / 注册项分别记录在 `WeakSet` 里，不会叠加包装 |
| 上游改了字段名或槽形状 | 补丁退化为 no-op，官方完全展开行为保持不变；告警文本会指出缺失的 `hooks.presentation` 或槽 |
| 浏览器环境没有共享滚动口 | 只有滚动补偿降级为空操作；策略投影照旧 |
| 滚动补偿安装失败 | 告警一次，不影响策略投影 |

策略投影不触碰其他三种模式：它们的策略对象按身份透传，选择器引用稳定。滚动补偿只在插件挂载期间对同步 `hidden` 折叠生效，不改变任何模式的折叠策略；跟底、动画折叠、没有与视口相交的锚点等跳过条件与失败模式见[第 4 册](04-reading-anchor.md)。它也不改写 Host 设置；用户选择的收起时机继续由官方 `TranscriptViewPolicy` 持久化和发布。
