# dsh-rightbar-fonts

把**右栏「文件 / 文本 / 代码 / Markdown 预览」正文**与**右栏「变更审阅」diff** 从上游
固定的 11px 提到**字号轴主档**（设置 →「字号大小」，`--dsh-content-font-size`，默认
14px）的本地持久化插件。纯浏览器半部样式补丁：宿主半部为空占位，不消费任何服务，
不声明 `inject`。

## 为什么内置设置不够

上游把「代码 / 紧凑小号文本」刻意排除在字号轴之外（主题 README：*紧凑的小号文本与代码
变体保持固定字号*），这两处的正文都吃同一个**固定 11px** 的 token
`--dsw-font-markdown-code-block`：

| 位置 | 上游元素 | 上游字号 | 受「字号大小」影响 |
| --- | --- | --- | --- |
| 右栏纯文本 / 代码预览 | `[data-textpreview-body]`（正文容器） | 13px（`--dsh-content-font-size-secondary`） | 部分（设置 17 时 → 15px） |
| 右栏纯文本 / 代码预览的每一页 | `[data-textpreview-page]`（`pre`） | **11px** 固定 | ❌ |
| 右栏 Markdown 预览正文 | `[data-document-markdown]` | `--dsw-font-markdown-base` = 字号轴 | ✅ |
| 右栏 Markdown 里的代码块 | `CodeBlock` 的 `pre` | **11px** 固定（同一 token） | ❌ |
| 右栏「变更审阅」diff | `[data-changes-review] [data-review-view]` | **11px** 固定，行高硬编码 22px | ❌ |

所以「设置里调字号」对代码预览与变更审阅**完全无效**——只能靠本插件在容器内重指该
token。

## 注入的样式表（`src/css.ts` 是唯一真源）

```css
/* ① 右栏文件/文本/代码/Markdown 预览 */
[data-textpreview-body] {
  font-size: var(--dsh-content-font-size, 14px) !important;   /* 正文：secondary 档 → 字号轴主档 */
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) /
    calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* ② 右栏「变更审阅」标签页 */
[data-changes-review] {
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) /
    calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* diff 每行的行高 / 最小行高上游硬编码 22px，随字号增量同步 */
[data-changes-review] [data-diff-line] {
  min-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
  line-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
}
```

默认（`FIXED_FONT_SIZE_PX = null`）渲染为 **14px / 22px**，与 `dsh-code-card-fonts`
的聊天卡片同号。

## 实现依据

- **只重指 token，不逐个覆盖元素**：上游这些 `font:` 简写全部读同一个 token
  （`CodeBlock.module.css` 里 `--dsl-code-block-content-font: var(--dsw-font-markdown-code-block)`、
  `TextPreview` 的 `.page`、`ReviewTab` 的 `.body`），在容器上重指一次即三处同时生效，
  不必写 `.dhJKeW_page` / `.ZDDmpq_body` 这类 CSS-module 哈希类名。
- **选择器全是稳定 data 属性**（抗上游 CSS-module 哈希改名）：
  `[data-textpreview-body]` 是 `ui-sidebar-documentpreview` 正文容器，纯文本页
  （`[data-textpreview-page]`）、Markdown（`[data-document-markdown]`）与 CodeBlock
  预览（`[data-code-preview]`）都是它的后代；`[data-changes-review]` 是
  `ui-deliverables` 变更审阅 tab 根（地址 `dsh-resource://changes-review/session/<id>/<seq>/<turn>`），
  `[data-diff-line]` 打在它的每一行 diff 行上（unified / split 两种视图同款）。
- **`font:` 简写的值须是完整简写**：token 被当 `font:` 消费，所以重指值写成
  `400 <size> / <line-height> <family>`，与上游自己的 `11px/19px var(--ds-font-family-code)`
  同形。`--dsh-content-font-size` / `--dsh-content-font-delta` / `--ds-font-family-code`
  都是主题声明在 **`body`** 上的变量（前者是内联样式），容器内可直接取到；`--dsh-content-font-delta`
  另带 `0px` 兜底，主题缺席时退化为固定 22px 行高。
- **`font-size !important`**：正文容器上游规则 `.dhJKeW_body{font-size:var(…secondary…)}` 同为
  单类名 (0,1,0)，`!important` 让结果不依赖样式注入顺序（client-hmr 重注入会换标签）。

## 调整

| 想改什么 | 怎么做 |
| --- | --- |
| 整体再大 / 再小 | 改设置里的「字号大小」（12..17），右栏三处一起联动 |
| 与设置解耦、钉死一个 px | `src/css.ts` 的 `FIXED_FONT_SIZE_PX` 从 `null` 改成数字（如 `15`），行高按 22/14 比例缩放 |
| 只改行距 | 改 `src/css.ts` 里两处 `22px` 基线 |

改完 `npm run typecheck && npm run build`；产物 mtime 变化后 client-hmr 在 500ms 内热推送，
页面无需重启 / 刷新。

## 已知边界

1. **不覆盖字号轴**：Markdown 预览的正文 / 标题阶梯 / 表格仍由「字号大小」控制（上游
   `--dsw-font-markdown-*` 已在 `body` 上替换求值，容器内重指字号轴变量不会回溯生效）。
   默认设置下右栏正文与代码块同为 14px；把设置调到 17 时正文 17px、代码块仍 14px，
   想统一就把 `FIXED_FONT_SIZE_PX` 设成与设置相同的值。
2. **审阅页头部（文件选择器、± 计数、说明行）保持上游 12 / 13px**：它们是 chrome 且带
   固定高度（28px 按钮），跟着涨会挤版；只有 diff 正文随字号轴走。
3. **不作用于会话内 diff 卡片**（工具卡里的 `[data-diff]`，同样是固定 11px）：本插件的
   范围只有右栏两处。需要时可把 `[data-diff]` 加进 `src/css.ts`。
4. **`data-*` 是上游内部实现、非文档化公开 API**：上游升级可能改名，届时样式仍注入但匹配
   不到元素（静默失效）；已在上述表格记下当前元素。
5. 若上游改用 `!important` 声明这些字号，本插件的 `!important` 仍胜出（同权重下按注入
   顺序，本样式表在 head 末尾），但 token 重指可能被上游显式 `font-size` 压过。

## 构建与加载

```sh
npm install
npm run typecheck && npm run build && npm run check
```

```sh
cd <仓库根>/dsh-rightbar-fonts
dsh plugin --profile web add link:.                  # 重启 App 生效（bundle 层不支持热重载）
dsh plugin --profile web remove dsh-rightbar-fonts
```

`build`：`scripts/build-client.mjs` **直接执行 esbuild 平台二进制**（而非 JS API，后者用
stdio 管道通信，受限沙箱下 `spawn` 报 `EPERM`）→ `lib/client.js`（入仓，禁止手改）。
挂载后**改样式不需要重启**：`npm run build` 后 client-hmr 热替换浏览器半部；只有首次
挂载（Profile bundle 层）需要重启 App。

现场核对：右栏打开任一代码文件，computed `font-size` 为 14px（随「字号大小」变），
`document.head` 里有 `<style data-plugin="dsh-rightbar-fonts">`；变更审阅 diff 行的
computed `line-height` 为 22px。
