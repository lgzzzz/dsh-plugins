/**
 * 浮层与设置页的 React 组件。
 *
 * 浮层与 `dsh-workspace-quick-switch` 同一套交互（一屏 10 行、窗口连续滑动、滚轮一格一行、
 * `Esc` / `Enter` / `↑` / `↓` / `←` / `→`），只是候选来自模型列表与快捷操作；设置页把同一份
 * 列表按提供方分组增删。可见文案全部由 `t` 取，组件不写死中文。
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { actionOfKey } from './actions.ts'
import {
  PAGE_SIZE,
  clampIndex,
  clampOffset,
  installPaletteKeys,
  installPaletteWheel,
  keepOptionVisible,
  windowSlice,
  type PaletteRow,
  type PaletteStore,
  type PaletteView,
} from './palette.ts'
import {
  choiceKey,
  choicePresentation,
  orderCatalogGroups,
  type CatalogGroup,
  type CatalogModelRow,
  type ModelChoice,
  type ModelSelectionLike,
} from './model.ts'
import type { ModelDataStore } from './model-data.ts'
import type { ModelTranslate } from './views.ts'
import { translateZh } from './locales.ts'
import { PALETTE_OPTION_ATTR, SETTINGS_ROOT_ATTR, optionDomId, paletteCountLabel } from './views.ts'

/** 浮层组件的 props。 */
export interface OverlayProps {
  readonly store: PaletteStore
  readonly data: ModelDataStore
  readonly view: PaletteView
  /** 第二步（选思考等级）的文案；缺席时复用 `view`。 */
  readonly effortView?: PaletteView
  /** 第二步按 `Esc` 时退回第一步。 */
  readonly onBack?: () => void
  /** 本插件字典的翻译函数；省略时用简体中文。 */
  readonly t?: TranslateNS<'dsh-model-quick-switch'>
}

/** 设置页里可执行的动作。 */
export interface SettingsActions {
  /** 重新拉取 Host 模型目录。 */
  loadCatalog(): Promise<void>
  /** 往列表里加一条（已存在则不动）。 */
  add(choice: ModelChoice): Promise<void>
  /** 从列表里删一条（不存在则不动）。 */
  remove(choice: ModelChoice): Promise<void>
}

/** 设置页组件的 props（由 `options.inject` 交出）。 */
export interface SettingsProps {
  readonly data: ModelDataStore
  readonly actions: SettingsActions
  /** 本插件字典的翻译函数；省略时用简体中文。 */
  readonly t?: TranslateNS<'dsh-model-quick-switch'>
}

/**
 * 一行候选项。
 *
 * 直接返回元素而不是组件：这里没有状态与生命周期，平铺调用让产物测试能按元素树断言。
 * @param props.store - 浮层状态。
 * @param props.view - 浮层文案。
 * @param props.entry - 候选行。
 * @param props.index - 候选在整个列表里的下标。
 * @param props.active - 是否为选中行。
 * @param props.t - 翻译函数。
 * @returns 行按钮。
 */
function optionElement({
  store,
  view,
  entry,
  index,
  active,
  t,
}: {
  readonly store: PaletteStore
  readonly view: PaletteView
  readonly entry: PaletteRow
  readonly index: number
  readonly active: boolean
  readonly t: TranslateNS<'dsh-model-quick-switch'>
}): ReactElement {
  const label = entry.title === '' ? entry.key : entry.title
  const badges = entry.badges ?? []
  const action = actionOfKey(entry.key)
  return (
    <button
      key={entry.key}
      type="button"
      id={optionDomId(view, index)}
      role="option"
      className="dsh-model-quick-switch-option"
      aria-selected={active}
      {...{ [PALETTE_OPTION_ATTR]: '' }}
      // 稳定身份（列表项的复合 key）：人工排查与自动化验证按它定位行。
      data-palette-key={entry.key}
      data-active={active ? 'true' : 'false'}
      {...action === null ? {} : { 'data-action': action }}
      onClick={() => {
        store.select(index)
        const binding = store.getSnapshot().binding
        if (binding !== null) binding()
      }}
    >
      <span className="dsh-model-quick-switch-index">{`${index + 1}`}</span>
      <span className="dsh-model-quick-switch-texts">
        <span className="dsh-model-quick-switch-label">
          <span className="dsh-model-quick-switch-name">{label}</span>
          {entry.current === true
            ? <span className="dsh-model-quick-switch-current">{t('currentBadge')}</span>
            : null}
          {badges.map(badge => (
            <span key={`badge:${badge}`} className="dsh-model-quick-switch-badge" data-badge={badge}>
              {badge}
            </span>
          ))}
        </span>
        <span className="dsh-model-quick-switch-path">{entry.subtitle}</span>
      </span>
      {active ? <span className="dsh-model-quick-switch-enter">{t('footerEnter')}</span> : null}
    </button>
  )
}

/** 浮层本体：只在 `open` 为真时渲染；开着的时候按捕获阶段收到的按键动作。 */
export function ModelOverlay({
  store,
  data,
  view: modelView,
  effortView,
  onBack,
  t = translateZh,
}: OverlayProps): ReactElement | null {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const dataState = useSyncExternalStore(data.subscribe, data.getSnapshot, data.getSnapshot)
  const stage = dataState.stage
  const view = stage === 'efforts' && effortView !== undefined ? effortView : modelView
  const stagePresentation = dataState.stageModel === null
    ? undefined
    : choicePresentation(dataState.stageModel, dataState.catalog)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const open = state.open
  const entries = state.entries
  const activeIndex = clampIndex(state.activeIndex, entries.length)
  const offset = clampOffset(state.offset, entries.length)
  const visible = windowSlice(entries, offset)
  const activeEntry = activeIndex < 0 ? undefined : entries[activeIndex]
  const enterHint = activeEntry !== undefined && actionOfKey(activeEntry.key) !== null
    ? t('footerEnterExecute')
    : view.enterHint
  // 一份目录都没有时，确认模型要等 Host 返回目录（见 confirmModel 里的等待）：把这段等待写出来。
  // 后台刷新（目录已在手上）不阻塞任何操作，不出提示，免得每次打开浮层都闪一下。
  const waitingCatalog = dataState.catalog.length === 0 && dataState.groups.length === 0
    && (dataState.catalogStatus === 'idle' || dataState.catalogStatus === 'loading')

  useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  // 选中行必须留在可见范围：窗口不够高时列表只在内部滚动，键盘把选中行移出视口等于「看不见」。
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    keepOptionVisible(activeIndex < 0 ? null : list?.querySelector(`#${optionDomId(view, activeIndex)}`))
  }, [open, activeIndex, view])

  useEffect(
    () => installPaletteKeys(store, document, undefined, stage === 'efforts' && onBack !== undefined ? { back: onBack } : {}),
    [store, stage, onBack],
  )

  // 滚轮按行滑动窗口（一格一行），不改选中行；挂在整个浮层上，指针偏到遮罩留白也归浮层。
  useEffect(() => {
    if (!open) return
    return installPaletteWheel(rootRef.current, rows => store.slide(rows))
  }, [open, store])

  if (!open) return null

  return (
    <div ref={rootRef} className="dsh-model-quick-switch-overlay" {...{ [view.rootAttr]: '' }}>
      <div className="dsh-model-quick-switch-backdrop" />
      <div
        ref={panelRef}
        className="dsh-model-quick-switch-panel"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
      >
        <div className="dsh-model-quick-switch-head">
          <span className="dsh-model-quick-switch-title">{view.title}</span>
          <span className="dsh-model-quick-switch-count">
            {entries.length === 0 ? view.emptyCount : paletteCountLabel(view, entries, offset, t)}
          </span>
        </div>
        {stagePresentation === undefined
          ? null
          : (
            <div className="dsh-model-quick-switch-subhead">
              {t('subhead', { title: stagePresentation.title, subtitle: stagePresentation.subtitle })}
            </div>
          )}
        {entries.length === 0
          ? <div className="dsh-model-quick-switch-empty">{view.emptyHint}</div>
          : (
            <div
              ref={listRef}
              className="dsh-model-quick-switch-list"
              role="listbox"
              aria-label={view.listLabel}
              aria-activedescendant={optionDomId(view, activeIndex)}
            >
              {visible.map((entry, index) => optionElement({
                store,
                view,
                entry,
                index: offset + index,
                active: offset + index === activeIndex,
                t,
              }))}
            </div>
          )}
        {/* 状态区始终占一行高：切换工作树 / 团队协作时浮层不增不减，面板不会因这一行出现
            或消失而在视口里上下跳一下（浮层是居中的，高度一变整块就平移）。快捷操作不显示
            中间态：开关成功与否只用行上的角标与副标题体现，状态区只留给模型切换、目录等待与错误。 */}
        <div className="dsh-model-quick-switch-status">
          {dataState.pending
            ? <span className="dsh-model-quick-switch-pending">{t('pendingModel')}</span>
            : null}
          {!dataState.pending && waitingCatalog
            ? <span className="dsh-model-quick-switch-pending">{t('pendingCatalog')}</span>
            : null}
          {dataState.error === null
            ? null
            : <span className="dsh-model-quick-switch-error" role="alert">{dataState.error}</span>}
        </div>
        <div className="dsh-model-quick-switch-foot">
          <span>{t('footerMove')}</span>
          {entries.length > PAGE_SIZE ? <span>{t('footerPage')}</span> : null}
          <span>{enterHint}</span>
          <span>{stage === 'efforts' ? t('footerEscBack') : t('footerEscClose')}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * 设置页顶部那句「当前使用什么」。
 *
 * 三种读数分开说：没有会话、会话没有显式选择（跟随目录默认）、会话有显式选择。
 * @param state - 数据快照。
 * @param presentation - 当前有效选择（显式或默认）的显示名。
 * @param t - 翻译函数。
 * @returns 一行说明。
 */
function currentLine(
  state: { readonly sessionId: string | null; readonly current: ModelSelectionLike | null },
  presentation: ReturnType<typeof choicePresentation> | undefined,
  t: ModelTranslate,
): string {
  if (state.sessionId === null) return t('currentNoSession')
  if (presentation === undefined) return t('currentNoDefault')
  const detail = `${presentation.title} · ${presentation.subtitle}`
  return state.current === null ? t('currentFollowDefault', { detail }) : t('currentDetail', { detail })
}

/**
 * 设置页里的一行已添加模型。
 * @param props.choice - 已添加的模型。
 * @param props.state - 数据快照里的目录与当前选择。
 * @param props.catalogReady - 目录是否已加载完成。
 * @param props.disabled - 写入进行中 / 只读时禁用。
 * @param props.actions - 设置页动作面。
 * @param props.t - 翻译函数。
 * @returns 列表行。
 */
function choiceSettingsRow({
  choice,
  state,
  catalogReady,
  disabled,
  actions,
  t,
}: {
  readonly choice: ModelChoice
  readonly state: { readonly catalog: readonly CatalogModelRow[]; readonly current: ModelSelectionLike | null }
  readonly catalogReady: boolean
  readonly disabled: boolean
  readonly actions: SettingsActions
  readonly t: ModelTranslate
}): ReactElement {
  const presentation = choicePresentation(choice, state.catalog)
  const isCurrent = state.current !== null
    && state.current.provider === choice.provider
    && state.current.model === choice.model
    && (choice.reasoningEffort === undefined || choice.reasoningEffort === state.current.reasoningEffort)
  return (
    <li key={choiceKey(choice)} className="dsh-model-quick-switch-settings-row">
      <div className="dsh-model-quick-switch-settings-texts">
        <span className="dsh-model-quick-switch-settings-name">
          <span className="dsh-model-quick-switch-settings-name-text">{presentation.title}</span>
          {isCurrent
            ? <span className="dsh-model-quick-switch-settings-current">{t('currentBadge')}</span>
            : null}
          {catalogReady && !presentation.known
            ? <span className="dsh-model-quick-switch-settings-badge">{t('outsideBadge')}</span>
            : null}
        </span>
        <span className="dsh-model-quick-switch-settings-id">{presentation.subtitle}</span>
      </div>
      <button
        type="button"
        className="dsh-model-quick-switch-settings-button dsh-model-quick-switch-settings-button-danger"
        disabled={disabled}
        aria-label={t('settingsDeleteAria', { title: presentation.title })}
        onClick={() => {
          void actions.remove(choice)
        }}
      >
        {t('settingsDelete')}
      </button>
    </li>
  )
}

/** 目录里一个模型的副标题：模型 id，附带适配器公布的推理强度名单。 */
function modelSubtitle(model: CatalogGroup['models'][number]): string {
  const efforts = model.reasoning?.efforts ?? []
  if (efforts.length === 0) return model.id
  return `${model.id} · ${efforts.map(effort => effort.name ?? effort.id).join(' / ')}`
}

/**
 * 目录角标的可显示文本。
 *
 * 上游 `ModelCatalogModel['badge']` 的 `text` 是 `LocalizedText`（字符串或按语言分键）；
 * 设置页只画一行，按 `en` 兜底，避免把结构对象直接交给 React。
 */
function badgeText(badge: CatalogModelRow['badge']): string {
  if (badge === undefined) return ''
  return typeof badge.text === 'string' ? badge.text : badge.text.en
}

/**
 * 「添加模型」面板：按提供方分组列出目录里的模型。
 * @param groups - 按提供方分组的目录。
 * @param catalog - 展开后的目录。
 * @param choices - 已添加的列表。
 * @param status - 目录状态。
 * @param disabled - 写入进行中 / 只读时禁用。
 * @param actions - 设置页动作面。
 * @param t - 翻译函数。
 * @returns 目录面板。
 */
function catalogPicker(
  groups: readonly CatalogGroup[],
  catalog: readonly CatalogModelRow[],
  choices: readonly ModelChoice[],
  status: 'idle' | 'loading' | 'ready' | 'error',
  disabled: boolean,
  actions: SettingsActions,
  t: ModelTranslate,
): ReactElement {
  if (groups.length === 0) {
    const message = status === 'loading' ? t('settingsCatalogLoading') : t('settingsCatalogEmpty')
    return (
      <div className="dsh-model-quick-switch-settings-catalog">
        <p className="dsh-model-quick-switch-settings-note">{message}</p>
      </div>
    )
  }
  return (
    <div className="dsh-model-quick-switch-settings-catalog">
      {groups.map(group => (
        <div key={group.id} className="dsh-model-quick-switch-settings-group">
          <h4 className="dsh-model-quick-switch-settings-group-title">{group.name ?? group.id}</h4>
          {group.models.length === 0
            ? <p className="dsh-model-quick-switch-settings-note">{t('settingsNoProviderModels')}</p>
            : group.models.map((model) => {
              const presentation = choicePresentation({ provider: group.id, model: model.id }, catalog)
              const added = choices.some(choice => choice.provider === group.id && choice.model === model.id)
              return (
                <div key={model.id} className="dsh-model-quick-switch-settings-model">
                  <div className="dsh-model-quick-switch-settings-model-texts">
                    <span className="dsh-model-quick-switch-settings-model-name">
                      <span className="dsh-model-quick-switch-settings-model-name-text">{presentation.title}</span>
                      {model.badge === undefined
                        ? null
                        // 上游 0.2.2-rc.2 的角标是 `{ text, tone }` 结构，本设置的展示槽只画一行文本。
                        : <span className="dsh-model-quick-switch-settings-badge">{badgeText(model.badge)}</span>}
                    </span>
                    <span className="dsh-model-quick-switch-settings-model-id">{modelSubtitle(model)}</span>
                  </div>
                  <button
                    type="button"
                    className="dsh-model-quick-switch-settings-button"
                    disabled={disabled || added}
                    onClick={() => {
                      void actions.add({ provider: group.id, model: model.id })
                    }}
                  >
                    {added ? t('settingsAdded') : t('settingsAddOne')}
                  </button>
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}

/**
 * 设置页：「列表里有什么」+「从目录里添加」。
 *
 * 列表与浮层候选是同一份数据（`ctx.configForms` 的 `models` 字段），所以这里增删一条，
 * 浮层下一次打开（以及开着的那张）立刻跟着变。写入进行中禁用所有增删按钮，失败时在页面上
 * 显示 Host 的拒绝原因。
 * @param props - 数据快照、动作面与翻译函数。
 * @returns 设置分区。
 */
export function ModelSettingsSection({ data, actions, t = translateZh }: SettingsProps): ReactElement {
  const state = useSyncExternalStore(data.subscribe, data.getSnapshot, data.getSnapshot)
  const [addOpen, setAddOpen] = useState(false)

  // 打开设置页就拉一次目录（目录可能比页面挂载晚就绪，失败时页面给重试入口）。
  useEffect(() => {
    void actions.loadCatalog()
  }, [actions])

  const groups = orderCatalogGroups(state.groups)
  const effective = state.current ?? state.defaultSelection
  const currentPresentation = effective === null ? undefined : choicePresentation(effective, state.catalog)
  const busy = state.writing || state.pending
  const disabled = busy || !state.writable
  const catalogReady = state.catalogStatus === 'ready'

  return (
    <div className="dsh-model-quick-switch-settings" {...{ [SETTINGS_ROOT_ATTR]: '' }}>
      <div>
        <h2 className="dsh-model-quick-switch-settings-title">{t('settingsTitle')}</h2>
        <p className="dsh-model-quick-switch-settings-intro">{t('settingsIntro')}</p>
        <p className="dsh-model-quick-switch-settings-intro">{currentLine(state, currentPresentation, t)}</p>
      </div>
      <div>
        <div className="dsh-model-quick-switch-settings-heading">
          <h3 className="dsh-model-quick-switch-settings-subtitle">{t('settingsModelsTitle')}</h3>
          <span className="dsh-model-quick-switch-settings-hint">
            {t('settingsCount', { count: state.choices.length })}
          </span>
        </div>
        {state.configStatus === 'unavailable'
          ? <p className="dsh-model-quick-switch-settings-empty">{t('settingsUnavailable')}</p>
          : state.configStatus === 'loading'
            ? <p className="dsh-model-quick-switch-settings-empty">{t('settingsLoading')}</p>
            : state.choices.length === 0
              ? <p className="dsh-model-quick-switch-settings-empty">{t('settingsEmpty')}</p>
              : (
                <ul className="dsh-model-quick-switch-settings-list">
                  {state.choices.map(choice => choiceSettingsRow({
                    choice,
                    state,
                    catalogReady,
                    disabled,
                    actions,
                    t,
                  }))}
                </ul>
              )}
        {state.writable
          ? null
          : <p className="dsh-model-quick-switch-settings-note">{t('settingsReadonly')}</p>}
      </div>
      <div>
        <div className="dsh-model-quick-switch-settings-actions">
          <button
            type="button"
            className="dsh-model-quick-switch-settings-button"
            aria-expanded={addOpen ? 'true' : 'false'}
            onClick={() => setAddOpen(!addOpen)}
          >
            {addOpen ? t('settingsCollapse') : t('settingsAdd')}
          </button>
          <button
            type="button"
            className="dsh-model-quick-switch-settings-button"
            disabled={busy || state.catalogStatus === 'loading' || state.catalogRefreshing}
            onClick={() => {
              void actions.loadCatalog()
            }}
          >
            {state.catalogStatus === 'loading' || state.catalogRefreshing
              ? t('settingsCatalogLoading')
              : t('settingsRefresh')}
          </button>
          {state.catalogError === null
            ? null
            : <span className="dsh-model-quick-switch-settings-error" role="alert">{state.catalogError}</span>}
        </div>
        {state.writeError === null
          ? null
          : <p className="dsh-model-quick-switch-settings-error" role="alert">{state.writeError}</p>}
        {addOpen
          ? catalogPicker(groups, state.catalog, state.choices, state.catalogStatus, disabled, actions, t)
          : null}
      </div>
    </div>
  )
}
