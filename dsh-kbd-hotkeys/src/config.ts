/**
 * dsh-kbd-hotkeys — 键位表、组合键归一化与用户配置(localStorage)。
 *
 * 键位设计依据 docs/dsh-hotkeys-proposal.md 第 4 节(Open WebUI 打底 +
 * OpenCode/Claude Code 补充,浏览器冲突已按第 3 节重映射):
 * - `mod` 在 macOS = ⌘(Cmd),Win/Linux = Ctrl;
 * - 三态分发:态 A 审批/问题卡片打开;态 B 输入框聚焦;态 C 浏览对话;
 * - 用户可通过 localStorage 覆盖默认键位(见 README「自定义键位」)。
 */

/** 三态分发状态名。 */
export type StateName = 'A' | 'B' | 'C'

/** 单个动作定义。 */
export interface ActionDef {
  id: string
  /** 展示名(速查表 / 命令面板用)。 */
  label: string
  /** 速查表分组。 */
  group: string
  /** 允许触发的分发状态。 */
  states: StateName[]
}

/**
 * 动作注册表。question.option(数字键)与 shift+escape 为固定行为,
 * 不进 bindings 映射(见 dispatcher),但仍在 ACTIONS 中展示说明。
 */
export const ACTIONS: readonly ActionDef[] = [
  // P0 回合级高频(审批动作放行任意态:服务级 pendingSnapshot 判定,
  // 不受 React 渲染卡片时序影响;问答卡片依赖 DOM,仅态 A 固定分发)
  { id: 'approval.allow', label: '审批:允许一次', group: '审批(P0)', states: ['A', 'B', 'C'] },
  { id: 'approval.reject', label: '审批:拒绝', group: '审批(P0)', states: ['A', 'B', 'C'] },
  { id: 'question.option', label: '问题:按 1–9 选择选项', group: '问答卡片(P0)', states: ['A'] },
  { id: 'question.submit', label: '问题:Enter 确认 / 提交', group: '问答卡片(P0)', states: ['A'] },
  { id: 'session.new', label: '新建会话', group: '会话(P0)', states: ['A', 'B', 'C'] },
  // P1 会话级
  { id: 'sidebar.toggle', label: '开关侧栏', group: '会话(P1)', states: ['C'] },
  { id: 'session.prev', label: '上一个会话', group: '会话(P1)', states: ['A', 'B', 'C'] },
  { id: 'session.next', label: '下一个会话', group: '会话(P1)', states: ['A', 'B', 'C'] },
  { id: 'scroll.pageup', label: '对话上翻一页', group: '滚动(P1)', states: ['C'] },
  { id: 'scroll.pagedown', label: '对话下翻一页', group: '滚动(P1)', states: ['C'] },
  { id: 'scroll.top', label: '跳到最旧消息', group: '滚动(P1)', states: ['C'] },
  { id: 'scroll.bottom', label: '跳到最新消息', group: '滚动(P1)', states: ['C'] },
  { id: 'reply.copy', label: '复制最后回复', group: '复制(P1)', states: ['A', 'B', 'C'] },
  { id: 'code.copy', label: '复制最后代码块', group: '复制(P1)', states: ['A', 'B', 'C'] },
  { id: 'settings.open', label: '打开设置', group: '面板(P1)', states: ['A', 'B', 'C'] },
  { id: 'model.open', label: '打开模型选择器', group: '面板(P1)', states: ['B', 'C'] },
  { id: 'composer.focus', label: '聚焦输入框', group: '面板(P1)', states: ['C'] },
  { id: 'palette.toggle', label: '命令面板:搜索命令 / 切换会话', group: '面板(P1)', states: ['A', 'B', 'C'] },
  { id: 'help.toggle', label: '快捷键速查表', group: '面板(P1)', states: ['A', 'B', 'C'] },
]

export const ACTION_BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTIONS.map((a) => [a.id, a]))

/** 默认键位(动作 id → 归一化组合键)。 */
export const DEFAULT_BINDINGS: Readonly<Record<string, string>> = {
  'approval.allow': 'mod+alt+enter',
  'approval.reject': 'mod+alt+backspace',
  'session.new': 'mod+shift+o',
  'sidebar.toggle': 'mod+b',
  'session.prev': 'mod+alt+arrowleft',
  'session.next': 'mod+alt+arrowright',
  'scroll.pageup': 'pageup',
  'scroll.pagedown': 'pagedown',
  'scroll.top': 'mod+arrowup',
  'scroll.bottom': 'mod+arrowdown',
  'reply.copy': 'mod+shift+c',
  'code.copy': 'mod+shift+;',
  'settings.open': 'mod+.',
  'model.open': 'mod+alt+m',
  'composer.focus': 'mod+shift+e',
  'palette.toggle': 'mod+k',
  'help.toggle': 'mod+/',
}

const STORAGE_KEY = 'dsh-kbd-hotkeys:v1'

/** 解析后的用户配置。 */
export interface HotkeyConfig {
  enabled: boolean
  bindings: Record<string, string>
}

/** 读取 localStorage 用户配置并与默认值合并(坏数据一律回退默认)。 */
export function loadConfig(): HotkeyConfig {
  const bindings: Record<string, string> = { ...DEFAULT_BINDINGS }
  let enabled = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>
        if (typeof obj.enabled === 'boolean') enabled = obj.enabled
        if (typeof obj.bindings === 'object' && obj.bindings !== null) {
          for (const [id, combo] of Object.entries(obj.bindings as Record<string, unknown>)) {
            if (typeof combo === 'string' && combo !== '') bindings[id] = normalizeComboString(combo)
          }
        }
      }
    }
  } catch {
    // 配置损坏时静默回退默认键位
  }
  return { enabled, bindings }
}

/** 写回用户配置(总开关 / 单键位覆盖共用)。 */
export function saveConfig(config: HotkeyConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: config.enabled, bindings: config.bindings }))
  } catch {
    // 隐私模式等写入失败可忽略(仅影响持久化)
  }
}

/** macOS 判定(⌘ 与 Ctrl 的选择)。 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const source = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
  return /mac|iphone|ipad|ipod/i.test(source)
}

/** e.code → 归一化键名表(避免 Shift 产生 ':'/'?' 之类漂移)。 */
const CODE_KEYS: Readonly<Record<string, string>> = {
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Minus: '-',
  Equal: '=',
  Space: 'space',
  Enter: 'enter',
  Backspace: 'backspace',
  Escape: 'escape',
  Tab: 'tab',
  ArrowUp: 'arrowup',
  ArrowDown: 'arrowdown',
  ArrowLeft: 'arrowleft',
  ArrowRight: 'arrowright',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Home: 'home',
  End: 'end',
  Delete: 'delete',
  Insert: 'insert',
}

/** 单键归一化:优先 e.code,回退 e.key。 */
function keyTokenOf(event: KeyboardEvent): string {
  const code = event.code
  if (code !== '') {
    if (Object.prototype.hasOwnProperty.call(CODE_KEYS, code)) return CODE_KEYS[code]
    if (code.startsWith('Key')) return code.slice(3).toLowerCase()
    if (code.startsWith('Digit')) return code.slice(5)
    if (code.startsWith('Numpad') && /^[0-9]$/.test(code.slice(6))) return code.slice(6)
  }
  return event.key.toLowerCase()
}

/** 从 KeyboardEvent 归一化组合键(mod = ⌘/Ctrl,两键等价)。 */
export function comboOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(keyTokenOf(event))
  return parts.join('+')
}

/** 把用户配置里的组合键字符串归一化(如 "Cmd+Shift+O" → "mod+shift+o")。 */
export function normalizeComboString(combo: string): string {
  const key = combo.split('+').pop() ?? ''
  const parts: string[] = []
  for (const token of combo.split('+').slice(0, -1)) {
    const t = token.trim().toLowerCase()
    if (t === 'mod' || t === 'cmd' || t === 'meta' || t === 'ctrl' || t === 'control' || t === 'command') parts.push('mod')
    else if (t === 'alt' || t === 'option') parts.push('alt')
    else if (t === 'shift') parts.push('shift')
  }
  parts.push(key.trim().toLowerCase())
  return parts.join('+')
}

/** 组合键 → 展示串(速查表 / 面板用)。 */
export function prettyCombo(combo: string): string {
  const mac = isMac()
  return combo
    .split('+')
    .map((token) => {
      if (token === 'mod') return mac ? '⌘' : 'Ctrl'
      if (token === 'alt') return mac ? '⌥' : 'Alt'
      if (token === 'shift') return mac ? '⇧' : 'Shift'
      const special: Record<string, string> = {
        enter: '↵',
        backspace: '⌫',
        escape: 'Esc',
        arrowup: '↑',
        arrowdown: '↓',
        arrowleft: '←',
        arrowright: '→',
        pageup: 'PageUp',
        pagedown: 'PageDown',
        space: 'Space',
      }
      return special[token] ?? (token.length === 1 ? token.toUpperCase() : token)
    })
    .join(mac ? '' : '+')
}
