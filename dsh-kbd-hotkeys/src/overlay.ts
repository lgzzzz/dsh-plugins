/** 插件自建浮层(纯 DOM,不消费 react):速查表、工作区、近期对话、模型。
 * 同一时刻只有一个浮层,共用模态分发(未处理的按键一律吞掉);Esc 或同组合键关闭,按别的浮层组合键互切。 */
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

export interface OverlayDeps {
  getConfig(): HotkeyConfig
  listWorkspaces(): readonly WorkspaceRowLike[]
  selectWorkspace(workspaceId: string): void
  listRecentSessions(): RecentSessionsViewLike
  selectRecentSession(sessionId: string): void
  listModels(): Promise<ModelPickerViewLike>
  selectModel(selection: ModelSelectionLike): void
  cycleEffort(): EffortCycleResultLike
}

export interface OverlayHost {
  isOpen(): boolean
  contains(target: Node | null): boolean
  handleKey(event: KeyboardEvent): boolean
  toggleHelp(): void
  toggleWorkspacePicker(): void
  toggleModelPicker(): void
  toggleRecentPicker(): void
  destroy(): void
}

/** 当前浮层种类（同一时刻至多一个）。 */
type PanelKind = 'help' | 'workspace' | 'model' | 'recent'

const STYLE_ID = 'dsh-kbd-hotkeys/style'

const STYLE = [
  '.dsh-kbd-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font-family:var(--dsw-font-family,system-ui,-apple-system,sans-serif)}',
  // 面板必须不透明：官方 `--dsw-specific-menu` 本体带 alpha（#f8f9fa94 / #30313680，约 50–58%，
  // 官方一律配 40px backdrop-filter 做磨砂），本插件不引磨砂，直接铺会透出背后的遮罩。
  // 故把它作 background-image 叠在不透明的 `--dsw-alias-bg-base` 上：合成即纯色，色值≈今天所见。
  '.dsh-kbd-panel{width:min(560px,calc(100vw - 48px));max-height:64vh;background-color:var(--dsw-alias-bg-base,#fff);background-image:linear-gradient(var(--dsw-specific-menu,#fff),var(--dsw-specific-menu,#fff));color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.25));border-radius:14px;display:flex;flex-direction:column;overflow:hidden}',
  // 近期对话浮窗最多 10 行，抬高上限让整屏可见（须排在 .dsh-kbd-panel 之后）。
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
  // 近期对话行：多一层缩进，用独立类名便于诊断脚本区分。
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

/** 三个列表浮窗共用的行载荷，choose() 按 kind 分派。 */
interface RowTarget {
  workspaceId?: string
  sessionId?: string
  selection?: ModelSelectionLike
}

/** 创建浮层宿主（速查表 + 工作区 + 近期对话 + 模型）。 */
export function createOverlays(deps: OverlayDeps): OverlayHost {
  ensureStyle()
  let root: HTMLDivElement | null = null
  let kind: PanelKind | null = null
  let rowEls: HTMLElement[] = []
  let rowTargets: RowTarget[] = []
  let cursor = 0
  let modelList: HTMLElement | null = null
  let modelCurrentEl: HTMLElement | null = null
  let modelLabel = ''
  let modelEffort = ''
  /** 模型浮窗渲染序号：过期结果一律丢弃。 */
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
      // 空串 = 默认不绑键位(如 diff 分栏,只在 ⌘/Ctrl+S 触发时同步);未进 config 的动作同理
      key.textContent = fixed ?? (combo === undefined || combo === '' ? '未绑定' : prettyCombo(combo))
      row.appendChild(label)
      row.appendChild(key)
      container.appendChild(row)
    }
    return container
  }

  /** 画工作区浮窗：标题 + 行 + 提示；mousedown 确认、mouseenter 移高亮。 */
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

  /** 画近期对话浮窗:组标题不参与高亮;↑/↓ 跨组连续移动,Enter / 点行才打开会话。 */
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

  /** 行主体：主标签 + 次行（空则省略）。 */
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

  function renderBadge(text: string): HTMLElement {
    const badge = document.createElement('span')
    badge.className = 'dsh-kbd-rowBadge'
    badge.textContent = text
    return badge
  }

  /** 近期对话行的状态标记：待回应 → 运行中 → 完成。 */
  function renderStatusBadges(row: RecentSessionRowLike): HTMLElement {
    const badge = document.createElement('span')
    badge.className = 'dsh-kbd-rowBadge'
    badge.textContent = row.pending ? '待回应' : row.running ? '运行中' : row.completed ? '完成' : ''
    return badge
  }

  /** 行鼠标交互：mousedown 直接确认，mouseenter 移高亮（与键盘共用下标）。 */
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

  function renderHint(text: string): HTMLElement {
    const hint = document.createElement('div')
    hint.className = 'dsh-kbd-hint'
    hint.textContent = text
    return hint
  }

  /** 画模型浮窗：标题 + 「当前」行 + 模型行 + 提示；异步取数，过期结果按序号丢弃。 */
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

  /** 用一次取数结果重画列表与「当前」行。 */
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

  /** 列表下方小字（失败提供方计数 / 错误详情）。 */
  function renderFootnote(text: string): HTMLElement {
    const footnote = document.createElement('div')
    footnote.className = 'dsh-kbd-hint'
    footnote.textContent = text
    return footnote
  }

  function renderGroupHeading(row: ModelPickerRowLike): HTMLElement {
    const heading = document.createElement('div')
    heading.className = 'dsh-kbd-group'
    heading.textContent = row.provider
    return heading
  }

  /** 「当前」行（⇧Tab 后原地更新）。 */
  function paintModelCurrent(): void {
    if (modelCurrentEl === null) return
    if (modelLabel === '') {
      modelCurrentEl.textContent = ''
      return
    }
    modelCurrentEl.textContent = modelEffort === '' ? `当前：${modelLabel}` : `当前：${modelLabel} · ${modelEffort}`
  }

  /** 移动高亮（越界 clamp 不循环）并滚进可视区；只切换 isActive 后缀。 */
  function setCursor(index: number): void {
    if (rowEls.length === 0) return
    const next = Math.max(0, Math.min(index, rowEls.length - 1))
    cursor = next
    rowEls.forEach((el, i) => {
      const base = el.className.split(' ').filter((name) => name !== 'isActive')[0] ?? 'dsh-kbd-row'
      el.className = i === next ? `${base} isActive` : base
    })
    const active = rowEls[next]
    // 最小 DOM 桩无 scrollIntoView，判空后调用。
    if (active !== undefined && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' })
    }
  }

  /** 确认当前行：先关浮窗再提交，按 kind 分派。 */
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

  /** 取某动作的组合键（支持 localStorage 覆盖）。 */
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

  /** 浮层打开时的按键分发；返回 true 表示已消费。 */
  function handleKey(event: KeyboardEvent): boolean {
    if (kind === null) return false
    if (event.key === 'Escape') {
      close()
      return true
    }
    const combo = comboOf(event)
    // 导航键先于开关浮层的组合键：↑/↓ 只移高亮，Enter 才确认。
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
    // 模型浮窗：⇧Tab 原地循环强度，只更新「当前」行，不动列表与高亮。
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
    // 再按同一组合键关闭；按别的浮层组合键直接互切。
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
