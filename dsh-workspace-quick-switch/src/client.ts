/**
 * 浏览器半部:快捷键 `⌘⌥M`(macOS)/ `Ctrl+Alt+M`(Windows、Linux)弹出「工作区快速切换」浮层。
 *
 * 固定行声明的是逻辑组合 `primary+alt`+`M`,注册表在 macOS 上展开成 `meta+alt`(⌘⌥)、
 * 在 Windows/Linux 上展开成 `control+alt`(Ctrl+Alt),所以同一份声明在两端各是各的键。
 *
 * 浮层列出的候选**就是左侧栏那一份**:上游 Workspace 控制器的 `list` 快照按宿主持久
 * 显示顺序排列(`dsh-workspace-activity-sort` 之类改的正是这份顺序),取前
 * {@link WORKSPACE_LIMIT} 个即可。浮层开着的时候候选继续跟随快照(顺序变了、工作区被
 * 删了,列表跟着变),选中行尽量停在原来那个工作区上。会话目录能读到主视图会话时,
 * 它所属的工作区会标上「当前」,并作为打开时的初始选中行。
 *
 * 三条通路:
 *
 *   - **固定行**注册在快捷键服务里(group `application`),占据 `primary+alt+M`,存在
 *     本身就是占用;按键经 `observeFixedInput` 的固定通道送达,只认这一条物理组合。
 *   - **浮层**注册进 `shell.overlay`(加法式列表槽)。候选由本插件直接订阅工作区快照
 *     得来(槽只给框架标准 props,容器与其注入面在 `ctx.inject` 的 scope 里造好),
 *     所以工作区一变就重渲。
 *   - **浮层内的按键**由本插件在 document 捕获阶段取走(`Escape` / `Enter` /
 *     `↑` / `↓`):浮层一开它就先于任何本地控件看到按键,关掉后立即放行。
 *
 * 两条通路都**不**写进本插件的 `inject`:固定行与浮层只等 `slots` / `shortcuts`,所以
 * `primary+alt+M` 从一开始就占着、浮层也随时能开。候选与「当前」标记要用的 `workspaces` /
 * `sessions` 是另一回事 —— 它们经 gateway + WebSocket 的远程链路提供,通常比本插件激活
 * 晚得多,所以各挂一个**等待子 fiber**(`scope.inject`),服务到位后再接上订阅;服务缺席
 * 就只是没有候选(浮层照常打开并提示),不会把启动审计拖成「等待激活」。
 *
 * 动作只有一条:在选中工作区**新建会话** —— `uiWorkspace.startSession(workspaceId)`,
 * 与左侧栏工作区分组上那个「新建会话」按钮是同一个动词(复用该工作区已有的空白会话,
 * 没有才真创建)。
 */
import * as React from 'react'
import { name } from './runtime.ts'
import {
  QUICK_SWITCH_BINDING,
  QUICK_SWITCH_ID,
  WORKSPACE_LIMIT,
  clampIndex,
  createPaletteStore,
  paletteEntries,
  quickSwitchKeys,
  quickSwitchPress,
  type HostWorkspace,
  type PaletteEntry,
  type PaletteStore,
  type QuickSwitchPlatform,
} from './palette.ts'

export { name }

/** 浮层依赖的两个客户端服务;任一缺席就整体不安装。 */
export const inject = ['slots', 'shortcuts']

/** 浮层自己注入的样式(随本插件的 fiber 卸载一起移除)。 */
const PALETTE_CSS = `
.dsh-workspace-quick-switch-overlay {
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px;
  font-family: var(--dsw-font-family);
}
.dsh-workspace-quick-switch-backdrop {
  pointer-events: auto;
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.24));
  backdrop-filter: var(--dsw-mask-blur, none);
}
.dsh-workspace-quick-switch-panel {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: min(70vh, 560px);
  overflow: hidden;
  border-radius: var(--dsw-radius-lg, 16px);
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0, 0, 0, 0.18));
}
.dsh-workspace-quick-switch-panel:focus {
  outline: none;
}
.dsh-workspace-quick-switch-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 10px;
}
.dsh-workspace-quick-switch-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.dsh-workspace-quick-switch-count {
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0 8px 8px;
  list-style: none;
  overflow-y: auto;
}
.dsh-workspace-quick-switch-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsh-workspace-quick-switch-option[data-active='true'] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.dsh-workspace-quick-switch-option:hover:not([data-active='true']) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.dsh-workspace-quick-switch-option:focus {
  outline: none;
}
.dsh-workspace-quick-switch-index {
  flex: none;
  width: 20px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.dsh-workspace-quick-switch-label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
}
.dsh-workspace-quick-switch-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-workspace-quick-switch-current {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11px;
  line-height: 18px;
}
.dsh-workspace-quick-switch-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-enter {
  flex: none;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-empty {
  padding: 8px 18px 18px;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
.dsh-workspace-quick-switch-foot {
  display: flex;
  gap: 14px;
  padding: 10px 18px 14px;
  border-top: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #81858c);
}
`

/** 浮层根节点的 DOM 标记(人工排查与自动化验证都读它)。 */
export const PALETTE_ROOT_ATTR = 'data-workspace-quick-switch'

/** 一行候选项的 DOM 标记。 */
export const PALETTE_OPTION_ATTR = 'data-workspace-quick-switch-option'

/** 浮层内一个按键解出的动作。 */
export type PaletteAction = 'close' | 'confirm' | 'next' | 'previous'

/** `paletteAction` 读到的按键事实(KeyboardEvent 结构上满足它)。 */
export interface PaletteEventLike {
  readonly key: string
  readonly repeat?: boolean
  readonly isComposing?: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly shiftKey?: boolean
  readonly metaKey?: boolean
  readonly defaultPrevented?: boolean
}

/** 快捷键目录面:只用到固定行注册、固定输入观察与设备平台。 */
export interface ShortcutsFace {
  registerFixed: (command: FixedCommand) => () => void
  observeFixedInput: (listener: (input: unknown) => void) => () => void
  /** 接收输入的设备平台;`primary` 按它展开成 `meta`(macOS)或 `control`(其它)。 */
  readonly platform?: QuickSwitchPlatform
  readonly fixedCatalog?: {
    getSnapshot(): readonly { readonly id?: string }[]
  }
}

/** 固定行的形状(快捷键目录里的一条只读输入动作)。 */
export interface FixedCommand {
  readonly id: string
  readonly label: () => string
  readonly keys: readonly string[]
  readonly bindings: readonly unknown[]
  readonly group: 'application'
}

/** 浮层组件的类型:注册进槽位的是**组件本体**,不是渲染出来的元素。 */
export type OverlayComponent = (props: OverlayProps) => React.ReactElement | null

/** 槽位注册表面:只用到「等声明 + 注册」。 */
export interface SlotsFace {
  /**
   * 等某个槽被声明后再跑回调。
   *
   * 槽已经声明时回调**同步**执行并返回它交出来的清理函数;否则回调排队,等声明落地再跑,
   * 返回的仍是同一个清理函数。两种情形下都必须能立刻拿到清理函数。
   */
  inject(key: string, callback: () => undefined | (() => void)): () => void
  /**
   * 注册一个条目。
   *
   * 第二个参数必须是**组件本体**,不能是 `React.createElement(...)` 出来的元素 —— 渲染器对
   * 每个条目做的是 `jsx(entry.component, props)`,业务 props 只能由 `options.inject()` 交出来。
   *
   * 本方法与 {@link SlotsFace.inject} 都是上游**使用 `this` 的原型方法**:必须以槽位服务
   * 对象本身为接收者调用(`slots.register(...)`),由 Cordis 的服务代理把 `this.ctx` 换成
   * 调用方 scope;一旦把方法 bind/apply 到别处,上游读 `this.ctx` 就会直接抛错。
   */
  register(options: Record<string, unknown>, component: OverlayComponent): unknown
}

/** 浮层动作面:`uiWorkspace` 的公开动词里本插件唯一要用的那一个。 */
export interface WorkspaceNavigation {
  startSession(workspaceId: string): void
}

/** 宿主工作区控制器面:纯快照源。 */
export interface WorkspacesFace {
  readonly list: {
    getSnapshot(): { readonly items: readonly HostWorkspace[] }
    subscribe(listener: () => void): () => void
  }
}

/** 会话目录面:只用它把「主视图会话」映射回工作区。 */
export interface SessionsFace {
  readonly list: {
    getSnapshot(): {
      readonly ids: readonly string[]
      readonly byId: Readonly<Record<string, { readonly retainedBy?: { readonly mainView?: number } } | undefined>>
    }
    /** 订阅面(真实 `ISessions.list` 是 `ObservableSnapshot`);缺席只影响「当前」标记的实时性。 */
    subscribe?(listener: () => void): () => void
  }
}

/** 本插件注入依赖的收窄视图;Cordis 的 `Context` 结构上满足它。 */
export interface PaletteScope {
  effect(callback: () => undefined | (() => void), label?: string): unknown
  get(name: string): unknown
  /**
   * 等某个服务可用后再跑回调 —— Cordis 的子 fiber:服务齐了就运行,服务消失或换实现时先卸载
   * (回调里用 `scope.effect` 登记的清理函数随之跑掉)再重跑。
   *
   * 上游服务由远程链路提供、比本插件激活晚时,这是唯一能补上读数的做法:当场 `get` 一次只会
   * 读到 undefined,而且再也不会回头。
   */
  inject(names: readonly string[], setup: (scope: PaletteScope) => void): unknown
}

/** 往 `<head>` 挂一张样式表,并返回移除它的函数。 */
function installStyleTag(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.textContent = PALETTE_CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}

/**
 * 一次按键解码出的动作。
 *
 * 只认没有修饰键的 `Escape` / `Enter` / `ArrowDown` / `ArrowUp`;组合中、已被别的
 * 处理器消费、或带修饰键的按键统统放行(浮层不抢 `Ctrl+↑`、`Shift+↑` 这类有主的键)。
 * @param event - 按键事实。
 * @returns 动作,或不属于浮层时的 undefined。
 */
export function paletteAction(event: PaletteEventLike): PaletteAction | undefined {
  if (event.defaultPrevented === true) return undefined
  if (event.isComposing === true) return undefined
  if (event.ctrlKey === true || event.altKey === true || event.metaKey === true || event.shiftKey === true) return undefined
  // 按住不放的重复:选择键可以连按,取消与确认不行(避免一次长按连开好几个会话)。
  if (event.repeat === true && (event.key === 'Enter' || event.key === 'Escape')) return undefined
  if (event.key === 'Escape') return 'close'
  if (event.key === 'Enter') return 'confirm'
  if (event.key === 'ArrowDown') return 'next'
  if (event.key === 'ArrowUp') return 'previous'
  return undefined
}

/** 主视图会话所属的工作区 id;两处读数都不全时不返回(浮层就不标「当前」)。 */
function currentWorkspaceId(
  sessions: SessionsFace | undefined,
  workspaces: readonly HostWorkspace[],
): string | undefined {
  const list = sessions?.list.getSnapshot()
  if (list === undefined) return undefined
  const current = list.ids.find((id) => (list.byId[id]?.retainedBy?.mainView ?? 0) > 0)
  if (current === undefined) return undefined
  return workspaces.find((workspace) => workspace.sessionIds?.includes(current) === true)?.workspaceId
}

/** 捕获阶段的按键目标(document 结构上满足它)。 */
export interface PaletteKeyTarget {
  addEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture?: boolean): void
  removeEventListener(type: 'keydown', listener: (event: KeyboardEvent) => void, capture?: boolean): void
}

/**
 * 在捕获阶段接管浮层的四个键。
 *
 * 捕获监听先于任何本地控件看到按键,所以浮层一开,`Esc`/`Enter`/`↑`/`↓` 就归它;关掉
 * 之后立刻回到原来的归属。浮层没开时一个键都不动。
 * @param store - 浮层状态。
 * @param target - 按键目标,浏览器里是 `document`。
 * @returns 卸载函数。
 */
export function installPaletteKeys(store: PaletteStore, target: PaletteKeyTarget): () => void {
  if (target === undefined || target === null) return () => {}
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!store.getSnapshot().open) return
    const action = paletteAction(event)
    if (action === undefined) return
    // 这四个键归浮层:不让页面上任何本地控件拿到同一次按键。
    event.preventDefault()
    event.stopPropagation()
    if (action === 'close') store.close()
    else if (action === 'confirm') confirmActive(store)
    else store.move(action === 'next' ? 1 : -1)
  }
  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}

/** 浮层组件的 props:本插件只从容器收到一个 store。 */
export interface OverlayProps {
  readonly store: PaletteStore
}

/** 浮层本体:只在 `open` 为真时渲染,开着的时候按捕获阶段收到的按键动作。 */
export function PaletteOverlay(props: OverlayProps): React.ReactElement | null {
  const store = props.store
  const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const open = state.open
  const entries = state.entries

  React.useEffect(() => {
    if (!open) return
    panelRef.current?.focus()
  }, [open])

  React.useEffect(() => installPaletteKeys(store, document), [store])

  if (!open) return null

  const activeIndex = clampIndex(state.activeIndex, entries.length)
  const children: React.ReactNode[] = [
    React.createElement('div', { key: 'backdrop', className: 'dsh-workspace-quick-switch-backdrop' }),
    React.createElement(
      'div',
      {
        key: 'panel',
        ref: panelRef,
        className: 'dsh-workspace-quick-switch-panel',
        tabIndex: -1,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '工作区快速切换',
      },
      React.createElement(
        'div',
        { key: 'head', className: 'dsh-workspace-quick-switch-head' },
        React.createElement('span', { key: 'title', className: 'dsh-workspace-quick-switch-title' }, '新建会话于工作区'),
        React.createElement(
          'span',
          { key: 'count', className: 'dsh-workspace-quick-switch-count' },
          entries.length === 0 ? '左侧栏还没有工作区' : `前 ${entries.length} 个工作区`,
        ),
      ),
      entries.length === 0
        ? React.createElement(
            'div',
            { key: 'empty', className: 'dsh-workspace-quick-switch-empty' },
            '先在左侧栏添加一个工作区。',
          )
        : React.createElement(
            'div',
            {
              key: 'list',
              className: 'dsh-workspace-quick-switch-list',
              role: 'listbox',
              'aria-label': '工作区',
              'aria-activedescendant': optionDomId(activeIndex),
            },
            entries.map((entry, index) => optionElement(store, entry, index, index === activeIndex)),
          ),
      React.createElement(
        'div',
        { key: 'foot', className: 'dsh-workspace-quick-switch-foot' },
        React.createElement('span', { key: 'move' }, '↑ ↓ 选择'),
        React.createElement('span', { key: 'enter' }, 'Enter 新建会话'),
        React.createElement('span', { key: 'esc' }, 'Esc 关闭'),
      ),
    ),
  ]

  return React.createElement(
    'div',
    { className: 'dsh-workspace-quick-switch-overlay', [PALETTE_ROOT_ATTR]: '' },
    children,
  )
}

/** 一行候选项的 DOM id(与 `aria-activedescendant` 配对)。 */
function optionDomId(index: number): string {
  return `dsh-workspace-quick-switch-option-${index}`
}

/** 一行候选项。 */
function optionElement(store: PaletteStore, entry: PaletteEntry, index: number, active: boolean): React.ReactElement {
  const label = entry.title === '' ? entry.workspaceId : entry.title
  return React.createElement(
    'button',
    {
      key: entry.workspaceId,
      type: 'button',
      id: optionDomId(index),
      role: 'option',
      className: 'dsh-workspace-quick-switch-option',
      'aria-selected': active ? 'true' : 'false',
      [PALETTE_OPTION_ATTR]: '',
      // 悬停与键盘选中共用同一套高亮(见样式表),但只有键盘/点击会改选中行。
      'data-active': active ? 'true' : 'false',
      onClick: () => activate(store, index),
    },
    React.createElement('span', { key: 'index', className: 'dsh-workspace-quick-switch-index' }, `${index + 1}`),
    React.createElement(
      'span',
      { key: 'texts', className: 'dsh-workspace-quick-switch-texts' },
      React.createElement(
        'span',
        { key: 'label', className: 'dsh-workspace-quick-switch-label' },
        React.createElement('span', { key: 'name', className: 'dsh-workspace-quick-switch-name' }, label),
        entry.current === true
          ? React.createElement('span', { key: 'current', className: 'dsh-workspace-quick-switch-current' }, '当前')
          : null,
      ),
      React.createElement('span', { key: 'path', className: 'dsh-workspace-quick-switch-path' }, entry.path),
    ),
    active
      ? React.createElement('span', { key: 'enter', className: 'dsh-workspace-quick-switch-enter' }, 'Enter')
      : null,
  )
}

/** 确认当前选中行(Enter)。 */
function confirmActive(store: PaletteStore): void {
  activate(store, store.getSnapshot().activeIndex)
}

/**
 * 确认一行(点击或 Enter):先把选中行定到它,再关掉浮层,最后让容器执行动作。
 *
 * 顺序是有意的:动作(新建会话)会切走主视图,先关浮层就不会留下一个悬在切换之上的遮罩。
 * @param store - 浮层状态。
 * @param index - 被确认的行(可以是越界值,由 store 收敛)。
 */
function activate(store: PaletteStore, index: number): void {
  store.select(index)
  const binding = store.getSnapshot().binding
  store.close()
  if (binding === null) return
  binding()
}

/** 固定行:占据 `primary+alt+M` 并出现在快捷键目录(group `application`),键帽按平台格式化。 */
function fixedCommand(platform: QuickSwitchPlatform): FixedCommand {
  return {
    id: QUICK_SWITCH_ID,
    label: () => '工作区快速切换',
    keys: quickSwitchKeys(platform),
    bindings: [QUICK_SWITCH_BINDING],
    group: 'application',
  }
}

/**
 * 安装浮层:注册固定行、把浮层挂进 `shell.overlay`、接上固定输入通道。
 *
 * 本插件只等 `slots` / `shortcuts`:它们一就绪,`Ctrl+Alt+M` 与浮层就都在了。工作区与会话
 * 服务(都走远程链路,比这里晚)由两个等待子 fiber 接上,缺席时浮层按空候选打开并提示;
 * `uiWorkspace` 缺席时固定行照旧在(快捷键目录里可见),按键不做动作。
 * @param ctx - 客户端上下文。
 */
export function apply(ctx: { inject(names: readonly string[], setup: (scope: PaletteScope) => void): unknown }): void {
  ctx.inject(inject, (scope) => {
    const slots = readSlots(scope)
    if (slots === undefined) return
    const shortcuts = readShortcuts(scope)
    if (shortcuts === undefined) {
      warn('shortcuts 服务不可用:固定行与快捷键输入未安装')
      return
    }

    const store = createPaletteStore()
    // 平台只决定 `primary` 往哪边展开;服务缺席时按 Windows/Linux 的 `Ctrl+Alt` 兜底。
    const platform: QuickSwitchPlatform = shortcuts.platform ?? 'windows'

    /**
     * 把上游当前读数投影进 store:候选、当前工作区标记与选中行一起对齐。
     *
     * 每拍都从 `scope` 重新读服务,不缓存读数:`workspaces` / `sessions` 可能在订阅建立之后
     * 才到位(见下面的等待子 fiber),缓存住那一次 `undefined` 就再也补不回来了。
     */
    const refresh = (): void => {
      const workspaces = readWorkspaces(scope)
      const hosts = workspaces === undefined ? [] : workspaces.list.getSnapshot().items
      store.sync(paletteEntries(hosts, currentWorkspaceId(readSessions(scope), hosts), WORKSPACE_LIMIT))
    }

    scope.effect(installStyleTag, `${name}: palette styles`)
    // 固定行要先挂载,固定输入观察者才读得到它;三者同属一个 scope,按同序销毁。
    scope.effect(() => {
      try {
        return shortcuts.registerFixed(fixedCommand(platform))
      } catch (error) {
        warn(`固定行注册失败(${quickSwitchKeys(platform).join('+')} 未占用):`, error)
        return undefined
      }
    }, `${name}: quick switch fixed row`)
    scope.effect(
      () => shortcuts.observeFixedInput((input) => {
        if (!opensPalette(shortcuts, platform, input)) return
        openPalette(store, readNavigation(scope))
      }),
      `${name}: quick switch key`,
    )
    scope.effect(() => {
      let disposeSlot: undefined | (() => void)
      // `slots.inject` / `slots.register` 都以槽位服务对象本身为接收者调用:它们是上游使用
      // `this` 的原型方法,服务代理会据此把 `this.ctx` 换成我们这个 scope(于是注册项与
      // 清理函数都挂在同一个 fiber 上)。自己 bind 到 scope 会让上游连 `this.ctx` 都读不到。
      slots.inject('shell.overlay', () => {
        disposeSlot = slots.register(
          {
            name: 'shell.overlay',
            id: name,
            order: 60,
            // 业务 props 只能由 inject 交出来:渲染器对条目做的是 jsx(entry.component, props)。
            inject: () => ({ store }),
          },
          PaletteOverlay,
        ) as () => void
        return disposeSlot
      })
      // 槽已经声明时回调同步跑完,disposeSlot 此刻已经拿到;还没声明(ui-layout 尚未装配)
      // 时由回调自己交出的那个清理函数负责,这里什么都不用做。
      return () => disposeSlot?.()
    }, `${name}: palette overlay`)

    // 候选来源:`workspaces` 由工作区控制器经远程链路提供,激活时通常还不存在。
    scope.inject(['workspaces'], (inner) => {
      refresh()
      const workspaces = readWorkspaces(inner)
      if (workspaces === undefined) return
      inner.effect(() => workspaces.list.subscribe(refresh), `${name}: palette candidates`)
    })
    // 「当前工作区」标记要读会话目录的 `retainedBy.mainView`;它同属远程链路,而且主视图会话
    // 一换就该跟着对齐(浮层打开时的初始选中行由它决定),所以也订阅它。
    scope.inject(['sessions'], (inner) => {
      refresh()
      const list = readSessions(inner)?.list
      if (list === undefined || typeof list.subscribe !== 'function') return
      inner.effect(() => list.subscribe?.(refresh), `${name}: palette current`)
    })
  })
}

/** 打开浮层:动作为「在选中工作区新建会话」,初始选中行落在当前会话所在的工作区。 */
function openPalette(store: PaletteStore, navigation: WorkspaceNavigation | undefined): void {
  if (navigation === undefined) {
    warn('uiWorkspace 服务不可用:无法新建会话')
    return
  }
  const entry = (): void => {
    const snapshot = store.getSnapshot()
    const index = clampIndex(snapshot.activeIndex, snapshot.entries.length)
    const picked = index < 0 ? undefined : snapshot.entries[index]
    if (picked === undefined) return
    try {
      navigation.startSession(picked.workspaceId)
    } catch (error) {
      warn(`新建会话失败(${picked.workspaceId}):`, error)
    }
  }
  const current = store.getSnapshot().entries.findIndex((candidate) => candidate.current === true)
  store.open(entry, current < 0 ? 0 : current)
}

/**
 * 这次固定输入是否就是本插件那条固定组合(macOS `⌘⌥M`,Windows/Linux `Ctrl+Alt+M`)。
 *
 * 先按平台判定物理组合(再看一眼固定行是否真的挂上了);消费与组字一类由调用处放行。
 */
function opensPalette(shortcuts: ShortcutsFace, platform: QuickSwitchPlatform, input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false
  const candidate = input as { readonly type?: unknown; readonly gesture?: unknown }
  if (candidate.type !== 'keydown') return false
  const gesture = candidate.gesture as Partial<Record<string, unknown>> | undefined
  if (gesture === undefined || gesture === null) return false
  if (!quickSwitchPress(platform, gesture)) return false
  if (gesture.composing === true || gesture.repeat === true || gesture.defaultPrevented === true) return false
  const rows = shortcuts.fixedCatalog?.getSnapshot()
  return rows === undefined || rows.some((row) => row.id === QUICK_SWITCH_ID)
}

/** 从注入面读槽位表。 */
function readSlots(scope: PaletteScope): SlotsFace | undefined {
  const value = scope.get('slots')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<SlotsFace>
  if (typeof face.inject !== 'function' || typeof face.register !== 'function') return undefined
  return face as SlotsFace
}

/** 从注入面读快捷键目录。 */
function readShortcuts(scope: PaletteScope): ShortcutsFace | undefined {
  const value = scope.get('shortcuts')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<ShortcutsFace>
  if (typeof face.registerFixed !== 'function' || typeof face.observeFixedInput !== 'function') return undefined
  return face as ShortcutsFace
}

/** 从注入面读 `uiWorkspace`。 */
function readNavigation(scope: PaletteScope): WorkspaceNavigation | undefined {
  const value = scope.get('uiWorkspace')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<WorkspaceNavigation>
  if (typeof face.startSession !== 'function') return undefined
  return face as WorkspaceNavigation
}

/** 从注入面读宿主工作区控制器(缺席时浮层按空候选打开)。 */
function readWorkspaces(scope: PaletteScope): WorkspacesFace | undefined {
  const value = scope.get('workspaces')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<WorkspacesFace>
  if (face.list === undefined || typeof face.list.getSnapshot !== 'function' || typeof face.list.subscribe !== 'function') {
    return undefined
  }
  return face as WorkspacesFace
}

/** 从注入面读会话目录(缺席时只影响「当前工作区」标记)。 */
function readSessions(scope: PaletteScope): SessionsFace | undefined {
  const value = scope.get('sessions')
  if (typeof value !== 'object' || value === null) return undefined
  const face = value as Partial<SessionsFace>
  if (face.list === undefined || typeof face.list.getSnapshot !== 'function') return undefined
  return face as SessionsFace
}

/** 输出一行带插件前缀的诊断。 */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}

