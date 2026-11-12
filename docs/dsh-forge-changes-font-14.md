# dsh-forge-changes-font-14

把右栏**「本地变更」「变更请求」标签页**整棵子树的字号统一为 **14px**。纯客户端插件：把两条 CSS 规则注入一条 `<style>`，锚在上游两个标签页根元素的 `data-forge-changes` / `data-forge-panel` 上；只改 `font-size`，字体族、行高、颜色与布局都不动。装上即生效，从 profile 移除即恢复；不注册服务、不占 slot、没有配置项。

-----

## 它改的是哪两处

上游 `@deepseek-ai/dsh-experimental-client-ui-forge` 把这些页面注册成右栏标签页，并各自在根元素上留了稳定的 `data-*`：

| 页面 | 根锚点 | 上游字号 |
|---|---|---|
| 「本地变更」标签页（`branch` / `uncommitted` / `unstaged` / `staged` 范围） | `[data-forge-changes="local"]` | 根 12px；子树 11px（徽标 / 次要信息）、12px（代码 / 文件行）、13px（标题） |
| 各变更请求的「#N 的变更」标签页 | `[data-forge-changes="change"]` | 同上 |
| 「变更请求」标签页（检出信息、本地变更卡片、变更请求列表） | `[data-forge-panel]` | 根 13px；子树 12px（卡片细节）、13px（标题） |

「本地变更」与「#N 的变更」共用同一个 `data-forge-changes` 根，本插件一并覆盖；两者与「变更请求」面板是右栏里仅有的三个 forge 页面。

-----

## 覆盖与不覆盖

| | 结果 |
|---|---|
| 「本地变更」标签页 | **14px** |
| 变更请求 diff 标签页（「#N 的变更」） | **14px** |
| 「变更请求」面板 | **14px** |
| 标签页里的代码 / 行内代码 | 字号 14px，等宽字体族与行高不变 |
| diff 行与占位行 | 行高仍是 22px；占位行 `--forge-rows * 22px` 与真实行一致 |
| 右栏标签条上的标题 chip（「本地变更」「变更请求」） | 不变（属于标签条，不是标签页正文） |
| 浮层菜单（基准分支、范围、视图选项、文件搜索、提交菜单等） | 不变（portal 到 `document.body`，不在标签页 DOM 子树里） |
| 其它右栏标签页（文档预览、终端等） | 不受影响 |

字号固定为 14px，不跟随应用的字号设置。

-----

## 怎么确认它真的生效

装上后，文档根元素带一个标记，页面里多一条带插件名的 `<style>`：

```js
// DevTools Console
document.documentElement.hasAttribute('data-dsh-forge-changes-font-14')   // true = 已加载并装上
document.querySelector('style[data-plugin="dsh-forge-changes-font-14"]')  // 非 null = 样式表在页面里
```

打开「本地变更」或「变更请求」标签页后，任选根元素检查计算字号：

```js
const root = document.querySelector('[data-forge-changes], [data-forge-panel]')
getComputedStyle(root).fontSize   // "14px"
```

- 两个标记都在、字号却不是 14px → 上游锚点或覆盖关系变了，运行 `pnpm --filter dsh-forge-changes-font-14 check:css`；清单会指出是哪个锚点失效。
- 两个标记都不在 → 本插件没有加载。先硬刷新页面；仍不在则说明 Host 尚未重新合成 profile，需要重启 `dsh web`（或在「设置 → 插件」里关掉再打开本插件）。

-----

## 实现要点

| 文件 | 职责 |
|---|---|
| [`src/client.ts`](../dsh-forge-changes-font-14/src/client.ts) | 浏览器入口；挂 `<style>`、写生效标记，`ctx.effect` 卸载时移除两者 |
| [`src/css.ts`](../dsh-forge-changes-font-14/src/css.ts) | 两条规则：根元素 14px，根下全部后代 14px |
| [`css-contract.json`](../dsh-forge-changes-font-14/css-contract.json) | 上游锚点与「上游没有 `!important` 钉字号」的静态契约 |
| [`check-css.mjs`](../dsh-forge-changes-font-14/check-css.mjs) | 构建后对 DSH 安装产物逐条校验上面的契约 |

- **锚点选 `data-*`，不用 CSS Module 哈希类名**：哈希前缀随上游构建变化；`data-forge-changes` / `data-forge-panel` 是上游渲染根元素时明确输出的属性，也是本插件唯一依赖的上游事实。
- **`!important` 的原因**：上游把字号写在 CSS Module 的哈希类名上，模块样式表与本插件的 `<style>` 谁先注入不由插件决定，靠源码顺序压过上游的字号声明不可靠；`!important` 保证覆盖不受注入顺序影响。契约里的 `no-important-font-size` 反向规则会在上游也开始用 `!important` 时显式失败。
- **`*` 不命中根自身**：根元素与后代分成两条规则，根上的 12px / 13px 与子树里的 11px 都被覆盖。
- **只改字号**：不碰 `line-height`（diff 行 22px、占位行 `--forge-rows * 22px` 必须一致），不碰字体族（代码仍用 `--ds-font-family-code`）与颜色；行号列的 `--forge-number-width` 用 `ch` 计算，字号变大后自动变宽。

-----

## 挂载与启用

从仓库根执行：

```bash
pnpm --filter dsh-forge-changes-font-14 build
dsh plugin --profile web add ./dsh-forge-changes-font-14
```

然后重启 `dsh web` 并刷新 GUI 页面。也可以直接跑 `./add-plugins.sh`：它会先补齐所有插件的 `lib/` 产物，再把仓库根下的 `dsh-*` 逐个挂进 web profile。

从 profile 移除本包（`dsh plugin --profile web remove dsh-forge-changes-font-14`）并重启后，字号回到上游默认。

-----

## 进一步探索

- [dsh-ui-css-patches](../dsh-ui-css-patches) —— 同一个 CSS 注入模式，覆盖右栏预览、计划卡片等其它区域。
- [dsh-changes-review-wrap](dsh-changes-review-wrap.md) —— 右栏 `changes-review` 标签页的默认换行。
- [DSH 组件 CSS 架构](dsh-css-architecture.md) —— CSS Modules / CSS 变量 / `data-*` 三种机制与运行时 `<style>` 的注册路径。
- `@deepseek-ai/dsh-experimental-client-ui-forge` 的 README —— 三个 forge 页面各自的完整交互。

<details>
<summary>Dev Note</summary>

- 实测（0.2.2-rc.2，无头 Chrome）：在打开的「本地变更」标签页里，覆盖前有文字的元素字号是 11px 与 12px，覆盖后全部 14px；「变更请求」面板覆盖前是 12px 与 13px，覆盖后全部 14px。
- 构建产物在真实页面里验证过：`apply()` 后 `<style>` 与文档根标记出现、计算字号变为 14px，`dispose()` 后两者消失。
- `check-css` 当前 3/3 通过：两个根锚点命中，上游 forge 产物里没有 `font-size: … !important`。
- 覆盖范围之外的标题 chip 与 portal 菜单不会随本插件变化；要让它们也变，需要另加锚点，`[data-forge-*] *` 命不中它们。

</details>
