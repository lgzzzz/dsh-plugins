/**
 * 设置项那一行：提示文案随权限与开关状态变化，开关按钮的 `aria-label` 与 `title` 复用同一条提示。
 *
 * 文案走 Client locale（`t` 由注册项的 `locale:` 座位交进来；测试等无槽位环境用简体中文兜底），
 * 样式挂在 `data-plugin-css="dsh-desktop-notify/settings.css"` 标记下，重复调用不会挂第二张表。
 */
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { translateZh, type NotifyLocaleNS } from './locales.ts'
import type { NotifyStore, NotifyStoreState } from './notify-store.ts'

const STYLE_TAG_ID = 'dsh-desktop-notify/settings.css'

const CSS = [
  '.dsh-desktop-notify-setting{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
  '.dsh-desktop-notify-setting-text{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px}',
  '.dsh-desktop-notify-setting-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}',
  '.dsh-desktop-notify-setting-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
  '.dsh-desktop-notify-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3);cursor:pointer}',
  '.dsh-desktop-notify-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}',
  '.dsh-desktop-notify-switch:disabled{cursor:default;opacity:.5}',
  '.dsh-desktop-notify-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color);outline-offset:2px}',
  '.dsh-desktop-notify-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}',
  '.dsh-desktop-notify-switch[aria-checked=true] .dsh-desktop-notify-switch-thumb{transform:translateX(16px)}',
].join('')

/** 组件 props：槽位文档提供 `t`；测试等直接调用时可省略，退回简体中文。 */
export interface NotifySettingsRowProps {
  readonly t?: TranslateNS<NotifyLocaleNS>
}

type Translate = TranslateNS<NotifyLocaleNS>

export function ensureNotifySettingsStyles(doc: Document): void {
  if (doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'dsh-desktop-notify'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  doc.head.appendChild(tag)
}

/**
 * 开关按钮上的提示（`aria-label` / `title`）。
 *
 * @param state - 权限与开关快照。
 * @param t - 翻译函数。
 * @param origin - 站点源（拒绝提示里指向它）。
 */
export function hintOf(state: NotifyStoreState, t: Translate, origin: string): string {
  if (state.permission === 'unsupported') return t('hintUnsupported')
  if (state.permission === 'denied') return t('hintDenied', { origin })
  if (state.permission !== 'granted') return t('hintPrompt')
  return state.enabled ? t('hintOn') : t('hintOff')
}

/**
 * 行内的说明文案。
 *
 * @param state - 权限与开关快照。
 * @param t - 翻译函数。
 */
export function descriptionOf(state: NotifyStoreState, t: Translate): string {
  if (state.permission === 'unsupported') return t('descUnsupported')
  if (state.permission === 'denied') return t('descDenied')
  if (state.permission !== 'granted') return t('descPrompt')
  return state.enabled ? t('descOn') : t('descOff')
}

/**
 * 构造设置行组件。
 *
 * @param store - 权限与开关快照的外部 store。
 * @param origin - 站点源，写进「已被拒绝」的提示。
 * @returns 注册进 `settings.general.item` 的组件。
 */
export function createNotifySettingsRow(
  store: NotifyStore,
  origin = typeof window === 'undefined' ? '' : (window.location?.origin ?? ''),
): (props: NotifySettingsRowProps) => ReactNode {
  return function NotifySettingsRow({ t = translateZh }: NotifySettingsRowProps = {}): ReactNode {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

    if (state.permission === 'unsupported') return null
    const hint = hintOf(state, t, origin)
    const on = state.permission === 'granted' && state.enabled
    return (
      <div className="dsh-desktop-notify-setting">
        <div className="dsh-desktop-notify-setting-text">
          <div className="dsh-desktop-notify-setting-title">{t('title')}</div>
          <div className="dsh-desktop-notify-setting-desc">{descriptionOf(state, t)}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={hint}
          title={hint}
          disabled={state.permission === 'denied'}
          className="dsh-desktop-notify-switch"
          onClick={() => {
            void store.activate()
          }}
        >
          <span className="dsh-desktop-notify-switch-thumb" />
        </button>
      </div>
    )
  }
}
