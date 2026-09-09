/**
 * dsh-kbd-hotkeys — 键位表、组合键归一化与用户配置(localStorage)。
 *
 * 键位设计依据 docs/dsh-hotkeys-proposal.md 第 4 节(Open WebUI 打底 +
 * OpenCode/Claude Code 补充,浏览器冲突已按第 3 节重映射):
 * - `mod` 在 macOS = ⌘(Cmd),Win/Linux = Ctrl;
 * - 三态分发:`card` 卡片态(审批/问答/计划评审卡片打开)、`editing` 输入态
 *   (输入框聚焦)、`browse` 浏览态(浏览对话);
 * - 用户可通过 localStorage 覆盖默认键位(见 README「自定义键位」)。
 */

/**
 * 三态分发状态名:
 * - `card`    — 卡片态:当前会话有待处理交互(审批 / 问答 / 计划评审卡片);
 * - `editing` — 输入态:焦点在可编辑元素(输入框 / textarea / contenteditable);
 * - `browse`  — 浏览态:其余情形(浏览对话)。
 */
export type StateName = 'card' | 'editing' | 'browse'

/** 单个动作定义。 */
export interface ActionDef {
  id: string
  /** 展示名(速查表用)。 */
  label: string
  /** 速查表分组。 */
  group: string
  /** 允许触发的分发状态。 */
  states: StateName[]
}

/**
 * 动作注册表。question.option(数字键)为固定行为,不进 bindings 映射
 * (见 dispatcher),但仍在 ACTIONS 中展示说明。
 */
export const ACTIONS: readonly ActionDef[] = [
  // P0 回合级高频:审批与问答/计划评审均为服务级应答(uiSession 待处理交互),
  // `card` 态亦由该表判定,不受 React 渲染卡片时序影响;数字键/Enter 由分发器固定分发。
  { id: 'approval.allow', label: '审批:允许一次', group: '审批(P0)', states: ['card', 'editing', 'browse'] },
  { id: 'approval.reject', label: '审批:拒绝', group: '审批(P0)', states: ['card', 'editing', 'browse'] },
  { id: 'question.option', label: '问题:按 1–9 选择选项', group: '问答卡片(P0)', states: ['card'] },
  { id: 'question.submit', label: '问题:Enter 确认 / 提交', group: '问答卡片(P0)', states: ['card'] },
  // P1 会话级
  // sidebar.toggle 额外放行 editing:⌘/Ctrl+B 在输入框聚焦时同样开关侧栏
  // (带修饰键的组合不干扰文本编辑,与 `editing` 态「只保留带修饰键的全局组合」一致)。
  { id: 'sidebar.toggle', label: '开关侧栏', group: '会话(P1)', states: ['browse', 'editing'] },
  { id: 'session.prev', label: '上一个活跃会话', group: '会话(P1)', states: ['card', 'editing', 'browse'] },
  { id: 'session.next', label: '下一个活跃会话', group: '会话(P1)', states: ['card', 'editing', 'browse'] },
  { id: 'session.stop', label: '停止当前会话(含运行中子代理)', group: '会话(P1)', states: ['card', 'editing', 'browse'] },
  { id: 'view.prev', label: '上一个会话视图标签', group: '会话视图(P1)', states: ['card', 'editing', 'browse'] },
  { id: 'view.next', label: '下一个会话视图标签', group: '会话视图(P1)', states: ['card', 'editing', 'browse'] },
  { id: 'help.toggle', label: '快捷键速查表', group: '面板(P1)', states: ['card', 'editing', 'browse'] },
]

export const ACTION_BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTIONS.map((a) => [a.id, a]))

/** 默认键位(动作 id → 归一化组合键)。 */
export const DEFAULT_BINDINGS: Readonly<Record<string, string>> = {
  'approval.allow': 'mod+alt+enter',
  'approval.reject': 'mod+alt+backspace',
  'sidebar.toggle': 'mod+b',
  'session.prev': 'mod+alt+arrowup',
  'session.next': 'mod+alt+arrowdown',
  // Esc:停止当前会话的整棵运行中交互树(自身 + 直系子代理后代;one-shot 跳过)。
  // 无运行中会话时不消费该键,页面默认 Esc 行为保留(浮层打开时由浮层优先处理)。
  'session.stop': 'escape',
  'view.prev': 'mod+alt+arrowleft',
  'view.next': 'mod+alt+arrowright',
  'help.toggle': 'mod+/',
}

/**
 * 反向索引:归一化组合键 → 动作 id。
 * config.bindings 全表语义为「动作 id → 组合键」(overlay.ts 的速查表按
 * 动作 id 取键位),按键分发需要按 combo 反查动作,故在此构建一次索引;
 * bindings 变更(仅 localStorage 覆盖,刷新后经 loadConfig 重建)须同步重建。
 */
export function comboActionMap(bindings: Readonly<Record<string, string>>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [id, combo] of Object.entries(bindings)) {
    if (combo !== '') map.set(combo, id)
  }
  return map
}

const STORAGE_KEY = 'dsh-kbd-hotkeys:v1'

/** 解析后的用户配置(快捷键默认启用,无总开关;bindings 可经 localStorage 覆盖)。 */
export interface HotkeyConfig {
  bindings: Record<string, string>
}

/** 读取 localStorage 用户配置并与默认值合并(坏数据一律回退默认)。 */
export function loadConfig(): HotkeyConfig {
  const bindings: Record<string, string> = { ...DEFAULT_BINDINGS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        const obj = parsed as Record<string, unknown>
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
  return { bindings }
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

/** 把用户配置里的组合键字符串归一化(如 "Cmd+Alt+C" → "mod+alt+c";旧配置中的 shift 也解析)。 */
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
