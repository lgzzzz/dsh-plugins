/**
 * dsh-left-dock — 内联 SVG 图标。
 *
 * 上游图标来自 `dsh-client-ui-primitives`（本插件不打包该包，也不在模块表里），
 * 因此这里手写同尺寸（16px、stroke=currentColor、线宽 1.4）的等价几何图形。
 * 统一由 `createElement` 构造，不使用 JSX（模块表不注册 react/jsx-runtime）。
 */
import { createElement as h } from 'react'
import type { ReactNode } from 'react'

/** 图标通用 props。 */
interface IconProps {
  size?: number
}

/** 生成一个 16×16 描边图标。 */
function strokeIcon(children: ReactNode, size: number): ReactNode {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    children,
  )
}

/** 会话：对话框轮廓（活动栏第一枚）。 */
export function IconChat({ size = 16 }: IconProps): ReactNode {
  return strokeIcon(
    [
      h('path', { key: 'b', d: 'M2.75 3.75h10.5v7.5H8.1l-3.35 2.6v-2.6H2.75z' }),
      h('path', { key: 'l1', d: 'M5.4 6.6h5.2' }),
      h('path', { key: 'l2', d: 'M5.4 8.9h3.2' }),
    ],
    size,
  )
}

/** 文件：文件夹轮廓（活动栏第二枚）。 */
export function IconFolder({ size = 16 }: IconProps): ReactNode {
  return strokeIcon(
    h('path', { d: 'M2.4 4h4.1l1.25 1.6h5.85v6.9H2.4z' }),
    size,
  )
}

/** 新会话：加号。 */
export function IconPlus({ size = 16 }: IconProps): ReactNode {
  return strokeIcon(
    [h('path', { key: 'v', d: 'M8 3.4v9.2' }), h('path', { key: 'h', d: 'M3.4 8h9.2' })],
    size,
  )
}

/** 重新读取：环形箭头。 */
export function IconRefresh({ size = 16 }: IconProps): ReactNode {
  return strokeIcon(
    [
      h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.45-3.52' }),
      h('path', { key: 'b', d: 'M13.1 2.7v3.2H9.9' }),
    ],
    size,
  )
}

/** 目录展开指示：`open` 为 true 时朝下，否则朝右。 */
export function IconChevron({ size = 12, open = false }: IconProps & { open?: boolean }): ReactNode {
  return strokeIcon(
    h('path', { d: open ? 'M4.4 6.4 8 10l3.6-3.6' : 'M6.4 4.4 10 8l-3.6 3.6' }),
    size,
  )
}

/** 目录：闭合/展开两态共用同一个文件夹几何（状态由 chevron 表达）。 */
export function IconDir({ size = 16 }: IconProps): ReactNode {
  return strokeIcon(
    h('path', { d: 'M2.4 4h4.1l1.25 1.6h5.85v6.9H2.4z' }),
    size,
  )
}

/** 文件：带折角的纸张。 */
export function IconFile({ size = 16 }: IconProps): ReactNode {
  return strokeIcon(
    [
      h('path', { key: 'body', d: 'M4.2 2.4h4.6l3 3v8.2H4.2z' }),
      h('path', { key: 'fold', d: 'M8.8 2.4v3h3' }),
    ],
    size,
  )
}
