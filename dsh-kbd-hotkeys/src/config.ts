/** 键位表 / 归一化 / localStorage 自定义;单修饰键给全局动作,mod+alt 给导航(浏览器保留键见 README)。 */

/** 三态分发状态名(card 卡片 / editing 输入 / browse 浏览)。 */
export type StateName = 'card' | 'editing' | 'browse'

export interface ActionDef {
  id: string
  /** 展示名(速查表用)。 */
  label: string
  group: string
  states: StateName[]
}

/** 动作注册表;固定分发的单键(见 FIXED_KEYS)也在此展示说明。 */
export const ACTIONS: readonly ActionDef[] = [
  // 回合级:服务级应答,单键固定分发,不进 bindings
  { id: 'approval.allow', label: '审批:允许一次', group: '审批', states: ['card'] },
  { id: 'approval.reject', label: '审批:拒绝', group: '审批', states: ['card'] },
  { id: 'question.option', label: '问题:按 1–9 选择选项(不翻题)', group: '问答卡片', states: ['card'] },
  { id: 'question.prev', label: '问题:← 上一题', group: '问答卡片', states: ['card'] },
  { id: 'question.next', label: '问题:→ 下一题', group: '问答卡片', states: ['card'] },
  { id: 'question.submit', label: '问题:Enter 下一题 / 末题提交', group: '问答卡片', states: ['card'] },
  // 左 B(肌肉记忆) / 右 O(Open panel);带修饰键不干扰编辑,故放行 editing
  { id: 'sidebar.toggle', label: '开关左侧栏', group: '会话', states: ['browse', 'editing'] },
  { id: 'sidebarRight.toggle', label: '开关右侧栏', group: '会话', states: ['browse', 'editing'] },
  // mod+alt+←/→:方向键轴归导航;card 裸键归卡片,不冲突
  { id: 'sidebarRight.tabPrev', label: '右侧栏:上一个标签', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'sidebarRight.tabNext', label: '右侧栏:下一个标签', group: '会话', states: ['card', 'editing', 'browse'] },
  // 定位文件浏览器(已有则聚焦,无则创建)并置顶
  { id: 'sidebarRight.files', label: '右侧栏:定位文件浏览器(不存在则创建)并置顶', group: '会话', states: ['card', 'editing', 'browse'] },
  // 定位终端但不去重、不置顶,故先读 store 认页
  { id: 'sidebarRight.terminal', label: '右侧栏:定位终端并聚焦(不存在则新建)', group: '会话', states: ['card', 'editing', 'browse'] },
  // 关当前标签;上游拒关「独占停靠的 guide」,被拒即 no-op 不吞键
  { id: 'sidebarRight.closeTab', label: '右侧栏:关闭当前标签', group: '会话', states: ['card', 'editing', 'browse'] },
  // 等同侧栏「新建会话」按钮(uiWorkspace.startSession)
  { id: 'session.new', label: '新建会话并跳转', group: '会话', states: ['card', 'editing', 'browse'] },
  // mod+J 焦点跳回输入框;editing 仅在焦点不在 composer 内时执行
  { id: 'composer.focus', label: '聚焦输入框', group: '会话', states: ['browse', 'editing'] },
  { id: 'session.prev', label: '上一个活跃会话', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'session.next', label: '下一个活跃会话', group: '会话', states: ['card', 'editing', 'browse'] },
  // mod+K:浮窗内 ↑↓ 只移高亮,Enter 才 openWorkspace
  { id: 'workspace.pick', label: '切换工作区(浮窗:↑↓ 选择、Enter 切换)', group: '会话', states: ['card', 'editing', 'browse'] },
  // mod+M:与上游两个入口共用同一 per-session 目录
  { id: 'model.pick', label: '切换模型(浮窗:↑↓ 选择、Enter 切换)', group: '会话', states: ['card', 'editing', 'browse'] },
  // mod+I:浮窗内 ↑↓ 只移高亮,Enter 才 openSession
  { id: 'session.recent', label: '近期对话(浮窗:按工作区分组、↑↓ 选择、Enter 打开)', group: '会话', states: ['card', 'editing', 'browse'] },
  // ⇧Tab 是编辑核心键,仅 browse / editing,且 editing 需焦点在 composer 内
  { id: 'model.effortNext', label: '循环切换思考强度(⇧Tab;仅输入框/浏览态)', group: '会话', states: ['browse', 'editing'] },
  { id: 'session.stop', label: '停止当前会话(无审批卡片时;含运行中子代理)', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'help.toggle', label: '快捷键速查表', group: '面板', states: ['card', 'editing', 'browse'] },
]

export const ACTION_BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTIONS.map((a) => [a.id, a]))

/** 固定分发的单键(不可被 localStorage 覆盖);loadConfig 会剔除同名自定义。 */
export const FIXED_KEYS: Readonly<Record<string, string>> = {
  'approval.allow': 'Enter',
  'approval.reject': 'Esc',
  'question.option': '1–9',
  'question.prev': '←',
  'question.next': '→',
  'question.submit': 'Enter',
}

/** 默认键位(动作 id → 组合键);固定分发动作不在表内。 */
export const DEFAULT_BINDINGS: Readonly<Record<string, string>> = {
  // 左 = B(跨应用肌肉记忆),右 = O(Open panel)
  'sidebar.toggle': 'mod+b',
  'sidebarRight.toggle': 'mod+o',
  // 右栏标签轴;边缘循环,单标签不吞键
  'sidebarRight.tabPrev': 'mod+alt+arrowleft',
  'sidebarRight.tabNext': 'mod+alt+arrowright',
  // 反斜杠走物理键位(code),与布局字符无关
  'sidebarRight.files': 'mod+\\',
  // 浏览器保留键(聚焦地址栏)
  'sidebarRight.terminal': 'mod+l',
  // 点号 = 关闭/取消联想:按 code 判定(Period),不受布局影响
  'sidebarRight.closeTab': 'mod+.',
  // 浏览器保留键(新建窗口)
  'session.new': 'mod+n',
  // J = Jump;终端里 ⌃J(LF)不再送给 PTY
  'composer.focus': 'mod+j',
  'session.prev': 'mod+alt+arrowup',
  'session.next': 'mod+alt+arrowdown',
  // 浏览器保留键(地址栏搜索)
  'workspace.pick': 'mod+k',
  // M = Model
  'model.pick': 'mod+m',
  // I = Input/会话;抢了 contenteditable 的斜体默认键
  'session.recent': 'mod+i',
  // 免鼠标循环强度;no-op 时不吞键
  'model.effortNext': 'shift+tab',
  // 只停运行中的会话树;无运行中会话不吞键
  'session.stop': 'escape',
  'help.toggle': 'mod+/',
}

/** 反向索引 combo → 动作 id(bindings 变更后须重建)。 */
export function comboActionMap(bindings: Readonly<Record<string, string>>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [id, combo] of Object.entries(bindings)) {
    if (combo !== '') map.set(combo, id)
  }
  return map
}

const STORAGE_KEY = 'dsh-kbd-hotkeys:v1'

/** 解析后的用户配置(bindings 可经 localStorage 覆盖)。 */
export interface HotkeyConfig {
  bindings: Record<string, string>
}

/** 读 localStorage 并与默认值合并(坏数据回退默认)。 */
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
    // 坏数据静默回退默认
  }
  // 固定分发动作不参与 bindings,剔除同名键位
  for (const id of Object.keys(FIXED_KEYS)) delete bindings[id]
  return { bindings }
}

/** 平台判定(mac 上 mod 展示为 ⌘)。 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const source = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
  return /mac|iphone|ipad|ipod/i.test(source)
}

/** e.code → 归一化键名(避免 Shift 产生字符漂移)。 */
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

/** 归一化组合键(mod = ⌘/Ctrl,两键等价)。 */
export function comboOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(keyTokenOf(event))
  return parts.join('+')
}

/** 用户配置串归一化("Cmd+Alt+C" → "mod+alt+c")。 */
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
