# dsh-changes-review-fullscreen

右栏的**改动审查**（`changes-review`）标签页按面板的呈现方式选择默认 diff 布局：**不是全屏（`push`）时默认单栏，全屏（`fullscreen`，含窄窗口自动全屏）时默认左右对比**；打开标签页时不再把它切成全屏。纯客户端插件：审查标签页首次挂载时等上游 review store 写入默认值后，按面板现值调用工具栏分栏按钮的 React `onClick`；面板之后在 `push` / `fullscreen` 之间切换时，再按新呈现方式重新设默认。工具栏的分栏按钮照常可开关，同一呈现方式内切走再切回不会改写用户的选择。装上即生效，从 profile 移除即恢复；不注册服务、不占 slot、没有配置项。

> 包名保留历史写法：插件原先的职责是“点击改动卡片时默认全屏”。现在它只负责“按全屏状态设分栏默认值”，不再切换右栏呈现方式。

-----

## 它改的是什么

上游 `@deepseek-ai/dsh-client-ui-deliverables` 用一个 per-session 的 review store 记录每个审查标签页的视图状态：

```ts
{ index, split: true, wrap: false, navigated }
```

- 首次打开标签页时，`ReviewTab` 的 `useEffect` 调 `actions.navigated(...)` seed 这条记录；
- 正文按 `state.split` 画成单栏（`data-review-view="unified"`）或左右对比（`data-review-view="split"`）；
- 唯一的写入口是工具栏分栏按钮的 `onClick: () => actions.toggledSplit(tab.id)`；
- 按钮本身带 `aria-pressed={split}` 与 `data-review-tool="split"`。

右栏的呈现方式存在布局状态 `mode` 里，渲染到面板根的 `data-sidebar-right-panel` 属性上：`push`（推挤、非全屏）或 `fullscreen`。窄于 768px 的窗口里，展开的面板自动按全屏绘制，属性同样是 `fullscreen`。

本插件因此在两个时机读这个属性：

1. **审查标签页首次挂载**：等 `aria-pressed` 从 seed 前的 `false` 变成 seed 后的 `true`，再按面板的 `push` / `fullscreen` 决定要不要调用分栏按钮的 `onClick`。
2. **面板呈现方式变化**：`MutationObserver` 观察 `data-sidebar-right-panel` 属性；属性一变，就对这块面板里已挂载的审查标签页重新按新值设默认。

`push` 对应单栏（`split: false`），`fullscreen` 对应左右对比（`split: true`）。写入口用 fiber 上的 `onClick` 直接调用，不合成点击事件，也不经过 React 的合成事件系统；失败收在插件内的 `try/catch` 里，下一帧再试。

-----

## 默认值怎么落下

| 时机 | 行为 |
|---|---|
| 首次挂载，面板是 `push` | 等 store seed（`split: true`）后调用一次分栏按钮，把 `split` 切成 `false` |
| 首次挂载，面板是 `fullscreen` | 上游 seed 已经是 `split: true`，不动作 |
| 面板 `push` → `fullscreen` | 当前是单栏就调用一次，切成左右对比 |
| 面板 `fullscreen` → `push` | 当前是左右对比就调用一次，切成单栏 |
| 同一标签页切走再切回 | 不动作（store 记录还在，用户的选择优先） |
| 关闭标签页再重新打开 / 刷新恢复 | 新的占位实例 id / 新的 store 记录，重新按当前呈现方式设默认 |
| 用户手动点分栏按钮 | 插件的观察器只认呈现方式变化，不会立刻改回去；直到呈现方式再次变化 |

**为什么要等 seed。** `ReviewTab` 首帧渲染时 store 还没有这个标签页的记录，`aria-pressed` 是 `false`；如果直接把它当成“用户选了单栏”，`push` 下会误判为“已经符合默认值”而放过，随后 seed 又把布局翻成左右对比。上游首次 seed 恒为 `split: true`，所以插件等按钮变成 `true` 再判断；读不到就下一帧重试，连续失败告警后保持上游默认。

**为什么用 fiber 上的 `onClick`。** `actions.toggledSplit(tab.id)` 在 store 的 bucket 还没 seed 出来时会抛 `no review state for tab …`。直接调用可以把异常收在插件里并重试；`button.click()` 会让异常穿过 React 事件派发，被槽位的 `SlotErrorBoundary` 接住。这条闭包同时握着正确的 `actions` 与 `tab.id`，也不会写错标签页。

-----

## 怎么确认它真的生效

装上后，文档根元素会带一个标记：

```js
// DevTools Console
document.documentElement.hasAttribute('data-dsh-changes-review-fullscreen')   // true = 已加载并装上
```

打开一个改动文件的审查标签页后（右栏不是全屏）：

```js
const root = document.querySelector('[data-changes-review]')
root?.getAttribute('data-dsh-review-split')                                       // "push"
root?.querySelector('[data-review-tool="split"]')?.getAttribute('aria-pressed')   // "false"
root?.querySelector('[data-review-view]')?.getAttribute('data-review-view')       // "unified"
```

点右栏右上角的**全屏**按钮，再做一次同样的检查：

```js
root?.getAttribute('data-dsh-review-split')   // "fullscreen"
root?.querySelector('[data-review-tool="split"]')?.getAttribute('aria-pressed')   // "true"
root?.querySelector('[data-review-view]')?.getAttribute('data-review-view')       // "split"
```

- 标记为 `false` → 浏览器这一页没有加载到本插件，先硬刷新；仍为 `false` 说明 Host 还没有重新合成，需要重启 `dsh web`（或在「设置 → 插件」里关掉再打开本插件）。
- 标记为 `true`、`push` 下仍是左右对比 → 先看控制台有没有 `[dsh-changes-review-fullscreen]` 告警：没有告警说明插件没处理这个标签页（可能没有占位实例 id / 标签页 id）；有告警说明上游分栏按钮或 store seed 变了，对照 [`contract.json`](../dsh-changes-review-fullscreen/contract.json) 运行 `pnpm --filter dsh-changes-review-fullscreen check:css`。
- 想恢复上游默认（一直左右对比、不随全屏变化）→ 从 profile 移除本包，刷新页面。

-----

## 作用范围与边界

| | 结果 |
|---|---|
| 打开审查标签页时右栏不是全屏（`push`） | **默认单栏** |
| 打开审查标签页时右栏已是全屏 / 窄窗口自动全屏 | **默认左右对比**（上游 seed 本身就是左右对比，不额外动作） |
| 审查标签页已打开，切到全屏 | 自动切成左右对比 |
| 审查标签页已打开，退出全屏 | 自动切回单栏 |
| 同一标签页切走再切回、或用户刚手动点过分栏按钮 | 保持现状，不重新改写 |
| 关闭标签页再重新打开、刷新页面时恢复的审查标签页 | 按当前呈现方式重新设默认 |
| 审查标签页落在浮动面板里 | 沿用所属右栏面板的呈现方式读数 |
| 改动文件卡片的悬停预览浮层（`[data-changes-hover-preview]`） | 不受影响（不是审查标签页） |
| 右栏其它标签页、终端、文档预览 | 不受影响（根元素不是 `[data-changes-review]`） |
| 面板还没有 `data-sidebar-right-panel` 标记 | 重试若干帧；一直读不到就保持上游默认，并在控制台告警一次 |
| 分栏按钮缺席 / 读不到 React `onClick` / 写入口连续抛错 | 保持上游默认，控制台告警一次；工具栏按钮仍可手动开关 |
| 非浏览器环境（没有 `document` / `MutationObserver`） | 空操作 |

**不再做的事**：点击改动文件卡片不会再把审查标签页切成全屏。右栏的全屏仍可由面板右上角的按钮、`Ctrl+Alt+Enter` 或 `⌘⌥Enter` 等既有入口手动切换；本插件只在切换后调整 diff 的默认布局。`⌘⌥Y` 打开「变更请求」面板的默认全屏由 [`dsh-keyboard-shortcuts`](dsh-keyboard-shortcuts.md) 负责，与本插件无关。

-----

## 实现要点

| 文件 | 职责 |
|---|---|
| [`src/client.ts`](../dsh-changes-review-fullscreen/src/client.ts) | 浏览器入口；`ctx.effect` 装上 / 卸载观察器 |
| [`src/split-default.ts`](../dsh-changes-review-fullscreen/src/split-default.ts) | 身份判定、呈现方式读数、一次写入、重试与放手、`MutationObserver` |
| [`src/fiber.ts`](../dsh-changes-review-fullscreen/src/fiber.ts) | 从分栏按钮的 React fiber 上取 `onClick` |

- **身份**：优先用最近的 `[data-sidebar-right-occurrence]`（标签页占位实例的随机 id，跨会话唯一，切页重挂时不变）；该属性缺席时退回「会话 id + 标签页 id」。已经按某个呈现方式处理过的身份记在内存里，因此切页重挂不会二次写入。
- **呈现方式只读 DOM**：`[data-sidebar-right-panel]` 是布局状态的公开读数，浮动面板同样挂在面板根内；不注入 `sidebarRight` 服务，也不调用任何全屏切换入口。
- **重试**：只有确认失败或还没到可判断的时候才重试 —— 读不到分栏按钮 / 呈现方式、首次挂载时 store 还没 seed、取不到 `onClick`、按钮不可操作、`onClick` 抛错。`MAX_ATTEMPTS` 帧（12 帧，约 200ms）后告警并放手。
- **幂等与卸载**：成功写入后不再复核（切换分栏是 toggle，复核失败再调一次会把布局翻回去）；卸载时断开观察、移除文档根标记，不动 DOM 与布局。

-----

## 挂载与启用

从仓库根依次执行：

```bash
# 仓库根：把新包记进 workspace / lockfile
pnpm install

# 构建浏览器半部（tsdown → lib/client.js）
pnpm --filter dsh-changes-review-fullscreen build

# 挂进 web profile
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-changes-review-fullscreen
```

然后刷新 GUI 页面。客户端半部改动后要重新构建；Host 在页面加载时重新读产物，通常刷新即可，若仍拿到旧字节，用「设置 → 插件」关掉再打开本插件，或重启 `dsh web`。

-----

## 上游契约与校验

本目录的 [`check-css.mjs`](../dsh-changes-review-fullscreen/check-css.mjs) 按 [`contract.json`](../dsh-changes-review-fullscreen/contract.json) 对 DSH 安装产物逐条 grep，`pnpm check:css` 触发（不挂在 `pnpm build` 上）。校验的是：

- 审查标签页根 `data-changes-review`；
- 分栏按钮的 `data-review-tool="split"`、`aria-pressed={split}` 与它的 `onClick` 仍调用 `actions.toggledSplit(tab.id)`；
- review store 首次 seed 仍是 `split: true, wrap: false`（插件“等 seed 后再切单栏”的前提）；
- 右栏面板的 `data-sidebar-right-panel` 以及它同时输出 `push` / `fullscreen` 两个值；
- 侧栏的占位实例 / 标签页 / 会话三个身份属性。

上游改名或删 token 时显式失败，而不是让默认分栏静默失效。

-----

## 进一步探索

- [改动审查标签页默认换行](dsh-changes-review-wrap.md) —— 同一个 `changes-review` 标签页的另一条默认行为，同样从 DOM 锚点出发。
- [改动文件卡片打开本地变更](dsh-changes-card-local.md) —— 卡片标题 / 文件行的另一条入口。
- [快捷键插件](dsh-keyboard-shortcuts.md) —— 面板全屏、`⌘⌥Y` 打开「变更请求」等固定键。
- [DSH 组件 CSS 架构](dsh-css-architecture.md) —— `data-*` 锚点与右栏标记的作用域。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端半部如何进入浏览器 roster。
