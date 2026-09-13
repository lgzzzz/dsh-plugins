# dsh-rightbar-tab-width

把 **右栏每个停靠 tab 胶囊的宽度固定为 100px**（外宽，含内边距）的本地持久化插件。
纯浏览器半部样式补丁：宿主半部为空占位，不消费任何服务。

100px 恰好是上游胶囊自身的地板值（`min-width:80px` 内容盒 + 左右各 10px 内边距），
也是 dockkit 分栏判定里 chip 预算的兜底常量值——所以这个取值让每枚胶囊恒定停在
「最小可完整显示」的尺寸上，且**分栏判定与上游默认逐字相同**（见「实现要点」第 4 条）。

## 功能与对照

| | 上游默认 | 本插件 |
| --- | --- | --- |
| 胶囊外宽 | `100px–190px` 随标签文字浮动（内容盒 `80px–170px` + 左右各 10px 内边距） | 恒定 `100px`（= 上游地板值） |
| 文字超出 | 缩到下限后由 `_stripTabs_` 横向滚动，胶囊内文字以渐变遮罩淡出 | 同左（内容盒固定 80px，超出即以遮罩淡出；长文件名比上游更早被裁） |
| 其他 | 两枚胶囊之间还有一条 10px 的分隔槽（`._slot_`），高度 28px、圆角 12px 不变 | 同左 |

注入的样式表全文（`src/css.ts` 是唯一真源）：

```css
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: 100px;
  max-width: 100px;
}
```

## 生效范围

- **只作用于右侧栏**：胶囊/条由 dockkit（`@deepseek-ai/dsh-client-ui-dockkit`）渲染，而
  dockkit **只被 `dsh-client-ui-sidebar-right` 消费**（已核查：`@deepseek-ai/*` 下所有
  `lib/client.js` 里只有它 `require("@deepseek-ai/dsh-client-ui-dockkit")`）。
- **只命中停靠的 tab 胶囊**：选择器锚在 `data-dockkit-tab` 上，该属性只在停靠 chip 的
  `<div role="tab" data-dockkit-tab="<tabId>">` 上。浮动窗口的标题是另一个元素
  （`div[data-dockkit-float-title]`，复用同一套 `._tab_` 尺寸规则但不带该属性），因此
  **不受影响**。若也要定宽浮动窗口标题，在 `src/css.ts` 增加一条同形规则：

  ```css
  [data-dockkit-float-grip] [data-dockkit-float-title] { box-sizing: border-box; min-width: 100px; max-width: 100px; }
  ```

  （浮窗标题 `<div data-dockkit-float-title>` 的父 `<header data-dockkit-float-grip>` 提供
  第二个属性选择器，凑成 (0,2,0) 特异性；标题自身只有一个属性。）

## 加载（用户操作）

本插件持久化在仓库内、尚未挂载；加载是用户操作，代理不代做：

```sh
cd <仓库根>/dsh-rightbar-tab-width
dsh plugin --profile web add link:.
# 重启 App（bundle 层为常驻挂载，不支持热重载）
```

卸载：

```sh
dsh plugin --profile web remove dsh-rightbar-tab-width
```

挂载后**再改宽度不需要重启**：只动 CSS 常量 → `npm run build` → `dsh-client-hmr` 在
500ms 内热替换浏览器半部，页面无需刷新。

## 构建与验证

```sh
npm install
npm run typecheck && npm run build && npm run check
```

- `build`：`scripts/build-client.mjs` 用 esbuild 把 `src/client.ts`（含 `src/css.ts`）
  打包为单文件 CJS，再包进 `window.__ModuleLoader__.load({ id, factory })` 写成
  `lib/client.js`（入仓的构建产物，禁止手改）。
- 该脚本**直接调用 esbuild 的平台二进制**（`@esbuild/win32-x64/esbuild.exe`）并把 stdio
  继承给父进程，而不是 `import 'esbuild'` 的 `buildSync`：esbuild 的 JS API 用
  stdin/stdout 管道与子进程通信，在受限沙箱下 `spawn` 会被拒（`EPERM`）。
- 现场核对：DevTools 选中任一右栏 tab 胶囊，`[data-dockkit-tab]` 的 computed
  `width` 应为 `100px`；`document.head` 里应有
  `<style data-plugin="dsh-rightbar-tab-width">`。

## 实现要点（源码依据，DSH 0.1.5-rc.2）

1. 上游胶囊规则（`dsh-web-frontend/dist/assets/index-DPX2bQLO.css`）：

   ```css
   ._tab_17p4l_156{position:relative;display:flex;flex:0 1 auto;align-items:center;
     min-width:80px;max-width:170px;height:28px;padding:0 10px;...}
   ._tabTitle_17p4l_286{display:flex;flex:1 1 auto;gap:5px;align-items:center;min-width:0;overflow:hidden}
   ._stripTabs_17p4l_173{flex:0 1 auto;min-width:0;overflow-x:auto;...}
   ```

   该元素是 **content-box**——全应用没有 `box-sizing` 全局重置（`index-*.css`、
   `vendor-*.css`、`index.html` 以及所有内置包与本地插件的 `client.js` 里唯一的通用
   选择器规则是 `dsh-client-ui-theme` 的 `*,:before,:after{corner-shape:...}`），所以
   上游外宽实际在 100px–190px 之间。
2. **定宽为什么是这三条**：`flex: 0 1 auto` 的基准尺寸取内容的 max-content、被
   `max-width` 夹取，而 shrink 又受 `min-width` 约束，因此 `min-width == max-width`
   即完全定宽，无需覆盖上游的 `flex`；改用 `box-sizing: border-box` 是为了让 100px 是
   **外宽**（内容盒 = 100 − 20 = 80px），并让上游若调整 `padding` 也不影响结果。
3. **特异性**：上游是单类名 (0,1,0)，本插件用两个属性选择器 (0,2,0)，稳定胜出，
   不依赖样式注入顺序、不需要 `!important`。属性钩子（`data-dockkit-tab`、
   `role="tab"`）是 dockkit 自己 `querySelector` 用的；CSS Module 类名
   （`_tab_17p4l_156`，哈希 `17p4l`）随上游构建变化，不要写进选择器。
4. **与分栏判定的耦合（重要）**：「分栏」按钮（`[data-dockkit-split-button]`，位于条尾：
   胶囊区 → 加号 → 弹性填充 → 分栏 → 面板控件）把当前格沿水平方向一分为二——dockkit 的
   `planSplitPane` 产出一条 `{type:"split", axis:"row", direction:"after", newPaneId}`，
   并给新格开一个默认页（引导页或唯一入口页）；产品上限两格
   （`dockPaneIds(...).length < 2`，达到后按钮消失；kit 自身上限是 `MAX_DOCK_PANES = 4`）。
   它是否出现，取决于下面这条「尺度可行性」判定（room rule）——
   「现在这格做一次水平分栏，分出来的每一半还装得下一枚胶囊吗？」，该判定读的正是
   pane 内第一个 `[data-dockkit-tab]` 的**计算后 `min-width`**：

   ```js
   const nn = { divider: 0, chip: 100, body: 48 };          // 公开导出的 SPLIT_MINIMUMS
   function ey(t){ const r = t.querySelector("[data-dockkit-tab]");
     if (r === null) return nn.chip;                        // 空 pane 无元素可量 → 常量兜底
     const i = getComputedStyle(r), s = parseFloat(i.minWidth);
     return s <= 0 ? nn.chip
          : i.boxSizing === "border-box" ? s
          : s + paddingL + paddingR + borderL + borderR; }  // 量的是「外占宽」
   function $8(t, r = nn){                                  // row: h >= c + r.chip
     const a = Math.max(0, pane.width - strip.width);
     const c = Math.max(0, strip.width - chipsWidth - fillWidth - splitControlWidth);
     const h = (pane.width - r.divider)/2 - a;              // 分栏后每一半的可用宽
     return { row: h >= c + r.chip, column: (pane.height-r.divider)/2 - a >= strip.height + r.body };
   }
   ```

   - `c` 是条上「除胶囊区与弹性填充区之外的固定占用」再**减去分栏控件**——因为右栏用
     `hideSplitWhenBlocked: true`，一旦分成两格，分栏按钮就从每一格里消失（见下），
     所以判定必须按**分栏后**的 chrome 来算。`r` 就是 `hideSplitWhenBlocked`。
   - 于是 `h >= c + chip` 读作：**分栏后每一半的宽度 ≥ 分栏后的固定 chrome + 一枚胶囊**。
     这就是「chip 预算」的全部含义；它是「一枚胶囊仍能完整显示」的下界，因此必须是
     `min-width`——用 `max-width`(170) 会把判定放得过分保守，用当前文字的实测宽度则会
     让判定随「开了哪个文件、文件名多长」抖动。`min-width` 与当前开了哪些 tab 无关。
   - 该读数经 `onRoom` → 右栏 `canSplitPane: (paneId) => room.current.get(paneId)?.row !== false`，
     用于两处：**分栏按钮是否渲染**，以及**把 tab 拖到格子左右边缘时是否允许分栏**
     （`G5()` 里 `v === "left" | "right" ? room.row : room.column`，不通过就退化为
     `"center"`＝只把 tab 移进该格）。
   - 判定的重算时机是挂载 + `ResizeObserver` 观察 `[data-dockkit-surface]`。
   - 本插件取值的后果：算得的 `min-width` 是 **100**（border-box 分支直接返回 100），
     与内置兜底常量 `nn.chip = 100` **同值**——`row` 条件仍是
     `pane.width/2 >= c + 100`，因此**分栏判定与上游默认逐字相同，没有任何偏移**。
     顺带说明：这个取值恰好也是上游胶囊自身的地板（`80 + 10 + 10`）；若把常量改成别的
     值（例如 120），`row` 条件里的 `chip` 就跟着变，条件 `pane.width/2 >= c + chip`
     会把**所需的右栏最小宽度整体移动 2×Δpx**（阈值在 `pane.width` 上，系数是 2），
     即右栏「分栏」按钮出现在更宽/更窄的栏宽下——这正是「chip 预算」的可见后果，
     不是缺陷。
   - 右栏的 `hideSplitWhenBlocked: true` 意味着判定不过时按钮**根本不渲染**（不是禁用
     态；`dock.splitPaneNarrow`「栏宽不足，拖宽侧边栏后再分栏」只在
     `hideSplitWhenBlocked: false` 的消费者里作为禁用提示出现）。
5. 上游把「文字被裁」暴露为 `data-dockkit-tab-clipped`（标题 span 的
   `scrollWidth > clientWidth + 1`，由 `ResizeObserver` 维护），配合 `mask-image` 做
   渐变淡出——定宽后该状态会更频繁地出现，属预期行为。

## 改宽度

只改 `src/css.ts` 的 `CAPSULE_WIDTH_PX`，然后 `npm run build`（挂载后自动热替换）。
该值同时是 dockkit 的 chip 预算读数（见上），改动会让分栏按钮的出现阈值整体移动
2×Δpx。当前取值 **100** 是刻意选的：它既等于上游胶囊的地板值（每枚胶囊恒定停在
最小可完整显示的宽度），又等于分栏判定的兜底常量，因此不引入任何分栏偏移。

## 已知边界与坑

1. `data-dockkit-tab` / `data-dockkit-float-title` 等属性钩子虽比类名哈希稳定，但仍是
   dockkit 内部实现、非文档化公开 API（dockkit 被内联进前端 bundle，没有独立可锁的
   版本）；上游升级可能改名，届时本插件静默失效（样式仍注入，只是匹配不到元素）。
2. 胶囊内文字是**遮罩淡出**而非省略号：标题 span 是 `display:flex` 的容器，文字是匿名
   flex item，`text-overflow: ellipsis` 对它不生效。想让标签更短应从 tab 类型的
   `title(address)` 入手（该文字在打开时被捕获进布局记录，没有改名服务）。
3. 定宽在 100px 后，每枚胶囊（+10px 分隔槽）恒占 110px，比上游「短标签更窄、长标签更宽」
   的浮动更省地方；代价是**长标签更早被裁**（内容盒只有 80px），条宽不足时**不再压缩**
   胶囊，而是横向滚动并出现两端遮罩。
4. 浮动窗口标题不受影响（见「生效范围」）。
5. 本插件只发样式，不消费任何服务，故浏览器半部**不声明** `inject`；宿主半部为空占位，
   `cordis.patch.yml` 的挂载行也不声明 `inject`。

## 文件结构

```
dsh-rightbar-tab-width/
├── package.json          # type=module；exports["."]→index.ts、["./client"]→lib/client.js；dsh.client/bundle
├── tsconfig.json         # 仅类型检查（erasableSyntaxOnly）
├── index.ts              # 宿主半部：空占位（Node Type Stripping 直载）
├── src/client.ts         # 浏览器半部入口（真源）
├── src/css.ts            # 定宽补丁 CSS 真源（CAPSULE_WIDTH_PX 在此）
├── scripts/build-client.mjs  # esbuild → lib/client.js
├── lib/client.js         # 构建产物（入仓，禁手改）
├── cordis.patch.yml      # 挂载行
└── README.md
```
