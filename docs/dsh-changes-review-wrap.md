# dsh-changes-review-wrap

让右栏的**改动审查**（`changes-review`）标签页默认开启自动换行。纯客户端插件：每个审查标签页第一次挂载时，本插件调用工具栏换行按钮自己的 React `onClick`，把上游 review store 里的 `wrap` 写成 `true`；工具栏的换行按钮仍然可用，用户可以随时关掉，关掉后切走再切回不会被重新打开。关闭标签页再重新打开，会得到一条新的 store 记录，于是重新按默认开启。装上即生效，从 profile 移除即恢复；不注册服务、不占 slot、没有配置项。

-----

## 它改的是什么

上游 `@deepseek-ai/dsh-client-ui-deliverables` 用一个 per-session 的 review store 记录每个审查标签页的视图状态：

```ts
{ index, split: true, wrap: false, navigated }
```

首次打开标签页时，`ReviewTab` 的 `useEffect` 调 `actions.navigated(...)` 写入这条记录。`wrap: false` 就是「默认不换行」的来源；唯一的写入口是工具栏换行按钮的 `onClick: () => actions.toggledWrap(tab.id)`。

本插件在 `[data-changes-review]` 根元素第一次插入 DOM 时，找到其中的 `[data-review-tool="wrap"]`，直接调用它在 fiber 上的 `onClick`。这等价于用户点了一次「自动换行」，但不经过 React 的合成事件派发：

- **不会把异常穿进 React 事件系统**。`actions.toggledWrap` 在 store 的 bucket 还没 seed 出来时会抛 `no review state for tab …`；直接调用可以把异常收在插件内的 `try/catch` 里，下一帧再试，而不是让槽位的 `SlotErrorBoundary` 接住。
- **不抢焦点**。`button.click()` 在真实浏览器里会移动焦点；直接调用 `onClick` 不会。

一次成功的调用之后不再复核：换行动作本身就是 toggle，复核失败时重试会把刚打开的换行又关掉。连续失败只重试「确认没写进去」的那几次（取不到按钮 / `onClick`、按钮不可操作、调用抛错）。

-----

## 怎么确认它真的生效

装上后，文档根元素会带一个标记：

```js
// DevTools Console
document.documentElement.hasAttribute('data-dsh-changes-review-wrap')   // true = 已加载并装上
```

打开一个改动文件的审查标签页后：

```js
const root = document.querySelector('[data-changes-review]')
root?.hasAttribute('data-dsh-review-wrap')                                // true = 本插件处理过这个标签页
root?.querySelector('[data-review-tool="wrap"]')?.getAttribute('aria-pressed')   // "true"
root?.querySelector('[data-review-view]')?.hasAttribute('data-review-wrap')      // true
```

- 打开的标签页没有换行、也没有根标记 → 本插件没有处理这个标签页。先看控制台有没有 `[dsh-changes-review-wrap]` 告警：没有告警说明插件没加载（看第一个标记）；有告警说明上游锚点或写入口变了。
- 有根标记、按钮 `aria-pressed` 却是 `"false"` → 用户手动关掉了换行；本插件不会再次打开它。

-----

## 作用范围与边界

| | 结果 |
|---|---|
| 新打开的审查标签页 | **默认换行** |
| 同一标签页里切走再切回 | 保持用户的选择（关掉后不会被重新打开） |
| 关闭审查标签页再重新打开 | 新的 store 记录 / 新的占位 id，**重新默认换行** |
| 刷新页面时恢复的审查标签页 | store 是新的，**重新默认换行** |
| 工具栏的换行按钮 | 照常工作（写同一个 store） |
| 改动文件卡片的悬停预览浮层（`[data-changes-hover-preview]`） | 不受影响（不是审查标签页） |
| 左右对比 / 单列视图（`split`） | 两者都换行，互不影响 |

本插件只处理 `[data-changes-review]`；改动文件卡片、文档预览、终端等其它右栏页面都不在作用范围内。

-----

## 实现要点

| 文件 | 职责 |
|---|---|
| [`src/client.ts`](../dsh-changes-review-wrap/src/client.ts) | 浏览器入口；`ctx.effect` 装上 / 卸载观察器 |
| [`src/wrap-default.ts`](../dsh-changes-review-wrap/src/wrap-default.ts) | 身份判定、一次写入、重试与放手、`MutationObserver` |
| [`src/fiber.ts`](../dsh-changes-review-wrap/src/fiber.ts) | 从换行按钮的 React fiber 上取 `onClick` |

- **身份**：优先用最近的 `[data-sidebar-right-occurrence]`（标签页占位实例的随机 id，跨会话唯一，切页重挂时不变）；该属性缺席时退回「会话 id + 标签页 id」。已经处理过的身份记在内存里，因此切页重挂不会二次写入。
- **重试**：只有确认失败才重试 —— 取不到按钮 / `onClick`、按钮不可操作、`onClick` 抛错。`MAX_ATTEMPTS` 帧（8 帧，约 130ms）后告警并放手，标签页保持未换行，仍可手动开关。
- **失败路径**：任何一步失败都只影响当前标签页，不改 DOM 布局、不拦截用户操作。

-----

## 挂载与启用

从仓库根依次执行：

```bash
# 仓库根：把新包记进 workspace / lockfile
pnpm install

# 构建浏览器半部（tsdown → lib/client.js）
pnpm --filter dsh-changes-review-wrap build

# 挂进 web profile
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-changes-review-wrap
```

然后刷新 GUI 页面。客户端半部改动后要重新构建；Host 在页面加载时重新读产物，通常刷新即可，若仍拿到旧字节，用「设置 → 插件」关掉再打开本插件，或重启 `dsh web`。

-----

## 上游契约与校验

本目录的 [`check-css.mjs`](../dsh-changes-review-wrap/check-css.mjs) 按 [`contract.json`](../dsh-changes-review-wrap/contract.json) 对 DSH 安装产物逐条 grep，`pnpm check:css` 触发（不挂在 `pnpm build` 上）。校验的是：

- 审查根 / 正文 / 工具栏换行按钮 / 换行态属性四个 DOM 锚点；
- review store 首次 seed 仍是 `split: true, wrap: false`（仍是「默认不换行」，插件仍有意义）；
- `toggledWrap` 动作名仍在（按钮的 `onClick` 仍写这个 action）；
- 侧栏的占位实例 / 标签页 / 会话三个身份属性。

上游改名或删 token 时显式失败，而不是让默认换行静默失效。

-----

## 进一步探索

- [改动文件卡片悬停浮层插件](dsh-changes-hover-off.md) —— 同一张改动文件卡片的另一条入口，同样的 `data-*` 锚点与静态契约写法。
- [DSH 组件 CSS 架构](dsh-css-architecture.md) —— 审查标签页的样式作用域与 `data-*` 锚点体系。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端半部如何进入浏览器 roster。
- [DSH 插件五种「名字」](plugin-naming.md) —— 包名 / patch id / 导出 name 的分工。
