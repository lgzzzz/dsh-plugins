/**
 * 设置项那一行:提示文案随权限与开关状态变化,开关按钮的 `aria-label` 与 `title` 复用同一条提示。
 *
 * 样式挂在 `data-plugin-css="dsh-desktop-notify/settings.css"` 标记下,重复调用不会挂第二张表。
 */
import { createElement, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
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
  '.dsh-desktop-notify-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
  '.dsh-desktop-notify-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}',
  '.dsh-desktop-notify-switch[aria-checked=true] .dsh-desktop-notify-switch-thumb{transform:translateX(16px)}',
].join('')

export function ensureNotifySettingsStyles(doc: Document): void {
  if (doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'dsh-desktop-notify'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  doc.head.appendChild(tag)
}

export function hintOf(state: NotifyStoreState): string {
  if (state.permission === 'unsupported') return '本浏览器不支持桌面通知'
  if (state.permission === 'denied') {
    return '桌面通知已被浏览器拒绝:请在 Chrome「设置 → 隐私与安全 → 网站设置 → 通知」里允许 127.0.0.1:3080,再回到本页'
  }
  if (state.permission !== 'granted') return '开启桌面通知:回合结束或需要你处理时弹系统通知'
  return state.enabled ? '桌面通知已开启,点击关闭' : '桌面通知已关闭,点击开启'
}

export function descriptionOf(state: NotifyStoreState): string {
  if (state.permission === 'unsupported') return '本浏览器不支持桌面通知'
  if (state.permission === 'denied') {
    return '已被浏览器拒绝:请在上方站点设置里允许通知,再回到本页重新打开'
  }
  if (state.permission !== 'granted') return '开启后需要先授权(浏览器会弹出授权框)'
  return state.enabled
    ? '已开启:页面不在前台时,回合结束或需要你处理会弹系统通知'
    : '已关闭:不再发送系统通知'
}

export function createNotifySettingsRow(store: NotifyStore): () => ReactNode {
  return function NotifySettingsRow(): ReactNode {
    const [state, setState] = useState<NotifyStoreState>(() => store.getSnapshot())
    useEffect(
      () =>
        store.subscribe(() => {
          setState(store.getSnapshot())
        }),
      [],
    )

    if (state.permission === 'unsupported') return null
    const hint = hintOf(state)
    const on = state.permission === 'granted' && state.enabled
    return createElement(
      'div',
      { className: 'dsh-desktop-notify-setting' },
      createElement(
        'div',
        { className: 'dsh-desktop-notify-setting-text' },
        createElement('div', { className: 'dsh-desktop-notify-setting-title' }, '桌面通知'),
        createElement('div', { className: 'dsh-desktop-notify-setting-desc' }, descriptionOf(state)),
      ),
      createElement(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': hint,
          title: hint,
          disabled: state.permission === 'denied',
          className: 'dsh-desktop-notify-switch',
          onClick: () => {
            void store.activate()
          },
        },
        createElement('span', { className: 'dsh-desktop-notify-switch-thumb' }),
      ),
    )
  }
}
