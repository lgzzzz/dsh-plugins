/**
 * dsh-kbd-hotkeys — 键位表、组合键归一化与用户配置(localStorage)。
 *
 * 键位取向:尽量贴合跨应用肌肉记忆(`⌘/Ctrl+B` 开关侧栏、`⌘/Ctrl+I` 聚焦输入框等),
 * 并与上游语义同源(动作名 / 服务方法名与键位一一对应),浏览器自带快捷键冲突的键位
 * 一律避开:
 * - `mod` 在 macOS = ⌘(Cmd),Win/Linux = Ctrl——`comboOf` 同时吸收 ctrlKey 与
 *   metaKey,故 macOS 上 `mod+i` 的 ⌃I 与 ⌘I 都能触发;
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
 * 动作注册表。审批卡片的 Enter/Esc 与问答卡片的四个动作(数字键 / 方向键 / Enter)
 * 为固定行为,不进 bindings 映射(见 FIXED_KEYS 与 dispatcher),但仍在 ACTIONS 中
 * 展示说明。
 */
export const ACTIONS: readonly ActionDef[] = [
  // 回合级高频:审批与问答/计划评审均为服务级应答(uiSession 待处理交互),
  // `card` 态亦由该表判定,不受 React 渲染卡片时序影响;审批 Enter/Esc 与问答的
  // 数字键/方向键/Enter 由分发器固定分发(单键不参与 bindings 覆盖,避免与输入框
  // 光标移动 / 发送消息冲突)。
  { id: 'approval.allow', label: '审批:允许一次', group: '审批', states: ['card'] },
  { id: 'approval.reject', label: '审批:拒绝', group: '审批', states: ['card'] },
  { id: 'question.option', label: '问题:按 1–9 选择选项(不翻题)', group: '问答卡片', states: ['card'] },
  { id: 'question.prev', label: '问题:← 上一题', group: '问答卡片', states: ['card'] },
  { id: 'question.next', label: '问题:→ 下一题', group: '问答卡片', states: ['card'] },
  { id: 'question.submit', label: '问题:Enter 下一题 / 末题提交', group: '问答卡片', states: ['card'] },
  // 会话级
  // 左栏为主键(⌘/Ctrl+B,跨应用肌肉记忆),右栏为派生键(⌘/Ctrl+Alt+B,叠加 alt);
  // 两者都额外放行 editing:带修饰键的组合不干扰文本编辑,与 `editing` 态
  // 「只保留带修饰键的全局组合」一致。
  { id: 'sidebar.toggle', label: '开关左侧栏', group: '会话', states: ['browse', 'editing'] },
  { id: 'sidebarRight.toggle', label: '开关右侧栏', group: '会话', states: ['browse', 'editing'] },
  // 右栏标签切换与右栏开关同为「派生面板」的键位档(mod+alt+方向键),三态均放行:
  // 焦点在输入框(editing)时带修饰键的组合不干扰文本编辑;card 态下 ← / → 虽归
  // 问答卡片,但那是**裸**方向键(固定分发),与带 mod+alt 的组合键不冲突,故无需让路。
  { id: 'sidebarRight.tabPrev', label: '右侧栏:上一个标签', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'sidebarRight.tabNext', label: '右侧栏:下一个标签', group: '会话', states: ['card', 'editing', 'browse'] },
  // 聚焦输入框只放行 browse:输入框已聚焦(editing)时该动作无意义,且 contenteditable
  // 里 ⌘/Ctrl+I 是浏览器「斜体」默认行为(execCommand,绕过 Lexical),card 态则归卡片
  // 自己的输入框。
  { id: 'composer.focus', label: '聚焦输入框', group: '会话', states: ['browse'] },
  { id: 'session.prev', label: '上一个活跃会话', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'session.next', label: '下一个活跃会话', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'session.stop', label: '停止当前会话(无审批卡片时;含运行中子代理)', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'help.toggle', label: '快捷键速查表', group: '面板', states: ['card', 'editing', 'browse'] },
]

export const ACTION_BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTIONS.map((a) => [a.id, a]))

/**
 * 固定分发的键位(单键,不进 bindings 映射,不可经 localStorage 覆盖):
 * 审批卡片 Enter = 允许一次、Esc = 拒绝;问答卡片 1–9 / ← / → / Enter。
 * 速查表按动作 id 展示这里的字面键位;loadConfig 亦按这些 id 剔除用户配置里
 * 的同名键位,确保固定分发的单键不可被自定义覆盖。
 */
export const FIXED_KEYS: Readonly<Record<string, string>> = {
  'approval.allow': 'Enter',
  'approval.reject': 'Esc',
  'question.option': '1–9',
  'question.prev': '←',
  'question.next': '→',
  'question.submit': 'Enter',
}

/** 默认键位(动作 id → 归一化组合键);固定分发的动作(见 FIXED_KEYS)不在此表。 */
export const DEFAULT_BINDINGS: Readonly<Record<string, string>> = {
  // 侧栏开关的两个键位按「主键给主面板」分配:
  // - 左栏 = ⌘/Ctrl+B:与 VS Code / Slack / 各类编辑器的侧栏开关一致,也是上游
  //   `layout.toggleSidebar()` 的本名(sidebar / sidebarCol 不带限定词就指左栏);
  // - 右栏 = ⌘/Ctrl+Alt+B:右栏在上游叫 rightbar(rightbarShown / rightbarTrack),
  //   是派生面板,拿"左栏 + alt"这一档栈式修饰键。
  'sidebar.toggle': 'mod+b',
  'sidebarRight.toggle': 'mod+alt+b',
  // 右栏标签切换 = ⌘/Ctrl+Alt+← / →:与右栏开关同一档修饰键(mod+alt),方向键
  // 表达「上一个 / 下一个」;与 ⌘/Ctrl+Alt+↑/↓ 的活跃会话跳转同族但不同轴
  // (会话轴 vs 右栏标签轴)。边缘处**循环**,只有单个标签时不吞键(见 sidebar-tabs.ts)。
  'sidebarRight.tabPrev': 'mod+alt+arrowleft',
  'sidebarRight.tabNext': 'mod+alt+arrowright',
  // 聚焦输入框 = ⌘/Ctrl+I:`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,所以
  // macOS 上 ⌃I 与 ⌘I 都能触发(用户要的 Ctrl+I 在 mac 上按 ⌃I 即可),Win/Linux
  // 就是 Ctrl+I;两平台的浏览器 DevTools 都带 Shift(⌘⌥I / Ctrl+Shift+I),不冲突。
  'composer.focus': 'mod+i',
  'session.prev': 'mod+alt+arrowup',
  'session.next': 'mod+alt+arrowdown',
  // Esc:停止当前会话的整棵运行中交互树(自身 + 直系子代理后代;one-shot 跳过)。
  // 无运行中会话时不消费该键,页面默认 Esc 行为保留(浮层打开时由浮层优先处理)。
  'session.stop': 'escape',
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
  // 固定分发动作不参与 bindings:剔除用户配置里的同名键位,
  // 避免覆盖固定分发的单键。
  for (const id of Object.keys(FIXED_KEYS)) delete bindings[id]
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

/** 把用户配置里的组合键字符串归一化(如 "Cmd+Alt+C" → "mod+alt+c";兼容 shift 修饰)。 */
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
