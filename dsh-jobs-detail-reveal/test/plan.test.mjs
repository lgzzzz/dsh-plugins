/**
 * `src/plan.ts` 的行为测试：滚动目标与「按需加高」的两条判定。
 *
 * 几何都按真实面板的量级取（面板顶边 12px、内边距 6px、视口 1309px），断言用整数，方便读。
 * 跑全部请用 `node test/run-all.mjs`（或 `pnpm test`）。
 */
import { BOTTOM_INSET, fitMaxHeight, parseMaxHeight, rowScrollTop } from '../src/plan.ts'
import { check, checkTrue, finish } from './helpers.mjs'

/** 面板与行的常用实测值。 */
const PANEL_TOP = 12
const PADDING = 6

check('BOTTOM_INSET 与面板顶部留白对称', BOTTOM_INSET, 12)

// ---- rowScrollTop：把行顶到内容区起点 -------------------------------------

check(
  '行在下方：目标 scrollTop = 行位置 − 上内边距',
  rowScrollTop({ panelTop: PANEL_TOP, panelBorderTop: 0, paddingTop: PADDING, scrollTop: 0, rowTop: 500 }),
  482,
)

check(
  '已滚动过：换算回内容坐标后仍是同一个目标',
  rowScrollTop({ panelTop: PANEL_TOP, panelBorderTop: 0, paddingTop: PADDING, scrollTop: 100, rowTop: 400 }),
  482,
)

check(
  '行本来就在顶部：不滚（行顶在内容区起点时目标为 0）',
  rowScrollTop({ panelTop: PANEL_TOP, panelBorderTop: 0, paddingTop: PADDING, scrollTop: 0, rowTop: PANEL_TOP + PADDING }),
  0,
)

check(
  '行在内容区起点之上：夹到 0，不写出负的 scrollTop',
  rowScrollTop({ panelTop: PANEL_TOP, panelBorderTop: 0, paddingTop: PADDING, scrollTop: 0, rowTop: 4 }),
  0,
)

check(
  '面板有上边框：边框宽度不计入内容区起点',
  rowScrollTop({ panelTop: PANEL_TOP, panelBorderTop: 2, paddingTop: PADDING, scrollTop: 0, rowTop: 500 }),
  480,
)

// ---- fitMaxHeight：详情装不下才加高 ---------------------------------------

check(
  '详情装得下：不动上游 max-height',
  fitMaxHeight({
    panelTop: PANEL_TOP,
    itemHeight: 340,
    paddingTop: PADDING,
    paddingBottom: PADDING,
    naturalMaxHeight: 1133,
    viewportHeight: 1309,
  }),
  null,
)

check(
  '详情装不下：加高到刚好装下',
  fitMaxHeight({
    panelTop: PANEL_TOP,
    itemHeight: 600,
    paddingTop: PADDING,
    paddingBottom: PADDING,
    naturalMaxHeight: 500,
    viewportHeight: 1309,
  }),
  612,
)

check(
  '装下需要的空间超过视口：只加到视口允许的高度',
  fitMaxHeight({
    panelTop: PANEL_TOP,
    itemHeight: 1300,
    paddingTop: PADDING,
    paddingBottom: PADDING,
    naturalMaxHeight: 500,
    viewportHeight: 1309,
  }),
  1285,
)

check(
  '视口本身比上游 max-height 还挤：不加高（只会更糟）',
  fitMaxHeight({
    panelTop: PANEL_TOP,
    itemHeight: 900,
    paddingTop: PADDING,
    paddingBottom: PADDING,
    naturalMaxHeight: 500,
    viewportHeight: 400,
  }),
  null,
)

check(
  '上游没有限高（Infinity）：永远不用加高',
  fitMaxHeight({
    panelTop: PANEL_TOP,
    itemHeight: 9999,
    paddingTop: PADDING,
    paddingBottom: PADDING,
    naturalMaxHeight: Number.POSITIVE_INFINITY,
    viewportHeight: 1309,
  }),
  null,
)

check(
  '浮点容差：差半个像素以内不重写',
  fitMaxHeight({
    panelTop: PANEL_TOP,
    itemHeight: 500,
    paddingTop: PADDING,
    paddingBottom: PADDING,
    naturalMaxHeight: 512.3,
    viewportHeight: 1309,
  }),
  null,
)

// ---- parseMaxHeight -------------------------------------------------------

check('解析 px 计算值', parseMaxHeight('1133px', Number.POSITIVE_INFINITY), 1133)
check('none 用兜底值', parseMaxHeight('none', Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY)
check('0px 不退化成兜底', parseMaxHeight('0px', 7), 0)
check('解析不出数字时用兜底值', parseMaxHeight('calc(100vh - 3px)', 7), 7)

checkTrue('空字符串拿兜底值', parseMaxHeight('', 42) === 42)

finish()
