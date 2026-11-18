/**
 * Inline glyphs used by the dashboard: the sidebar entry, an alert, and the
 * refresh action.
 *
 * @module dsh-request-stats/client/icons
 */

import * as React from 'react'
import type { AlertIconProps, PanelIconProps } from './types.ts'

const h = React.createElement

/** Sidebar entry glyph: three ascending latency bars over a baseline. */
export function PanelIcon(props: PanelIconProps): React.ReactElement {
  const size = typeof props?.size === 'number' ? props.size : 18
  const color = props?.active === true ? 'var(--dsw-alias-brand-primary)' : 'currentColor'
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'M4 19.25h16', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.4 }),
    h('rect', { x: 5.4, y: 12.2, width: 3.7, height: 4.6, rx: 1.2, fill: color, opacity: 0.5 }),
    h('rect', { x: 10.15, y: 8.6, width: 3.7, height: 8.2, rx: 1.2, fill: color, opacity: 0.75 }),
    h('rect', { x: 14.9, y: 4.9, width: 3.7, height: 11.9, rx: 1.2, fill: color }),
  )
}

/** Small inline alert glyph. */
export function AlertIcon(props: AlertIconProps): React.ReactElement {
  const size = props?.size ?? 14
  return h(
    'svg',
    { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
    h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.7 }),
    h('path', { d: 'M12 7.6v5.2', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
    h('circle', { cx: 12, cy: 16.4, r: 1, fill: 'currentColor' }),
  )
}

/** Refresh glyph that spins while a manual refresh is running. */
export function RefreshIcon(): React.ReactElement {
  return h(
    'svg',
    { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
    h('path', {
      d: 'M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5',
      stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    }),
  )
}
