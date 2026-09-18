/** 右栏字号补丁:右栏「文件/文本/代码/Markdown 预览」与「变更审阅」diff 的字号真源。
 *
 * 上游这两处的正文都吃**固定 11px** 的代码 token `--dsw-font-markdown-code-block`(与主题里
 * 「紧凑小号文本与代码变体保持固定字号」的约定一致),因此设置里的「字号大小」轴
 * (`--dsh-content-font-size`,ui-theme,12..17)对它们无效。本插件只在**容器内重指**该 token,
 * 顺带把预览正文从 secondary 档(设置 −1px)提到字号轴主档,并把上游硬编码的 22px 行高改成
 * 「22px + 字号增量」,让字号涨时行距同步涨。
 *
 * 选择器全部是稳定 data 属性(抗 CSS-module 哈希):`[data-textpreview-body]` 是
 * ui-sidebar-documentpreview 的正文容器(纯文本页 / Markdown / CodeBlock 预览都在其中),
 * `[data-changes-review]` 是 ui-deliverables 的变更审阅 tab 根,`[data-diff-line]` 打在它的每个
 * diff 行上。 */

/** 目标字号来源。
 *  - `null`(默认):跟随设置里的「字号大小」(默认 14px),用户改设置即整体联动;
 *  - 数字:钉死该 px(行高按 22/14 的比例同步),与设置互不干扰。
 *  改动后须 `npm run build`。 */
export const FIXED_FONT_SIZE_PX: number | null = null

// 正文字号:默认取自主题内联在 body 上的字号轴变量。
const FONT_SIZE = FIXED_FONT_SIZE_PX === null
  ? 'var(--dsh-content-font-size, 14px)'
  : `${FIXED_FONT_SIZE_PX}px`

// 行高:上游 diff 行基线 22px(14px 字号),随字号轴增量同步。
const LINE_HEIGHT = FIXED_FONT_SIZE_PX === null
  ? 'calc(22px + var(--dsh-content-font-delta, 0px))'
  : `${Math.round((FIXED_FONT_SIZE_PX * 22) / 14)}px`

// 代码/正文的 font 简写:上游把整个 token 当 `font:` 简写消费,故这里必须是完整简写。
const CODE_FONT = `400 ${FONT_SIZE} / ${LINE_HEIGHT} var(--ds-font-family-code)`

// 注入的样式表;首行注释供 DevTools 核对来源。
export const CSS = `/* dsh-rightbar-fonts: right-sidebar preview + changes review follow the content font-size axis */
/* ① 右栏文件/文本/代码/Markdown 预览:正文容器 [data-textpreview-body]
   —— 正文提到字号轴主档(上游取 secondary 档);
   —— 容器内重指代码 token:纯文本/代码页 <pre data-textpreview-page>、Markdown 里的代码块、
      CodeBlock 预览(其 --dsl-code-block-content-font 默认指向同一 token)一并生效。 */
[data-textpreview-body] {
  font-size: ${FONT_SIZE} !important;
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

/* ② 右栏「变更审阅」标签页(dsh-resource://changes-review/…):.body 用 font: var(--dsw-font-markdown-code-block) */
[data-changes-review] {
  --dsw-font-markdown-code-block: ${CODE_FONT};
}

/* diff 每行的行高/最小行高上游硬编码 22px,随字号增量同步,否则字号涨了行距不变会更挤 */
[data-changes-review] [data-diff-line] {
  min-height: ${LINE_HEIGHT} !important;
  line-height: ${LINE_HEIGHT} !important;
}
`
