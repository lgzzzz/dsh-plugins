# dsh-changes-card-local

改动文件卡片（每个完成轮次结尾那张卡）的两处入口改成：**左键点标题打开右栏「本地变更」并切成全屏**，**右键标题或文件行用宿主菜单里的「查看本轮快照 diff」回到本轮审查页**；文件行左键保持上游行为（打开该文件的本轮 diff）。纯客户端插件：在 `document` 捕获阶段改写标题点击、再以宿主 `contextMenus` 贡献一条菜单动作，都是上游已有的公开面。装上即生效，从 profile 移除即恢复；不注册服务、不占 slot、没有配置项。

-----

## 它改的是哪两处

上游 `@deepseek-ai/dsh-client-ui-deliverables` 把一轮的改动渲染成一张卡片（`[data-changed-files]`），卡片里只有三类按钮：

| 元素 | 上游默认行为 | 本插件行为 |
|---|---|---|
| 标题（多文件卡片，也是单文件卡片唯一的按钮） | 打开本轮审查标签页（`changes-review`），定位到第 1 个文件 | **打开右栏「本地变更」标签页**（`forge-changes` 的 `local`），右栏原本是推挤呈现时再**切成全屏** |
| 文件行（`<li>` 里的按钮） | 打开本轮审查标签页，定位到该文件 | 不变 |
| 「展开全部文件」折叠按钮（带 `aria-expanded`） | 只展开 / 折叠列表 | 不变 |
| 标题或文件行的**右键** | 浏览器原生菜单 | **宿主上下文菜单 + 「查看本轮快照 diff」** |

「本地变更」是 forge 面板里的会话级视图：它显示当前检出相对基线的全部改动，和改动卡片针对的「某一轮快照」不是一回事。改完之后，一轮的快照 diff 仍可从文件行左键或右键菜单进入。

-----

## 标题与文件行怎么区分

判定只看卡片的两条结构事实（[`src/install.ts`](../dsh-changes-card-local/src/install.ts) 的 `headerButton`）：

- **标题**：卡片内、**不在 `<li>` 里**、且**不带 `aria-expanded`** 的按钮；
- **文件行**：在 `<li>` 里的按钮，直接跳过；
- **折叠按钮**：带 `aria-expanded`，直接跳过。

单文件卡片没有列表，标题就是唯一一行；它带 `aria-describedby` 但没有 `<li>`，因此按标题处理。

-----

## 打开本地变更

`sidebarRight.openResource('dsh-resource://forge-changes/<sessionId>/local')`，会话取自 `sidebarRight.mounted`，与右栏当前显示的会话一致。

接管一次点击的顺序是「先确认能打开、再阻止冒泡」：

1. `sidebarRight.mounted` 有会话；
2. `sidebarRightTabs.claim(address)` 能认领该地址（即 forge bundle 已挂载、地址格式未变）；
3. `openResource` 调用成功；
4. 右栏原本是推挤呈现时，`toggleFullscreen` 切成全屏（见下一节）。

任一步失败都直接返回，不调用 `stopPropagation()`——这次点击仍会冒泡给上游，照常打开本轮审查页。只有第 3 步返回后，才 `stopPropagation()`，让 React 18 挂在应用根容器上的合成事件收不到这次点击，从而不执行上游的 `openReview(0)`。

点击时按住了 `⌘` / `Ctrl` / `Alt` / `Shift` 的，本插件不接管：这是保留给「直接看本轮快照 diff」的逃生口。

-----

## 全屏呈现

打开「本地变更」之后，右栏若不是全屏就把它切到**全屏**（`[data-sidebar-right-panel="fullscreen"]`，占满窗口，不再把对话挤成一列）。判定与动作（[`src/install.ts`](../dsh-changes-card-local/src/install.ts) 的 `panelMode` / `presentFullscreen`）：

| 点击时的状态 | 结果 |
|---|---|
| 右栏折叠或推挤（`push`） | 打开后切成全屏 |
| 已经全屏（手动切过） | 保持全屏，不重复切换 |
| 窄窗口（< 768px）自动全屏 | 保持全屏，不重复切换（再切一次会把右栏收起来） |
| 面板还没画出来 / 读不到 `data-sidebar-right-panel` | 只打开，不改呈现方式 |
| 活动页不是刚打开的那一页（例如打开落在了浮层里） | 只打开，不改呈现方式 |
| 右栏面没有 `toggleFullscreen`（旧版或别的实现） | 只打开，不改呈现方式 |
| 目标已陈旧（`isTargetCurrent` 为假） | 只打开，不改呈现方式 |

几条实现上的取舍：

- **呈现方式只读 DOM**：`data-sidebar-right-panel` 是布局状态的公开读数（`push` / `fullscreen`），浮动面板同样挂在面板根内；不直接写 store，也不碰私有的布局方法。其它会话的视图仍留在 DOM 里并带 `hidden`，读数时先排除，避免把别的会话的全屏当成自己的。
- **只切一次、只从推挤切**：`toggleFullscreen` 是开关，不是「设为全屏」；已经全屏时再调会切回推挤，窄窗口下甚至会把右栏收起来。所以先读现值，只有 `push` 才调。
- **目标从布局读**：`commandTarget(null)` 明确不读 DOM 焦点——点标题时焦点在卡片按钮上，读焦点会拿到右栏以外的空目标。
- **切屏失败不影响打开**：`openResource` 成功之后切全屏抛错只记一条带插件前缀的告警，这次点击仍然接管（否则上游会再打开一张审查页）。

切全屏不会改 forge 的会话视图内容：它只是右栏的呈现方式，标签页、文件树与 diff 都不变。

-----

## 右键菜单

右键（以及键盘的 `ContextMenu` 键、`Shift+F10`）落在标题或文件行上时：

1. 先读该按钮由 React 绑定的 `onClick`（`memoizedProps.onClick`，即上游的 `() => { openReview(index) }`）；
2. 读不到就放弃——不弹菜单，也不阻止 `contextmenu`，浏览器原生菜单照旧；
3. 读得到就让宿主 `contextMenus` 在指针位置弹出菜单，目标种类是本插件私有的 `dsh-changes-card-local/changed-turn`，贡献一条 **查看本轮快照 diff**。

菜单动作执行时调用第 1 步读到的 `onClick`，直接走上游原本的打开审查页路径：坐标（会话、事件序号、轮次、文件下标）来自上游闭包，本插件不需要在 DOM 上重建它们。一次右键只消费一次，动作执行后再次解析该菜单返回空列表。

菜单贡献在第一次右键时才注册（`contextMenus` 服务可能比本插件晚挂载），插件卸载时注销。

-----

## 覆盖与边界

| | 结果 |
|---|---|
| 多文件卡片标题左键 | 打开 / 聚焦「本地变更」标签页；右栏原本是推挤呈现时切成全屏 |
| 单文件卡片标题左键 | 同上（该卡片唯一的入口就是标题） |
| 标题左键，右栏已经全屏 / 窄窗口自动全屏 | 打开 / 聚焦「本地变更」，保持全屏，不切回推挤 |
| 标题左键，面板还没画出来 / 读不到现值 | 打开 / 聚焦「本地变更」，呈现方式不变 |
| 标题左键，右栏面没有全屏命令 | 打开 / 聚焦「本地变更」，呈现方式不变，不告警 |
| 文件行左键 | 上游行为：打开本轮审查页并定位到该文件 |
| 「展开全部文件」 | 只展开 / 折叠列表，不打开任何标签页 |
| 标题 / 文件行右键 | 宿主菜单，含「查看本轮快照 diff」；执行后打开本轮审查页 |
| `⌘` / `Ctrl` / `Alt` / `Shift` + 左键标题 | 不接管，上游照常打开本轮审查页 |
| 卡片外点击、悬停预览浮层 | 不处理（浮层 portal 到 `document.body`，不在卡片内） |
| 没有屏幕上的会话 | 不动作 |
| forge bundle 未挂载（地址无人认领） | 不动作，标题点击仍打开本轮审查页 |
| 右栏在点击与调用之间卸载 | 不阻止冒泡，照常打开本轮审查页，并在控制台记一条带插件前缀的告警 |
| 按钮上读不到 React `onClick` | 不弹菜单，保留浏览器原生右键菜单 |
| `contextMenus` 服务缺席 | 右键不接管 |
| 子代理轮次若在父会话里内联渲染出卡片 | 打开的是父会话的「本地变更」；快照 diff 的右键仍按该卡片的 `onClick` 打开，坐标正确 |

-----

## 怎么确认它真的生效

装上后，文档根元素会带一个标记：

```js
// DevTools Console
document.documentElement.hasAttribute('data-dsh-changes-card-local')   // true = 已加载并装上
```

然后：

1. 点一下多文件卡片的标题 → 右栏活动标签页的标题是「本地变更」，没有新开 `changes-review` 标签页，且右栏面板根变成全屏：

   ```js
   document.querySelector('[data-sidebar-right-session]:not([hidden]) [data-sidebar-right-panel]')
     .getAttribute('data-sidebar-right-panel')   // 'fullscreen'
   ```

2. 先手动把右栏切回推挤（面板右上角的全屏按钮），再点一次标题 → 打开 / 聚焦「本地变更」并再次切到全屏；
3. 右栏已经全屏时再点标题 → 保持全屏（不会被切回推挤）；
4. 把窗口缩到 768px 以下再点标题 → 仍是全屏，且右栏不会被收起；
5. 点其中一个文件行 → 仍打开本轮审查标签页并定位到该文件；
6. 右键某个文件行 → 出现宿主菜单，只有一条「查看本轮快照 diff」；点它打开本轮审查页并定位到该文件；
7. 点「展开全部文件」→ 只展开列表。

- 标记为 `false` → 浏览器这一页没有加载到本插件，先硬刷新；仍为 `false` 说明 Host 还没有重新合成 profile，需要重启 `dsh web`（或在「设置 → 插件」里关掉再打开本插件）。
- 标记为 `true`、标题点击却仍打开审查页 → 对照 [`contract.json`](../dsh-changes-card-local/contract.json) 运行 `pnpm --filter dsh-changes-card-local check:css`，清单会指出是哪条上游锚点失效。
- 标题点开了「本地变更」但右栏仍是推挤 → 多半是 `data-sidebar-right-panel` 读数、`commandTarget` / `isTargetCurrent` / `toggleFullscreen` 其中一条变了；同样跑 `check:css`。若右栏面是别的实现（没有 `toggleFullscreen`），这是预期的降级。
- 右键没有宿主菜单、只有浏览器菜单 → 多半是按钮上读不到 React `onClick`（上游换了绑定方式），或有别的插件在捕获阶段吃掉了 `contextmenu`。

-----

## 实现与校验

| 文件 | 作用 |
|---|---|
| [`src/client.ts`](../dsh-changes-card-local/src/client.ts) | 浏览器入口；`ctx.inject(['sidebarRight'])` 后把安装函数交给 `ctx.effect` |
| [`src/install.ts`](../dsh-changes-card-local/src/install.ts) | 捕获监听、标题 / 行 / 折叠按钮判定、地址与菜单动作、面板呈现方式读数与切全屏 |
| [`src/fiber.ts`](../dsh-changes-card-local/src/fiber.ts) | 读按钮上的 React `onClick`；只做能力探测，读不到就降级 |
| [`src/dom.ts`](../dsh-changes-card-local/src/dom.ts) | 捕获层用到的最小 DOM 形状、事件目标提取与面板查询 |
| [`src/locales.ts`](../dsh-changes-card-local/src/locales.ts) | 菜单文案的中英文字典与翻译回退 |
| [`contract.json`](../dsh-changes-card-local/contract.json) | 依赖的上游锚点与公开面清单（17 条） |
| [`check-css.mjs`](../dsh-changes-card-local/check-css.mjs) | 构建后对 DSH 安装产物逐条校验上面的清单 |

```bash
pnpm --filter dsh-changes-card-local build
pnpm --filter dsh-changes-card-local typecheck
pnpm --filter dsh-changes-card-local test
pnpm --filter dsh-changes-card-local check:css
```

菜单贡献与捕获监听都是插件作用域内的注册，卸载时随 `ctx.effect` 的清理函数一并移除；文档根上的标记同时移除。
