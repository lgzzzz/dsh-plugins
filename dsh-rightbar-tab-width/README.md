# dsh-rightbar-tab-width

把**右栏每个停靠 tab 胶囊的外宽固定为 100px**（含内边距）的本地持久化插件。
纯浏览器半部样式补丁：宿主半部为空占位，不消费任何服务，不声明 `inject`。

注入的样式表全文（`src/css.ts` 是唯一真源，常量 `CAPSULE_WIDTH_PX` 在此）：

```css
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: 100px;
  max-width: 100px;
}
```

| | 上游默认 | 本插件 |
| --- | --- | --- |
| 胶囊外宽 | `100px–190px` 随标签文字浮动（内容盒 `80px–170px` + 左右各 10px 内边距） | 恒定 `100px`（= 上游地板值） |
| 文字超出 | 缩到下限后横向滚动，文字以渐变遮罩淡出 | 同左（内容盒固定 80px，长文件名更早被裁） |

- **只作用于右侧栏**：`data-dockkit-tab` 由 dockkit 渲染，而 dockkit 只被
  `dsh-client-ui-sidebar-right` 消费。
- **只命中停靠胶囊**：浮动窗口标题是 `[data-dockkit-float-title]`（不带该属性），不受影响。
- 特异性 (0,2,0) 压过上游单类名 `._tab_*` (0,1,0)，不依赖注入顺序、不需要 `!important`；
  两个属性钩子是 dockkit 自己 `querySelector` 用的，CSS Module 类名哈希不要写进选择器。
- `min-width == max-width` + `border-box` 即为完全定宽（无需覆盖上游 `flex`）。

## 与分栏判定的耦合（重要）

dockkit 的「尺度可行性」判定把 pane 内第一个 `[data-dockkit-tab]` 的**计算后
`min-width`** 当作「一枚胶囊的宽度预算」（`SPLIT_MINIMUMS.chip`，兜底常量也是 100），
用于决定「分栏」按钮是否渲染，以及是否允许把 tab 拖到格子左右边缘分栏。右栏用
`hideSplitWhenBlocked: true`，判定不过时按钮根本不渲染。

- 本插件取值 100 = 内置兜底常量 ⇒ 分栏判定与上游默认**逐字相同**。
- 若改 `CAPSULE_WIDTH_PX`，所需右栏最小宽度会整体移动 **2×Δpx**（阈值在 `pane.width`
  上、系数 2）——这是「chip 预算」的可见后果，不是缺陷。

## 改宽度

只改 `src/css.ts` 的 `CAPSULE_WIDTH_PX`，然后 `npm run build`（挂载后自动热替换）。
当前 **100** 是刻意选的：既等于上游胶囊地板值，又等于分栏判定兜底常量。

## 已知边界

1. `data-dockkit-tab` / `data-dockkit-float-title` 是 dockkit 内部实现、非文档化公开 API
   （dockkit 内联进前端 bundle，没有可锁版本）；上游升级可能改名，届时样式仍注入但匹配
   不到元素（静默失效）。
2. 胶囊内文字是**遮罩淡出**而非省略号：标题 span 是 `display:flex` 容器，文字是匿名 flex
   item，`text-overflow: ellipsis` 不生效。想让标签更短应从 tab 类型的 `title(address)` 入手。
3. 定宽后每枚胶囊（+10px 分隔槽）恒占 110px：短标签更省地方，代价是长标签更早被裁、
   条宽不足时不再压缩胶囊而是横向滚动。

## 构建与加载

```sh
npm install
npm run typecheck && npm run build && npm run check
```

```sh
cd <仓库根>/dsh-rightbar-tab-width
dsh plugin --profile web add link:.                  # 重启 App 生效（bundle 层不支持热重载）
dsh plugin --profile web remove dsh-rightbar-tab-width
```

`build`：`scripts/build-client.mjs` **直接执行 esbuild 平台二进制**（而非 JS API，后者用
stdio 管道通信，受限沙箱下 `spawn` 报 `EPERM`）→ `lib/client.js`（入仓，禁止手改）。
**改宽度不需要重启**：`npm run build` 后 client-hmr 在 500ms 内热替换浏览器半部。
现场核对：任一右栏 tab 胶囊的 computed `width` 为 `100px`，`document.head` 里有
`<style data-plugin="dsh-rightbar-tab-width">`。
