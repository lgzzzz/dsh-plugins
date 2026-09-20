# dsh-rightbar-fonts

把**右栏「文件 / 文本 / 代码 / Markdown 预览」正文**、**右栏 Markdown 预览里的表格 /
行内代码 / 代码围栏**与**右栏「变更审阅」diff** 从上游的固定 11px、secondary 档与
`0.875em` 统一提到**字号轴主档**（设置 →「字号大小」，`--dsh-content-font-size`，默认
14px）的本地持久化插件。纯浏览器半部样式补丁：宿主半部为空占位，不消费任何服务，
不声明 `inject`。

## 为什么内置设置不够

上游把「代码 / 紧凑小号文本」刻意排除在字号轴之外（主题 README：*紧凑的小号文本与代码
变体保持固定字号*），右栏这几处正文于是各吃各的写死值：**固定 11px** 的代码 token
`--dsw-font-markdown-code-block`、**secondary 档**的表格，以及行内代码的 `0.875em`：

| 位置 | 上游元素 | 上游字号（实测 computed） | 受「字号大小」影响 |
| --- | --- | --- | --- |
| 右栏纯文本 / 代码预览 | `[data-textpreview-body]`（正文容器） | 13px（`--dsh-content-font-size-secondary`） | 部分（设置 17 时 → 15px） |
| 右栏纯文本 / 代码预览的每一页 | `[data-textpreview-page]`（`pre`） | **11px** 固定 | ❌ |
| 右栏 Markdown 预览正文 | `[data-document-markdown]` 内的 MarkdownText 根 | `--dsw-font-markdown-base` = 字号轴（14px / 24px） | ✅ |
| 右栏 Markdown 表格 th / td | `--dsw-font-markdown-table-head` / `-table` | **13px / 22px**（secondary 档） | 部分（设置 17 时 → 15px） |
| 右栏 Markdown 行内代码 | `._markdown_xxx :not(pre) > code`（源码写 `.markdown`） | **12.25px**（`0.875em` 写死 `!important`） | ❌ |
| 右栏 Markdown 表格内行内代码 | `._tableScroll_xxx table code` | **11.375px**（同一条 `0.875em`；上游另写的 `font-size:11px` 被自己的 `!important` 压掉，是死规则） | ❌ |
| 右栏 Markdown 里的代码块 | `CodeBlock` 的 `pre` | **11px / 19px** 固定（同一 token） | ❌ |
| 右栏「变更审阅」diff | `[data-changes-review] [data-review-view]` | **11px** 固定，行高硬编码 22px | ❌ |

所以「设置里调字号」对代码预览、表格、行内代码与变更审阅**完全无效**——只能靠本插件在
容器上重指这些 token（行内代码被上游 `!important` 写死，再叠一条更高特异性的 `font-size`）。
插件生效后，右栏 Markdown 里表格、行内代码与代码围栏**全部与正文本号**（默认
14px / 代码行高 22px），只有标题仍按上游阶梯放大。

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

/* ③ 右栏 Markdown 预览：表格 / 代码围栏与正文本号 */
[data-document-markdown] {
  --dsw-font-markdown-table: var(--dsh-content-font-size, 14px) /
    calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-table-head: 500 var(--dsh-content-font-size, 14px) /
    calc(22px + var(--dsh-content-font-delta, 0px)) var(--dsw-font-family);
  --dsw-font-markdown-code-block: 400 var(--dsh-content-font-size, 14px) /
    calc(22px + var(--dsh-content-font-delta, 0px)) var(--ds-font-family-code);
}

/* 行内代码：1em = 父级字号（正文/列表/表格里就是字号轴），行高留上游 19px 不撑行。
   注意不能写 .markdown —— 那是 CSS-module 本地名，DOM 上是哈希类名 _markdown_uddqf_5，
   故用两个 data 属性锚点把特异性抬到 (0,2,2) 压过上游的 (0,1,2)。 */
[data-textpreview-body] [data-document-markdown] :not(pre) > code {
  font-size: 1em !important;
}
```

默认（`FIXED_FONT_SIZE_PX = null`）渲染为 **14px / 22px**，与 `dsh-code-card-fonts`
的聊天卡片同号；右栏 Markdown 的正文（`--dsw-font-markdown-base`，行高 24px）与 ③ 段
收口的表格、行内代码、代码围栏因此同为 14px。

### 实测（headless Chrome + 上游真实 CSS / 真实哈希类名与 data 属性）

| 目标 | 未装插件（轴 14） | 装后（轴 14） | 装后（轴 17） |
| --- | --- | --- | --- |
| 正文 `p` | 14px / 24px | 14px / 24px | 17px / 27px |
| 行内 `code` | 12.25px | **14px** | **17px** |
| `h1` | 21px / 30px | 21px / 30px | 24px / 33px |
| `h1` 内行内 `code` | 18.375px | 21px（随标题阶梯） | 24px |
| 表格 `th` / `td` | 13px / 22px | **14px / 22px** | **17px / 25px** |
| 表格内行内 `code` | 11.375px | **14px** | **17px** |
| 围栏 `pre` | 11px / 19px | **14px / 22px** | **17px / 25px** |
| 聊天区行内 `code`（对照） | 12.25px | 12.25px（不受影响） | 14.875px |

复现方法：把上游 `dsh-web-frontend/dist/assets/index-*.css`、ui-theme 的 token 样式串、
documentpreview 的 `dhJKeW_body` / `_0RKuNG_document` 样式串与本插件产物注入的样式表
按真实顺序内联进一个页面，DOM 用真实的哈希类名 + `[data-textpreview-body]` /
`[data-document-markdown]` 结构，再 `getComputedStyle` 逐个取值。

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
- **`MarkdownText` 根没有稳定钩子，别写 `.markdown`**：它的类名是 CSS-module 本地名
  `markdown`，构建后 DOM 上只有哈希 `_markdown_uddqf_5`；`data-markdown-variant` 只在
  `compact` 变体下才渲染，右栏是 `body` 变体因而不存在。所以 ③ 段的行内代码规则叠了
  `[data-textpreview-body]`（MarkdownBody 的唯一渲染父级）与 `[data-document-markdown]`
  两个 data 属性锚点把特异性抬到 (0,2,2)，压过上游 `._markdown_xxx :not(pre) > code`
  的 (0,1,2)——既不依赖哈希类名，也不依赖样式注入顺序。
- **`font:` 简写的值须是完整简写**：token 被当 `font:` 消费，所以重指值写成
  `400 <size> / <line-height> <family>`，与上游自己的 `11px/19px var(--ds-font-family-code)`
  同形。`--dsh-content-font-size` / `--dsh-content-font-delta` / `--ds-font-family-code`
  都是主题声明在 **`body`** 上的变量（前者是内联样式），容器内可直接取到；`--dsh-content-font-delta`
  另带 `0px` 兜底，主题缺席时退化为固定 22px 行高。
- **`font-size !important`**：正文容器上游规则 `.dhJKeW_body{font-size:var(…secondary…)}` 同为
  单类名 (0,1,0)，`!important` 让结果不依赖样式注入顺序（client-hmr 重注入会换标签）。
- **Markdown 三处额外收口（③ 段）**：
  - 表格走 token：上游 `.tableScroll th/td{font: var(--dsw-font-markdown-table-head/-table)}`，
    在 `[data-document-markdown]` 上重指即生效（表头字重 500、单元格 normal，与上游同形）；
  - 代码围栏走 token：`CodeBlock.module.css` 的 `.block :where(pre){font:var(--dsl-code-block-content-font)}`，
    而 `--dsl-code-block-content-font` 默认指向 `--dsw-font-markdown-code-block`，同一容器内重指即可
    （与 ① 段值一致，显式写一遍是为了让「右栏 Markdown = 字号轴」不依赖 ① 段）。注意这只对
    「token 的值引用另一个 token」成立；`.block` 上本地字面量声明的 `--dsl-code-block-banner-font`
    就吃不到祖先重指，所以标签条不在本插件范围内；
  - 行内代码只能覆盖元素：上游 `._markdown_xxx :not(pre) > code` 的 `font-size` 带
    `!important` 写死 `0.875em`（实测把上游自己写的 `.tableScroll table code{font-size:11px}`
    也压掉了，故表格内基线是 11.375px 而非 11px）；本插件用 (0,2,2) 选择器 + `!important`
    压过它。取 `1em`（= 父级字号）而非固定值，是为了让标题里的行内代码仍随标题阶梯；
    行高不动，芯片仍是上游的 19px 高，不会把整行撑开。

## 调整

| 想改什么 | 怎么做 |
| --- | --- |
| 整体再大 / 再小 | 改设置里的「字号大小」（12..17），右栏各处一起联动 |
| 与设置解耦、钉死一个 px | `src/css.ts` 的 `FIXED_FONT_SIZE_PX` 从 `null` 改成数字（如 `15`），行高按 22/14 比例缩放 |
| 只改行距 | 改 `src/css.ts` 里两处 `22px` 基线 |
| 右栏 Markdown 的表格 / 行内代码 / 代码围栏想与正文**不同号** | 改 ③ 段：表格改 `TABLE_FONT` / `TABLE_HEAD_FONT`，代码围栏改 `[data-document-markdown]` 里的 `--dsw-font-markdown-code-block`，行内代码把 `1em` 换成固定值（如 `14px`） |
| 代码围栏的语言 / 复制标签条也一起涨 | 它是上游的 11px/18px chrome：`--dsl-code-block-banner-font` 由 `.block` **本地声明**，祖先重指无效（与代码正文不同——正文那个 token 的值是 `var(--dsw-font-markdown-code-block)`，会取到本插件的重指值）。标签条自带稳定属性 `[data-code-block-banner]`，直接对它写 `font:`，并再压一层它的子元素（语言名另有 `font-size:11px`） |

改完 `npm run typecheck && npm run build`；产物 mtime 变化后 client-hmr 在 500ms 内热推送，
页面无需重启 / 刷新。

## 已知边界

1. **不覆盖字号轴**：Markdown 预览的正文与标题阶梯仍由「字号大小」控制（上游
   `--dsw-font-markdown-*` 已在 `body` 上替换求值，容器内重指字号轴变量不会回溯生效），
   本插件只把表格 / 行内代码 / 代码围栏也钉到**同一根轴的主档**。因此默认设置下右栏
   Markdown 全篇 14px（标题按上游阶梯 21/19/18/14px）；把设置调到 17 时正文、表格、
   行内代码、代码围栏一起变 17px，标题阶梯同步（24/22/21/17px）。想让右栏与设置解耦，
   把 `FIXED_FONT_SIZE_PX` 设成想要的数字。
2. **审阅页头部（文件选择器、± 计数、说明行）保持上游 12 / 13px**：它们是 chrome 且带
   固定高度（28px 按钮），跟着涨会挤版；只有 diff 正文随字号轴走。同理，右栏 Markdown
   代码围栏顶部那条语言 / 复制标签条仍是 11px。
3. **不作用于会话内 diff 卡片**（工具卡里的 `[data-diff]`，同样是固定 11px）：本插件的
   范围只有右栏两处。需要时可把 `[data-diff]` 加进 `src/css.ts`。
4. **不作用于会话内 Markdown**：③ 段的锚点是右栏文档预览的 `[data-document-markdown]`，
   聊天区 Markdown（同一 `MarkdownText` 组件、无该属性）不受影响。
5. **`data-*` 是上游内部实现、非文档化公开 API**：上游升级可能改名，届时样式仍注入但匹配
   不到元素（静默失效）；已在上述表格记下当前元素。
6. 若上游改用 `!important` 声明这些字号，本插件的 `!important` 仍胜出（同权重下按注入
   顺序，本样式表在 head 末尾），但 token 重指可能被上游显式 `font-size` 压过——行内代码
   正是这种情形（上游 `0.875em !important`），故它走「更高特异性 + `!important`」而非 token。
7. **标题里的行内代码随标题字号**（`1em` 的代价）：轴 14 时 `h1` 里的行内代码是 21px 而不是
   上游那个被 `0.875em` 打折后的 18.375px——正好是上游 `.markdown :where(h1…) code{font:inherit}`
   本来想要的语义。要改回打折，在 ③ 段补一条 `:is(h1,h2,h3,h4,h5,h6) :not(pre) > code{font-size:.875em}`。

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
computed `line-height` 为 22px。右栏打开一个 `.md` 文件，正文 `<p>`、表格 `<td>` /
`<th>`、行内 `<code>` 与围栏 `<pre>` 的 computed `font-size` 应**同为 14px**（表格
`<th>` 字重 500、行内代码行高 19px）。
