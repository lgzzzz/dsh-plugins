/**
 * dsh-kbd-hotkeys — 键位表、组合键归一化与用户配置(localStorage)。
 *
 * 键位取向:尽量贴合跨应用肌肉记忆(`⌘/Ctrl+B` 开关左栏、`⌘/Ctrl+O` 开关右栏等),
 * 并与上游语义同源(动作名 / 服务方法名与键位一一对应)。
 * 分档:**单修饰键 `mod+键` 给全局动作**(左栏 `B`、右栏 `O`、工作区 `K`、模型 `M`、
 * 新建会话 `N`、焦点跳转 `J`、文件浏览器 `\`、终端 `L`、速查表 `/`),**`mod+alt` 这一档留给导航**
 * (右栏标签 `←`/`→`、会话跳转 `↑`/`↓`);两档都取 `event.code` 的物理键位。
 * 需要留意的是浏览器自带快捷键:本插件在 document 捕获阶段先 `preventDefault`,
 * 但 `⌘/Ctrl+O`(打开文件)、`⌘/Ctrl+K`(地址栏搜索)属浏览器保留键,详见 README
 * 「已知限制」。
 * - `mod` 在 macOS = ⌘(Cmd),Win/Linux = Ctrl——`comboOf` 同时吸收 ctrlKey 与
 *   metaKey,故 macOS 上 `mod+j` 的 ⌃J 与 ⌘J 都能触发;
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
  // 左栏为 ⌘/Ctrl+B、右栏为 ⌘/Ctrl+O(`O` = 打开 / 开合面板,Open panel;
  // 也避免把右栏塞进 `mod+alt` 那一档而占用方向键族的语义)。
  // 两者都额外放行 editing:带修饰键的组合不干扰文本编辑,与 `editing` 态
  // 「只保留带修饰键的全局组合」一致。
  { id: 'sidebar.toggle', label: '开关左侧栏', group: '会话', states: ['browse', 'editing'] },
  { id: 'sidebarRight.toggle', label: '开关右侧栏', group: '会话', states: ['browse', 'editing'] },
  // 右栏标签切换 = ⌘/Ctrl+Alt+← / →:走 mod+alt 这一档(与右栏开关、文件浏览器的
  // 单修饰键区分开),因为方向键在 `mod+alt` 里已成体系——←/→ 是右栏内的标签轴,
  // ↑/↓ 是左栏里的会话轴,两者都放行三态:
  // 焦点在输入框(editing)时带修饰键的组合不干扰文本编辑;card 态下 ← / → 虽归
  // 问答卡片,但那是**裸**方向键(固定分发),与带 mod+alt 的组合键不冲突,故无需让路。
  { id: 'sidebarRight.tabPrev', label: '右侧栏:上一个标签', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'sidebarRight.tabNext', label: '右侧栏:下一个标签', group: '会话', states: ['card', 'editing', 'browse'] },
  // 定位右栏文件浏览器(⌘/Ctrl+\):与右栏开关(⌘/Ctrl+O)同为「右栏」这一族
  // (单修饰键),同样三态放行——带修饰键的组合既不与卡片的裸 ← / → / 数字键冲突,
  // 也不干扰文本编辑。语义是「定位」而非「开关」:该面板已有文件浏览器页就聚焦它,
  // 没有就在面板末尾创建(上游 openTab 按目标面板去重),再加一步置顶。
  { id: 'sidebarRight.files', label: '右侧栏:定位文件浏览器(不存在则创建)并置顶', group: '会话', states: ['card', 'editing', 'browse'] },
  // 定位右栏终端(⌘/Ctrl+L):与文件浏览器定位(⌘/Ctrl+\)同族,同为「定位」语义,
  // 但**不做置顶**(终端是 multiple 页,用户可能开着多个,热键不替用户重排顺序)。
  // 关键差异见 sidebar-tabs.ts 的 revealRightSidebarTerminal:terminal 是
  // `multiple: true` 的页类型,上游每次 openTab 都铸一个带 UUID 的 contentId、
  // 因此不按 (kind, contentId) 去重——直接调 openTab 会每按一次多开一个终端,
  // 所以这里先在会话级 store 的布局里认页(record.kind === 'terminal'),
  // 已有就只聚焦(必要时展开右栏)、并把 DOM 焦点移进 xterm
  // (focusTerminalScreen;上游 focus 只聚焦标签,终端内容的自动聚焦 effect 在
  // 「本来就是当前标签」时不会重跑),没有才调 openTab('terminal') 新建。
  { id: 'sidebarRight.terminal', label: '右侧栏:定位终端并聚焦(不存在则新建)', group: '会话', states: ['card', 'editing', 'browse'] },
  // 新建会话并跳转(⌘/Ctrl+N)= `/new` 命令的同一动作:调公开的
  // uiWorkspace.startSession()(与侧栏「新建会话」按钮、dsh-new-session 处理
  // command/executed('new') 后的调用逐字相同)。三态放行:创建新会话与当前
  // 会话是否有待回应卡片、焦点是否在输入框都无关,带修饰键的组合也既不占用
  // 卡片的裸键(数字 / ← / → / Enter)也不干扰文本编辑。
  { id: 'session.new', label: '新建会话并跳转(等同 /new)', group: '会话', states: ['card', 'editing', 'browse'] },
  // 聚焦输入框放行 browse / editing,但 **editing 态另有一道元素级门闸**:
  // 「焦点在可编辑元素里」并不等于「焦点在 composer 里」——右侧栏终端(xterm 的
  // 隐藏 helper textarea)与 Monaco(inputarea textarea)都把 DOM 焦点放在一个真实的
  // <textarea> 上,焦点在那里时用户按下 ⌘/Ctrl+J 的意图恰恰是「跳回对话输入框」
  // (J = Jump,焦点跳转)。因此 editing 态只在焦点**不在** composer 自己的编辑区内时
  // 才执行聚焦(见 client.ts 里基于 isComposerTarget 的门闸,复用 ⇧Tab 那道门闸的
  // 同一取元素链路);焦点已在 composer 内时不再重复聚焦,但组合键**仍被吞掉**——
  // 旧键位 I 在同一位放行是为了保住 contenteditable 的「斜体」默认键,J 没有等价的
  // 默认行为,放行只会让 Win/Linux 浏览器的 Ctrl+J(下载页)跑出来。
  // card 态仍不放行:此时归卡片自己的输入框。
  { id: 'composer.focus', label: '聚焦输入框', group: '会话', states: ['browse', 'editing'] },
  { id: 'session.prev', label: '上一个活跃会话', group: '会话', states: ['card', 'editing', 'browse'] },
  { id: 'session.next', label: '下一个活跃会话', group: '会话', states: ['card', 'editing', 'browse'] },
  // 工作区切换浮窗(⌘/Ctrl+K):单修饰键这一档(`K` = Work-space),三态放行——
  // 带修饰键的组合既不与卡片的裸 ← / → / 数字键冲突,也不干扰文本编辑。
  // 浮窗打开后 ↑/↓ 只在列表里移动高亮、Enter 才调 uiWorkspace.openWorkspace
  // (连接工作区),故这一个动作 id 同时覆盖「开关浮窗」与「浮窗内导航」。
  { id: 'workspace.pick', label: '切换工作区(浮窗:↑↓ 选择、Enter 切换)', group: '会话', states: ['card', 'editing', 'browse'] },
  // 模型浮窗(⌘/Ctrl+M):同属单修饰键这一档(`M` = Model),三态放行。
  // 列表 / 切换都走**上游同一个** per-session 模型目录(ctx.modelDirectories 的
  // directoryFor,与 `/model` 弹层、composer 模型座位同一份状态),
  // 故浮窗里的切换与两个上游入口完全同步(见 model-picker.ts)。
  { id: 'model.pick', label: '切换模型(浮窗:↑↓ 选择、Enter 切换)', group: '会话', states: ['card', 'editing', 'browse'] },
  // 近期对话浮窗(⌘/Ctrl+I):单修饰键这一档(`I` = Input 会话),三态放行——
  // 带修饰键的组合既不与卡片的裸 ← / → / 数字键冲突,也不干扰文本编辑。
  // 浮窗内 ↑/↓ 在整份列表上跨工作区分组移动高亮、Enter 才打开会话
  // (`uiWorkspace.openSession`,与侧栏点会话行同一条公开服务调用;缺失时回退
  // 同一份服务实例上的 `sessions.open`),见 recent-sessions.ts。
  { id: 'session.recent', label: '近期对话(浮窗:按工作区分组、↑↓ 选择、Enter 打开)', group: '会话', states: ['card', 'editing', 'browse'] },
  // 思考强度循环(⇧Tab)只放行 browse / editing:card 态下 ⇧Tab 归卡片自己
  // (问答卡片的输入框仍需要正向/反向移动焦点)。editing 态另有一道**元素级门闸**
  // (见 client.ts 的 isComposerTarget):只有焦点在 composer 自己的编辑区内才接管,
  // 焦点在设置面板输入框 / Monaco 隐藏 textarea 等其它可编辑元素时一律放行——
  // ⇧Tab 是文本编辑的核心键(反向移动焦点 / 反向缩进),不能全局抢。
  { id: 'model.effortNext', label: '循环切换思考强度(⇧Tab;仅输入框/浏览态)', group: '会话', states: ['browse', 'editing'] },
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
  // 侧栏开关按「主面板 = 主键、次面板 = 邻键」分配:
  // - 左栏 = ⌘/Ctrl+B:与 VS Code / Slack / 各类编辑器的侧栏开关一致,也是上游
  //   `layout.toggleSidebar()` 的本名(sidebar / sidebarCol 不带限定词就指左栏);
  // - 右栏 = ⌘/Ctrl+O:同属单修饰键这一档,`O` 取「Open(打开/开合右栏面板)」联想
  //   (VS Code 亦用 ⌘0 而非 ⌘N 表示次面板);与左栏的 `B` 同档不同键。
  'sidebar.toggle': 'mod+b',
  'sidebarRight.toggle': 'mod+o',
  // 右栏标签切换 = ⌘/Ctrl+Alt+← / →:方向键表达「上一个 / 下一个」;与
  // ⌘/Ctrl+Alt+↑/↓ 的活跃会话跳转同族但不同轴(会话轴在左栏、标签轴在右栏)。
  // 边缘处**循环**,只有单个标签时不吞键(见 sidebar-tabs.ts)。
  'sidebarRight.tabPrev': 'mod+alt+arrowleft',
  'sidebarRight.tabNext': 'mod+alt+arrowright',
  // 定位右栏文件浏览器并置顶 = ⌘/Ctrl+\:反斜杠在主键区右端,与右栏开关
  // (⌘/Ctrl+O)同为「右栏」这一族。键名走 `comboOf` 的 e.code 归一化
  // (`Backslash` → `\`),与布局产出什么字符无关;JIS 等把 `\` 放在别的物理键上的
  // 键盘由 e.key 回退兜住。本键不再带 alt,故 Win/Linux 上「Ctrl+Alt 即 AltGr」
  // 的老问题在这里不存在(AltGr 层单独打出的 `\` 只会命中 `alt+\\`,不是本组合)。
  'sidebarRight.files': 'mod+\\',
  // 定位右栏终端 = ⌘/Ctrl+L:与右栏开关(⌘/Ctrl+O)、文件浏览器定位(⌘/Ctrl+\)
  // 同属「单修饰键」这一档。`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,
  // 所以 macOS 上 ⌃L 与 ⌘L 都能触发,Win/Linux 就是 Ctrl+L。
  // 语义与文件浏览器同形(「定位」而非「开关」):该会话已有终端页就聚焦它并把
  // DOM 焦点移进 xterm(focusTerminalScreen),没有才新建;重复按不会堆积终端
  // (terminal 是 multiple 页,上游的 openTab 本身不去重,认页由 sidebar-tabs.ts
  // 自己完成)。
  // 注意 Ctrl/Cmd+L 是浏览器「聚焦地址栏」的保留键(见 README「已知限制」)。
  'sidebarRight.terminal': 'mod+l',
  // 新建会话并跳转 = ⌘/Ctrl+N:跨应用肌肉记忆(浏览器 / 编辑器 / 终端的新建),
  // 语义 = `/new` 命令(公开的 uiWorkspace.startSession())。属单修饰键这一档,
  // 与 ⌘/Ctrl+K(工作区)、⌘/Ctrl+M(模型)并列。`mod` 在 comboOf 里同时吸收
  // ctrlKey 与 metaKey,故 macOS 上 ⌃N 与 ⌘N 都会触发;注意浏览器把
  // ⌘/Ctrl+N 当作「新建窗口」保留键(见 README「已知限制」)。
  'session.new': 'mod+n',
  // 聚焦输入框(焦点跳转)= ⌘/Ctrl+J:`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,
  // 所以 macOS 上 ⌃J 与 ⌘J 都能触发,Win/Linux 就是 Ctrl+J。该组合落在「单修饰键」
  // 这一档,与 ⌘/Ctrl+B(左栏)、⌘/Ctrl+O(右栏)同族;语义上 J = Jump(焦点跳转),
  // 取代旧键位 ⌘/Ctrl+I(I = Input):好处是不再与 contenteditable 的「斜体」默认键
  // 同键,代价是终端里的 `⌃J`(= 0x0A,LF;readline 的 newline,与 Enter 同义)不再
  // 送给 PTY,要换行请按 Enter。注意 Win/Linux 的浏览器把 Ctrl+J 绑成「下载」页
  // (浏览器保留键),详见 README「已知限制」。
  'composer.focus': 'mod+j',
  'session.prev': 'mod+alt+arrowup',
  'session.next': 'mod+alt+arrowdown',
  // 工作区切换浮窗 = ⌘/Ctrl+K:属「单修饰键」这一档,`K` 取「工作区(Work-space)」
  // 联想;`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,故 macOS 上按 ⌃K 或 ⌘K
  // 均可(Win/Linux 就是 Ctrl+K)。
  // 打开后 ↑/↓ 移动高亮、Enter 切换、Esc 关闭(见 overlay.ts)。
  // 注意 Ctrl+K 是浏览器保留键(地址栏搜索),详见 README「已知限制」。
  'workspace.pick': 'mod+k',
  // 模型浮窗 = ⌘/Ctrl+M:同为「单修饰键」这一档,`M` 取「模型(Model)」联想,
  // 与 ⌘/Ctrl+K(工作区)并列。`mod` 在 comboOf 里同时吸收 ctrlKey 与 metaKey,
  // 故 macOS 上按 ⌃M 或 ⌘M 均可(Win/Linux 就是 Ctrl+M)。浮窗内 ↑/↓ 选择、
  // Enter 切换、⇧Tab 调强度、Esc 关闭。
  'model.pick': 'mod+m',
  // 近期对话浮窗 = ⌘/Ctrl+I:属「单修饰键」这一档,`I` 取「Input / 会话」联想
  // (与 ⌘/Ctrl+K 工作区、⌘/Ctrl+M 模型并列)。`mod` 在 comboOf 里同时吸收
  // ctrlKey 与 metaKey,故 macOS 上按 ⌃I 或 ⌘I 均可(Win/Linux 就是 Ctrl+I)。
  // 浮窗内:↑/↓ 在整份列表上**跨工作区分组**移动高亮(不打开会话——免得连按就连开
  // 一串)、Enter 才打开高亮会话(`uiWorkspace.openSession`,与侧栏点会话行同一条
  // 服务调用;缺失时回退 `sessions.open`)、
  // Esc 或同组合键关闭、⌘/ 换成速查表。注意 `Ctrl+I` 在 contenteditable 里是
  // 浏览器默认的「斜体」键,这里会被 preventDefault 抢走(见 README「已知限制」);
  // 焦点跳转(⌘/Ctrl+J)是另一回事,不受影响。
  'session.recent': 'mod+i',
  // 思考强度循环 = ⇧Tab:上游 composer 座位把强度档收在「模型菜单 → Effort」二级
  // 面板里(没有默认键位),这里给一个免鼠标的循环键。Shift 单独作修饰键不与任何
  // 已有组合冲突(bindings 里没有其它 shift+ 项);`comboOf` 走 e.code 归一化
  // (`Tab` → `tab`),不随布局漂移。no-op(模型无强度档 / 只有一档 / 目录不可用)时
  // **不吞键**,页面默认的 ⇧Tab 行为照常;editing 态另需焦点落在 composer 内(见 client.ts)。
  'model.effortNext': 'shift+tab',
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
