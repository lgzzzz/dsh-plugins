/**
 * 会话标题栏的「开启通知」按钮:一次点击里完成授权(requestPermission 必须在用户手势里),
 * 已授权后同一按钮即开关。状态与运行时共读同一个 store。
 * 无 locale 命名空间(纯中文图标按钮),故不注册 locale。
 */
import { createElement, useEffect, useState } from 'react'
import type { NotifyStore, NotifyStoreState } from './notify-store.ts'

/** 样式标签标识(dedup 用;client-hmr 重建时不会重复注入)。 */
const STYLE_TAG_ID = 'dsh-desktop-notify/action.css'

/** 按钮与状态点样式:内联样式表达不了 :hover / :focus-visible,故注入一次 <style>。 */
const CSS = [
  '.dsh-desktop-notify-action{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:9999px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
  '.dsh-desktop-notify-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
  '.dsh-desktop-notify-action[data-state=off]{color:var(--dsw-alias-label-dimmed)}',
  '.dsh-desktop-notify-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:1px}',
  '.dsh-desktop-notify-dot{position:absolute;top:4px;inset-inline-end:4px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary,currentColor)}',
].join('')

/** 注入一次样式(以 data-plugin-css 去重)。 */
export function ensureActionStyles(doc: Document): void {
  if (doc.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
  const tag = doc.createElement('style')
  tag.dataset.plugin = 'dsh-desktop-notify'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = CSS
  doc.head.appendChild(tag)
}

/** 按钮当前状态 → 提示文案(aria-label 与 title 共用)。 */
export function hintOf(state: NotifyStoreState): string {
  if (state.permission === 'unsupported') return '本浏览器不支持桌面通知'
  if (state.permission === 'denied') {
    return '桌面通知已被浏览器拒绝:请在 Chrome「设置 → 隐私与安全 → 网站设置 → 通知」里允许 127.0.0.1:3080,再回到本页'
  }
  if (state.permission !== 'granted') return '开启桌面通知:回合结束或需要你处理时弹系统通知'
  return state.enabled ? '桌面通知已开启,点击关闭' : '桌面通知已关闭,点击开启'
}

/** 铃铛图标(SVG 描边,跟随 currentColor)。 */
function bellIcon(): unknown {
  return createElement(
    'svg',
    {
      width: 14,
      height: 14,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    createElement('path', { d: 'M8 2.2a3.9 3.9 0 0 0-3.9 3.9c0 3-1 4.2-1 4.2h9.8s-1-1.2-1-4.2A3.9 3.9 0 0 0 8 2.2Z' }),
    createElement('path', { d: 'M6.7 12.4a1.5 1.5 0 0 0 2.6 0' }),
  )
}

/**
 * 造标题栏按钮组件(props 由 slot 注入,本组件不需要)。
 * @param store - 权限 / 开关共享状态。
 * @returns 一个 React 函数组件。
 */
export function createNotifyAction(store: NotifyStore): () => unknown {
  return function NotifyAction(): unknown {
    const [state, setState] = useState<NotifyStoreState>(() => store.getSnapshot())
    useEffect(
      () =>
        store.subscribe(() => {
          setState(store.getSnapshot())
        }),
      [],
    )

    // 没有 Notification API 的环境不占位
    if (state.permission === 'unsupported') return null
    const hint = hintOf(state)
    const on = state.permission === 'granted' && state.enabled
    const off = state.permission === 'denied' || (state.permission === 'granted' && !state.enabled)
    return createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-desktop-notify-action',
        'data-state': on ? 'on' : off ? 'off' : 'pending',
        title: hint,
        'aria-label': hint,
        onClick: () => {
          void store.activate()
        },
      },
      bellIcon(),
      state.permission === 'default' ? createElement('span', { className: 'dsh-desktop-notify-dot' }) : null,
    )
  }
}
