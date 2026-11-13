# dsh-changes-review-fullscreen

点击**改动文件卡片**打开右栏的**改动审查**（`changes-review`）标签页时，默认把右栏切成**全屏呈现**。纯客户端插件：在 `document` 捕获阶段接住卡片里打开审查页的按钮，等 React 的 `onClick` 把标签页放进右栏之后，再对活动 dock 面板调用 `sidebarRight.toggleFullscreen()`。面板本来就是全屏（包括窄于 768px 的窗口里展开即自动全屏）时不动作；卡片的「展开全部文件」按钮、卡片外的点击与右栏其它标签页都不受影响。装上即生效，从 profile 移除即恢复；不注册服务、不占 slot、没有配置项。

-----

## 它改的是什么

上游 `@deepseek-ai/dsh-client-ui-deliverables` 让每个完成轮次以「改动文件卡片」收尾（`[data-changed-files]`）：

- 单文件时，卡片标题就是一个按钮；多文件时，标题与每个文件行都是按钮；
- 点击按钮调用 `sidebarRight.openResource()` 打开（或聚焦）那一轮的审查标签页，kind 是 `changes-review`，落在右栏的活动 dock 面板并把右栏展开；
- 同一张卡片里还有一个「展开全部文件」的折叠按钮（带 `aria-expanded`），它只改列表高度，不打开标签页。

右栏的呈现方式存在布局状态 `mode` 里（`push` / `fullscreen`），渲染到面板根的 `data-sidebar-right-panel` 属性上；唯一公开的写入口是 `sidebarRight.toggleFullscreen(target)`。窄于 768px 的窗口里，展开的面板自动按全屏绘制，属性同样是 `fullscreen`。

本插件因此分两步：

1. 在 `document` 捕获阶段认领 `[data-changed-files]` 里不带 `aria-expanded` 的按钮点击；
2. 排一个微任务。等 React 的 `onClick` 把标签页放进 store、右栏展开之后，读活动标签页与面板标记：只有活动标签页确实是 `changes-review`、面板标记是 `push`、目标仍是当前 dock 面板时，才调用 `toggleFullscreen()`。

微任务在本次点击的事件派发之后、绘制之前运行，所以面板不会先以推挤方式闪一帧。已经是 `fullscreen` 时不调用：`toggleFullscreen()` 会把它切回 `push`，窄窗口下还会把右栏折叠。

-----

## 怎么确认它真的生效

装上后，文档根元素会带一个标记：

```js
// DevTools Console
document.documentElement.hasAttribute('data-dsh-changes-review-fullscreen')   // true = 已加载并装上
```

点一下改动文件卡片的标题或文件行，然后：

```js
const panel = document.querySelector('[data-sidebar-right-session]:not([hidden]) [data-sidebar-right-panel]')
panel?.getAttribute('data-sidebar-right-panel')   // "fullscreen"
```

- 标记为 `false` → 浏览器这一页没有加载到本插件，先硬刷新；仍为 `false` 说明 Host 还没有重新合成，需要重启 `dsh web`（或在「设置 → 插件」里关掉再打开本插件）。
- 标记为 `true`、点击后仍是 `push` → 先确认点的是标题 / 文件行而不是「展开全部文件」；再对照 [`contract.json`](../dsh-changes-review-fullscreen/contract.json) 检查上游锚点与右栏公开面是否改名。本插件失败时只收敛为不动作，不写控制台告警。
- 想恢复推挤呈现 → 从 profile 移除本包，刷新页面；已经打开的面板可用面板右上角的「退出全屏」切回去。

-----

## 作用范围与边界

| | 结果 |
|---|---|
| 点击改动文件卡片的标题 / 文件行 | 打开（或聚焦）审查标签页，并默认全屏呈现 |
| 点击卡片的「展开全部文件」 | 只展开列表，不改呈现方式（按钮带 `aria-expanded`，插件跳过） |
| 面板本来就是全屏 / 窄窗口自动全屏 | 不改变呈现方式，不会误切回 `push` 或折叠 |
| 面板当前是 `push`，但活动标签页不是 `changes-review` | 不动作（例如点击时标签页已被别的操作切走） |
| 审查标签页在浮动面板里被聚焦 | 不动作（全屏切换只作用于当前活动的 dock 面板） |
| 卡片外的点击、右栏其它标签页 | 不受影响 |
| 右栏服务缺席（右栏插件没挂） | 不安装监听，无副作用 |
| `document` 缺席（非浏览器环境） | 空操作 |

本插件只处理改动文件卡片点击这一条路径。用 `⌘⌥Y` / `Ctrl+Alt+Y` 打开「变更请求」面板的默认全屏由 [`dsh-keyboard-shortcuts`](dsh-keyboard-shortcuts.md) 负责，两者互不覆盖：一个在卡片点击之后切全屏，另一个在那条固定键打开面板之后切全屏。

-----

## 实现要点

| 文件 | 职责 |
|---|---|
| [`src/client.ts`](../dsh-changes-review-fullscreen/src/client.ts) | 浏览器入口；`ctx.inject(['sidebarRight'])` 后经 `ctx.effect` 装上 / 卸载监听 |
| [`src/fullscreen.ts`](../dsh-changes-review-fullscreen/src/fullscreen.ts) | 点击判定、面板呈现读数、打开后的全屏切换、捕获监听与文档根标记 |

- **只认打开审查页的按钮**：卡片里的折叠按钮带 `aria-expanded`；禁用的按钮与带 `aria-disabled="true"` 的按钮同样跳过。
- **只切 push → fullscreen**：面板根标记是 `fullscreen` 时直接返回。这个读数同时覆盖手动全屏与窄窗口的自动全屏。只读当前会话视图（`[data-sidebar-right-session]:not([hidden])`）；切走后仍保留在 DOM 里的其它会话视图不参与判断。
- **确认打开的是审查页**：`sidebarRight.active()` 的 kind 必须是 `changes-review`。活动标签页不是它时，点击可能没有走到打开审查页的路径，不能顺手切当前标签页。
- **用 `commandTarget(null)` 解析活动 dock 面板**：不沿用卡片按钮的焦点，点击后右栏刚展开、按钮仍在会话区；`null` 让服务回退到当前 Session 的活动 dock 面板。
- **幂等与卸载**：排程中的点击只保留一次；卸载时移除捕获监听与文档根标记，不动 DOM 与布局。

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

- 改动文件卡片根 `data-changed-files` 与折叠按钮的 `aria-expanded`；
- 右栏面板的 `data-sidebar-right-panel` 以及它同时输出 `push` / `fullscreen` 两个值；
- 审查标签页的 kind 仍是 `changes-review`；
- 右栏公开面仍提供 `active()`、`commandTarget()` 与 `toggleFullscreen()`。

上游改名或删 token 时显式失败，而不是让「默认全屏」静默失效。

-----

## 进一步探索

- [改动审查标签页默认换行](dsh-changes-review-wrap.md) —— 同一个 `changes-review` 标签页的另一条默认行为，同样从 DOM 锚点出发。
- [改动文件卡片悬停浮层关闭](dsh-changes-hover-off.md) —— 同一张卡片的另一条入口，`data-changed-files` 锚点的另一种用法。
- [快捷键插件](dsh-keyboard-shortcuts.md) —— `⌘⌥Y` / `Ctrl+Alt+Y` 打开「变更请求」面板并默认全屏的实现。
- [DSH 组件 CSS 架构](dsh-css-architecture.md) —— `data-*` 锚点与右栏标记的作用域。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端半部如何进入浏览器 roster。
