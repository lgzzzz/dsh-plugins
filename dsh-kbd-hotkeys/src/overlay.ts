/**
 * dsh-kbd-hotkeys — 轻量浮层:快捷键速查表(⌘/)与操作提示。
 *
 * 纯 DOM 实现(不消费 react,与 dsh-code-card-fonts 同策略):样式走 <style>
 * 标签 + 主题变量(--dsw-*),卸载时随 ctx.effect disposer 一并回收。
 * 浮层打开时进入模态分发:按键先交给 handleKey(),未处理且焦点在浮层内的
 * 交给浮层自身,其余吞掉,避免误触发页面快捷键。
 */
import { ACTIONS, HIDDEN_FROM_HELP_WHEN_UNBOUND, prettyCombo, type HotkeyConfig } from './config.ts'

/** 浮层依赖。 */
export interface OverlayDeps {
  getConfig(): HotkeyConfig
}

/** 浮层宿主面。 */
export interface OverlayHost {
  isOpen(): boolean
  contains(target: Node | null): boolean
  /** 浮层打开时的按键处理;返回 true 表示已消费。 */
  handleKey(event: KeyboardEvent): boolean
  toggleHelp(): void
  destroy(): void
}

const STYLE_ID = 'dsh-kbd-hotkeys/style'

const STYLE = [
  '.dsh-kbd-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font-family:var(--dsw-font-family,system-ui,-apple-system,sans-serif)}',
  '.dsh-kbd-panel{width:min(560px,calc(100vw - 48px));max-height:64vh;background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.25));border-radius:14px;display:flex;flex-direction:column;overflow:hidden}',
  '.dsh-kbd-help{padding:14px 18px;overflow-y:auto}',
  '.dsh-kbd-help h3{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-help h3:first-child{margin-top:0}',
  '.dsh-kbd-helpRow{display:flex;align-items:center;gap:12px;padding:5px 0;font-size:13px}',
  '.dsh-kbd-helpRow .dsh-kbd-itemLabel{flex:1}',
  '.dsh-kbd-help kbd{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;line-height:18px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-bottom-width:2px;border-radius:6px;background:var(--dsw-alias-bg-base,transparent)}',
].join('\n')

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = STYLE
  document.head.appendChild(tag)
}

/** 创建浮层宿主(速查表 + 样式标签)。 */
export function createOverlays(deps: OverlayDeps): OverlayHost {
  ensureStyle()

  let root: HTMLDivElement | null = null
  let open = false

  function isOpen(): boolean {
    return open
  }

  function contains(target: Node | null): boolean {
    return root !== null && target !== null && root.contains(target)
  }

  function close(): void {
    if (root !== null) root.remove()
    root = null
    open = false
  }

  function mount(): void {
    close()
    ensureStyle()
    const backdrop = document.createElement('div')
    backdrop.className = 'dsh-kbd-backdrop'
    const panel = document.createElement('div')
    panel.className = 'dsh-kbd-panel'
    panel.appendChild(renderHelp())
    backdrop.appendChild(panel)
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close()
    })
    document.body.appendChild(backdrop)
    root = backdrop
    open = true
  }

  function renderHelp(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'dsh-kbd-help'
    const config = deps.getConfig()
    let lastGroup = ''
    for (const action of ACTIONS) {
      // 已移除默认键位且未自绑定的动作不展示(自绑定后恢复展示)
      if (
        HIDDEN_FROM_HELP_WHEN_UNBOUND.has(action.id) &&
        (config.bindings[action.id] === undefined || config.bindings[action.id] === '')
      ) {
        continue
      }
      if (action.group !== lastGroup) {
        lastGroup = action.group
        const heading = document.createElement('h3')
        heading.textContent = action.group
        container.appendChild(heading)
      }
      const row = document.createElement('div')
      row.className = 'dsh-kbd-helpRow'
      const label = document.createElement('span')
      label.className = 'dsh-kbd-itemLabel'
      label.textContent = action.label
      const key = document.createElement('kbd')
      const combo = config.bindings[action.id]
      key.textContent =
        action.id === 'question.option' || action.id === 'question.submit'
          ? action.id === 'question.option'
            ? '1–9'
            : 'Enter'
          : combo === undefined
            ? '未绑定'
            : prettyCombo(combo)
      row.appendChild(label)
      row.appendChild(key)
      container.appendChild(row)
    }
    return container
  }

  function toggleHelp(): void {
    if (open) close()
    else mount()
  }

  /** 浮层打开时的按键分发。 */
  function handleKey(event: KeyboardEvent): boolean {
    if (!open) return false
    if (event.key === 'Escape') {
      close()
      return true
    }
    const combo = `${event.ctrlKey || event.metaKey ? 'mod+' : ''}${event.altKey ? 'alt+' : ''}${event.shiftKey ? 'shift+' : ''}${event.key.toLowerCase()}`
    if (combo === 'mod+/') {
      close()
      return true
    }
    return false
  }

  function destroy(): void {
    close()
    document.getElementById(STYLE_ID)?.remove()
  }

  return { isOpen, contains, handleKey, toggleHelp, destroy }
}