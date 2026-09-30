# 四个插件 CSS 修复 + 统一重构 + 静默失败检测方案

> 目标：把 `dsh-code-card-fonts`、`dsh-rightbar-fonts`、`dsh-rightbar-tab-width`、`dsh-fullwidth-chat` 四个 CSS 注入插件，**重构为一个统一的 CSS 注入插件**，同时修复失效规则、并接入构建后静态契约校验。
> 结论依据：逐一比对当前 DSH Web 前端（`dsh-web-frontend/dist` + 各 `dsh-client-ui-*` 包）实际生成的 DOM 结构与 CSS 变量。

---

## 0. TL;DR

1. **选择器类型结论不变**：四个插件全部使用 `[data-*]` **属性选择器**，这是正确的、应当保留的锚点策略。**不要改成哈希类选择器**（`._tab_6nhg2_134` 这类是构建产物，行号进类名，上游改一行就全变，且插件独立构建拿不到上游的类名映射表）。
2. **只有 `dsh-code-card-fonts` 存在失效规则**，共 5 处；其余三组规则全部有效。
3. **失效根因**：上游把「披露行/样例卡」的标题+摘要从直接 `span` 兄弟，包进了 `TextShimmer` 包装层，且标题/摘要改读 `--dsh-content-font-size-secondary` 变量。原来的 `:nth-child` / `:nth-last-child` / `:has()` 位置选择器因此打偏或打空。
4. **修复方向**：把位置选择器替换为「稳定属性锚点 + 覆盖 CSS 变量」。
5. **统一重构**：四个插件合并为一个 `dsh-ui-css-patches` 插件——单一 `<style>` 注入点、单一生命周期、单一构建与校验。
6. **静默失败检测**：一个**构建后静态契约校验器**（插件目录内的 `check-css.mjs` + `css-contract.json`），对上游产物做 token/正则 grep，验证依赖的 `data-*` 属性与 CSS 变量仍存在；无需运行时、无需浏览器。

---

## 1. 现状与问题定位（当前四插件）

### 1.1 选择器类型结论

| 插件 | 注入的选择器类型 |
|---|---|
| `dsh-code-card-fonts` | `[data-*]` 属性选择器 + `body` + 伪类（`:nth-child`/`:nth-last-child`/`:not`/`:has`） |
| `dsh-rightbar-fonts` | `[data-*]` 属性选择器 |
| `dsh-rightbar-tab-width` | `[data-dockkit-tab][role="tab"]` 复合属性选择器 |
| `dsh-fullwidth-chat` | `[data-slot='main.conversation'] [data-conversation-content]` 属性选择器 |

**全部是属性选择器，无类选择器。** 这是跨版本最稳的锚点，保留。

### 1.2 失效规则清单（全部在 `dsh-code-card-fonts/src/css.ts`）

| 行 | 规则（节选） | 状态 | 根因 |
|---|---|---|---|
| 10–12 | `[data-chat-flow-kind] [data-disclosure-row] > span:nth-child(2)` | ⚠️ 部分失效 | 第 2 子是 `TextShimmer` 包装 span；标题在 `span.title` 自带 `font-size: var(--dsh-content-font-size-secondary, 13px)`，父级 `14px!important` 是继承值，压不过子元素自身声明 |
| 14–16 | `[data-sample] > span:nth-last-child(3)` | ❌ 失效 | 现在 `[data-sample]` 子元素是 `[span.leading, (span.visuallyHidden), TextShimmer]`；有状态时命中 leading 图标（错位），无状态时 `nth-last-child(3)` 不存在 |
| 23–25 | `[data-chat-flow-kind] [data-disclosure-row] > :nth-child(n+3)` | ❌ 死选择器 | 披露行 `div.row` 现在只有 2 个子元素，`:nth-child(n+3)` 匹配 0 个 |
| 27–29 | `[data-sample] > span:last-child` | ⚠️ 部分失效 | 命中 `TextShimmer` 包装 span，标题/摘要各自带字号，不被继承值改变 |
| 74–77 | `[data-tool] [data-open] > div > div:has(> ul), :has(> p)` | ❌ 大概率失效 | 深度硬编码工具展开体层级，现代工具卡片结构已变，属脆弱猜测 |

### 1.3 仍有效的规则（无需改，仅列入回归验收）

`dsh-code-card-fonts` 中以下规则仍命中且 `!important` 生效：compaction（18–21/31–34/58–61 行）、`pre`/`pre code`/`:not(pre) > code`（36–43）、`table th/td`（45–48）、`[data-markdown-variant="compact"]`（54–56）、代码字体变量重定义（63–72）、`[data-turn-trigger]`（79–83）。

其余三个插件全部有效：

- `dsh-rightbar-fonts`：`data-textpreview-body`、`data-changes-review`、`data-diff-line`、`data-document-markdown` 均存在且关系正确；重定义的 `--dsw-font-markdown-code-block` / `-table` / `-table-head` 仍被上游消费。
- `dsh-rightbar-tab-width`：dockkit 标签确为 `<div role="tab" data-dockkit-tab class="_tab_6nhg2_134">`，插件 `(0,2,0)` 压过上游 `.tab` `(0,1,0)`。
- `dsh-fullwidth-chat`：`data-slot="main.conversation"` 在 slot 出口 `<div>`，`data-conversation-content` 在 `.wSkVaW_body` 上；上游正是用 `.wSkVaW_body { --dsh-chat-content-width: … }` 在该元素自身声明此变量，插件 `(0,2,0)` 压过 `(0,1,0)`。

---

## 2. 修复方案（Part A）

### 2.1 修复原则

1. **锚点只用稳定 `data-*` 属性**，杜绝按 DOM 位置（`:nth-child`/`:nth-last-child`/`:has()` 深层结构）定位。
2. **优先走 CSS 变量通道**：上游标题/摘要已经改读 `--dsh-content-font-size-secondary`，覆盖这个变量比逐元素 `font-size!important` 更稳、更少副作用。
3. 保留仍有效的规则，只替换失效的 5 处。

### 2.2 `dsh-code-card-fonts` 逐条修复

失效的 5 处替换为：

```css
/* 失效规则 3 + 6：披露行标题/摘要 → 覆盖 secondary 变量 */
[data-chat-flow-kind] [data-disclosure-row] {
  --dsh-content-font-size-secondary: 14px;
}

/* 失效规则 4 + 7：样例卡(bash)标题/摘要 → 覆盖 secondary 变量 */
[data-sample] {
  --dsh-content-font-size-secondary: 14px;
}

/* 失效规则 17：工具展开体正文（脆弱 :has 猜测）→ 删除 */
/* 其意图已被 pre/code/table 规则覆盖 */
```

**副作用与验收点**：

- `--dsh-content-font-size-secondary: 14px` 会顺带影响同作用域内**派生自 secondary** 的元素，例如 ToolRow 的 `diffStat`（`calc(secondary - 2px)`）会从 11px 变 12px。这通常符合「卡片内容按 14px 缩放」的预期，但需在真实会话里目视确认。
- 行高不受影响（标题/摘要行高读 `--dsh-content-font-delta`，只随用户正文字号轴变化），符合「行高保持用户可调」的设计。

---

## 3. 统一重构方案（Part B）

把四个插件合并为一个 `dsh-ui-css-patches` 插件（名字可自定）。

### 3.1 收益

| 维度 | 四插件现状 | 统一后 |
|---|---|---|
| 注入点 | 四个 `<style data-plugin=…>` | 一个 `<style data-plugin="dsh-ui-css-patches">` |
| 加载/覆盖顺序 | 依赖四个插件的挂载顺序（不可控） | 单一样式表内源码顺序，完全确定 |
| 生命周期 | 四个 `ctx.effect` 各自挂/卸 | 一个 `ctx.effect`，HMR 整段一起清理 |
| 构建 | 三次 tsdown + 三次 check | 一次 tsdown + 一次 check |
| 样板 | 四份 index.ts / client.ts / package.json / tsconfig / tsdown.config / cordis.patch.yml | 一份 |
| 契约清单 | 分散 | 一份 `css-contract.json` |

> 无失败隔离损失：CSS 规则彼此独立，某一条选择器失效只是「不匹配」，不影响同一张样式表里其它规则。若想单独停用某一组，注释掉对应 CSS 块即可。

### 3.2 目标目录结构

```
dsh-ui-css-patches/
  index.ts               # 宿主半部：name + 空 apply
  package.json
  tsconfig.json
  tsdown.config.mjs
  cordis.patch.yml
  src/
    client.ts            # 浏览器半部：注入一个 <style>
    css.ts               # 四组 CSS 合并（已应用 §2 修复）
  check-css.mjs          # 构建后静态契约校验器（§4）
  css-contract.json      # 契约清单：data-* / CSS 变量断言（§4）
lib/client.js            # tsdown 产物（构建生成）
```

### 3.3 各文件内容

**`index.ts`**

```ts
export const name = 'dsh-ui-css-patches'
export function apply(): void {}
```

**`src/client.ts`**

```ts
import { CSS } from './css.ts'

export const name = 'dsh-ui-css-patches'

interface ClientContext {
  effect?(callback: () => void | (() => void)): void
}

export function apply(ctx?: ClientContext): void {
  installStyles(ctx)
}

function installStyles(ctx?: ClientContext): void {
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = CSS
  document.head.appendChild(tag)
  if (typeof ctx?.effect === 'function') {
    ctx.effect(() => () => tag.remove())
  }
}
```

**`src/css.ts`**（四组 CSS 合并，已应用 §2 修复，删除失效的 `:has` 规则）：

```ts
// 由 dsh-code-card-fonts / dsh-rightbar-fonts / dsh-rightbar-tab-width /
// dsh-fullwidth-chat 合并而来。

// ── 右栏字号轴参数（来自 dsh-rightbar-fonts）──────────────────
const FIXED_FONT_SIZE_PX: number | null = null
const FONT_SIZE = FIXED_FONT_SIZE_PX === null
  ? 'var(--dsh-content-font-size, 14px)'
  : `${FIXED_FONT_SIZE_PX}px`
const LINE_HEIGHT = FIXED_FONT_SIZE_PX === null
  ? 'calc(22px + var(--dsh-content-font-delta, 0px))'
  : `${Math.round((FIXED_FONT_SIZE_PX * 22) / 14)}px`
const CODE_FONT = `400 ${FONT_SIZE} / ${LINE_HEIGHT} var(--ds-font-family-code)`
const TABLE_FONT = `${FONT_SIZE} / ${LINE_HEIGHT} var(--dsw-font-family)`
const TABLE_HEAD_FONT = `500 ${FONT_SIZE} / ${LINE_HEIGHT} var(--dsw-font-family)`

// ── 右栏 tab 宽度参数（来自 dsh-rightbar-tab-width）───────────
const CAPSULE_WIDTH_PX = 100

export const CSS = `
/* ═══ 1. 对话全宽（来自 dsh-fullwidth-chat）═══════════════════ */
[data-slot='main.conversation'] [data-conversation-content] {
  --dsh-chat-content-width: 100%;
}

/* ═══ 2. 右栏 tab 固定宽度（来自 dsh-rightbar-tab-width）═════ */
[data-dockkit-tab][role="tab"] {
  box-sizing: border-box;
  min-width: ${CAPSULE_WIDTH_PX}px;
  max-width: ${CAPSULE_WIDTH_PX}px;
}

/* ═══ 3. 右栏预览/变更审查字号（来自 dsh-rightbar-fonts）═════ */
[data-textpreview-body] {
  font-size: ${FONT_SIZE} !important;
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

[data-changes-review] {
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

[data-changes-review] [data-diff-line] {
  min-height: ${LINE_HEIGHT} !important;
  line-height: ${LINE_HEIGHT} !important;
}

[data-document-markdown] {
  --dsw-font-markdown-table: ${TABLE_FONT};
  --dsw-font-markdown-table-head: ${TABLE_HEAD_FONT};
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

[data-textpreview-body] [data-document-markdown] :not(pre) > code {
  font-size: 1em !important;
}

/* ═══ 4. 对话卡片 14px 字号与间距（来自 dsh-code-card-fonts，已修复）═══ */
body {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

body [data-step-process-body] {
  --dsh-chat-flow-gap: calc(14px * 0.5);
}

/* 披露行标题/摘要：覆盖 secondary 变量（修复失效的 nth-child 定位） */
[data-chat-flow-kind] [data-disclosure-row] {
  --dsh-content-font-size-secondary: 14px;
}

/* 样例卡(bash)标题/摘要：同上 */
[data-sample] {
  --dsh-content-font-size-secondary: 14px;
}

/* compaction 标题/摘要 */
[data-chat-flow-kind="compaction"] button > span:nth-last-child(3),
[data-chat-flow-kind="manual-compaction"] button > span:nth-last-child(3) {
  font-size: 14px !important;
}

[data-chat-flow-kind="compaction"] button > span:last-child,
[data-chat-flow-kind="manual-compaction"] button > span:last-child {
  font-size: 14px !important;
}

/* code / inline code / table */
[data-chat-flow-kind] pre,
[data-chat-flow-kind] pre code {
  font-size: 14px !important;
}

[data-chat-flow-kind] :not(pre) > code {
  font-size: 14px !important;
}

[data-chat-flow-kind] table th,
[data-chat-flow-kind] table td {
  font-size: 14px !important;
}

/* 展开内容 + compact markdown */
[data-chat-flow-kind] [data-open]:not([data-turn-process]) > :not([data-disclosure-row]) {
  font-size: 14px !important;
}

[data-chat-flow-kind] [data-open]:not([data-turn-process]) [data-markdown-variant="compact"] {
  font-size: 14px !important;
}

/* compaction 展开体 */
[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div,
[data-chat-flow-kind="manual-compaction"] button[aria-expanded="true"] + div {
  font-size: 14px !important;
}

/* 代码字体变量 */
[data-tool],
[data-sample] {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

[data-sample] + * {
  --dsw-font-markdown-code-block-small: 14px/16px var(--ds-font-family-code);
  --dsw-font-markdown-code-block: 14px/19px var(--ds-font-family-code);
}

/* turn-trigger */
[data-turn-trigger] > button > span:nth-child(2),
[data-turn-trigger] > div > p,
[data-turn-trigger] > div > div {
  font-size: 14px !important;
}
`
```

**`package.json`**

```jsonc
{
  "name": "dsh-ui-css-patches",
  "version": "1.0.0",
  "private": true,
  "description": "Local persistent Web UI CSS patches (merged from dsh-code-card-fonts / dsh-rightbar-fonts / dsh-rightbar-tab-width / dsh-fullwidth-chat).",
  "type": "module",
  "exports": {
    ".": { "default": "./index.ts" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": { "platform": "web", "immediately": true },
    "bundle": { "patch": "./cordis.patch.yml" }
  },
  "scripts": {
    "build": "tsdown && node check-css.mjs",
    "check:css": "node check-css.mjs",
    "typecheck": "tsc --noEmit",
    "check": "node --check lib/client.js && node --check index.ts"
  },
  "devDependencies": {
    "tsdown": "^0.22.2",
    "typescript": "^5.9.3"
  }
}
```

**`tsdown.config.mjs`**

```js
import { clientBundle } from '../tsdown.client.mjs'
export default clientBundle('dsh-ui-css-patches', { entry: 'src/client.ts' })
```

**`cordis.patch.yml`**

```yaml
# dsh-ui-css-patches 的 web bundle 挂载行:随 dsh.profile.bundles 自动挂载。
- insert:
    - id: dsh-ui-css-patches
      name: dsh-ui-css-patches
```

**`tsconfig.json`**：与现有三个 TS 插件一致（`include: ["index.ts", "src/**/*.ts"]`，`erasableSyntaxOnly` / `verbatimModuleSyntax` 等）。

### 3.5 追加加固：清掉残留的位置选择器（已落盘）

§2 只修了失效规则，但样式表里仍留着两类**能命中、却依赖 DOM 顺序**的选择器。它们日后会像 §1.2 那样静默打偏，因此一并改写成「稳定属性锚点 + 变量覆盖」：

| 原选择器 | 问题 | 现写法 |
|---|---|---|
| `[data-turn-trigger] > button > span:nth-child(2)` | 第 2 个 span 只是「恰好」是标题；前面一旦加插图标/徽标即打偏 | `[data-turn-trigger] > button { --dsh-content-font-size: 14px }` |
| `[data-chat-flow-kind="compaction"] button > span:nth-last-child(3)` / `> span:last-child` | 依赖按钮内 span 数量与末尾位置（当前 4 个 span，含 2 个 `aria-hidden`） | `[data-chat-flow-kind="compaction"], [data-chat-flow-kind="manual-compaction"] { --dsh-content-font-size-secondary: 14px }` |
| `[data-chat-flow-kind="compaction"] button[aria-expanded="true"] + div` | 相邻兄弟 + 状态属性，双重位置假设 | 同上一条（展开体 `.compactionBody` 也读 `--dsh-content-font-size-secondary`，被同一个变量覆盖） |
| `[data-turn-trigger] > div > p` / `> div > div` | 硬编码展开体内部层级 | `[data-turn-trigger] > div { --dsw-font-xxs-12: 14px/21px var(--dsw-font-family) }` |

**为什么标题不再逐元素设 `font-size`**：上游 `TurnTriggerNodeView.module.css` 里 `.title` 已经是
`font-size: var(--dsh-content-font-size, 14px)`，`.explanation` / `.content` 是 `font: var(--dsw-font-xxs-12)`，
`.compactionTitle` / `.compactionSummary` / `.compactionBody` 是 `font-size: var(--dsh-content-font-size-secondary, 13px)`。
标题 span 本身**没有任何自有属性**（唯一标识是构建期 CSS module 类名 `._title_xxxx`，随构建变），
所以不针对该 span 写选择器，而在它的**属性锚点祖先**上重定义它消费的变量——这同时免掉了 `!important`，
且上游新增/挪动内部元素也依然生效。

代价：语义从「只改标题」放宽为「改该卡片内读同一变量的文字」。对 turn-trigger 按钮，`--dsh-content-font-size`
只被 title 消费；对 compaction 卡片，只有标题/摘要/展开体读次级变量；对展开体，`--dsw-font-xxs-12`
当前只有 `.oz9t_a_time` / `.oz9t_a_explanation` / `.oz9t_a_content` 三处消费者（均已在上游核对）。

`--dsw-font-xxs-12` 已加入 `css-contract.json`（`xxs-font-var`），上游若改用它 token，
校验会在构建时就报 `✗`，而不是等样式静默失效。

### 3.4 迁移步骤

1. 新建 `dsh-ui-css-patches/`，写入 §3.3 的全部文件。
2. 更新 `css-contract.json`：把每条 `plugin` 字段改为 `dsh-ui-css-patches`（`id`/`hint` 保留，可加 `source` 字段标注原插件来源，便于追溯）。
3. 在 DSH 配置（`dsh.profile.bundles` 或等价的 bundle 挂载处）用 `dsh-ui-css-patches` 替换原来的四个 bundle 条目。
4. 运行 `npm run build`（tsdown + `check-css`），确认 `lib/client.js` 产出、契约全绿。
5. 删除/归档四个旧目录 `dsh-code-card-fonts`、`dsh-rightbar-fonts`、`dsh-rightbar-tab-width`、`dsh-fullwidth-chat`。
6. 刷新 Web GUI 目视回归（工具调用/bash 样例/代码块/表格/压缩标记/变更审查/右栏 tab 宽度/对话全宽）。

---

## 4. 静默失败检测方案（Part C）—— 构建后静态契约校验

CSS 规则的失败是**静默**的：没有 JS 异常、没有 console 报错，样式只是悄悄不生效。本方案在**构建之后**跑一个纯 Node 脚本，对上游产物做静态 grep，**不注入任何运行时/浏览器代码**。

### 4.1 为什么静态够用（配合 §2 的修复）

- §2 修复后，插件**不再依赖脆弱的 DOM 位置**（`:nth-child` / `:has()`），只依赖两类稳定 token：
  1. `data-*` 属性名（上游 JSX/JS 渲染代码里的字符串字面量）；
  2. CSS 变量名（上游 CSS 里的 `--var:` 声明或 `var(--var)` 消费）。
- 「上游改名/删除某个属性或变量」是静默失效的最主要根因，而这**恰好能用 grep 精确捕获**。

### 4.2 产物（已落盘并验证）

| 文件 | 作用 |
|---|---|
| [`dsh-ui-css-patches/check-css.mjs`](dsh-ui-css-patches/check-css.mjs) | 校验器：读契约清单，对 DSH 产物递归 grep，输出通过/失败，退出码 0/1 |
| [`dsh-ui-css-patches/css-contract.json`](dsh-ui-css-patches/css-contract.json) | 契约清单：29 条 token/正则断言（含 hint 说明每条失效的后果） |

已验证：对当前 DSH 前端跑出 `29/29 通过`；负向测试（伪造 token）正确输出 `✗` 并退出码 `1`。

### 4.3 校验器工作方式与用法

- **DSH 根目录解析**：`--dsh-root` 参数 → `$DSH_ROOT` 环境变量 → `npm root -g` 下的 `@deepseek-ai/dsh`。定位不到时仅告警不阻断。
- **契约清单定位**：默认取**与脚本同目录**的 `css-contract.json`，可用 `--manifest <json>` 覆盖；脚本与清单随插件目录一起移动/复制，不依赖仓库根布局。
- **匹配方式**：清单里 `token` 用子串匹配，`pattern` 用正则（`s` 标志）；递归遍历指定目录，跳过嵌套 `node_modules`，只读 `.js/.mjs/.cjs/.ts/.tsx/.css/.json`。
- **退出码**：`0` 全通过；`1` 存在契约缺失（可作 CI/构建门禁）；`2` 配置错误。

```bash
cd dsh-ui-css-patches
node check-css.mjs                                   # 自动解析 DSH 根目录（构建脚本用的就是这条）
node check-css.mjs --dsh-root <path-to-dsh-checkout> # 显式指定
```

### 4.4 契约清单要点（29 条，节选）

| 契约 token | 失效后果（hint） |
|---|---|
| `data-disclosure-row` / `data-chat-flow-kind` / `data-sample` / `data-tool` / `data-turn-trigger` / `data-markdown-variant` / `data-turn-process` | 对应锚点消失 → 选择器静默失效 |
| `manual-compaction` | `data-chat-flow-kind="compaction/manual-compaction"` 取值消失 |
| `--dsh-content-font-size-secondary` | 标题/摘要不再读 secondary 变量 → 变量覆盖修复失效 |
| `--dsw-font-markdown-code-block(-small)` / `--ds-font-family-code` / `--dsh-chat-flow-gap` | 代码字体/间距变量被上游删除或改名 |
| `data-textpreview-body` / `data-changes-review` / `data-diff-line` / `data-document-markdown` | 右栏预览/变更审查锚点消失 |
| `--dsw-font-markdown-table(-head)` / `--dsh-content-font-size` / `--dsh-content-font-delta` / `--dsw-font-family` | 表格/正文字号变量被删除或改名 |
| `role:"tab"` 与 `"data-dockkit-tab"` 同元素（正则共现） | dockkit 标签不再同时带两者 → 复合选择器失效 |
| `data-conversation-content` / `main.conversation` | 对话正文 / slot 键锚点消失 |
| `--dsh-chat-content-width`（声明 `:` + 消费 `var(`） | 上游不再声明或消费该宽度变量 → 全宽失效 |

### 4.5 局限（如实说明）

1. **纯 grep 无法证明「语义共现」**：例如 fullwidth-chat 依赖「`--dsh-chat-content-width` 声明在 `.wSkVaW_body` 上，而 `.wSkVaW_body` 恰是 `data-conversation-content` 那同一个元素」。清单只能分别证明「变量被声明」「属性存在」，同元素这一层靠 `hint` 标注，建议**大版本升级后目视一次**。
2. **哈希类名不进清单**：`._tab_6nhg2_134` 这类本就随构建变化，契约清单只校验稳定的 `data-*` 与变量名（这也正是插件应当依赖的全部）。
3. **不覆盖运行时竞态**：若未来有其它插件以 `!important` 覆盖同一元素，静态校验抓不到（那属于运行时问题）；但修复后规则不再依赖位置，冲突面已大幅缩小。

---

## 5. 落地清单（Checklist）

- [ ] 新建 `dsh-ui-css-patches/`，写入 §3.3 的 `index.ts` / `src/client.ts` / `src/css.ts` / `package.json` / `tsdown.config.mjs` / `cordis.patch.yml` / `tsconfig.json`，以及检测套件 `check-css.mjs` / `css-contract.json`（两者与插件同目录，`package.json` 内直接 `node check-css.mjs`）。
- [ ] `css-contract.json` 的 `plugin` 字段统一改为 `dsh-ui-css-patches`（保留 `id`/`hint` 溯源）。
- [ ] DSH 配置用 `dsh-ui-css-patches` 替换原四个 bundle 条目。
- [ ] 运行 `npm run build`（tsdown 产出 `lib/client.js` + 自动触发 `check-css`）。
- [ ] 运行 `node check-css.mjs`（插件目录内），确认 `29/29 通过`、无 `✗`。
- [ ] 删除/归档四个旧目录。
- [ ] 刷新 Web GUI 目视回归：工具调用/bash 样例/代码块/表格/压缩标记/变更审查/右栏 tab 宽度/对话全宽。
- [ ] 升级 DSH 版本后重跑 `npm run build`（自动触发 `check-css`），作为「静默失败」回归门禁。
