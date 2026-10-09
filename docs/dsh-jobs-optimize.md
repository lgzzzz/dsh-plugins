# dsh-jobs-optimize

让会话标题栏的**后台任务计数控件**（`{count} 个后台任务`）的三个行为与它左边的子代理控件完全一致：指针悬停 150ms 自动展开，指针离开 120ms 自动折叠，点击把它钉住——**已展开时点击也不折叠**，钉住后指针离开仍保持展开（关闭只剩点击控件外部与 Escape 两条路径）。纯客户端插件：在 `slots` 账本里按 id **遮蔽**上游那个条目，把它的组件换成一层无盒包装，用合成 click 驱动上游自己的开合逻辑，并在已展开时拦下那次点击——上游产物一行未改，也不写上游对象。没有配置项、不注册服务；从 profile 移除即恢复上游原本的点击开合。

## 它改的是什么

上游 `@deepseek-ai/dsh-client-ui-jobs` 在 `conversation.session.header.actions` 槽里以 `id: "job-list"` 注册这个控件（`$DSH_ROOT/node_modules/@deepseek-ai/dsh-client-ui-jobs/lib/client.js` 612 行），而它只认点击：

| | 上游现状 |
|---|---|
| 打开路径 | 只有触发器上的 `onClick`，做 `setOpen(current => !current)`（同文件 452-455 行） |
| 开合真值 | 组件私有 `useState`，唯一对外暴露的是触发器上的 `aria-expanded`（同文件 450 行） |
| 菜单 | `open ? <ul> : null` 条件渲染（同文件 470 行），是宿主内的绝对定位元素 |
| 悬停 | 没有任何悬停处理；`lib/` 里也没有开关可传 |
| 无任务时 | 整个控件返回 `null`（同文件 410 行），因此触发器会消失又重建 |

左侧的子代理控件就是被对齐的参照物，它的三个行为写在 `dsh-client-ui-subagent/lib/client.js`：悬停展开延迟 150ms（424 行）、离开折叠延迟 120ms（433 行）、点击 `pinnedRef.current = true; if (!open) changeOpen(true)`（535-539 行）——**点击只钉住，从不折叠**，菜单已经展开时也一样。本插件按这三个行为取值，并且把参照物本身也钉进了 `contract.json`：上游一改，构建就失败。

**纯 CSS 做不到**：菜单关闭时不在 DOM 里，没有节点可供 `display` 切换。

## 它怎么做到的

不改上游产物，五步接住这个控件：

1. **遮蔽注册。** `slots` 的 list 槽允许同 id、**不同 priority** 的两项并存，`priority` 最小者渲染（`dsh-client-ui-slots/lib/index.js` 183 行的同格冲突判定，提示文案在同文件 168 行）。本插件注册一个 `priority` 为源项减一的同 id 条目，其余契约从源项抄来：`inject`（业务面 `hooks.jobs` / `watchRows` / `observe` / `killJob` 只由它交出）、`locale`（`t` 座位按它合成）、`order`（位置不变）、`label`（槽位检查界面显示同一个名字）。`children` 与 `store` 不抄——上游控件两者都没声明，而抄 `children` 会撞上「子槽已被声明」的注册错误。源项本身不被改写，源项消失（ui-jobs 被卸载）时遮蔽项随之撤回。
2. **无盒包装层。** 包装组件渲染一个 `style="display: contents"` 的 div 包住源组件。头部动作条是 `display: flex; gap: 8px`（`dsh-client-ui-conversation/lib/client.js` 15797 行的 `headerActions`），无盒锚点不占 flex 子项，间距与位置因此与上游一致；无任务时那个空锚点同样不产生盒子。这也是渲染器自己给槽出口用的手法（`dsh-client-ui-renderer/lib/client.js` 1094 行的 `ANCHOR_STYLE`）。
3. **合成 click 驱动开合。** 状态机不做状态镜像：每次开/合之前重读 `aria-expanded`，读到的值与目标一致就空操作；否则在触发器上派发一次 `click()`。触发器是 `button[aria-expanded]`，而 React 18+ 的 `onClick` 委派在应用根容器上，合成 click 会冒泡到那里（实测：在 Console 里执行 `document.querySelector('[data-slot="conversation.session.header.actions"] button[aria-expanded]').click()`，菜单照常打开）。
4. **指针进出。** 监听器挂在无盒锚点上，用冒泡的 `mouseover` / `mouseout` 加 `relatedTarget` 包含关系判定真正的进出（不依赖「无盒元素是否参与命中测试」这类浏览器细节），因此指针从触发器移进菜单时不会误判为离开：进入后 150ms 展开，离开后 120ms 折叠。
5. **点击钉住。** 合成 click 的 `isTrusted` 为 `false`，用它区分「用户点的」和「我们点的」。受信任的点击落在触发器上就进入钉住状态：未展开时放它过去（上游 onClick 展开它），**已展开时在捕获阶段 `stopPropagation()` 把它拦下**——上游的 onClick 是无条件 toggle，放过去就会把菜单关掉，而参照物从不折叠。捕获监听器挂在宿主上，早于 React 委派在应用根容器上的冒泡派发，所以这次点击到不了上游的 onClick。钉住后指针离开不再折叠；外部 `pointerdown` 关闭（上游自己的 dismiss）与 Escape 关闭都不经过本状态机，因此指针再次进入时若读到控件已关闭就复位钉住状态——否则会出现「点外部关闭后再也关不掉」。

**自检。** 上游客户端包依赖一串服务，注册时刻通常晚于槽位声明，所以本插件不在启动时注册，而是等槽位声明（`slots.inject`）后扫一次账本，之后每次账本变化（`slots.subscribe`）再扫。上游先注册或后注册都能遮蔽到。`job-list` 在约 1 秒的窗口内始终没出现时告警一次；一旦接管成功过，此后源项消失不再告警（那是账本变化的正常结果，撤回即可）。

## 怎么确认它真的生效

```js
// DevTools Console:包装层在不在
document.querySelector('[data-slot="conversation.session.header.actions"] div[style*="contents"]') !== null

// 悬停前 / 悬停 150ms 后 / 指针移开 120ms 后,分别取一次
document.querySelector('[data-slot="conversation.session.header.actions"] div[style*="contents"] button[aria-expanded]')
  ?.getAttribute('aria-expanded')

// 点击探针:先让菜单展开,再点一下触发器,然后用上面那个表达式再取一次——应仍是 'true'(已展开时点击不折叠)
```

- 第一条返回 `false` → 遮蔽项没有挂上：先在 Console 找 `[dsh-jobs-optimize]` 的告警（「遮蔽 job-list 失败」是注册被拒，「未找到 …#job-list」是上游条目始终没出现），再对照 `contract.json` 逐条核对上游锚点。
- 第二条在悬停期间应为 `'true'`，指针移开后应为 `'false'`。若悬停能展开、移开后不折叠，说明 `trigger-aria` 契约已变（读不到开合真值）。
- 点击探针在点击后应仍为 `'true'`。若变回 `'false'`，说明那次点击没被拦下（React 的委派模型变了，或监听器没挂在包装层上），控件退化成上游原本的「点击即 toggle」。

## 作用域与不受影响的部分

| | 结果 |
|---|---|
| 后台任务控件的指针悬停 | **自动展开 / 自动折叠**（150ms / 120ms，与子代理控件同值） |
| 点击控件 | **与子代理控件一致**：未展开时点击展开并钉住；已展开时点击只是钉住，不折叠（关闭靠点击控件外部或按 Escape，后者需要焦点在控件内） |
| 键盘路径 | Escape 照旧关闭，Tab 焦点顺序不变；Enter / Space 产生的是一次受信任点击，因此与鼠标点击走同一条路径（已展开时也不折叠，与子代理控件一致） |
| 菜单内交互 | 不受影响：停止任务、展开实时输出、清空已结束，全部照旧 |
| 子代理控件及其它头部动作 | 不受影响：只遮蔽 `id: "job-list"` 那一格 |
| 上游产物 | 一行未改；本插件被移除后，控件回到只能点击开合 |

## 挂载与启用

```bash
# 仓库根:把新包记进 lockfile
pnpm install

# 构建浏览器半部(tsdown → lib/client.js)+ 校验上游契约
pnpm --filter dsh-jobs-optimize build

# 挂进 web profile(宿主半部为空 apply,客户端半部随 immediately 注册)
dsh plugin --profile web add /Users/lz/dsh-plugins/dsh-jobs-optimize
```

刷新 GUI 页面后生效。**恢复上游原本的点击开合**（点击已展开的控件会折叠它）：从 profile 的 `dsh.profile.bundles` 里移除本包（或 `dsh plugin --profile web remove dsh-jobs-optimize`），刷新页面即可。

> Host 在合成那一刻就把 `lib/client.js` 的字节读进快照，所以**重新构建后仅刷新页面可能仍拿到旧字节**：重启 `dsh web`，或在「设置 → 插件」里关掉再打开本插件，然后刷新页面。挂载与构建的通用约定见 [`docs/README.md`](README.md)，Host 快照那条的完整说明见 [`dsh-changes-hover-off.md`](dsh-changes-hover-off.md#挂载与启用)。

## 契约校验与测试

- [`contract.json`](../dsh-jobs-optimize/contract.json)：声明十一条上游事实。前八条是接管本身依赖的锚点（槽键、出口渲染、注册 id、遮蔽规则、渲染期读取条目组件、触发器的开合真值与 toggle、菜单在宿主内），后三条钉住**被对齐的参照物**——子代理控件的 150ms / 120ms 两个延迟与「点击只钉住、从不折叠」的点击语义。由 [`dsh-ui-css-patches/check-css.mjs`](../dsh-ui-css-patches/check-css.mjs) `--manifest contract.json` 在**每次 `build` 后**静态校验：锚点改名或改走别的路径会失败，参照物变了同样会失败（那时要重新对齐本插件的取值），而不是让接管静默退化或与子代理控件分叉。
- `pnpm test`（即 `node test/run-all.mjs`）：
  - `shadow.test.mjs` —— 源项定位、遮蔽项的注册选项、安装 / 保持 / 重建 / 撤回序列、注册抛错后记账无残留、对账期间被同步回调时不叠加包装；
  - `hover-open.test.mjs` —— 延迟展开、未达延迟就离开则不展开、延迟折叠、点击钉住且离开不折叠、**已展开时点击不折叠**（替身建模了「捕获阶段拦下则上游 onClick 不派发」这条传播关系）、两个延迟常量与参照物同值、只有受信任的触发器点击才改变钉住、进入时复位、宿主内位移不触发、已展开时不重复点击、卸载后不再动作、触发器缺席时是空操作；
  - `artifact-client.test.mjs` —— 加载 `lib/client.js`，断言模块 id / 插件名 / 服务声明 / 唯一外部模块 / 自检窗口时长 / 产物里的稳定契约字符串，并在假账本上验证遮蔽注册与契约透传、包装层的渲染结构（`react-dom/server`）、源项消失后的撤回、`slots` 服务形状不符时不抛错、自检窗口的启动与卸载后停止。

## 已知边界

- **依赖 React 的事件委派模型。** 合成 click 与「已展开时拦下那次点击」都走「`onClick` 委派在应用根容器上、捕获阶段早于它」这条路径。上游若改成 `onPointerDown` 打开，或不再无条件 toggle，`trigger-toggle` 契约检查会失败并提示。
- **参照物的点击语义只钉到分支级。** `subagent-click-pins` 钉的是 `CatalogDropdown` 里 `if (!open) changeOpen(true)` 那条分支；头部动作条那枚计数 chip 走它，是因为 `SubagentCatalogAction` 没有传 `openTitle`（带 `openTitle` 的分支会折叠：`if (open) changeOpen(false)`）。上游若让计数 chip 也传 `openTitle`，契约仍会通过，但参照物的点击语义已经变了——那时本插件的「点击不折叠」不再有对齐依据。
- **点击已展开的触发器不再折叠（有意与上游分叉）。** 上游后台任务控件原本是「点击即 toggle」；本插件按参照物把它改成「点击只钉住」。键盘激活（Enter / Space）产生的是一次受信任点击，走同一条路径，行为相同。需要关闭时点控件外部或按 Escape（Escape 由控件根节点的 keydown 处理，需要焦点落在控件内；悬停展开不移动焦点，那时只能点控件外部）——这与子代理控件完全一致，但确实不再等同于上游产物本身的行为。
- **依赖菜单是宿主内的绝对定位元素。** 上游若把菜单 portal 到 `body`（子代理控件就是那样），菜单会落在包装层之外，指针移向菜单时会被判成离开——`menu-in-root` 契约检查专门盯这条。
- **自检窗口约 1 秒。** 上游在槽位声明后超过约 1 秒才注册 `job-list` 时，会先告警一次「未找到」；条目随后出现仍会正常接管，只是那次告警不会撤回。
- **无任务时锚点仍在。** 控件在 `visibleCount === 0` 时返回 `null`，包装层的空锚点保留在头部动作条里；它是 `display: contents`，不占布局也不可点击。
- **与 `dsh-header-action-order` 并存。** 该插件遍历原始账本改写 `options.order`，同 id 的两项（源项与遮蔽项）都会拿到同一个序号；遮蔽的胜者判定按 `priority`，与 `order` 无关，因此两插件互不干扰。
