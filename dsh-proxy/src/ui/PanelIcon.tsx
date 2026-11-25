/**
 * 侧栏入口图标：一条主干分叉到两个出口点。
 * 描边与填充用 `currentColor`，随侧栏按钮的选中态变色，不写死颜色。
 */

/** 槽位 `sidebar.panellist` 交给图标组件的属性。 */
export interface PanelIconProps {
  /** 槽位分配的方形边长（像素）。 */
  size: number
  /** 该面板是否为主栏当前选中项；图标本身不区分，保留以便对齐槽位契约。 */
  active: boolean
}

/**
 * 渲染侧栏图标。
 * @param props - 边长与选中态。
 * @returns 图标元素。
 */
export function PanelIcon({ size }: PanelIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.5 18h8.5" />
        <path d="M14 18c4.6 0 4.4-8 9-8h4.5" />
        <path d="M14 18c4.6 0 4.4 8 9 8h4.5" />
      </g>
      <g fill="currentColor">
        <circle cx="29.6" cy="10" r="2.6" />
        <circle cx="29.6" cy="26" r="2.6" />
      </g>
    </svg>
  )
}
