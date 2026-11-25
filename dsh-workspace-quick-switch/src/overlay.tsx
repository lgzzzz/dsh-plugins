/**
 * 浮层本体：两张浮层共用同一个组件，只在文案（`view`）与候选来源上不同。
 *
 * 只在 `open` 为真时渲染；打开时面板拿到焦点，键盘动作由 `installPaletteKeys` 在捕获阶段
 * 接管，滚轮由 `installPaletteWheel` 挂到根节点上滑窗口。行按钮带 `role="option"` 与
 * `aria-selected`，列表是 `role="listbox"`，选中行用 `aria-activedescendant` 指向。
 */
import { useEffect, useRef, useSyncExternalStore, type ReactElement } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  PAGE_SIZE,
  clampIndex,
  clampOffset,
  windowSlice,
  type PaletteRow,
  type PaletteStore,
  type PaletteView,
} from './palette.ts'
import { activate, installPaletteKeys, installPaletteWheel, keepOptionVisible } from './keys.ts'
import { translateZh, type PaletteLocaleNS } from './locales.ts'
import { CLASS } from './style.ts'
import { PALETTE_OPTION_ATTR, countLabel, optionDomId } from './views.ts'

/** 浮层组件的 props：业务 props 由容器注入，一个是 store，一个是这张浮层的文案与翻译函数。 */
export interface OverlayProps {
  readonly store: PaletteStore
  readonly view: PaletteView
  /** 本插件字典的翻译函数；省略时用简体中文。 */
  readonly t?: TranslateNS<PaletteLocaleNS>
}

/**
 * 一行候选项。
 *
 * 直接返回元素而不是组件：这里没有状态与生命周期，平铺调用让产物测试能按元素树断言。
 */
function optionElement({
  store,
  view,
  entry,
  index,
  active,
  t,
}: {
  readonly store: PaletteStore
  readonly view: PaletteView
  readonly entry: PaletteRow
  readonly index: number
  readonly active: boolean
  readonly t: TranslateNS<PaletteLocaleNS>
}): ReactElement {
  const label = entry.title === '' ? entry.key : entry.title
  const badges = entry.badges ?? []
  return (
    <button
      key={entry.key}
      type="button"
      id={optionDomId(view, index)}
      role="option"
      className={CLASS.option}
      aria-selected={active}
      {...{ [PALETTE_OPTION_ATTR]: '' }}
      // 稳定身份（工作区 id / 会话 id）：人工排查与自动化验证按它定位行，不依赖文案或序号。
      data-palette-key={entry.key}
      // 悬停与键盘选中共用同一套高亮（见样式表），但只有键盘/点击会改选中行。
      data-active={active ? 'true' : 'false'}
      onClick={() => activate(store, index)}
    >
      <span className={CLASS.index}>{`${index + 1}`}</span>
      <span className={CLASS.texts}>
        <span className={CLASS.label}>
          <span className={CLASS.name}>{label}</span>
          {entry.current === true
            ? <span className={CLASS.current}>{t('currentBadge')}</span>
            : null}
          {badges.map(badge => (
            <span key={`badge:${badge}`} className={CLASS.badge} data-badge={badge}>
              {badge}
            </span>
          ))}
        </span>
        <span className={CLASS.path}>{entry.subtitle}</span>
      </span>
      {active ? <span className={CLASS.enter}>{t('footerEnter')}</span> : null}
    </button>
  )
}

/** 浮层主体：只在 `open` 为真时渲染，开着的时候按捕获阶段收到的按键动作。 */
export function PaletteOverlay({ store, view, t = translateZh }: OverlayProps): ReactElement | null {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const open = state.open
  const entries = state.entries
  const activeIndex = clampIndex(state.activeIndex, entries.length)
  // 一屏只渲染 PAGE_SIZE 行；窗口起点越界（候选变短）按当前候选收敛，渲染与按键读的是同一个值。
  // 窗口是连续滑动的：起点可以是任意行，所以滚一下就是 1–10 → 2–11，而不是整屏跳。
  const offset = clampOffset(state.offset, entries.length)
  const visible = windowSlice(entries, offset)

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  // 选中行必须留在可见范围：窗口不够高时列表只在内部滚动，键盘把选中行移出视口等于「看不见」。
  // 打开时（初始选中行可能就是第 10 行）与每次 ↑/↓ 之后都把它滚进来。
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    keepOptionVisible(activeIndex < 0 ? null : list?.querySelector(`#${optionDomId(view, activeIndex)}`))
  }, [open, activeIndex, view])

  useEffect(() => installPaletteKeys(store, document), [store])

  // 滚轮按行滑动窗口（一格一行，1–10 → 2–11），不改选中行（选中行只由键盘与点击改）。
  // 挂在整个浮层上而不是面板上：指针偏到遮罩那片留白里时，滚轮也该归浮层，不该穿到背后
  // 正文。浮层只在打开时才渲染，所以跟着 `open` 走。
  useEffect(() => {
    if (!open) return
    return installPaletteWheel(rootRef.current, rows => store.slide(rows))
  }, [open, store])

  if (!open) return null

  return (
    <div ref={rootRef} className={CLASS.overlay} {...{ [view.rootAttr]: '' }}>
      <div className={CLASS.backdrop} />
      <div
        ref={panelRef}
        className={CLASS.panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
      >
        <div className={CLASS.head}>
          <span className={CLASS.title}>{view.title}</span>
          <span className={CLASS.count}>
            {entries.length === 0 ? view.emptyCount : countLabel(view, entries.length, offset, t)}
          </span>
        </div>
        {entries.length === 0
          ? <div className={CLASS.empty}>{view.emptyHint}</div>
          : (
            <div
              ref={listRef}
              className={CLASS.list}
              role="listbox"
              aria-label={view.listLabel}
              aria-activedescendant={optionDomId(view, activeIndex)}
            >
              {visible.map((entry, index) => optionElement({
                store,
                view,
                entry,
                index: offset + index,
                active: offset + index === activeIndex,
                t,
              }))}
            </div>
          )}
        <div className={CLASS.foot}>
          <span>{t('footerMove')}</span>
          {entries.length > PAGE_SIZE ? <span>{t('footerPage')}</span> : null}
          <span>{view.enterHint}</span>
          <span>{t('footerEsc')}</span>
        </div>
      </div>
    </div>
  )
}
