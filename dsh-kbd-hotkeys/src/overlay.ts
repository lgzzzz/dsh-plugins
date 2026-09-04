/**
 * dsh-kbd-hotkeys — 轻量浮层:命令面板(⌘K)、快捷键速查表(⌘/)与操作提示。
 *
 * 纯 DOM 实现(不消费 react,与 dsh-code-card-fonts 同策略):样式走 <style>
 * 标签 + 主题变量(--dsw-*),卸载时随 ctx.effect disposer 一并回收。
 * 浮层打开时进入模态分发:按键先交给 handleKey(),未处理且焦点在浮层内的
 * 交给浮层自身(面板输入框),其余吞掉,避免误触发页面快捷键。
 */
import { ACTIONS, prettyCombo, type HotkeyConfig } from './config.ts'
import type { SessionSummaryLike, Services } from './types.ts'

/** 浮层依赖。 */
export interface OverlayDeps {
  services: Services
  getConfig(): HotkeyConfig
  setEnabled(enabled: boolean): void
  runAction(id: string): boolean
}

/** 浮层宿主面。 */
export interface OverlayHost {
  isOpen(): boolean
  contains(target: Node | null): boolean
  /** 浮层打开时的按键处理;返回 true 表示已消费。 */
  handleKey(event: KeyboardEvent): boolean
  togglePalette(): void
  toggleHelp(): void
  destroy(): void
}

const STYLE_ID = 'dsh-kbd-hotkeys/style'

const STYLE = [
  '.dsh-kbd-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font-family:var(--dsw-font-family,system-ui,-apple-system,sans-serif)}',
  '.dsh-kbd-panel{width:min(560px,calc(100vw - 48px));max-height:64vh;background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.25));border-radius:14px;display:flex;flex-direction:column;overflow:hidden}',
  '.dsh-kbd-input{border:none;outline:none;background:transparent;color:inherit;font:inherit;font-size:15px;padding:14px 18px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}',
  '.dsh-kbd-input::placeholder{color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-list{margin:0;padding:6px;list-style:none;overflow-y:auto;flex:1;min-height:0}',
  '.dsh-kbd-item{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;color:inherit;font:inherit;font-size:13px;line-height:20px;padding:9px 12px;border-radius:8px;cursor:pointer}',
  '.dsh-kbd-item[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}',
  '.dsh-kbd-itemLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-kbd-itemHint{flex:none;color:var(--dsw-alias-label-tertiary,#999);font-size:11px}',
  '.dsh-kbd-item kbd,.dsh-kbd-help kbd{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;line-height:18px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-bottom-width:2px;border-radius:6px;background:var(--dsw-alias-bg-base,transparent)}',
  '.dsh-kbd-foot{flex:none;padding:8px 16px;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08))}',
  '.dsh-kbd-empty{padding:24px 16px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;text-align:center}',
  '.dsh-kbd-help{padding:14px 18px;overflow-y:auto}',
  '.dsh-kbd-help h3{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-help h3:first-child{margin-top:0}',
  '.dsh-kbd-helpRow{display:flex;align-items:center;gap:12px;padding:5px 0;font-size:13px}',
  '.dsh-kbd-helpRow .dsh-kbd-itemLabel{flex:1}',
  '.dsh-kbd-helpSwitch{display:flex;align-items:center;gap:8px;padding:10px 0 2px;font-size:13px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.08));margin-top:12px}',
  '.dsh-kbd-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483001;background:var(--dsw-alias-label-primary,#222);color:var(--dsw-alias-bg-base,#fff);font-size:12px;line-height:18px;padding:6px 14px;border-radius:999px;opacity:0;transition:opacity .15s;pointer-events:none}',
  '.dsh-kbd-toast[data-show="true"]{opacity:.92}',
].join('\n')

/** 短暂操作提示。 */
export function showToast(message: string): void {
  const toast = document.createElement('div')
  toast.className = 'dsh-kbd-toast'
  toast.textContent = message
  document.body.appendChild(toast)
  requestAnimationFrame(() => {
    toast.dataset.show = 'true'
  })
  window.setTimeout(() => {
    toast.dataset.show = 'false'
    window.setTimeout(() => {
      toast.remove()
    }, 200)
  }, 1400)
}

interface PaletteItem {
  kind: 'action' | 'session'
  id: string
  label: string
  hint: string
  sessionId?: string
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = STYLE
  document.head.appendChild(tag)
}

function sessionLabel(summary: SessionSummaryLike | undefined, id: string): string {
  const named = summary?.displayTitle ?? summary?.title
  return named === undefined || named === '' ? id : named
}

/** 创建浮层宿主(面板 + 速查表 + 样式标签)。 */
export function createOverlays(deps: OverlayDeps): OverlayHost {
  ensureStyle()

  let root: HTMLDivElement | null = null
  let mode: 'palette' | 'help' | null = null
  let input: HTMLInputElement | null = null
  let list: HTMLUListElement | null = null
  let items: PaletteItem[] = []
  let activeIndex = 0

  function isOpen(): boolean {
    return mode !== null
  }

  function contains(target: Node | null): boolean {
    return root !== null && target !== null && root.contains(target)
  }

  function close(): void {
    if (root !== null) root.remove()
    root = null
    mode = null
    input = null
    list = null
    items = []
  }

  function mount(nextMode: 'palette' | 'help'): void {
    close()
    ensureStyle()
    const backdrop = document.createElement('div')
    backdrop.className = 'dsh-kbd-backdrop'
    const panel = document.createElement('div')
    panel.className = 'dsh-kbd-panel'
    backdrop.appendChild(panel)

    if (nextMode === 'palette') {
      input = document.createElement('input')
      input.className = 'dsh-kbd-input'
      input.placeholder = '搜索命令或会话…(↑↓ 选择,Enter 确认)'
      input.addEventListener('input', () => renderPalette())
      panel.appendChild(input)
      list = document.createElement('ul')
      list.className = 'dsh-kbd-list'
      panel.appendChild(list)
      const foot = document.createElement('div')
      foot.className = 'dsh-kbd-foot'
      foot.textContent = 'Enter 确认 · ↑↓ 选择 · Esc 关闭'
      panel.appendChild(foot)
    } else {
      panel.appendChild(renderHelp())
    }

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close()
    })
    document.body.appendChild(backdrop)
    root = backdrop
    mode = nextMode
    if (nextMode === 'palette') {
      renderPalette()
      input?.focus()
    }
  }

  function buildItems(): PaletteItem[] {
    const result: PaletteItem[] = []
    // 全局可用动作(states 含 C)
    for (const action of ACTIONS) {
      if (!action.states.includes('C')) continue
      if (action.id === 'palette.toggle' || action.id === 'help.toggle') continue
      const combo = deps.getConfig().bindings[action.id]
      result.push({
        kind: 'action',
        id: action.id,
        label: action.label,
        hint: combo === undefined ? '' : prettyCombo(combo),
      })
    }
    // 会话(当前会话置顶,其余按更新时间倒序,最多 40 条)
    const snapshot = deps.services.sessions?.list?.getSnapshot?.()
    const ids = snapshot?.ids ?? []
    const byId = snapshot?.byId ?? {}
    const current = snapshot?.current
    const summaries = ids
      .map((id) => byId[id])
      .filter((s): s is SessionSummaryLike => s !== undefined)
      .sort((left, right) => {
        if (left.id === current) return -1
        if (right.id === current) return 1
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      })
      .slice(0, 40)
    for (const summary of summaries) {
      result.push({
        kind: 'session',
        id: summary.id,
        sessionId: summary.id,
        label: sessionLabel(summary, summary.id),
        hint: summary.id === current ? '当前' : summary.running === true ? '运行中' : '',
      })
    }
    return result
  }

  function renderPalette(): void {
    if (list === null) return
    const query = (input?.value ?? '').trim().toLowerCase()
    items = buildItems().filter((item) => query === '' || item.label.toLowerCase().includes(query))
    if (activeIndex >= items.length) activeIndex = 0
    list.textContent = ''
    if (items.length === 0) {
      const empty = document.createElement('li')
      empty.className = 'dsh-kbd-empty'
      empty.textContent = '无匹配命令或会话'
      list.appendChild(empty)
      return
    }
    items.forEach((item, index) => {
      const li = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-kbd-item'
      button.dataset.active = String(index === activeIndex)
      const label = document.createElement('span')
      label.className = 'dsh-kbd-itemLabel'
      label.textContent = item.label
      const hint = document.createElement('span')
      hint.className = 'dsh-kbd-itemHint'
      hint.textContent = item.hint
      button.appendChild(label)
      button.appendChild(hint)
      button.addEventListener('click', () => {
        activate(index)
      })
      button.addEventListener('mousemove', () => {
        if (activeIndex !== index) {
          activeIndex = index
          syncActive()
        }
      })
      li.appendChild(button)
      list?.appendChild(li)
    })
  }

  function syncActive(): void {
    if (list === null) return
    const buttons = list.querySelectorAll<HTMLButtonElement>('.dsh-kbd-item')
    buttons.forEach((button, index) => {
      button.dataset.active = String(index === activeIndex)
      if (index === activeIndex) button.scrollIntoView({ block: 'nearest' })
    })
  }

  function activate(index: number): void {
    const item = items[index]
    if (item === undefined) return
    if (item.kind === 'action') {
      const handled = deps.runAction(item.id)
      if (!handled) return
      close()
      return
    }
    const sessions = deps.services.sessions
    if (sessions !== null && sessions !== undefined && typeof sessions.open === 'function' && item.sessionId !== undefined) {
      sessions.open(item.sessionId)
    }
    close()
  }

  function renderHelp(): HTMLElement {
    const container = document.createElement('div')
    container.className = 'dsh-kbd-help'
    const config = deps.getConfig()
    let lastGroup = ''
    for (const action of ACTIONS) {
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
    const hint = document.createElement('div')
    hint.className = 'dsh-kbd-helpRow'
    const hintLabel = document.createElement('span')
    hintLabel.className = 'dsh-kbd-itemLabel'
    hintLabel.textContent = '此外:Esc 中断回合(由 dsh-new-session 提供);Shift+Esc 聚焦输入框'
    const hintKey = document.createElement('kbd')
    hintKey.textContent = 'Esc'
    hint.appendChild(hintLabel)
    hint.appendChild(hintKey)
    container.appendChild(hint)

    const switchRow = document.createElement('label')
    switchRow.className = 'dsh-kbd-helpSwitch'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = config.enabled
    checkbox.addEventListener('change', () => {
      deps.setEnabled(checkbox.checked)
      showToast(checkbox.checked ? '快捷键已启用' : '快捷键已停用')
    })
    const switchLabel = document.createElement('span')
    switchLabel.textContent = '启用全部快捷键(总开关)'
    switchRow.appendChild(checkbox)
    switchRow.appendChild(switchLabel)
    container.appendChild(switchRow)

    const note = document.createElement('div')
    note.className = 'dsh-kbd-foot'
    note.textContent = '自定义键位:localStorage["dsh-kbd-hotkeys:v1"] 的 bindings 字段(见插件 README)'
    container.appendChild(note)
    return container
  }

  function togglePalette(): void {
    if (mode === 'palette') close()
    else mount('palette')
  }

  function toggleHelp(): void {
    if (mode === 'help') close()
    else mount('help')
  }

  /** 浮层打开时的按键分发。 */
  function handleKey(event: KeyboardEvent): boolean {
    if (mode === null) return false
    const combo = `${event.ctrlKey || event.metaKey ? 'mod+' : ''}${event.altKey ? 'alt+' : ''}${event.shiftKey ? 'shift+' : ''}${event.key.toLowerCase()}`
    if (event.key === 'Escape') {
      close()
      return true
    }
    if (combo === 'mod+k' || combo === 'mod+/') {
      close()
      return true
    }
    if (mode === 'palette') {
      if (event.key === 'ArrowDown') {
        if (items.length > 0) {
          activeIndex = (activeIndex + 1) % items.length
          syncActive()
        }
        return true
      }
      if (event.key === 'ArrowUp') {
        if (items.length > 0) {
          activeIndex = (activeIndex - 1 + items.length) % items.length
          syncActive()
        }
        return true
      }
      if (event.key === 'Enter') {
        activate(activeIndex)
        return true
      }
    }
    return false
  }

  function destroy(): void {
    close()
    document.getElementById(STYLE_ID)?.remove()
  }

  return { isOpen, contains, handleKey, togglePalette, toggleHelp, destroy }
}
