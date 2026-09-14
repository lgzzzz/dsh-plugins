/**
 * dsh-kbd-hotkeys — 轻量浮层:快捷键速查表(⌘/)、工作区切换浮窗(⌘/Ctrl+Alt+K)
 * 与模型浮窗(⌘/Ctrl+Alt+M)。
 *
 * 纯 DOM 实现(不消费 react,与 dsh-code-card-fonts 同策略):样式走 <style>
 * 标签 + 主题变量(--dsw-*),卸载时随 ctx.effect disposer 一并回收。
 *
 * 同一时刻只有一个浮层(help | workspace | model),三者共用一份模态分发:
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
  WorkspaceRowLike,
} from './types.ts'

/** 浮层依赖。 */
export interface OverlayDeps {
  getConfig(): HotkeyConfig
  /** 工作区浮窗的候选行(每次打开浮窗时调用一次)。 */
  listWorkspaces(): readonly WorkspaceRowLike[]
  /** 工作区浮窗确认(Enter / 点击):切到该工作区。 */
  selectWorkspace(workspaceId: string): void
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
  destroy(): void
}

/** 当前浮层种类(同一时刻至多一个)。 */
type PanelKind = 'help' | 'workspace' | 'model'

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
  '.dsh-kbd-panelHeading{padding:14px 18px 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#999)}',
  '.dsh-kbd-list{display:flex;flex-direction:column;gap:2px;padding:0 8px;overflow-y:auto}',
  '.dsh-kbd-row{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:8px;font-size:13px;line-height:18px}',
  '.dsh-kbd-row.isActive{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18)))}',
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

/** 创建浮层宿主(速查表 + 工作区浮窗 + 样式标签)。 */
export function createOverlays(deps: OverlayDeps): OverlayHost {
  ensureStyle()

  let root: HTMLDivElement | null = null
  let kind: PanelKind | null = null
  /** 工作区浮窗的行元素与对应 workspaceId(高亮/确认都按同一下标走)。 */
  let rowEls: HTMLElement[] = []
  let rowIds: string[] = []
  /** 模型浮窗的行元素与对应完整选择(与 rowEls 同下标)。 */
  let rowSelections: ModelSelectionLike[] = []
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
    rowIds = []
    rowSelections = []
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
    panel.className = 'dsh-kbd-panel'
    if (next === 'help') panel.appendChild(renderHelp())
    else if (next === 'workspace') renderWorkspacePicker(panel)
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
      panel.appendChild(renderHint())
      return
    }

    const list = document.createElement('div')
    list.className = 'dsh-kbd-list'
    const els: HTMLElement[] = []
    const ids: string[] = []
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
      // mousedown 而非 click:在模态分发吞掉事件前完成确认,且不改动页面焦点
      el.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        choose(index)
      })
      el.addEventListener('mouseenter', () => {
        setCursor(index)
      })
      list.appendChild(el)
      els.push(el)
      ids.push(row.workspaceId)
    })
    panel.appendChild(list)
    panel.appendChild(renderHint())

    rowEls = els
    rowIds = ids
    setCursor(Math.max(0, rows.findIndex((row) => row.current)))
  }

  /** 行主体:主标签 + 次行(次行空串时省略)。工作区行与模型行共用。 */
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

  function renderHint(): HTMLElement {
    const hint = document.createElement('div')
    hint.className = 'dsh-kbd-hint'
    hint.textContent = '↑ ↓ 选择 · Enter 切换 · Esc 关闭'
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
      rowSelections = []
      return
    }

    const els: HTMLElement[] = []
    const selections: ModelSelectionLike[] = []
    let lastProvider = ''
    rows.forEach((row, index) => {
      if (row.provider !== lastProvider) {
        lastProvider = row.provider
        list.appendChild(renderGroupHeading(row))
      }
      const el = document.createElement('div')
      el.className = 'dsh-kbd-row'
      el.appendChild(renderRowMain(row))
      if (row.current) {
        const badge = document.createElement('span')
        badge.className = 'dsh-kbd-rowBadge'
        badge.textContent = '当前'
        el.appendChild(badge)
      }
      // mousedown 而非 click:在模态分发吞掉事件前完成确认,且不改动页面焦点
      el.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        choose(index)
      })
      el.addEventListener('mouseenter', () => {
        setCursor(index)
      })
      list.appendChild(el)
      els.push(el)
      selections.push({ ...row.selection })
    })
    if (view.footnote !== '') list.appendChild(renderFootnote(view.footnote))

    rowEls = els
    rowSelections = selections
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

  /** 移动高亮(越界 clamp,不循环)并把选中行滚进可视区。 */
  function setCursor(index: number): void {
    if (rowEls.length === 0) return
    const next = Math.max(0, Math.min(index, rowEls.length - 1))
    cursor = next
    rowEls.forEach((el, i) => {
      el.className = i === next ? 'dsh-kbd-row isActive' : 'dsh-kbd-row'
    })
    const active = rowEls[next]
    // 行元素可能来自最小 DOM 桩(无 scrollIntoView),判空后调用
    if (active !== undefined && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' })
    }
  }

  /**
   * 确认当前行:先关浮窗、再提交(导航 / 选模型都是异步的,不阻塞浮窗关闭)。
   * 同一时刻只有一个浮窗,故按 kind 分派到各自的确认动作。
   */
  function choose(index: number): void {
    if (kind === 'model') {
      const selection = rowSelections[index]
      if (selection === undefined) return
      const target = { ...selection }
      close()
      deps.selectModel(target)
      return
    }
    const workspaceId = rowIds[index]
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
    // 工作区浮窗的导航键先于「开关浮层」的组合键:↑/↓ 只移动高亮(不触发导航),
    // Enter 才确认;空列表时 Enter 不消费(由上层模态吞掉)。
    if (kind === 'workspace') {
      if (combo === 'arrowup') {
        setCursor(cursor - 1)
        return true
      }
      if (combo === 'arrowdown') {
        setCursor(cursor + 1)
        return true
      }
      if (combo === 'enter' && rowIds.length > 0) {
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
      if (combo === 'enter' && rowSelections.length > 0) {
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

  return { isOpen, contains, handleKey, toggleHelp, toggleWorkspacePicker, toggleModelPicker, destroy }
}
