# dsh-stats-ttft

在输入框下方的**性能统计按钮**上显示**最近 7 步**的平均首 token 时长（TTFT）与输出速度（TPS），
点开的气泡正文仍按**全会话**统计。
宿主半部注册一个 `recentStepStats` 会话投影（逐步折叠 TTFT / 解码累计）；浏览器半部在
`conversation.composer.dock` 槽的账本里按 id **遮蔽**上游 `activity` 条目，包装上游的
`ActivityPill` 并替换它收到的 `t`，再把气泡正文里被带偏的两处文本还原：

- 按钮第一段后追加最近 7 步的平均 TTFT；
- 按钮速度段换成最近 7 步的 TPS；
- 气泡标题值去掉追加的时长、气泡速度行换回全会话 TPS；气泡的 TTFT 行本来由上游按全会话计算。

按钮读数从「12 轮 34 步 · 45.0 tok/s」变成「12 轮 34 步 · 2.3秒 · 45 tok/s」。**只显示裸时长/裸速度，
不带「近 7 步」或「首 token 平均（TTFT）」标签**。上游产物一行未改，从 profile 移除即恢复原读数。

-----

## 口径

- **一步**：一次模型请求/应答周期（`step/start` → 流式 → `assistant/message` → 工具执行 → `step/end`）。
  TTFT/TPS 只覆盖模型段，工具执行时间不计入。
- **窗口**：最近 7 个**已结束的 step**（`step/end` 计数）。进行中的步不计入；失败、取消的
  已结束步占一个步位，但没有样本、不贡献 TTFT/TPS。
- **TTFT**：窗口内**有首 token** 的步的 `首 token − step/start` 求和 ÷ 样本步数。
- **TPS**：窗口内**上报 `outputTokens`** 的步的 `outputTokens` 求和 ÷ `解码时间` 求和；解码时间是
  `assistant/message − 首 token`，与上游 `sessionStats` 同口径。
- **重试**：TTFT 取**首次尝试**的首 token；解码时间跨过重试退避（与上游一致，TPS 会被拉低）。
- **失败/取消步**：`step/end` 前没有 `assistant/message` 就是零值步位；占窗口、不占样本。
- **窗口不足 7 步**：用现有步；没有任何样本时不显示 `0秒`、也不改写 TPS。
- **气泡**：点开的气泡正文是全会话口径——标题值、TTFT 行、速度行、模型/工具用时都不受最近 7 步影响。

-----

## 它改的是什么

上游 `@deepseek-ai/dsh-client-ui-chat` 在 `conversation.composer.dock` 槽里以 `id: "activity"`、
`order: 0` 注册这个按钮。上游的两段读数默认都是**全会话**口径：

| | 上游现状 | 本插件 |
|---|---|---|
| 按钮第一段 | `t("stats.counts", { turns, steps })` → `12 轮 34 步` | 追加最近 7 步平均 TTFT |
| 按钮第二段 | `t("message.tokensPerSecond", { tps })` → `45.0 tok/s` | 换成最近 7 步 TPS |
| 两段之间 | `reading()` 插入样式化的 `·` | 不变 |
| 气泡标题值 | 复用 `stats.counts` | 还原成全会话计数（去掉追加的时长） |
| 气泡 TTFT 行 | 上游内部用 `stats.ttftMs / stats.ttftSteps` 计算 | **不变（全会话）** |
| 气泡速度行 | 与按钮第二段共享同一个 speed 字符串 | 还原成全会话 TPS |

`counts` 与 `speed` 是同一个字符串，在 `ActivityPill` 内部同时喂给按钮和气泡，只换 `t` 分不开
两者。所以按钮照常接收改写后的 `t`，气泡挂载后由 `src/dialog.ts` 把标题值与速度行两处文本节点
改回全会话读数：**按钮是最近 7 步，气泡正文是全会话**，各自完整。

-----

## 怎么做到的

1. **宿主投影**（`src/recent.ts` + `index.ts`）：`ctx.inject(["sessionProjections"], …)` 注册
   `recentStepStats` 单元，`stateVersion = 1`、`summary = false`。折叠规则：
   `step/start` 记步起点；`assistant/attempt` 记首次尝试的首 token；`assistant/message`
   收尾（TTFT 计样本，usage 合法才计解码）；`llm/retry-started` 不清首 token；`step/end`
   把该步累计写进环形窗口并裁到最近 7 步，没有消息的步写零值。视图直接返回逐步数组，
   步内事件（尝试、消息）不换数组引用，因此不触发 change feed。
2. **等槽声明**：`ctx.slots.inject("conversation.composer.dock", …)`；槽一声明就扫账本，之后由
   `ctx.slots.subscribe` 在账本变化时重扫（`src/client.ts`）。
3. **遮蔽源条目**：在原始账本里找 `options.id === "activity"` 且 `component` 不是包装层的条目，
   按相同 `id` / `order` / `locale` 抄下 `inject`，以 `priority - 1` 注册遮蔽项。list 槽按
   priority 最小者渲染（`src/shadow.ts`）。
4. **只换 `t`**：包装层把 props 原样透传给 `ActivityPill`，只覆盖 `t`：
   `stats.counts` 后追加 ` · 时长`；`message.tokensPerSecond` 改用最近 7 步 TPS；其它 key 原样
   转发（`src/ttft.ts`）。
5. **还原气泡**：包装层读上游全会话投影 `sessionStats`（缺席时按 `deriveStats` 口径折叠窗口），
   算出全会话 TPS 与计数，配成标题值、速度行两对文本；气泡 portal 到 `document.body` 后，
   `src/dialog.ts` 用 MutationObserver 找到带 `data-session-stats-details` 的面板，把两处文本节点的
   `nodeValue` 改回全会话读数（React 重写后再同步）。用量按钮的气泡没有这个标记，不会被碰。
6. **取值与兜底**：优先 `useProjection("recentStepStats")`；投影缺席时用 `useChat` 的已加载
   窗口，取最后 7 个 assistant 节点（有消息的步）折叠兜底——没有消息的步不占位，是近似口径。
7. **生命周期**：源条目换对象时先撤回再重建；源条目消失时撤回；插件卸载时撤销注册与订阅。
   从未找到过源条目时，约 1 秒自检窗口后告警一次（`[dsh-stats-ttft] 未找到 …#activity`），
   UI 保持上游原样。

-----

## 怎么确认它真的生效

```js
// DevTools Console：按钮读数里有没有裸时长与最近 7 步速度
document.querySelector('[data-composer-stat="activity"]')?.textContent
```

- 读数形如 `12 轮 34 步 · 2.3秒 · 45 tok/s`。`2.3秒` 是最近 7 步平均 TTFT，`45 tok/s` 是最近
  7 步 TPS；`12 轮 34 步` 仍是全会话。
- 点开气泡再看一眼：标题值只有 `12 轮 34 步`（没有追加时长），速度行是全会话 TPS，TTFT 行是
  全会话平均。气泡正文的标记是 `document.querySelector('dl[data-session-stats-details]')`。
- **改完宿主半部必须重启 `dsh web`**：新投影单元要随宿主重新注册；重启前页面会走窗口兜底
  （最后 7 个有 assistant 消息的步），数值是近似口径；当前进行中的步要结束后才进入窗口。
- 只改客户端（含气泡还原）时不需要重启宿主：重建后**刷新页面**加载新的 `lib/client.js` 即可。
- 读数异常时先看 Console：`[dsh-stats-ttft] 未找到 …#activity` 是上游条目没出现；
  `[dsh-stats-ttft] 注册 recentStepStats 投影失败` 是宿主注册失败（此时走窗口兜底）。
- 再跑构建后契约：`pnpm --filter dsh-stats-ttft check:css`，对照 `contract.json` 逐条核对上游锚点。

-----

## 作用域与不受影响的部分

| | 结果 |
|---|---|
| 详细模式的性能按钮 | `12 轮 34 步 · 最近7步TTFT · 最近7步TPS` |
| 窄宽度被省略时的悬停提示 | 与按钮同一口径的完整读数（计数 · 最近时长 · 最近 TPS） |
| 点击按钮 / `aria-label` | 同上；点击照旧打开「会话统计」气泡 |
| 会话统计气泡 | 位置、Escape 与外点关闭都不变；标题值、TTFT 行、速度行都是全会话读数 |
| 简洁模式 | 上游只渲染速度，因此这里只有最近 7 步 TPS，没有 TTFT |
| 用量按钮（`usage`） | 不受影响：只遮蔽 `activity` 那一格 |
| 其它插件 / 上游产物 | 一行未改；移除本插件后回到原读数 |

-----

## 已知边界

- **按钮上没有「近 7 步」标签**：只显示裸时长；窗口语义由本说明提供。
- **按钮与气泡两个口径**：按钮上的时长与速度是最近 7 步；轮/步计数、tooltip、`aria-label`
  与整个气泡（标题值、TTFT 行、速度行、模型/工具用时）是全会话。
- **气泡还原写在挂载后的文本节点上**：上游改气泡 DOM 或去掉 `data-session-stats-details` 标记时，
  `check:css` 在构建后显式失败；运行时找不到标记就只保留按钮改写，气泡会重新显示最近 7 步读数。
  React 重写这两处文本后，包装层下一次同步会改回来。
- **失败/取消的已结束步占位**：最近 7 个已结束步里如果包含零值步，样本数会少于 7；平均与
  TPS 仍只按有样本的步计算。进行中的步在结束前不占位。
- **投影缺失时是近似窗口**：兜底只取已加载窗口里最后 7 个有 assistant 消息的步，失败步与
  进行中的步不占位，且受分页/压缩影响；宿主投影在时不受影响。
- **重试放大**：最近窗口里重试退避会直接拉低 TPS；这是与上游一致的口径，不是本插件引入的。
- **没有样本不改写**：最近 7 步没有 TTFT 样本时不追加时长；没有 TPS 样本时保留上游全会话速度
  （无法把速度段隐藏，只能不改写）。
- **窗口大小是共享常量**：`RECENT_STEPS = 7` 同时约束宿主环形窗口与客户端统计；改它要同时
  重建宿主与客户端（宿主投影还要重启）。
- **上游改名**：`stats.counts`、`message.tokensPerSecond`、两个时长单位、TPS 取整、`activity`
  注册、标准 props 等任一变化时，`check:css` 在构建后显式失败；运行时找不到注册只告警一次，
  读数保持原样。

-----

## 挂载与启用

```bash
pnpm install
pnpm --filter dsh-stats-ttft build
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-stats-ttft
```

**重启 `dsh web`**（宿主半部注册投影），然后刷新页面（客户端 bundle）。构建后的静态契约校验：

```bash
pnpm --filter dsh-stats-ttft check:css
# 或指定 DSH 根
node dsh-stats-ttft/check-css.mjs --dsh-root /opt/homebrew/lib/node_modules/@deepseek-ai/dsh
```

恢复原读数：从 profile 移除本包（`dsh plugin --profile web remove dsh-stats-ttft`），刷新页面。

-----

## 进一步探索

- [仓库文档索引](README.md) —— 构建、挂载与全部插件的入口。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端半部的加载顺序与服务注入边界。
- [DSH 插件五种「名字」](plugin-naming.md) —— 包名、patch id/name、导出 name 的分工。
