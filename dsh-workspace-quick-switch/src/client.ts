/**
 * 浏览器半部：两张浮层，各占一条固定键。
 *
 *   - **工作区浮层**：`⌘⌥M`（macOS）/ `Ctrl+Alt+M`（Windows、Linux）按左侧栏 Workspace
 *     分组的顺序列出工作区，`Enter` 在该工作区**新建会话**；
 *   - **会话浮层**：`⌘⌥I`（macOS）/ `Ctrl+Alt+I`（Windows、Linux）按左侧栏「单列表 +
 *     最近更新 + 隐藏已归档」的顺序列出会话，`Enter` **打开**选中的会话。
 *
 * 两条固定行声明的都是逻辑组合 `primary+alt`+字母，注册表在 macOS 上展开成 `meta+alt`
 * （⌘⌥）、在 Windows/Linux 上展开成 `control+alt`（Ctrl+Alt），所以同一份声明在两端
 * 各是各的键。
 *
 * 两张浮层共用同一套组件（`overlay.tsx`）、同一套样式（`style.ts`）与状态层（`palette.ts`），
 * 只是候选来源与确认动作不同：工作区候选照抄 Workspace 控制器的 `list` 快照；会话候选由
 * `sessions.ts` 按左侧栏的派生链投影。四条通路（固定行 / 浮层槽 / 浮层内按键 / 终端内打开键）
 * 的说明见 docs/dsh-workspace-quick-switch.md。
 *
 * 可见文案（标题、空态、底栏、角标、相对时间、固定行名称）全部走 Client locale；
 * 本文件只做装配，不渲染。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ShortcutBinding,
  ShortcutCommandId,
  ShortcutFixedCommand,
  ShortcutFixedInput,
  ShortcutGesture,
  ShortcutPlatform,
  Shortcuts,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// 只取模块增强:`Context['sessions'].list` 的 `SessionSummary.retainedBy.mainView`
// 由 ui-session 合并进 `SessionReferenceSourceMap`。
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { NS, en, sessionTextsOf, translateZh, zh, type PaletteLocaleNS } from './locales.ts'
import { PaletteOverlay } from './overlay.tsx'
import {
  QUICK_SWITCH_BINDING,
  QUICK_SWITCH_ID,
  SESSION_SWITCH_BINDING,
  SESSION_SWITCH_ID,
  bindingPress,
  clampIndex,
  createPaletteStore,
  currentRowIndex,
  paletteEntries,
  quickSwitchKeys,
  sessionSwitchKeys,
  type PaletteStore,
} from './palette.ts'
import { installStyleTag } from './style.ts'
import { name } from './runtime.ts'
import { sessionPaletteEntries } from './sessions.ts'
import { sessionView, workspaceView } from './views.ts'
import type { PaletteTranslate } from './views.ts'

export { name }

/** 浮层依赖的三个客户端服务;slots / shortcuts 任一缺席就整体不安装，locale 缺席时退回简体中文。 */
export const inject = ['slots', 'shortcuts', 'locale']

/** 测试与产物检查用的再导出：组件、样式与纯函数仍从入口取。 */
export { PaletteOverlay } from './overlay.tsx'
export { PALETTE_CSS, CLASS, installStyleTag } from './style.ts'
export {
  PALETTE_OPTION_ATTR,
  PALETTE_ROOT_ATTR,
  SESSION_OPTION_ATTR,
  SESSION_ROOT_ATTR,
  SESSION_VIEW,
  WORKSPACE_VIEW,
  countLabel,
  optionDomId,
  sessionView,
  workspaceView,
} from './views.ts'
export {
  activate,
  confirmActive,
  installPaletteKeys,
  installPaletteWheel,
  keepOptionVisible,
  paletteAction,
  wheelPixels,
  wheelStep,
} from './keys.ts'

/** 主视图会话所属的工作区 id;两处读数都不全时不返回(浮层就不标「当前」)。 */
function currentWorkspaceId(
  sessions: Sessions | undefined,
  workspaces: readonly WorkspaceView[],
): WorkspaceId | undefined {
  const list = sessions?.list.getSnapshot()
  if (list === undefined) return undefined
  const current = list.ids.find((id) => (list.byId[id]?.retainedBy?.mainView ?? 0) > 0)
  if (current === undefined) return undefined
  return workspaces.find((workspace) => workspace.sessionIds?.includes(current) === true)?.workspaceId
}

/** 会话目录服务面:上游 `ctx.sessions`(候选来源与「主视图会话」标记)。 */
type Sessions = Context['sessions']

/** 宿主工作区服务面:上游 `ctx.workspaces`(候选来源与置顶/归档集合)。 */
type Workspaces = Context['workspaces']

/** 工作区浮层的固定行:占据 `primary+alt+M`,键帽按平台格式化。 */
function workspaceFixedCommand(platform: ShortcutPlatform, t: PaletteTranslate): ShortcutFixedCommand {
  return {
    id: QUICK_SWITCH_ID as ShortcutCommandId,
    label: () => t('workspaceFixedLabel'),
    keys: quickSwitchKeys(platform),
    bindings: [QUICK_SWITCH_BINDING],
    group: 'application',
  }
}

/** 会话浮层的固定行:占据 `primary+alt+I`,键帽按平台格式化。 */
function sessionFixedCommand(platform: ShortcutPlatform, t: PaletteTranslate): ShortcutFixedCommand {
  return {
    id: SESSION_SWITCH_ID as ShortcutCommandId,
    label: () => t('sessionFixedLabel'),
    keys: sessionSwitchKeys(platform),
    bindings: [SESSION_SWITCH_BINDING],
    group: 'application',
  }
}

export function apply(ctx: Context): void {
  ctx.inject(inject, (scope) => {
    const slots = readSlots(scope)
    if (slots === undefined) return
    const shortcuts = readShortcuts(scope)
    if (shortcuts === undefined) {
      warn('shortcuts 服务不可用:固定行与快捷键输入未安装')
      return
    }

    // 可见文案走 Client locale；字典登记在 scope 上，随插件 fiber 卸载一起撤回。
    // locale 服务缺席（受限环境 / 测试桩）时退回简体中文字典。
    const locale = readLocale(scope)
    if (locale !== undefined) {
      scope.effect(() => locale.register(NS, { zh, en }), `${name}: dictionaries`)
    }
    const t = locale === undefined ? translateZh : locale.bind(NS)
    const workspacePaletteView = workspaceView(t)
    const sessionPaletteView = sessionView(t)
    const sessionTexts = sessionTextsOf(t)

    const workspaceStore = createPaletteStore()
    const sessionStore = createPaletteStore()
    // 平台只决定 `primary` 往哪边展开;服务缺席时按 Windows/Linux 的 `Ctrl+Alt` 兜底。
    const platform: ShortcutPlatform = (shortcuts.platform as ShortcutPlatform | undefined) ?? 'windows'

    /**
     * 把上游当前读数投影进两个 store:候选、当前标记与选中行一起对齐。
     *
     * 每拍都从 `scope` 重新读服务,不缓存读数:`workspaces` / `sessions` 可能在订阅建立之后
     * 才到位(见下面的等待子 fiber),缓存住那一次 `undefined` 就再也补不回来了。
     */
    const refresh = (): void => {
      const workspaces = readWorkspaces(scope)
      const snapshot = workspaces?.list.getSnapshot()
      const hosts = snapshot?.items ?? []
      const sessions = readSessions(scope)
      const list = sessions?.list.getSnapshot()
      workspaceStore.sync(paletteEntries(hosts, currentWorkspaceId(sessions, hosts)))
      sessionStore.sync(list === undefined ? [] : sessionPaletteEntries({
        sessions: list,
        workspaces: hosts,
        rowState: {
          archivedSessionIds: snapshot?.archivedSessionIds ?? [],
          pinnedSessionIds: snapshot?.pinnedSessionIds ?? [],
        },
        texts: sessionTexts,
      }))
    }

    /** 打开会话浮层:先关掉工作区浮层(两张浮层互斥),动作为「打开选中会话」。 */
    const openSessionPalette = (): void => {
      workspaceStore.close()
      openSessionStore(sessionStore, readNavigation(scope))
    }

    /** 打开工作区浮层:先关掉会话浮层,动作为「在选中工作区新建会话」。 */
    const openWorkspacePalette = (): void => {
      sessionStore.close()
      openWorkspaceStore(workspaceStore, readNavigation(scope))
    }

    scope.effect(installStyleTag, `${name}: palette styles`)
    // 固定行要先挂载,固定输入观察者才读得到它;三者同属一个 scope,卸载时按登记逆序跑清理函数。
    scope.effect(() => {
      const disposeWorkspace = registerFixedRow(shortcuts, workspaceFixedCommand(platform, t))
      const disposeSession = registerFixedRow(shortcuts, sessionFixedCommand(platform, t))
      return () => {
        disposeWorkspace?.()
        disposeSession?.()
      }
    }, `${name}: quick switch fixed rows`)
    scope.effect(
      () => shortcuts.observeFixedInput((input) => {
        const target = ownedPalette(shortcuts, platform, fixedGesture(input))
        if (target === undefined) return
        // 先把这次按键收归本插件,再开浮层:consume() 一调用,平台就不会把同一次 ⌘⌥M 再执行
        // 一遍自己的快捷键,排在后面的固定行观察者也会看到已消费输入。
        consumeFixedInput(input)
        if (target === 'session') openSessionPalette()
        else openWorkspacePalette()
      }),
      `${name}: quick switch key`,
    )
    // 终端那一半:落在 `.xterm` 内的 keydown 到不了上面的固定通道(终端在自己的 textarea
    // 处理器里 `stopPropagation()`),本捕获监听早一个阶段看到它,在事件进入终端前判定并
    // 吞掉这一按,再开对应的浮层。判定与固定通道共用 `ownedPalette`,两条路径互斥。
    scope.effect(() => {
      if (typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown') return
        const element = composedElement(event)
        if (element === null || element.closest('.xterm') === null) return
        const target = ownedPalette(shortcuts, platform, keyGesture(event))
        if (target === undefined) return
        // 在终端自身处理器之前拦截:事件到此为止,xterm 既收不到这一按,也不会把
        // `Ctrl+Alt+M` / `Ctrl+Alt+I` 当成 AltGr 字符送进 shell。
        event.preventDefault()
        event.stopPropagation()
        if (target === 'session') openSessionPalette()
        else openWorkspacePalette()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: quick switch terminal capture`)
    // macOS 的死键补偿:Option+I 是死键(ˆ),官方固定通道会把这一按标成组字中,观察者于是
    // 让位。这一条在同一阶段认领 `key === 'Dead'` 的 ⌘⌥I / ⌘⌥M。焦点在 `.xterm` 内时让给
    // 上面的终端捕获(它只读 `isComposing`,不受死键影响)。
    scope.effect(() => {
      if (platform !== 'macos' || typeof window === 'undefined') return () => {}
      const onKeydown = (event: KeyboardEvent): void => {
        if (event.type !== 'keydown' || event.key !== 'Dead') return
        if (isComposingEvent(event) || event.defaultPrevented === true) return
        const element = composedElement(event)
        if (element !== null && element.closest('.xterm') !== null) return
        const target = ownedPalette(shortcuts, platform, keyGesture(event))
        if (target === undefined) return
        // 先吞掉这一按:不让浏览器开始死键组合,也不让官方固定通道再看到它。
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat === true) return
        if (target === 'session') openSessionPalette()
        else openWorkspacePalette()
      }
      window.addEventListener('keydown', onKeydown, true)
      return () => window.removeEventListener('keydown', onKeydown, true)
    }, `${name}: quick switch dead key capture`)
    scope.effect(() => {
      let disposeWorkspace: undefined | (() => void)
      let disposeSession: undefined | (() => void)
      // `slots.inject` / `slots.register` 以槽位服务对象本身为接收者调用:它们是上游使用
      // `this` 的原型方法,服务代理会据此把 `this.ctx` 换成我们这个 scope(于是注册项与
      // 清理函数都挂在同一个 fiber 上)。自己 bind 到 scope 会让上游连 `this.ctx` 都读不到。
      slots.inject('shell.overlay', () => {
        disposeWorkspace = slots.register(
          {
            name: 'shell.overlay',
            id: name,
            order: 60,
            // 业务 props 只能由 inject 交出来:渲染器对条目做的是 jsx(entry.component, props)。
            inject: () => ({ store: workspaceStore, view: workspacePaletteView, t }),
          },
          PaletteOverlay,
        )
        disposeSession = slots.register(
          {
            name: 'shell.overlay',
            id: sessionPaletteView.id,
            order: 61,
            inject: () => ({ store: sessionStore, view: sessionPaletteView, t }),
          },
          PaletteOverlay,
        )
        return () => {
          disposeWorkspace?.()
          disposeSession?.()
        }
      })
      // 槽已经声明时回调同步跑完,dispose 此刻已经拿到;还没声明(ui-layout 尚未装配)
      // 时由回调自己交出的那个清理函数负责,这里什么都不用做。
      return () => {
        disposeWorkspace?.()
        disposeSession?.()
      }
    }, `${name}: palette overlays`)

    // 候选来源:`workspaces` 由工作区控制器经远程链路提供,激活时通常还不存在。
    // 工作区浮层的顺序与「当前工作区」、会话浮层的归属标签与置顶/归档集合都从这里来。
    scope.inject(['workspaces'], (inner) => {
      refresh()
      const workspaces = readWorkspaces(inner)
      if (workspaces === undefined) return
      inner.effect(() => workspaces.list.subscribe(refresh), `${name}: palette candidates`)
    })
    // 会话目录既是工作区浮层的「当前」标记来源,也是会话浮层的候选来源:主视图会话一换,
    // 两份读数都要跟着对齐。它同属远程链路,所以同样用等待子 fiber。
    scope.inject(['sessions'], (inner) => {
      refresh()
      const list = readSessions(inner)?.list
      if (list === undefined || typeof list.subscribe !== 'function') return
      inner.effect(() => list.subscribe?.(refresh), `${name}: palette current`)
    })
  })
}

/**
 * 注册一条固定行;注册失败只告警(该组合键不归本插件),不影响另一条。
 * @param shortcuts - 快捷键服务。
 * @param command - 固定行声明。
 * @returns 注销函数;注册失败时为 undefined。
 */
function registerFixedRow(shortcuts: Shortcuts, command: ShortcutFixedCommand): (() => void) | undefined {
  try {
    return shortcuts.registerFixed(command)
  } catch (error) {
    warn(`固定行注册失败(${command.keys.join('+')} 未占用):`, error)
    return undefined
  }
}

/** 打开工作区浮层:动作为「在选中工作区新建会话」,初始选中行落在当前会话所在的工作区。 */
function openWorkspaceStore(store: PaletteStore, navigation: UiWorkspace | undefined): void {
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
      navigation.startSession(picked.key as WorkspaceId)
    } catch (error) {
      warn(`新建会话失败(${picked.key}):`, error)
    }
  }
  const current = currentRowIndex(store.getSnapshot().entries)
  store.open(entry, current < 0 ? 0 : current)
}

/**
 * 打开会话浮层:动作为「打开选中会话」,初始选中行落在主视图会话上。
 *
 * `openSession` 缺席(上游换了动词名)时只告警、不开浮层 —— 打开一个按 Enter 什么也不做的
 * 列表比不打开更让人困惑。
 */
function openSessionStore(store: PaletteStore, navigation: UiWorkspace | undefined): void {
  const openSession = navigation?.openSession
  if (navigation === undefined || typeof openSession !== 'function') {
    warn('uiWorkspace 服务不可用:无法打开会话')
    return
  }
  const entry = (): void => {
    const snapshot = store.getSnapshot()
    const index = clampIndex(snapshot.activeIndex, snapshot.entries.length)
    const picked = index < 0 ? undefined : snapshot.entries[index]
    if (picked === undefined) return
    try {
      navigation.openSession?.(picked.key as SessionId)
    } catch (error) {
      warn(`打开会话失败(${picked.key}):`, error)
    }
  }
  const current = currentRowIndex(store.getSnapshot().entries)
  store.open(entry, current < 0 ? 0 : current)
}

/** 固定输入读数里的按键事实;不是 keydown 或没有 gesture 时返回 undefined。 */
function fixedGesture(input: ShortcutFixedInput): ShortcutGesture | undefined {
  if (input.type !== 'keydown') return undefined
  // 上游类型保证 keydown 一定带 gesture;测试替身可能省略或给 null,按「缺席」处理。
  return (input.gesture as ShortcutGesture | null | undefined) ?? undefined
}

/** 命中的是哪张浮层。 */
export type PaletteKind = 'workspace' | 'session'

/**
 * 一次按键事实归哪张浮层。
 *
 * 两条投递路径(固定通道的观察者与终端前的捕获拦截)共用本判定:平台物理组合完全匹配
 * (先试工作区的 `⌘⌥M` / `Ctrl+Alt+M`,再试会话的 `⌘⌥I` / `Ctrl+Alt+I`)、不是组字 / 长按 /
 * 已被消费的输入,且对应的固定行真的还挂在目录里(被别的注册者挤掉时这一按就"无主")。
 * @param shortcuts - 快捷键服务。
 * @param platform - 接收输入的设备平台。
 * @param gesture - 按键事实(KeyboardEvent 或固定通道读数结构上都满足);缺席时无主。
 * @returns 归属的浮层;不归本插件时 undefined。
 */
export function ownedPalette(
  shortcuts: Shortcuts,
  platform: ShortcutPlatform,
  gesture: ShortcutGesture | undefined,
): PaletteKind | undefined {
  if (gesture === undefined) return undefined
  if (gesture.composing === true || gesture.repeat === true || gesture.defaultPrevented === true) return undefined
  if (bindingOwns(shortcuts, platform, QUICK_SWITCH_BINDING, QUICK_SWITCH_ID, gesture)) return 'workspace'
  if (bindingOwns(shortcuts, platform, SESSION_SWITCH_BINDING, SESSION_SWITCH_ID, gesture)) return 'session'
  return undefined
}

/** 物理组合匹配 + 固定行仍在目录里。 */
function bindingOwns(
  shortcuts: Shortcuts,
  platform: ShortcutPlatform,
  binding: ShortcutBinding,
  id: string,
  gesture: ShortcutGesture,
): boolean {
  if (!bindingPress(platform, binding, gesture)) return false
  const rows = shortcuts.fixedCatalog?.getSnapshot()
  return rows === undefined || rows.some((row) => row.id === id)
}

/**
 * 这次固定输入是否就是工作区浮层那条组合(macOS `⌘⌥M`,Windows/Linux `Ctrl+Alt+M`)。
 *
 * 保留为独立导出:终端捕获与固定通道共用 `ownedPalette`,这里只回答「是不是工作区那张」。
 */
export function quickSwitchOwns(
  shortcuts: Shortcuts,
  platform: ShortcutPlatform,
  gesture: ShortcutGesture | undefined,
): boolean {
  return ownedPalette(shortcuts, platform, gesture) === 'workspace'
}

/** 这次固定输入是否就是会话浮层那条组合(macOS `⌘⌥I`,Windows/Linux `Ctrl+Alt+I`)。 */
export function sessionSwitchOwns(
  shortcuts: Shortcuts,
  platform: ShortcutPlatform,
  gesture: ShortcutGesture | undefined,
): boolean {
  return ownedPalette(shortcuts, platform, gesture) === 'session'
}

/** 与上游键盘适配器一致：isComposing、旧 keyCode 229、AltGraph 都算组合输入。 */
function isComposingEvent(event: KeyboardEvent): boolean {
  if (event.isComposing === true) return true
  if (event.keyCode === 229) return true
  return typeof event.getModifierState === 'function' && event.getModifierState('AltGraph') === true
}

/** 从一次原生 keydown 里取出本插件要读的手势事实(捕获阶段 `defaultPrevented` 恒为 false)。 */
function keyGesture(event: KeyboardEvent): ShortcutGesture {
  return {
    code: event.code,
    control: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    repeat: event.repeat,
    composing: isComposingEvent(event),
    defaultPrevented: false,
  }
}

/**
 * 事件组合路径上的第一个 Element(按 `closest` 这一项能力做鸭子类型判断,测试可以传普通假元素)。
 */
function composedElement(event: KeyboardEvent): Element | null {
  for (const value of event.composedPath()) {
    if (typeof value === 'object' && value !== null && 'closest' in value) return value as Element
  }
  return null
}

/**
 * 把这次固定输入收归本插件:调用适配器交出来的 `consume`(它就是 `event.preventDefault()`)。
 *
 * 固定行只「占住」组合键,上游**不会**替它消费:`effectiveShortcuts` 把带 `fixed` 的行排除在
 * 可配置行之外,于是 `dispatch` 里那条「处理成功就 `consume()`」永远轮不到固定行。所以不主动
 * 消费的话,这次按键会被平台再执行一遍自己的快捷键 —— macOS 上 `⌘⌥M` 顺手最小化窗口正是
 * 这一条。消费必须发生在按键派发的同一拍里,而固定通道本来就是同步回调。
 * @param input - 固定输入读数;没有 `consume` 的替身输入(测试夹具)直接跳过。
 */
function consumeFixedInput(input: ShortcutFixedInput): void {
  if (input.type !== 'keydown') return
  if (typeof input.consume === 'function') input.consume()
}

/** 从注入面读槽位服务。 */
function readSlots(scope: Context): SlotRegistry | undefined {
  const value = scope.get('slots')
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.inject !== 'function' || typeof value.register !== 'function') return undefined
  return value
}

/** 从注入面读快捷键服务。 */
function readShortcuts(scope: Context): Shortcuts | undefined {
  const value = scope.get('shortcuts')
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.registerFixed !== 'function' || typeof value.observeFixedInput !== 'function') return undefined
  return value
}

/** 从注入面读 `uiWorkspace`。 */
function readNavigation(scope: Context): UiWorkspace | undefined {
  const value = scope.get('uiWorkspace')
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.startSession !== 'function') return undefined
  return value
}

/** 从注入面读宿主工作区控制器(缺席时浮层按空候选打开)。 */
function readWorkspaces(scope: Context): Workspaces | undefined {
  const value = scope.get('workspaces')
  if (typeof value !== 'object' || value === null) return undefined
  if (value.list === undefined || typeof value.list.getSnapshot !== 'function' || typeof value.list.subscribe !== 'function') {
    return undefined
  }
  return value
}

/** 从注入面读会话目录(缺席时两张浮层都只是空候选)。 */
function readSessions(scope: Context): Sessions | undefined {
  const value = scope.get('sessions')
  if (typeof value !== 'object' || value === null) return undefined
  if (value.list === undefined || typeof value.list.getSnapshot !== 'function') return undefined
  return value
}

/** 从注入面读 locale 服务(字典注册与翻译)。 */
function readLocale(scope: Context): Context['locale'] | undefined {
  const value = scope.get('locale')
  if (typeof value !== 'object' || value === null) return undefined
  if (typeof value.bind !== 'function' || typeof value.register !== 'function') return undefined
  return value as Context['locale']
}

/** 输出一行带插件前缀的诊断。 */
function warn(message: string, detail?: unknown): void {
  if (detail === undefined) console.warn(`[${name}] ${message}`)
  else console.warn(`[${name}] ${message}`, detail)
}
