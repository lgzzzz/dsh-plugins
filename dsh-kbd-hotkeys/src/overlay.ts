/**
 * dsh-kbd-hotkeys — 轻量浮层:快捷键速查表(⌘/)、工作区切换浮窗(⌘/Ctrl+K)、
 * 模型浮窗(⌘/Ctrl+M)与近期对话浮窗(⌘/Ctrl+I)。
 *
 * 纯 DOM 实现(不消费 react,与 dsh-code-card-fonts 同策略):样式走 <style>
 * 标签 + 主题变量(--dsw-*),卸载时随 ctx.effect disposer 一并回收。
 *
 * 同一时刻只有一个浮层(help | workspace | model | recent),四者共用一份模态分发:
 * - 浮层自身先处理按键(handleKey);未处理且焦点在浮层内的交给浮层,
 *   其余一律吞掉,避免误触发页面快捷键;
 * - Esc 关闭;再按一次「打开它的那个组合键」(读 config.bindings,支持自定义键位)
 *   也关闭;另按另一个浮层的组合键则**直接换成那个浮层**(互切,不用先关)。
 *
 * 工作区浮窗的列表数据与切换动作都来自服务面(见 workspace-switcher.ts):
 * ↑/↓ 只在列表内移动高亮(不触发导航,避免每按一次就连接一个工作区),
 * Enter(或鼠标点行)才调用 `uiWorkspace.openWorkspace(workspaceId)`;
 * 数据在**每次打开时**重新取数(工作区增删、当前工作区变化即时反映)。
 *
 * 近期对话浮窗的数据与打开动作同样来自服务面(见 recent-sessions.ts):按工作区分组
 * (组标题 + 组内会话行,组序 = 宿主顺序,组内 = 最近更新在前),↑/↓ 在**整份列表**上
 * 跨组连续移动高亮,Enter(或点行)才打开选中会话——走上游 `uiWorkspace.openSession`
 * (侧栏点会话行的同一条调用,顺带从全局主面板回到对话视图),缺失时回退
 * `sessions.open`;空白会话不列出。三个列表浮窗共用同一套行模型(见 rows / rowEls),
 * 确认动作按 kind 分派。
 *
 * 模型浮窗的数据与提交同样来自服务面(见 model-picker.ts):列表是**异步**取的
 * (`directory.load()` 一次宿主代数目录),首次绘制为「正在加载模型目录…」,
 * 落地时用渲染序号守卫丢弃过期结果;↑/↓ 选择、Enter(或点行)才
 * `directory.select(selection)`;浮窗内 ⇧Tab 就地循环思考强度,只更新顶部
 * 「当前」行(列表与高亮都不动)。浮层不自己持有模型状态——真源始终是那份
 * per-session 目录 store。
 */
import { ACTIONS, FIXED_KEYS, comboOf, prettyCombo, type HotkeyConfig } from './config.ts'
import type {
  EffortCycleResultLike,
  ModelPickerRowLike,
  ModelPickerViewLike,
  ModelSelectionLike,
  RecentSessionRowLike,
  RecentSessionsViewLike,
  WorkspaceRowLike,
} from './types.ts'

/** 浮层依赖。 */
export interface OverlayDeps {
  getConfig(): HotkeyConfig
  /** 工作区浮窗的候选行(每次打开浮窗时调用一次)。 */
  listWorkspaces(): readonly WorkspaceRowLike[]
  /** 工作区浮窗确认(Enter / 点击):切到该工作区。 */
  selectWorkspace(workspaceId: string): void
  /** 近期对话浮窗的渲染数据(每次打开浮窗时现取一次会话 + 工作区快照)。 */
  listRecentSessions(): RecentSessionsViewLike
  /** 近期对话浮窗确认(Enter / 点击行):打开该会话(见 recent-sessions.ts)。 */
  selectRecentSession(sessionId: string): void
  /** 模型浮窗的渲染数据(每次打开浮窗时现取一次宿主代数目录,见 model-picker.ts)。 */
  listModels(): Promise<ModelPickerViewLike>
  /** 模型浮窗确认(Enter / 点击行):提交完整模型选择。 */
  selectModel(selection: ModelSelectionLike): void
  /** 模型浮窗内按 ⇧Tab:循环切换当前模型的思考强度(no-op 时 ok:false)。 */
  cycleEffort(): EffortCycleResultLike
}

/** 浮层宿主面。 */
export interface OverlayHost {
  isOpen(): boolean
  contains(target: Node | null): boolean
  /** 浮层打开时的按键处理;返回 true 表示已消费。 */
  handleKey(event: KeyboardEvent): boolean
  toggleHelp(): void
  toggleWorkspacePicker(): void
  toggleModelPicker(): void
  toggleRecentPicker(): void
  destroy(): void
}

/** 当前浮层种类(同一时刻至多一个)。 */
type PanelKind = 'help' | 'workspace' | 'model' | 'recent'

const STYLE_ID = 'dsh-kbd-hotkeys/style'

const STYLE = [
  '.dsh-kbd-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font-family:var(--dsw-font-family,system-ui,-apple-system,sans-serif)}',
  '.dsh-kbd-panel{width:min(560px,calc(100vw - 48px));max-height:64vh;background:var(--dsw-specific-menu,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.25));border-radius:14px;display:flex;flex-direction:column;overflow:hidden}',
  // 近期对话浮窗最多 10 行,面板高度按内容给足:高度是内容尺寸(不写死),这里只把
  // 上限从 64vh 抬到「视口可用高度」(backdrop 顶部留白 12vh,底部再留 24px)——
  // 于是 10 行 + 组标题 + 页眉/页脚在常见窗口高度下能整屏看全、列表不滚动,
  // 只有内容真的超过视口时列表才内部滚动。必须排在 `.dsh-kbd-panel` 之后
  // (同特异性,后声明的生效)。其余三个浮窗(速查表/工作区/模型)仍用 64vh。
  '.dsh-kbd-panel--recent{max-height:calc(88vh - 24px)}',
  '.dsh-kbd-help{padding:14px 18px;overflow-y:auto}',
  '.dsh-kbd-help h3{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-help h3:first-child{margin-top:0}',
  '.dsh-kbd-helpRow{display:flex;align-items:center;gap:12px;padding:5px 0;font-size:13px}',
  '.dsh-kbd-helpRow .dsh-kbd-itemLabel{flex:1}',
  '.dsh-kbd-help kbd{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;line-height:18px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-bottom-width:2px;border-radius:6px;background:var(--dsw-alias-bg-base,transparent)}',
  '.dsh-kbd-panelHeading{padding:14px 18px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-list{display:flex;flex-direction:column;gap:2px;padding:0 8px;overflow-y:auto}',
  '.dsh-kbd-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;font-size:13px;line-height:18px}',
  '.dsh-kbd-row.isActive{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18)))}',
  // 分组列表(近期对话浮窗)的行:与工作区 / 模型浮窗的行同形,只多一层缩进,
  // 让「组标题 → 组内会话」的层级一眼可辨。刻意用不同类名,便于诊断脚本区分
  // 两个浮窗各自渲染的行。
  '.dsh-kbd-groupRow{display:flex;align-items:center;gap:10px;padding:6px 10px 6px 20px;border-radius:8px;font-size:13px;line-height:18px}',
  '.dsh-kbd-groupRow.isActive{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18)))}',
  '.dsh-kbd-rowMain{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}',
  '.dsh-kbd-rowLabel,.dsh-kbd-rowDetail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsh-kbd-rowDetail{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-rowBadge{flex:none;font-size:11px;color:var(--dsw-alias-brand-primary,#4a6cf7)}',
  '.dsh-kbd-rowCount{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-empty{padding:4px 18px 16px;font-size:13px;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-hint{padding:10px 18px 14px;font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-current{padding:0 18px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-group{padding:8px 10px 4px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}',
].join('\n')

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = STYLE_ID
  tag.textContent = STYLE
  document.head.appendChild(tag)
}

/**
 * 一行待确认的目标。
 * 三个列表浮窗(工作区 / 近期对话 / 模型)共用同一份「行元素 + 行载荷」模型,
 * 高亮与确认都按下标走,`choose()` 按 kind 分派到各自的提交动作。
 */
interface RowTarget {
  workspaceId?: string
  sessionId?: string
  selection?: ModelSelectionLike
}

/** 创建浮层宿主(速查表 + 工作区浮窗 + 近期对话浮窗 + 模型浮窗)。 */
export function createOverlays(deps: OverlayDeps): OverlayHost {
  ensureStyle()
  let root: HTMLDivElement | null = null
  let kind: PanelKind | null = null
  /** 当前列表浮窗的行元素(高亮/确认都按同一下标走)。 */
  let rowEls: HTMLElement[] = []
  /** 与 rowEls 同下标的确认载荷(工作区 id / 会话 id / 模型选择)。 */
  let rowTargets: RowTarget[] = []
  let cursor = 0
  /** 模型浮窗的异步渲染落点与「当前」行(⇧Tab 后原地更新)。 */
  let modelList: HTMLElement | null = null
  let modelCurrentEl: HTMLElement | null = null
  let modelLabel = ''
  let modelEffort = ''
  /** 模型浮窗的渲染序号:过期(浮窗已关 / 已换开别的浮窗)的异步结果一律丢弃。 */
  let modelSeq = 0

  function isOpen(): boolean {
    return kind !== null
  }

  function contains(target: Node | null): boolean {
    return root !== null && target !== null && root.contains(target)
  }

  function close(): void {
    if (root !== null) root.remove()
    root = null
    kind = null
    rowEls = []
    rowTargets = []
    cursor = 0
    modelList = null
    modelCurrentEl = null
    modelLabel = ''
    modelEffort = ''
    modelSeq += 1
  }

  function mount(next: PanelKind): void {
    close()
    ensureStyle()
    const backdrop = document.createElement('div')
    backdrop.className = 'dsh-kbd-backdrop'
    const panel = document.createElement('div')
    // 近期对话浮窗额外带一个修饰类:它最多 10 行,需要比其它浮窗更高的上限
    // (见 STYLE 里 `.dsh-kbd-panel--recent`),让 10 行无需滚动即可看全。
    panel.className = next === 'recent' ? 'dsh-kbd-panel dsh-kbd-panel--recent' : 'dsh-kbd-panel'
    if (next === 'help') panel.appendChild(renderHelp())
    else if (next === 'workspace') renderWorkspacePicker(panel)
    else if (next === 'recent') renderRecentPicker(panel)
    else renderModelPicker(panel)
    backdrop.appendChild(panel)
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close()
    })
    document.body.appendChild(backdrop)
    root = backdrop
    kind = next
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
      const fixed = FIXED_KEYS[action.id]
      const combo = config.bindings[action.id]
      key.textContent = fixed ?? (combo === undefined ? '未绑定' : prettyCombo(combo))
      row.appendChild(label)
      row.appendChild(key)
      container.appendChild(row)
    }
    return container
  }

  /**
   * 画工作区浮窗:标题 + 工作区行(主标签 / 路径 / 当前标记 / 会话数)+ 底部提示。
   * 初始高亮 = 当前会话所属工作区(没有则第一行);行内 mousedown 直接确认,
   * mouseenter 移动高亮(与键盘共用同一下标状态)。
   */
  function renderWorkspacePicker(panel: HTMLElement): void {
    const heading = document.createElement('div')
    heading.className = 'dsh-kbd-panelHeading'
    heading.textContent = '切换工作区'
    panel.appendChild(heading)

    const rows = deps.listWorkspaces()
    if (rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'dsh-kbd-empty'
      empty.textContent = '当前没有已登记的工作区'
      panel.appendChild(empty)
      panel.appendChild(renderHint('↑ ↓ 选择 · Enter 切换 · Esc 关闭'))
      return
    }

    const list = document.createElement('div')
    list.className = 'dsh-kbd-list'
    const els: HTMLElement[] = []
    const targets: RowTarget[] = []
    rows.forEach((row, index) => {
      const el = document.createElement('div')
      el.className = 'dsh-kbd-row'
      el.appendChild(renderRowMain(row))
      if (row.current) {
        const badge = document.createElement('span')
        badge.className = 'dsh-kbd-rowBadge'
        badge.textContent = '当前'
        el.appendChild(badge)
      }
      const count = document.createElement('span')
      count.className = 'dsh-kbd-rowCount'
      count.textContent = `${String(row.sessionCount)} 个会话`
      el.appendChild(count)
      bindRow(el, index)
      list.appendChild(el)
      els.push(el)
      targets.push({ workspaceId: row.workspaceId })
    })
    panel.appendChild(list)
    panel.appendChild(renderHint('↑ ↓ 选择 · Enter 切换 · Esc 关闭'))

    rowEls = els
    rowTargets = targets
    setCursor(Math.max(0, rows.findIndex((row) => row.current)))
  }

  /**
   * 画近期对话浮窗:标题 + 按工作区分组的会话行 + 底部提示。
   *
   * 数据经 `deps.listRecentSessions()` 现取(见 recent-sessions.ts):组序 = 工作区
   * 宿主顺序、组内 = 最近更新在前、空白会话不列出。组标题是**只读**行(不参与高亮,
   * 也不进键盘轴);↑/↓ 在整份列表上跨组连续移动高亮,Enter(或行内 mousedown)才
   * `sessions.open(sessionId)`。初始高亮 = 当前会话所在行(不在列表里则首行)。
   */
  function renderRecentPicker(panel: HTMLElement): void {
    const heading = document.createElement('div')
    heading.className = 'dsh-kbd-panelHeading'
    heading.textContent = '近期对话'
    panel.appendChild(heading)

    const view = deps.listRecentSessions()
    if (view.rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'dsh-kbd-empty'
      empty.textContent = view.notice !== '' ? view.notice : '当前没有可打开的对话'
      panel.appendChild(empty)
      panel.appendChild(renderHint('↑ ↓ 选择 · Enter 打开 · Esc 关闭'))
      return
    }

    const list = document.createElement('div')
    list.className = 'dsh-kbd-list'
    const els: HTMLElement[] = []
    const targets: RowTarget[] = []
    for (const group of view.groups) {
      if (group.label !== '') {
        const groupHeading = document.createElement('div')
        groupHeading.className = 'dsh-kbd-group'
        groupHeading.textContent = group.label
        list.appendChild(groupHeading)
      }
      for (const row of group.rows) {
        const el = document.createElement('div')
        el.className = 'dsh-kbd-groupRow'
        el.appendChild(renderRowMain(row))
        el.appendChild(renderStatusBadges(row))
        if (row.current) el.appendChild(renderBadge('当前'))
        bindRow(el, els.length)
        list.appendChild(el)
        els.push(el)
        targets.push({ sessionId: row.sessionId })
      }
    }
    panel.appendChild(list)
    panel.appendChild(renderHint('↑ ↓ 选择 · Enter 打开 · Esc 关闭'))

    rowEls = els
    rowTargets = targets
    setCursor(view.initialIndex)
  }

  /** 行主体:主标签 + 次行(次行空串时省略)。三个列表浮窗的行共用。 */
  function renderRowMain(row: { label: string; detail: string }): HTMLElement {
    const main = document.createElement('div')
    main.className = 'dsh-kbd-rowMain'
    const label = document.createElement('div')
    label.className = 'dsh-kbd-rowLabel'
    label.textContent = row.label
    main.appendChild(label)
    if (row.detail !== '') {
      const detail = document.createElement('div')
      detail.className = 'dsh-kbd-rowDetail'
      detail.textContent = row.detail
      main.appendChild(detail)
    }
    return main
  }

  /** 行内右侧的标记(等宽小字)。 */
  function renderBadge(text: string): HTMLElement {
    const badge = document.createElement('span')
    badge.className = 'dsh-kbd-rowBadge'
    badge.textContent = text
    return badge
  }

  /** 近期对话行的状态标记:待回应 → 运行中 → 完成(空标记时返回空 span)。 */
  function renderStatusBadges(row: RecentSessionRowLike): HTMLElement {
    const badge = document.createElement('span')
    badge.className = 'dsh-kbd-rowBadge'
    badge.textContent = row.pending ? '待回应' : row.running ? '运行中' : row.completed ? '完成' : ''
    return badge
  }

  /**
   * 绑定一行的鼠标交互:行内 mousedown 直接确认(在模态分发吞掉事件前完成,
   * 且不改动页面焦点),mouseenter 移动高亮(与键盘共用同一下标状态)。
   */
  function bindRow(el: HTMLElement, index: number): void {
    el.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      choose(index)
    })
    el.addEventListener('mouseenter', () => {
      setCursor(index)
    })
  }

  /** 底部提示行(各浮窗的键位说明不同)。 */
  function renderHint(text: string): HTMLElement {
    const hint = document.createElement('div')
    hint.className = 'dsh-kbd-hint'
    hint.textContent = text
    return hint
  }

  /**
   * 画模型浮窗:标题 + 「当前」行 + 模型行(按提供方分组,分组标题只读)+ 底部提示。
   *
   * 数据经 `deps.listModels()` **异步**取(见 model-picker.ts:目录要 `load()` 一次
   * 宿主代数目录)。首次绘制是「正在加载模型目录…」,落地时用序号守卫丢弃过期结果
   * ——浮窗已关闭、或已换成工作区/速查表浮窗时那次渲染作废(否则会把行画进一个
   * 已经不作数的列表)。
   */
  function renderModelPicker(panel: HTMLElement): void {
    const heading = document.createElement('div')
    heading.className = 'dsh-kbd-panelHeading'
    heading.textContent = '选择模型'
    panel.appendChild(heading)

    const current = document.createElement('div')
    current.className = 'dsh-kbd-current'
    panel.appendChild(current)
    modelCurrentEl = current

    const list = document.createElement('div')
    list.className = 'dsh-kbd-list'
    const loading = document.createElement('div')
    loading.className = 'dsh-kbd-empty'
    loading.textContent = '正在加载模型目录…'
    list.appendChild(loading)
    panel.appendChild(list)
    modelList = list

    const hint = document.createElement('div')
    hint.className = 'dsh-kbd-hint'
    hint.textContent = '↑ ↓ 选择 · Enter 切换 · ⇧Tab 调整思考强度 · Esc 关闭'
    panel.appendChild(hint)

    const seq = ++modelSeq
    const stale = (): boolean => kind !== 'model' || seq !== modelSeq
    void Promise.resolve()
      .then(() => deps.listModels())
      .then(
        (view) => {
          if (!stale()) paintModelView(view)
        },
        () => {
          if (!stale()) paintModelView({ current: null, rows: [], notice: '模型目录不可用', footnote: '' })
        },
      )
  }

  /** 用一次取数结果重画列表 + 「当前」行(分组标题按相邻同组行插入)。 */
  function paintModelView(view: ModelPickerViewLike): void {
    const list = modelList
    if (list === null) return
    modelLabel = view.current?.label ?? ''
    modelEffort = view.current?.effort ?? ''
    paintModelCurrent()

    for (const child of [...list.children]) child.remove()
    const rows = view.rows
    if (rows.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'dsh-kbd-empty'
      empty.textContent = view.notice !== '' ? view.notice : '当前没有可用的模型'
      list.appendChild(empty)
      if (view.footnote !== '') list.appendChild(renderFootnote(view.footnote))
      rowEls = []
      rowTargets = []
      return
    }

    const els: HTMLElement[] = []
    const targets: RowTarget[] = []
    let lastProvider = ''
    rows.forEach((row, index) => {
      if (row.provider !== lastProvider) {
        lastProvider = row.provider
        list.appendChild(renderGroupHeading(row))
      }
      const el = document.createElement('div')
      el.className = 'dsh-kbd-row'
      el.appendChild(renderRowMain(row))
      if (row.current) el.appendChild(renderBadge('当前'))
      bindRow(el, index)
      list.appendChild(el)
      els.push(el)
      targets.push({ selection: { ...row.selection } })
    })
    if (view.footnote !== '') list.appendChild(renderFootnote(view.footnote))

    rowEls = els
    rowTargets = targets
    // 初始高亮 = 当前会话的有效选择(目录里找不到该行 → 首行)
    setCursor(Math.max(0, rows.findIndex((row) => row.current)))
  }

  /** 列表下方的小字(加载失败的提供方计数 / 错误详情)。 */
  function renderFootnote(text: string): HTMLElement {
    const footnote = document.createElement('div')
    footnote.className = 'dsh-kbd-hint'
    footnote.textContent = text
    return footnote
  }

  /** 提供方分组标题(与相邻同组行共用一个)。 */
  function renderGroupHeading(row: ModelPickerRowLike): HTMLElement {
    const heading = document.createElement('div')
    heading.className = 'dsh-kbd-group'
    heading.textContent = row.provider
    return heading
  }

  /** 「当前」行(⇧Tab 切换强度后就地更新,不重画列表)。 */
  function paintModelCurrent(): void {
    if (modelCurrentEl === null) return
    if (modelLabel === '') {
      modelCurrentEl.textContent = ''
      return
    }
    modelCurrentEl.textContent = modelEffort === '' ? `当前：${modelLabel}` : `当前：${modelLabel} · ${modelEffort}`
  }

  /**
   * 移动高亮(越界 clamp,不循环)并把选中行滚进可视区。
   * 基线类名逐行从元素自身保留(工作区 / 模型行 = `dsh-kbd-row`,
   * 近期对话行 = `dsh-kbd-groupRow`),只切换 `isActive` 后缀。
   */
  function setCursor(index: number): void {
    if (rowEls.length === 0) return
    const next = Math.max(0, Math.min(index, rowEls.length - 1))
    cursor = next
    rowEls.forEach((el, i) => {
      const base = el.className.split(' ').filter((name) => name !== 'isActive')[0] ?? 'dsh-kbd-row'
      el.className = i === next ? `${base} isActive` : base
    })
    const active = rowEls[next]
    // 行元素可能来自最小 DOM 桩(无 scrollIntoView),判空后调用
    if (active !== undefined && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' })
    }
  }

  /**
   * 确认当前行:先关浮窗、再提交(导航都是异步的,不阻塞浮窗关闭)。
   * 同一时刻只有一个列表浮窗,故按 kind 分派到各自的确认动作。
   */
  function choose(index: number): void {
    const target = rowTargets[index]
    if (target === undefined) return
    if (kind === 'model') {
      const selection = target.selection
      if (selection === undefined) return
      const next = { ...selection }
      close()
      deps.selectModel(next)
      return
    }
    if (kind === 'recent') {
      const sessionId = target.sessionId
      if (sessionId === undefined) return
      close()
      deps.selectRecentSession(sessionId)
      return
    }
    const workspaceId = target.workspaceId
    if (workspaceId === undefined) return
    close()
    deps.selectWorkspace(workspaceId)
  }

  /** 取当前配置里某动作的组合键(支持 localStorage 覆盖)。 */
  function bindingOf(actionId: string): string | undefined {
    return deps.getConfig().bindings[actionId]
  }

  function toggleHelp(): void {
    if (kind === 'help') close()
    else mount('help')
  }

  function toggleWorkspacePicker(): void {
    if (kind === 'workspace') close()
    else mount('workspace')
  }

  function toggleRecentPicker(): void {
    if (kind === 'recent') close()
    else mount('recent')
  }

  function toggleModelPicker(): void {
    if (kind === 'model') close()
    else mount('model')
  }

  /** 浮层打开时的按键分发。 */
  function handleKey(event: KeyboardEvent): boolean {
    if (kind === null) return false
    if (event.key === 'Escape') {
      close()
      return true
    }
    const combo = comboOf(event)
    // 工作区浮窗与近期对话浮窗的导航键先于「开关浮层」的组合键:↑/↓ 只移动高亮
    // (不触发导航 / 不打开会话),Enter 才确认;空列表时 Enter 不消费(由上层模态吞掉)。
    if (kind === 'workspace' || kind === 'recent') {
      if (combo === 'arrowup') {
        setCursor(cursor - 1)
        return true
      }
      if (combo === 'arrowdown') {
        setCursor(cursor + 1)
        return true
      }
      if (combo === 'enter' && rowTargets.length > 0) {
        choose(cursor)
        return true
      }
    }
    // 模型浮窗:↑/↓ 移动高亮、Enter 确认;⇧Tab(可覆盖)原地循环强度档,
    // 切换成功后只更新「当前」行——列表顺序与选中位置都不动,免得连按 ⇧Tab 时
    // 高亮跳走。空列表时 Enter 不消费(由上层模态吞掉)。
    if (kind === 'model') {
      if (combo === 'arrowup') {
        setCursor(cursor - 1)
        return true
      }
      if (combo === 'arrowdown') {
        setCursor(cursor + 1)
        return true
      }
      if (combo === 'enter' && rowTargets.length > 0) {
        choose(cursor)
        return true
      }
      if (combo === bindingOf('model.effortNext')) {
        const result = deps.cycleEffort()
        if (result.ok) {
          modelEffort = result.effortLabel
          paintModelCurrent()
        }
        return true
      }
    }
    // 再按一次打开它的组合键 → 关闭;按另一个浮层的组合键 → 直接换成那个浮层
    if (combo === bindingOf('session.recent')) {
      toggleRecentPicker()
      return true
    }
    if (combo === bindingOf('model.pick')) {
      toggleModelPicker()
      return true
    }
    if (combo === bindingOf('workspace.pick')) {
      toggleWorkspacePicker()
      return true
    }
    if (combo === bindingOf('help.toggle')) {
      toggleHelp()
      return true
    }
    return false
  }

  function destroy(): void {
    close()
    document.getElementById(STYLE_ID)?.remove()
  }

  return { isOpen, contains, handleKey, toggleHelp, toggleWorkspacePicker, toggleModelPicker, toggleRecentPicker, destroy }
}
