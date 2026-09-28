export const FIXED_FONT_SIZE_PX: number | null = null

const FONT_SIZE = FIXED_FONT_SIZE_PX === null
  ? 'var(--dsh-content-font-size, 14px)'
  : `${FIXED_FONT_SIZE_PX}px`

const LINE_HEIGHT = FIXED_FONT_SIZE_PX === null
  ? 'calc(22px + var(--dsh-content-font-delta, 0px))'
  : `${Math.round((FIXED_FONT_SIZE_PX * 22) / 14)}px`

const CODE_FONT = `400 ${FONT_SIZE} / ${LINE_HEIGHT} var(--ds-font-family-code)`

const TABLE_FONT = `${FONT_SIZE} / ${LINE_HEIGHT} var(--dsw-font-family)`
const TABLE_HEAD_FONT = `500 ${FONT_SIZE} / ${LINE_HEIGHT} var(--dsw-font-family)`

export const CSS = `
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
`
