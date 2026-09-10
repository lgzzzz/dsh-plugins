/**
 * dsh-left-dock — 左栏占位组件：活动栏（两枚按钮）+ 两个互斥面板。
 *
 * 本组件注册进 `sidebar` 槽位（single / root），因此拿到框架的完整 props 组合：
 *
 *   - owner 分享：`collapsed`（左栏是否收成 56px 轨道）、`width`（该轨道的实测宽度）；
 *   - 标准分享：`useSessions`（会话列表与当前会话）、`renderSlot`（本注册项声明的
 *     6 个子座位的渲染入口）、`t`（locale 命名空间合成）；
 *   - 注入分享（见 src/client.ts 的 inject face）：startSession / toggleSidebar /
 *     selectPanel / setSidebarWidth / listDirectory / openFile / usePanels。
 *
 * 互斥与宽度（需求「同一时间只有一个」+「二者宽度不共享」）是这样落地的：
 *
 *   - **active 面板**由本地 `mode` 决定：两块面板都挂载，非当前的一块 `display:none`
 *     （保住会话浏览器的搜索词/展开态/滚动位置），因此「同一时间只出现一个」是
 *     显示语义而不是卸载语义；
 *   - 框架的左栏轨道宽度只有一份（ui-layout 的 layoutInfo.sidebar），本插件把
 *     「每个模式各自的宽度」记在自己这边：切模式时用 `setSidebarWidth(该模式宽度)`
 *     写一次，拖动框架的列把手后由 `width` prop 变化回写当前模式的那份；
 *   - 收起 = 轨道 0（ui-layout 的 toggleSidebar），此时只留活动栏（56px）。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PanelMeta, RenderSlot, SessionsSelector, Translate } from './context.ts'
import type { ListDirectory } from './files.ts'
import { FilesPanel } from './files.ts'
import { IconChat, IconFolder, IconPlus } from './icons.ts'
import { loadState, saveState } from './persist.ts'
import type { DockMode, DockState } from './persist.ts'
import { safeTranslate } from './locales.ts'

/** 活动栏按钮 / 面板行用到的子座位名。 */
const BRAND_MARK = 'sidebar.brand.mark'
const BRAND_NAME = 'sidebar.brand.name'
const PANELLIST = 'sidebar.panellist'
const WORKSPACES = 'sidebar.workspaces'
const FOOTER_ACTION = 'sidebar.footer.action'
const SETTINGS = 'sidebar.settings'

/** 无 panellist 注册项时的稳定空数组（避免每次渲染换引用）。 */
const EMPTY_PANELS: readonly PanelMeta[] = []

/** 文件服务缺失时的列表实现：返回一次失败，由面板照常渲染失败行。 */
const UNAVAILABLE_LIST: ListDirectory = async () => ({
  ok: false,
  error: { code: 'dock/no-service', message: 'remote.workspaceFiles' },
})

/** 框架交给 `sidebar` 槽位占位组件的 props（结构切片，只列实际消费的字段）。 */
export interface DockProps {
  /** owner：左栏是否收起。 */
  collapsed?: boolean
  /** owner：左栏轨道实测宽度（px）。 */
  width?: number
  /** 标准：子座位渲染入口。 */
  renderSlot?: RenderSlot
  /** 标准：会话列表选择器 hook。 */
  useSessions?: SessionsSelector
  /** 注入：sidebar.panellist 行元数据选择器 hook（由 `hooks: { panels }` 绑成）。 */
  usePanels?: <T>(selector: (panels: readonly PanelMeta[]) => T) => T
  /** 注入：文件服务就绪状态选择器 hook（由 `hooks: { fileService }` 绑成）。 */
  useFileService?: <T>(selector: (ready: boolean) => T) => T
  /** 标准：locale 命名空间合成的文案函数。 */
  t?: unknown
  /** 注入：新建会话（uiWorkspace.startSession）。 */
  startSession?: (workspaceId?: string) => void
  /** 注入：开关左栏（layout.toggleSidebar）。 */
  toggleSidebar?: () => void
  /** 注入：选择 main 面板（layout.selectPanel）。 */
  selectPanel?: (panelId: string | null) => void
  /** 注入：写左栏轨道宽度（ui-layout root store 的 setSidebar）。 */
  setSidebarWidth?: (px: number) => void
  /** 注入：列目录（remote.workspaceFiles.list）。 */
  listDirectory?: ListDirectory
  /** 注入：打开文件到对话区 tab（dsh-text-editor.openFile）。 */
  openFile?: (path: string, cwd: string, sessionId: string | undefined) => boolean
}

/** 一枚活动栏按钮。 */
function stripButton(
  key: DockMode,
  label: string,
  active: boolean,
  icon: ReactNode,
  onClick: () => void,
): ReactNode {
  return h('button', {
    key,
    type: 'button',
    className: 'dsh-ld-btn',
    title: label,
    'aria-label': label,
    'aria-pressed': active,
    'data-dsh-ld-action': key,
    'data-active': active ? 'true' : undefined,
    onClick,
  }, icon)
}

/**
 * 左栏占位组件。
 * @param props - 见 {@link DockProps}。
 * @returns 左栏元素树。
 */
export function LeftDock(props: DockProps): ReactNode {
  const t: Translate = safeTranslate(props.t)
  const renderSlot = typeof props.renderSlot === 'function' ? props.renderSlot : undefined
  const collapsed = props.collapsed === true
  const trackWidth = typeof props.width === 'number' && Number.isFinite(props.width)
    ? Math.round(props.width)
    : 0

  // 钩子可用性在首次渲染冻结：条件调用会让 hook 计数在两次渲染间变化。
  const sessionsBound = useRef(typeof props.useSessions === 'function').current
  const panelsBound = useRef(typeof props.usePanels === 'function').current
  const fileServiceBound = useRef(typeof props.useFileService === 'function').current
  const booted = useRef<DockState | null>(null)
  if (booted.current === null) booted.current = loadState()
  const boot = booted.current

  const [mode, setMode] = useState<DockMode>(boot.mode)
  const [sessionWidth, setSessionWidth] = useState(boot.sessionWidth)
  const [filesWidth, setFilesWidth] = useState(boot.filesWidth)

  const sessionsHook = sessionsBound ? (props.useSessions as SessionsSelector) : undefined
  const panelsHook = panelsBound ? (props.usePanels as NonNullable<DockProps['usePanels']>) : undefined
  const fileServiceHook = fileServiceBound
    ? (props.useFileService as NonNullable<DockProps['useFileService']>)
    : undefined

  const sessionId = sessionsHook === undefined ? undefined : sessionsHook(snapshot => snapshot.current)
  const cwd = sessionsHook === undefined
    ? undefined
    : sessionsHook(snapshot => (sessionId === undefined ? undefined : snapshot.byId?.[sessionId]?.cwd))
  const panels = panelsHook === undefined ? EMPTY_PANELS : panelsHook(list => list)
  const fileServiceReady = fileServiceHook === undefined ? false : fileServiceHook(ready => ready)

  /**
   * 宽度写回：只有「当前模式刚成为可见面板」时写一次（挂载、切模式、展开）。
   *
   * 两个要害：
   * 1) 放在 effect 里而不是点击回调里，是为了让 mode 先提交、宽度后落——这样下面那条
   *    「拖动记录」效应看到这次变化时，当前模式已经是新模式，记录进去的正是该模式的
   *    目标值（幂等），A/B 两个面板的宽度因此不会互相污染；
   * 2) 它声明在「挂载校准」之前，因为首帧若持久化意图是「收起」，校准会 toggleSidebar；
   *    先写宽度、后 toggle 才能让 0 生效（反过来会把栏又撑开）。
   */
  const appliedMode = useRef<DockMode | null>(null)
  useEffect(() => {
    if (collapsed) {
      appliedMode.current = null
      return
    }
    if (appliedMode.current === mode) return
    appliedMode.current = mode
    if (typeof props.setSidebarWidth !== 'function') return
    props.setSidebarWidth(mode === 'files' ? filesWidth : sessionWidth)
    // 只在模式/展开态翻转时触发；宽度本身的变化由拖动记录效应处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, collapsed])

  // 挂载校准：持久化的是「意图」，布局 store 不持久化（刷新后回到 280/展开），
  // 因此第一次渲染后按持久化状态把「展开/收起」对齐一次；宽度由上面的写回效应补。
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current) return
    synced.current = true
    if (boot.open && collapsed) props.toggleSidebar?.()
    else if (!boot.open && !collapsed) props.toggleSidebar?.()
    // 只在挂载时校准一次：这里的 props 就是首帧那份。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 持久化（含 open 与两份宽度）。
  useEffect(() => {
    saveState({ mode, open: !collapsed, sessionWidth, filesWidth })
  }, [mode, collapsed, sessionWidth, filesWidth])

  // 框架列把手拖动 → 轨道宽度变化 → 回写到「当前模式」的那份宽度。
  // 收起、刚展开、刚切模式这三种变化都不是用户拖动，只更新基准不记录。
  const previousMode = useRef(mode)
  const previousCollapsed = useRef(collapsed)
  const previousWidth = useRef(trackWidth)
  useEffect(() => {
    const wasCollapsed = previousCollapsed.current
    const previousModeValue = previousMode.current
    const previousWidthValue = previousWidth.current
    previousCollapsed.current = collapsed
    previousMode.current = mode
    previousWidth.current = trackWidth
    if (collapsed || wasCollapsed) return
    if (previousModeValue !== mode) return
    if (trackWidth === 0 || trackWidth === previousWidthValue) return
    if (mode === 'files') setFilesWidth(trackWidth)
    else setSessionWidth(trackWidth)
  }, [trackWidth, mode, collapsed])

  /** 会话按钮：当前就在会话面板且展开 → 收起；否则切到会话面板并展开。 */
  const revealSession = (): void => {
    if (mode === 'session') {
      props.toggleSidebar?.()
      return
    }
    setMode('session')
    if (collapsed) props.toggleSidebar?.()
  }

  /** 文件按钮：当前就在文件面板且展开 → 收起；否则切到文件面板并展开。 */
  const revealFiles = (): void => {
    if (mode === 'files') {
      props.toggleSidebar?.()
      return
    }
    setMode('files')
    if (collapsed) props.toggleSidebar?.()
  }

  const sessionPanel = renderSlot === undefined ? null : h('div', { className: 'dsh-ld-session', 'data-dsh-ld-panel': 'session' },
    h('button', {
      type: 'button',
      className: 'dsh-ld-brand',
      title: t('session.new'),
      'data-dsh-ld-brand': '',
      onClick: () => { props.startSession?.() },
    },
    h('span', { className: 'dsh-ld-brandMark' }, renderSlot(BRAND_MARK, { size: 24 })),
    h('span', { className: 'dsh-ld-brandName' },
      renderSlot(BRAND_NAME, {}, { fallback: h('span', null, t('brand.localBuild')) }))),
    h('button', {
      type: 'button',
      className: 'dsh-ld-new',
      'data-dsh-ld-new': '',
      onClick: () => { props.startSession?.() },
    }, h(IconPlus, { size: 14 }), h('span', null, t('session.new'))),
    panels.length === 0 ? null : h('nav', { className: 'dsh-ld-panels' }, panels.map(panel => h('button', {
      key: panel.id,
      type: 'button',
      className: 'dsh-ld-panelRow',
      'data-dsh-ld-panel-row': panel.id,
      onClick: () => { props.selectPanel?.(panel.id) },
    },
    h('span', { className: 'dsh-ld-panelGlyph' }, renderSlot(PANELLIST, { size: 16, active: false }, { only: panel.id })),
    h('span', { className: 'dsh-ld-panelTitle' }, panel.label)))),
    h('div', { className: 'dsh-ld-region', 'data-dsh-ld-region': '' },
      renderSlot(WORKSPACES, {
        wide: true,
        expandSidebar: () => { if (collapsed) props.toggleSidebar?.() },
      })),
    h('div', { className: 'dsh-ld-foot' },
      h('div', { className: 'dsh-ld-footActions' }, renderSlot(FOOTER_ACTION, { wide: true })),
      h('div', { className: 'dsh-ld-settings' }, renderSlot(SETTINGS, { wide: true }))))

  const listDirectory = typeof props.listDirectory === 'function' ? props.listDirectory : UNAVAILABLE_LIST
  const filesPanel = h(FilesPanel, {
    sessionId,
    root: cwd ?? '',
    serviceReady: fileServiceReady,
    t,
    listDirectory,
    openFile: (path: string) => props.openFile?.(path, cwd ?? '', sessionId) === true,
  })

  /** 一块面板的容器：两块都挂载，非当前的一块 display:none（保住状态）。 */
  const pane = (key: DockMode, content: ReactNode): ReactNode => h('div', {
    key,
    className: 'dsh-ld-slotPane',
    'data-dsh-ld-pane': key,
    'data-active': mode === key ? 'true' : undefined,
  }, content)

  return h('div', {
    className: 'dsh-ld-root',
    'data-dsh-left-dock': collapsed ? 'collapsed' : mode,
    'data-state': collapsed ? 'collapsed' : mode,
  },
  h('nav', { className: 'dsh-ld-strip', 'aria-label': t('strip.session') },
    stripButton('session', t('strip.session.toggle'), !collapsed && mode === 'session', h(IconChat, { size: 18 }), revealSession),
    stripButton('files', t('strip.files.toggle'), !collapsed && mode === 'files', h(IconFolder, { size: 18 }), revealFiles)),
  collapsed ? null : h('div', { className: 'dsh-ld-panel' },
    pane('session', sessionPanel),
    pane('files', filesPanel)))
}
