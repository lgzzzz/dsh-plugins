# dsh-stats-ttft

在输入框下方的**性能统计按钮**上直接显示会话平均首 token 时长（TTFT）。纯客户端插件：
在 `conversation.composer.dock` 槽的账本里按 id **遮蔽**上游 `activity` 条目，包装上游的
`ActivityPill` 并只替换它收到的 `t` —— 按钮读数从「12 轮 34 步 · 45.0 tok/s」变成
「12 轮 34 步 · 2.3秒 · 45.0 tok/s」。**只追加时长本身，不带「首 token 平均（TTFT）」标签**；
TTFT 的语义仍由点开「会话统计」后正文那一行提供。上游产物一行未改，不拦截点击、不改气泡；
从 profile 移除即恢复原读数。没有配置项、不注册服务。

-----

## 它改的是什么

上游 `@deepseek-ai/dsh-client-ui-chat` 在 `conversation.composer.dock` 槽里以 `id: "activity"`、
`order: 0` 注册这个按钮（`$DSH_ROOT/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js`
15560-15568 行）。它的按钮读数由两段译文拼成，TTFT 只在气泡正文里：

| | 上游现状 |
|---|---|
| 按钮第一段 | `t("stats.counts", { turns, steps })` → `12 轮 34 步` |
| 按钮第二段 | `t("message.tokensPerSecond", { tps })` → `45.0 tok/s` |
| 两段之间 | `reading()` 插入一个样式化的 `·` 分隔符（`StatsPills.module.css` 的 `sep`） |
| TTFT | 只在点开「会话统计」气泡后由 `dt/dd` 行显示：`首 token 平均（TTFT） 2.3秒` |
| 取值 | `sessionStats` projection 的 `ttftMs / ttftSteps`（同文件 9422-9500 行） |
| 时长格式 | `duration.compactSeconds`（<60s 保留 1 位小数）/ `duration.compactMinutes`（≥60s） |

本插件把同一个平均时长并进第一段，因此按钮、tooltip 完整读数、`aria-label` 与气泡标题值
都会带上它；气泡正文的 TTFT 行不变。

-----

## 怎么做到的

1. **等槽声明**：`ctx.slots.inject("conversation.composer.dock", …)`；槽一声明就扫账本，之后由
   `ctx.slots.subscribe` 在账本变化时重扫（`src/client.ts`）。
2. **遮蔽源条目**：在原始账本里找 `options.id === "activity"` 且 `component` 不是包装层的条目，
   按相同 `id` / `order` / `locale` 抄下 `inject`，以 `priority - 1` 注册遮蔽项。list 槽按
   priority 最小者渲染（`src/shadow.ts`）。
3. **只换 `t`**：包装层把 props 原样透传给 `ActivityPill`，只覆盖 `t` 这一个座位；`stats.counts`
   的结果后追加 ` · 2.3秒`，其它 key（含输出速度）原样转发（`src/ttft.ts`）。
4. **取值与兜底**：包装层用会话作用域自带的 `useProjection("sessionStats")` 读投影；
   投影缺席时用 `useChat` 的窗口节点按上游同款规则折叠（assistant 节点、`stepStartTime` 与
   `firstTokenTime` 都有才计入）。
5. **生命周期**：源条目换对象时先撤回再重建；源条目消失时撤回；插件卸载时撤销注册与订阅。
   从未找到过源条目时，约 1 秒自检窗口后告警一次（`[dsh-stats-ttft] 未找到 …#activity`），
   UI 保持上游原样。

-----

## 怎么确认它真的生效

```js
// DevTools Console:按钮读数里有没有裸时长（形如 2.3秒 / 2分5秒）
document.querySelector('[data-composer-stat="activity"]')?.textContent

// 点一下按钮:气泡仍应打开,且正文仍有 TTFT 行
document.querySelector('[role="dialog"] [data-session-stats-details]')?.textContent
```

- 第一条返回没有时长 → 先在 Console 找 `[dsh-stats-ttft]` 的告警：「遮蔽 activity 失败」是注册
  被拒，「未找到 …#activity」是上游条目始终没出现；再跑 `pnpm --filter dsh-stats-ttft check:css`，
  对照 `contract.json` 逐条核对上游锚点。刚重启过 Host 时硬刷新页面。
- 第一条有时长、但点开气泡后读数是 `0秒` 或缺失 → 看 TTFT 样本是否存在（`ttftSteps > 0`）；
  没有记录到首 token 的步骤不会让按钮显示 0。
- 把「设置 → 通用设置 → 性能与用量」切到**简洁**后，按钮只剩输出速度（没有气泡）；这是上游
  行为，本插件不改。

-----

## 作用域与不受影响的部分

| | 结果 |
|---|---|
| 详细模式的性能按钮 | 第一段后追加裸时长（如 `12 轮 34 步 · 2.3秒 · 45.0 tok/s`） |
| 窄宽度被省略时的悬停提示 | 完整读数同样包含该时长 |
| 点击按钮 / `aria-label` | 时长进入可访问名称；点击照旧打开「会话统计」 |
| 会话统计气泡 | 正文行、位置、Escape 与外点关闭都不变；标题值同样带上该时长 |
| 简洁模式 | 不变：只有输出速度，没有统计气泡 |
| 用量按钮（`usage`） | 不受影响：只遮蔽 `activity` 那一格 |
| 其它插件 / 上游产物 | 一行未改；移除本插件后回到原读数 |

-----

## 已知边界

- **按钮上没有标签**：只显示 `2.3秒` 这样的裸时长；平均值的语义由气泡正文的 TTFT 行提供。
  这是刻意的显示取舍，不是漏写。
- **气泡标题会重复**：上游把同一段 `stats.counts` 同时用作按钮第一段和气泡标题值，因此气泡标题
  也会显示时长；正文的 TTFT 行保持原样。
- **全会话平均**：显示的是 `ttftMs / ttftSteps`，不是最近一轮，也不是逐轮值。
- **没有样本就不追加**：`ttftSteps === 0` 或投影与窗口都没有记录时不显示 `0秒`。
- **分隔符样式**：追加的中间分隔是纯文本 ` · `，与上游 `.sep` 的颜色/间距略有差异；本插件不向
  DOM 注入节点。
- **上游改名**：`stats.counts`、两个时长单位、`activity` 注册、投影字段、标准 props 等任一变化时，
  `check:css` 在构建后显式失败；运行时找不到注册只告警一次，读数保持原样。

-----

## 挂载与启用

```bash
pnpm install
pnpm --filter dsh-stats-ttft build
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-stats-ttft
```

挂载后 Host 会重新合成客户端 roster，**刷新页面**即可加载本插件（页面的 `__DSH_BOOT__`
里能看到 `dsh-stats-ttft` 条目）。Host 若在启动时冻结了 profile 与产物字节，刷新后页面仍未
带本条目，再重启 `dsh web` 并刷新。构建后的静态契约校验：

```bash
pnpm --filter dsh-stats-ttft check:css
# 或指定 DSH 根
node dsh-stats-ttft/check-css.mjs --dsh-root /opt/homebrew/lib/node_modules
```

恢复原读数：从 profile 移除本包（`dsh plugin --profile web remove dsh-stats-ttft`），刷新页面。

-----

## 进一步探索

- [仓库文档索引](README.md) —— 构建、挂载与全部插件的入口。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端半部的加载顺序与服务注入边界。
- [DSH 插件五种「名字」](plugin-naming.md) —— 包名、patch id/name、导出 name 的分工。
