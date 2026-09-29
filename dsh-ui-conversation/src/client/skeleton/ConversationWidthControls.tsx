import { useCallback, useLayoutEffect } from 'react'
import type { ConversationWidthControlsProps } from '../contract/slots.ts'
import css from './ConversationRoot.module.css'

const WHEEL_DELTA_LINE = 1
const WHEEL_DELTA_PAGE = 2
const FALLBACK_WHEEL_LINE_PX = 16

/** Convert a wheel event's vertical delta to scrollport pixels. */
function wheelDeltaY(event: React.WheelEvent, scrollport: HTMLElement): number {
  if (event.deltaMode === WHEEL_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(scrollport).lineHeight)
    return event.deltaY * (Number.isFinite(lineHeight) ? lineHeight : FALLBACK_WHEEL_LINE_PX)
  }
  if (event.deltaMode === WHEEL_DELTA_PAGE) return event.deltaY * scrollport.clientHeight
  return event.deltaY
}

/** One wheel-forwarding strip beside the transcript. */
function WidthHandle(props: { side: 'left' | 'right' }) {
  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const body = event.currentTarget.parentElement
    /* v8 ignore next -- a width handle renders only inside the Conversation body. */
    if (body === null) return
    const scrollport = body.querySelector<HTMLElement>(':scope > [data-conversation-scroll]')
    /* v8 ignore next -- the Conversation body always contains its direct scroll element. */
    if (scrollport === null) return
    if (event.ctrlKey || event.deltaY === 0) return
    scrollport.scrollBy({ top: wheelDeltaY(event, scrollport) })
  }, [])

  return (
    <div
      className={css.widthHandle}
      data-side={props.side}
      data-width-handle={props.side}
      onWheel={onWheel}
    />
  )
}

/**
 * Publish the measured Conversation column width and render the side strips.
 *
 * fork FW1: the transcript axis is unconditionally `100%` (ConversationRoot.module.css),
 * so this component owns no width preference any more. It neither reads nor writes
 * `--dsh-chat-user-width` and never persists
 * `localStorage['dsh.conversation.contentWidth']`; the upstream drag-resize axis is
 * gone with those writes, because at full width the strips resolve to zero
 * (`min(10px, calc((100% - 100%) / 2 - 48px))`), matching the "handles collapse to
 * the content edge" consequence of the full-width column.
 * @param props - Mounted Conversation body and current presentation phase.
 * @returns two active-phase strips, or no controls outside the active phase.
 */
export function ConversationWidthControls({ container, phase }: ConversationWidthControlsProps) {
  const publishWidths = useCallback((container: HTMLDivElement): void => {
    const target = container.parentElement ?? container
    target.style.setProperty('--dsh-conversation-column-width', `${container.offsetWidth}px`)
  }, [])

  useLayoutEffect(() => {
    if (container === null) return
    const observer = new ResizeObserver(() => { publishWidths(container) })
    observer.observe(container)
    publishWidths(container)
    return () => { observer.disconnect() }
  }, [container, publishWidths])

  if (container === null || phase !== 'active') return null
  return (['left', 'right'] as const).map(side => <WidthHandle key={side} side={side} />)
}
