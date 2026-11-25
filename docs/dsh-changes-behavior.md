# dsh-changes-behavior

右栏改动视图的统一行为插件。它把原先五个独立插件合成一个，并为「打开右栏」定一条统一策略：

- **改动卡片标题**打开右栏「本地变更」、**`⌘⌥Y` / `Ctrl+Alt+Y`** 打开会话绑定的「变更请求」页（没有绑定时打开「本地变更」）、**点会话面板那行「本地变更」**时，默认**全屏**；
- **其余任何打开右栏的入口**——改动卡片的文件行、中间过程里的文件 / 资源链接、上下文菜单、其它插件发起的打开——都默认**非全屏**（推挤呈现）；
- 改动审查（`changes-review`）标签页按面板呈现方式默认分栏（非全屏单栏、全屏左右对比），并默认开启自动换行；
- 关掉改动文件卡片 500ms 悬停弹出的单列 diff 浮层；
- 「本地变更」「变更请求」标签页整棵子树字号统一 14px；
- 固定「本地变更」「变更请求」左侧文件列表的宽度：隐藏那条既是拖动入口也是键盘入口的分隔条，宽度停在上游默认值，不再可调；
- **单文件改动卡片也按汇总形制渲染**：标题是 `已编辑 1 个文件`，下面列出那一个文件（启动期给上游客户端产物打一行补丁，见下文）。

宿主 + 客户端插件：宿主半部只在启动时做那行补丁，其余行为全在浏览器半部；不注册服务、不占 slot、没有配置项。装上即生效，从 profile 移除即恢复上游默认（补丁在卸载时也会还原）。原先的 `dsh-changes-card-local`、`dsh-changes-review-fullscreen`、`dsh-changes-review-wrap`、`dsh-changes-hover-off`、`dsh-forge-changes-font-14` 已全部并入本包；「变更请求」快捷键也从 `dsh-keyboard-shortcuts` 迁来。

-----

## 打开呈现策略

| 打开方式 | 结果 |
|---|---|
| 改改动卡片**标题** | 打开 / 聚焦「本地变更」，并切到全屏 |
| `⌘⌥Y` / `Ctrl+Alt+Y` | 打开 / 聚焦会话第一张变更请求卡片的变更页（没有绑定时是「本地变更」），并切到全屏 |
| 点**会话面板**里「本地变更 · N 个文件」那行的行主体，或同一行「⋯」菜单里的「查看变更」 | 打开 / 聚焦「本地变更」，并切到全屏（已经是全屏时保持） |
| 改动卡片**文件行** | 打开本轮审查页，**非全屏** |
| 中间过程 / 正文里的可点击文件、资源链接 | 打开对应右栏页面，**非全屏** |
| 上下文菜单的「在侧边栏打开」 | **非全屏** |
| 其它插件经 `sidebarRight.openResource` / `openTab` / `openResourceIn` / `openTabIn` 发起 | **非全屏** |
| 用户手动点面板右上角的全屏按钮 | 只改呈现方式，不受本策略干预 |

呈现方式不靠「猜这次点击是不是指定入口」：右栏面的四个打开入口各包一层，**先按原逻辑打开；打开前若面板是全屏，打开成功后立刻切回推挤**。打开成功时右栏一定已经展开，`toggleFullscreen` 才能生效；先打开再切换也避开了「折叠状态下无法切呈现方式」的上游限制。

指定入口用两种方式告诉包装层「这一次打开要全屏」：

- **卡片标题、`⌘⌥Y`** 在自己的打开动作外套一个 `withFullscreenIntent()`。包装层看到意图就跳过「切回推挤」，打开后再由 `presentFullscreen()` 按 DOM 现值决定：原本是推挤就切成全屏，原本已经全屏就保持。意图只在同一个同步任务内有效，`finally` 一定还原，不会泄漏到下一次打开。
- **会话面板那一行**在打开入口上判定（`session-panel.ts` 的 `isSessionPanelLocalOpen`）：打开的是当前会话的「本地变更」页、且此刻会话面板可见，就算这一行的打开。包层跳过「切回推挤」，打开后自己调 `presentFullscreen()` 切成全屏。行主体与行内「⋯」菜单走的是同一个打开入口，所以两者结果一致；已经全屏时从这一行再打开也不会被推回推挤（见「会话面板的『本地变更』行」）。

不干预的情况：

- **窄窗口（< 768px）的自动全屏**：此时上游本来就把推挤画成全屏，切 `push` 反而会把右栏收起来，所以包装层直接放行；
- **打开落在浮层**（`destination: 'float'`）：浮层不改变停靠栏的呈现方式；
- 面板还没画出来、读不到 `data-sidebar-right-panel`、右栏面没有全屏命令、目标已陈旧：只打开，不切呈现方式。

呈现方式只读 DOM 的 `data-sidebar-right-panel`；切回推挤仍走公开的 `toggleFullscreen(target)`，不直接写 store。

-----

## 改动卡片：标题

上游 `@deepseek-ai/dsh-client-ui-deliverables` 把一轮的改动渲染成一张卡片（`[data-changed-files]`）：

| 元素 | 上游默认行为 | 本插件行为 |
|---|---|---|
| 标题（多文件卡片；打完补丁后单文件卡片也走这条） | 打开本轮审查标签页（`changes-review`），定位到第 1 个文件 | **打开右栏「本地变更」标签页并切成全屏** |
| 文件行（`<li>` 里的按钮） | 打开本轮审查标签页，定位到该文件 | 不变（但仍受「非全屏」策略约束） |
| 「展开全部文件」折叠按钮（带 `aria-expanded`） | 只展开 / 折叠列表 | 不变 |

判定只看卡片的两条结构事实：标题是卡片内、**不在 `<li>` 里**、且**不带 `aria-expanded`** 的按钮；文件行在 `<li>` 里；折叠按钮带 `aria-expanded`。单文件卡片打完补丁后也有列表，标题依旧不在 `<li>` 里，所以判定不变。

标题点击不区分修饰键：`⌘` / `Ctrl` / `Alt` / `Shift` + 左键标题与普通左键一样打开本地变更。标题与文件行上的右键不接管，保留浏览器原生菜单。

-----

## 会话面板的「本地变更」行

会话标题栏打开的那块**会话面板**（`conversation.session.panel`）在「环境」分区里由上游 forge 包注册了一行本地变更：

```html
<div data-session-panel-row data-forge-local>
  <button data-row-part="body" aria-label="本地变更 · 3 个文件，新增 12 行，删除 4 行">…</button>
  <span data-row-part="trailing">+12 −4</span>
  <span data-row-part="menu"><button aria-label="本地变更操作" aria-haspopup="menu">⋯</button></span>
</div>
```

行主体（`data-row-part="body"`）与右侧「⋯」菜单里的「查看变更」都走同一个动作：`viewLocalChanges()` → `openChanges(sessionId,{kind:'local'})` → `sidebarRight.openResourceIn(sessionId, dsh-resource://forge-changes/<session>/local)`，随后各自 `dismissOverlay()` 收起浮层版的面板。

本插件让它和改动卡片标题、`⌘⌥Y` 一样**打开即全屏**，但不用拦点击：那一行点完还要收起浮层版面板，吞掉点击会让面板留在原地；同一行有两个入口，菜单还 portal 到 `document.body`，没有稳定锚点。判定改放在打开入口上（`src/session-panel.ts`）：

```ts
isSessionPanelLocalOpen(address, sessionId, doc)
  = address === dsh-resource://forge-changes/<sessionId>/local   // 就是这一页
  && 文档里有可见的 [data-session-panel]                          // 会话面板此刻开着
```

`install.ts` 把这个判定作为 `designated` 交给打开策略的包层：命中时跳过「切回推挤」，打开成功后由包层自己调 `presentFullscreen()`；不命中时照旧按非全屏处理。

| 情形 | 结果 |
|---|---|
| 面板可见（`docked` / `overlay`）时打开当前会话的本地变更页（行主体、行内「⋯」菜单） | 打开 / 聚焦并切成全屏 |
| 右栏本来已经是全屏，从这一行再打开 | 保持全屏（不会像「其余入口」那样被推回推挤） |
| 面板不可见（没有 `data-session-panel`，例如收起后由其它插件经 `forgeChanges.open` 打开） | 按非全屏处理 |
| 其它会话的本地变更页、变更请求页、文件、审查页 | 与本行无关，按非全屏处理 |
| 隐藏会话视图里的会话面板（`hidden` 祖先） | 不算可见 |

`[data-session-panel]` 只在面板真正画出来时才由上游输出（取值 `docked` / `overlay`；面板收起时元素不存在）。这一行就在面板里，用户点得到它就一定可见；反过来面板收起时既没有入口可点，也不会把别处的打开误判成这一行。全屏判定与卡片标题共用 `presentFullscreen()`：只在「刚打开 / 聚焦的确实是本地变更」且右栏当前是推挤时切换；已经全屏（含窄窗口自动全屏）、面板还没画出来、读不到呈现现值、目标陈旧，都只打开、不切呈现方式。

不处理的部分：行的右键 / 中键、行尾的 `+N −M` 与「⋯」按钮（它们不打开页面）；会话面板里其它行（Git、连接状态、变更请求卡片）。

-----

## 单文件卡片也按汇总形制

上游 `ChangedFiles` 只用一行初始化区分两种卡片：

```js
const singleFile = changes.total === 1 ? changes.files[0] : undefined
```

有值时是紧凑卡（标题 `已编辑 <文件名>`、文件类型图标、没有文件行），为空时才是汇总卡（标题 `已编辑 N 个文件`、通用 code 图标、下面一份文件行列表）。上游没有开关，所以本插件在**宿主启动时**把已安装的 `@deepseek-ai/dsh-client-ui-deliverables` 产物里那一行改成恒为 `void 0`：

```js
const singleFile=void 0;/*dsh-changes-single-card*/
```

于是单文件也走汇总卡：标题 `已编辑 1 个文件`，下面一行 `路径  +N -M`。文件行左键打开本轮审查第 1 个文件，标题左键仍是「本地变更」——与多文件卡片完全一致。

### 为什么必须写在启动期

- 卡片是上游 bundle 里的 React 代码，浏览器插件改不了它的渲染；
- `@deepseek-ai/dsh-client-modules` 在启动组网（seed）时就把每个 entry 的 `lib/client.js` 读进内存，之后 `/plugins/...` 的 GET 直接发这份缓冲。只写文件不够，必须再调 `clientModules.rebuilt(id)` 让服务重读、发布新的 rev；已打开的页面随 HMR 的 `rebuilt` 帧替换该插件，不需要刷新（`client-hmr` 的产物轮询也会在文件变化后自动补一次 `rebuilt`）；
- 产物路径不靠猜：`clientModules.clientPath('@deepseek-ai/dsh-client-ui-deliverables')` 给出组网时登记的绝对路径；
- 页面若在补丁前已经拉过 bundle，`rebuilt()` 发布的新 rev 会让已打开的页面在下一帧换到补丁版，无需刷新。

### 幂等、失败与恢复

| 情形 | 行为 |
|---|---|
| 文件里已有 `dsh-changes-single-card` 标记 | 视为已打过：不写、不 `rebuilt`（这次 seed 已经读到补丁内容） |
| 命中初始化锚点 | 写入补丁 → `rebuilt(id)` → 日志一行 info |
| 找不到锚点（上游重写了这段） | 只记 warn，单文件保持上游紧凑形制，启动不受影响 |
| 产物只读 / 权限不足 | 同上，只记 warn |
| 服务缺席或 `clientPath` 为空（例如纯 CLI 运行） | 只记 warn，空操作 |
| dsh 升级后产物被替换 | 标记消失、锚点回来 → 下次启动自动重新打上 |
| 插件移除 / 卸载 | 文件仍是本插件写下的那份时恢复原内容；若期间被升级替换则不动 |

### 怎么确认

启动日志里应出现一行 `[dsh-changes-single-card] 单文件卡片已改为汇总形制：<产物路径>`。如果只看到 `找不到 singleFile 初始化`，按 [`contract.json`](../dsh-changes-behavior/contract.json) 的 `single-card-initializer` 条目核对上游产物，必要时更新锚点。

-----

## 审查标签页默认值

上游用一个 per-session 的 review store 记录每个审查标签页的视图状态：

```ts
{ index, split: true, wrap: false, navigated }
```

首次打开标签页时 `ReviewTab` 的 `useEffect` 写入这条记录；唯一的写入口是工具栏分栏 / 换行按钮的 `onClick`（`actions.toggledSplit(tab.id)` / `actions.toggledWrap(tab.id)`）。右栏的呈现方式写在面板根的 `data-sidebar-right-panel` 上。

本插件在审查标签页首次挂载、以及面板呈现方式变化时：

- **分栏**：`push` → 单栏（`split: false`），`fullscreen`（含窄窗口自动全屏）→ 左右对比（`split: true`）；
- **换行**：每个新审查标签页第一次挂载时把 `wrap` 写成 `true`；
- **每个标签页每个呈现方式只设一次默认值**：同一标签页切走再切回、或用户手动点过分栏 / 换行按钮时，不会被重新改写；关闭重开或刷新恢复得到新的占位实例 id，重新按默认值处理；
- **首次挂载先等 seed**：`aria-pressed` 在 seed 前是 `false`，直接读会把“还没 seed”误判成“用户选了单栏”；上游首次 seed 恒为 `split: true`，所以等到按钮变成 `true` 再决定；
- **不合成点击**：直接调用按钮在 React fiber 上的 `onClick`，异常收在插件内，下一帧再试，不让它穿过 React 事件派发；失败连续若干帧后告警并放手，保持上游默认。

因为「其余打开非全屏」会在打开成功后把全屏面板切回推挤，从全屏状态点文件行时，审查页会以单栏打开，而不是继承上一页的全屏状态。

-----

## 悬停浮层关闭

上游给改动卡片的每个文件行包了 `HoverCard(openDelayMs: 500)`：指针停留 500ms 后在 `<body>` 上开一个单列 diff 浮层，浮层内容只在打开时挂载。本插件在 `document` 捕获阶段拦下落在 `[data-changed-files]` 内的 `pointerover` / `pointerenter` / `mouseover` / `mouseenter` 并 `stopPropagation()`，React 的合成 enter 收不到该手势，定时器根本不建立，浮层不出现，对比也不会被读取。

另有一层网兜：万一浮层仍进入 DOM，`body` 上的 `MutationObserver` 会在绘制前把它置为 `display:none`；只隐藏、不删除 React 拥有的节点，卸载时还原。行 hover 底色、点击行打开审查页、卡片外的 `HoverCard` 都不受影响。

-----

## 字号 14px

「本地变更」「变更请求」的标签页根由上游 forge 包输出 `data-forge-changes` / `data-forge-panel`。本插件注入一条 `<style>`，按「根 + 全部后代」命中这两个锚点，把 `font-size` 统一为 `14px !important`。只改字号，不动字体族（代码仍用 `--ds-font-family-code`）、行高（diff 行 22px 与占位行的 `--forge-rows * 22px` 必须一致）、颜色、行号列宽度与布局。

不覆盖：右栏标签条上的标题 chip、portal 到 `document.body` 的浮层菜单、改动审查页（`changes-review`）与其它右栏标签页。

-----

## 文件列表宽度固定

「本地变更」「变更请求」左侧的文件列表由上游 forge 包的 `FileTreePane` 渲染，宽度只存在组件内的 `useState(240)` 里。改宽也只有一个入口：它渲染的那条 8px 分隔条（`<div role="separator" tabIndex="0" aria-controls=…>`）。指针拖动、方向键与 Home / End 都挂在这条分隔条自己的事件上，`onWidth` 只把结果报给工具栏做列对齐。

本插件注入一条 `<style>`，把 `[data-forge-changes]` 里带 `aria-controls` 的 `role="separator"` 置为 `display:none !important`。分隔条消失后，指针与键盘两个入口一起失效，文件列表就停在上游自己算出的宽度：

- **默认 240px**（`FileTreePane` 的 `useState(240)`）；
- 面板窄时按可用空间收窄：上限 `min(600, 列表与 diff 所在行宽 − 320)`、下限 200，给 diff 至少留 320px；
- 标签页内容宽度不足 760px 时这块 pane 本来就不渲染，文件列表变成工具栏里的下拉菜单。

规则带 `!important`：分隔条的样式声明在 CSS Module 的哈希类名上，模块样式与本插件注入的 `<style>` 谁先生效不由本插件掌握；`[data-forge-changes] [role="separator"][aria-controls]` 的特异性（0,3,0）加 `!important` 足以压过它。

只碰文件树分隔条：作用域限定在 `[data-forge-changes]` 里，右栏其它可拖动元素、改动审查页（`[data-changes-review]`）与其它标签页都不处理。不读写 `localStorage`——旧版本写下的 `dsh-changes-behavior:tree-width` 不再被读取，留着也不会生效，可以手动删掉。

上游若把 `role` / `aria-controls` 改名，隐藏规则会整条落空、拖动把手重新出现；`contract.json` 的 `tree-separator-role` 与 `tree-separator-controls` 两条契约会在 `pnpm check:css` 里报出来。

-----

## 怎么确认它真的生效

装上后，文档根元素会带一组标记：

```js
document.documentElement.hasAttribute('data-dsh-changes-behavior')          // 总装
document.documentElement.hasAttribute('data-dsh-changes-behavior-open')     // 打开呈现策略
document.documentElement.hasAttribute('data-dsh-changes-behavior-card')     // 卡片标题
document.documentElement.hasAttribute('data-dsh-changes-behavior-split')    // 审查分栏默认
document.documentElement.hasAttribute('data-dsh-changes-behavior-wrap')     // 审查换行默认
document.documentElement.hasAttribute('data-dsh-changes-behavior-hover')    // 悬停闸门
document.documentElement.hasAttribute('data-dsh-changes-behavior-font-14')  // 14px 样式
document.documentElement.hasAttribute('data-dsh-changes-behavior-tree-fixed') // 文件列表宽度固定
```

然后：

1. 点改动卡片标题 → 右栏活动页是「本地变更」，面板属性变成全屏：

   ```js
   document.querySelector('[data-sidebar-right-session]:not([hidden]) [data-sidebar-right-panel]')
     .getAttribute('data-sidebar-right-panel')   // 'fullscreen'
   ```

2. 再点同一张卡片的文件行 → 打开本轮审查页，面板回到 `'push'`；如果审查页是新打开的，分栏应为单栏：

   ```js
   document.querySelector('[data-changes-review]')?.getAttribute('data-dsh-review-split')  // 'push'
   document.querySelector('[data-changes-review] [data-review-tool="split"]')?.getAttribute('aria-pressed') // 'false'
   document.querySelector('[data-changes-review] [data-review-tool="wrap"]')?.getAttribute('aria-pressed') // 'true'
   ```

3. 在正文 / 中间过程里点一个文件或资源链接 → 右栏打开对应页面，面板是 `'push'`。
4. 按 `⌘⌥Y` / `Ctrl+Alt+Y` → 固定行已挂载且打开会话第一张变更请求卡片的变更页（`dsh-resource://forge-changes/<session>/change/<url>`）；会话没有绑定变更请求时打开「本地变更」页。

   ```js
   [...document.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)   // 含变更请求编号（如 '#7'）或 '本地变更'
   ```

   面板原本是推挤时切成全屏；已经是全屏时保持。
5. 在右栏已经是全屏时再按 `⌘⌥Y` → 仍是全屏（不会被包装层切回推挤）。
6. 把窗口缩到 768px 以下操作上述入口 → 跟随上游自动全屏，右栏不会被收起。
7. 指针停在改动卡片文件行上 500ms → 不出现浮层；字号检查：

   ```js
   getComputedStyle(document.querySelector('[data-forge-changes]')).fontSize   // '14px'
   ```

8. 「本地变更」里文件列表旁看不到分隔条（默认在左侧，被工具栏切到右侧或隐藏时同样没有），鼠标划过去也不出现拖动光标，宽度不再可调：

   ```js
   const separator = document.querySelector('[data-forge-changes] [role="separator"][aria-controls]')
   separator?.checkVisibility?.()              // false：元素还在，被 display:none 隐藏
   separator?.parentElement?.getBoundingClientRect().width   // 240（面板窄时更小）
   ```

9. 只改了一个文件的一轮：卡片标题是 `已编辑 1 个文件`，`data-single` 不再出现，下面有一行文件行：

   ```js
   const card = document.querySelector('[data-changed-files]')
   card?.hasAttribute('data-single')          // false（补丁生效）
   card?.querySelector('button span')?.textContent  // '已编辑 1 个文件'
   card?.querySelector('li button')           // 那一个文件的文件行
   ```

   启动日志里对应的证据是 `[dsh-changes-single-card] 单文件卡片已改为汇总形制：<产物路径>`。

10. 点会话面板里「本地变更 · N 个文件」那行的**行主体**（或它的「⋯」→「查看变更」）→ 右栏活动页是「本地变更」，面板变全屏，浮层版的会话面板同时收起；右栏已经是全屏时从这一行再打开，仍是全屏：

   ```js
   document.querySelector('[data-session-panel] [data-forge-local] button[data-row-part="body"]')
   document.querySelector('[data-sidebar-right-session]:not([hidden]) [data-sidebar-right-panel]')
     .getAttribute('data-sidebar-right-panel')   // 'fullscreen'
   ```

- 标记为 `false` → 浏览器这一页没有加载到本插件：在「设置 → 插件」里关掉再打开本插件，让 HMR 重组合并把行送进页面；仍为 `false` 再硬刷新。只有 profile 未启用 HMR 时才需要重启 `dsh web`。
- 标记为 `true`、行为不对 → 对照 [`contract.json`](../dsh-changes-behavior/contract.json) 运行 `pnpm --filter dsh-changes-behavior check:css`，清单会指出是哪条上游锚点失效。

-----

## 作用范围与边界

| | 结果 |
|---|---|
| 多文件卡片标题左键 | 打开 / 聚焦「本地变更」并切成全屏 |
| 单文件卡片标题左键 | 同上（补丁后它的文件行才打开本轮审查） |
| 单文件卡片（补丁后） | 与多文件卡片一致：标题 + 一行文件行 |
| 上游产物只读 / 锚点缺失 / 服务缺席 | 只记一条告警，单文件卡片保持上游紧凑形制 |
| 文件行左键 | 上游行为：打开本轮审查页；由打开策略切成非全屏 |
| 「展开全部文件」 | 只展开 / 折叠列表 |
| 标题 / 文件行右键 | 不接管，保留浏览器原生菜单 |
| `⌘` / `Ctrl` / `Alt` / `Shift` + 左键标题 | 与普通左键一样打开本地变更 |
| 会话面板可见时打开当前会话的「本地变更」页（行主体、行内「⋯」菜单） | 打开 / 聚焦并切成全屏；右栏本来全屏时保持全屏 |
| 会话面板不可见时打开当前会话的「本地变更」页（例如其它插件经 `forgeChanges.open`） | 按非全屏处理 |
| 同一行的「⋯」按钮 / `+N −M` / 右键 | 不打开页面 |
| 会话面板其它行（Git、连接状态、变更请求卡片） | 不处理 |
| 正文 / 过程中间链接、其它插件打开 | 打开目标页，非全屏 |
| 窄窗口（< 768px） | 上游自动全屏；本插件不尝试切回推挤 |
| 浮层（`destination: 'float'`） | 不改变停靠栏呈现方式 |
| 审查标签页首次挂载 / 呈现方式变化 | 按呈现方式设分栏默认；新页默认换行 |
| 用户手动切分栏 / 换行 | 同一呈现方式内不再改写 |
| 卡片内 500ms 悬停 | 浮层被拦掉 |
| 「本地变更」「变更请求」文件列表拖动 / 键盘调整宽度 | 不生效：分隔条被隐藏，宽度固定在上游默认值（240，面板窄时更小） |
| 面板变窄导致文件列表被压小 | 仍按上游规则收窄（上限 `min(600, 列表与 diff 所在行宽 − 320)`、下限 200） |
| 右栏其它可拖动元素、其它标签页、终端、文档预览 | 不处理（字号也只覆盖两个 forge 根） |
| 非浏览器环境（没有 `document`） | 空操作 |
| `sidebarRight` 服务缺席 | 卡片 / 打开策略不装，其余行为照常；控制台告警一次 |
| `shortcuts` 服务缺席 | `⌘⌥Y` 不装，其余行为照常 |
| forge 的 `remote.forgePanel` 缺席 | `⌘⌥Y` 直接打开本地变更页，不读面板流、不等待 |
| 面板流第一帧 1.5s 内没到 / 读取失败 / 没有绑定 | 按没有绑定处理，打开本地变更页 |
| 分栏 / 换行按钮或 review store seed 变了 | 该标签页保持上游默认，告警一次；工具栏仍可手动开关 |

-----

## 实现要点

| 文件 | 职责 |
|---|---|
| [`index.ts`](../dsh-changes-behavior/index.ts) | 宿主入口：等 `clientModules` 就绪后安装 / 卸载启动期补丁 |
| [`src/host/single-card.ts`](../dsh-changes-behavior/src/host/single-card.ts) | 单文件卡片补丁：文本三态、写产物、`rebuilt`、卸载恢复 |
| [`src/client.ts`](../dsh-changes-behavior/src/client.ts) | 浏览器入口：先装 changes 面板行为，再装 `⌘⌥Y` 桥 |
| [`src/install.ts`](../dsh-changes-behavior/src/install.ts) | 总装：逐条安装、单条失败不阻断其余、逆序卸载 |
| [`src/presentation.ts`](../dsh-changes-behavior/src/presentation.ts) | 面板呈现方式读数、指定入口全屏、四个打开入口的包层、全屏意图与 `designated` 判定接缝 |
| [`src/card.ts`](../dsh-changes-behavior/src/card.ts) | 卡片标题 / 文件行 / 折叠按钮判定、本地变更地址 |
| [`src/session-panel.ts`](../dsh-changes-behavior/src/session-panel.ts) | 会话面板「本地变更」行的判定：面板可见 + 当前会话的本地变更页 |
| [`src/dom.ts`](../dsh-changes-behavior/src/dom.ts) | 捕获层的最小 DOM 形状与事件目标提取 |
| [`src/split-default.ts`](../dsh-changes-behavior/src/split-default.ts) | 审查分栏默认：身份、seed 等待、重试、呈现方式观察 |
| [`src/wrap-default.ts`](../dsh-changes-behavior/src/wrap-default.ts) | 审查换行默认：身份、一次写入、重试 |
| [`src/hover-gate.ts`](../dsh-changes-behavior/src/hover-gate.ts) | 卡片悬停闸门与浮层网兜 |
| [`src/font-14.ts`](../dsh-changes-behavior/src/font-14.ts) | 14px `<style>` 的安装与卸载 |
| [`src/tree-fixed.ts`](../dsh-changes-behavior/src/tree-fixed.ts) | 文件列表宽度固定：隐藏文件树分隔条的 `<style>` 与安装 / 卸载 |
| [`src/changes-open.ts`](../dsh-changes-behavior/src/changes-open.ts) | `⌘⌥Y` 固定行、固定输入观察者、终端捕获、按绑定关系选择变更页 |
| [`src/change-request.ts`](../dsh-changes-behavior/src/change-request.ts) | 变更页地址、面板流第一帧解析（带超时与释放） |
| [`src/fiber.ts`](../dsh-changes-behavior/src/fiber.ts) | 从 React fiber 取按钮 `onClick`（分栏 / 换行共用） |
| [`dsh-shortcut-utils`](dsh-shortcut-utils.md) | 快捷键判定与捕获层；共享纯函数包，客户端构建时内联 |
| [`contract.json`](../dsh-changes-behavior/contract.json) | 依赖的上游锚点与公开面清单（47 条） |
| [`check-css.mjs`](../dsh-changes-behavior/check-css.mjs) | 构建后逐条校验上面的清单 |

快捷键的共享纯函数（固定行绑定匹配、键帽格式化、捕获阶段手势 / 归属上下文）放在 [`dsh-shortcut-utils`](dsh-shortcut-utils.md)，由 `dsh-keyboard-shortcuts` 与 `dsh-changes-behavior` 共用；它是纯函数包，没有运行时状态，客户端构建时分别内联进两个 bundle。

```bash
pnpm --filter dsh-changes-behavior build
pnpm --filter dsh-changes-behavior typecheck
pnpm --filter dsh-changes-behavior test
pnpm --filter dsh-changes-behavior check:css
```

-----

## 挂载与启用

装卸与生效的通用规则见[插件挂载、卸载与生效](plugin-mounting.md)；本节只列本包的步骤。

本包替代原先五个插件。升级时先从 profile 移除旧包，再加入本包（或直接重新运行仓库根的 `add-plugins` / `remove-plugins` 脚本）：

```bash
pnpm install
pnpm --filter dsh-changes-behavior build
dsh plugin --profile web remove dsh-changes-card-local
dsh plugin --profile web remove dsh-changes-review-fullscreen
dsh plugin --profile web remove dsh-changes-review-wrap
dsh plugin --profile web remove dsh-changes-hover-off
dsh plugin --profile web remove dsh-forge-changes-font-14
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-changes-behavior
```

挂载后不需要重启 `dsh web` 或刷新页面：HMR 会重组合，已打开的页面随客户端图加载本插件。客户端半部改动后重新构建；宿主按产物 stat 轮询发布新的 rev 并替换已打开的插件。

本包带宿主半部：**单文件卡片补丁在宿主重组合、本插件启动时执行**，第一次装上本包即生效。改完宿主代码后，下一次重组合（在「设置 → 插件」里关掉再打开本插件，或编辑 profile 的 `cordis.patch.yml`）会重启本插件并重新应用补丁；HMR 默认不监视源码，保存文件本身不会重载。从 profile 移除本插件时，卸载钩子会把上游产物恢复原样，客户端产物的轮询随即让已打开的页面换回原版；若进程被强杀未走到卸载，产物会保持打过补丁的形态，下次启动会被识别为「已打过」而直接跳过（不会重复写）。

-----

## 上游契约与校验

[`check-css.mjs`](../dsh-changes-behavior/check-css.mjs) 按 [`contract.json`](../dsh-changes-behavior/contract.json) 对 DSH 安装产物逐条 grep，`pnpm check:css` 触发（不挂在 `pnpm build` 上）。校验的是：

- 改动卡片根 / 单文件标记 / `singleFile` 初始化（启动期补丁的锚点）/ 行容器 `<li>` / 行 `aria-describedby` 序号 / 折叠按钮 `aria-expanded` / 标题的 `openReview(0)`；
- 本地变更地址前缀与标题键；
- 右栏的 `openResource(address` / `openTab(kind` / `openResourceIn(sessionId,address` / `openTabIn(sessionId,kind` / `mounted` / `claim(address` / `toggleFullscreen(target)` / `commandTarget(element=…` / `isTargetCurrent(target)` / 窄窗口 `viewportWidth<768` 断点；
- 面板 `data-sidebar-right-panel` 与 push / fullscreen 两值；
- 审查根 / 正文 / 分栏 / 换行按钮 / `aria-pressed` / `toggledSplit` / `toggledWrap` / review store 首次 seed 的 `split:true, wrap:false`；
- 侧栏占位实例 / 标签页 / 会话三个身份属性；
- 快捷键服务的 `registerFixed(command` / `observeFixedInput(listener` / `fixedCatalog` / `platform`；
- 悬停浮层的 `openDelayMs: 500` 与 `data-changes-hover-preview`；
- 两个 forge 根锚点，以及上游没有用 `!important` 钉字号（反向）；
- 文件树分隔条的 `role="separator"` 与 `aria-controls`（固定宽度依赖的隐藏锚点）；
- 会话面板根的 `data-session-panel` 与会话面板「本地变更」行的打开动作 `openChanges(sessionId,{kind:`local`})`（点它切全屏依赖这两条）。

上游改名或删 token 时显式失败，而不是让某条行为静默失效。

-----

## 进一步探索

- [共享快捷键工具包](dsh-shortcut-utils.md) —— 两个插件共用的绑定匹配与捕获层纯函数。
- [快捷键插件](dsh-keyboard-shortcuts.md) —— 其余固定键与免聚焦桥接（`⌘⌥Y` 已迁到本插件）。
- [DSH 组件 CSS 架构](dsh-css-architecture.md) —— `data-*` 锚点与右栏标记的作用域。
- [`dsh.client.inject` 完整说明](dsh-client-inject.md) —— 客户端半部如何进入浏览器 roster。
