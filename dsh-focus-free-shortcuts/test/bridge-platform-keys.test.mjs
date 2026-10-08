/**
 * 平台键位端到端:四条自挂固定行声明的都是逻辑组合(`primary`),注册表按平台落成物理
 * 键位 —— macOS 上是 `⌘` 系(`⌘⌥J` / `⌘⌥←→` / `⌘↑↓` / `⌘⌥↑↓`),Windows/Linux 上仍是
 * `Ctrl` 系(`Ctrl+Alt+J` / `Ctrl+Alt+←→` / `Ctrl+↑↓` / `Ctrl+Alt+↑↓`);键帽标签同一趟按
 * 平台格式化,而且各平台只认自己那一组物理键(另一平台的组合不动作、不消费)。
 */
import {
  check,
  checkTrue,
  domBody,
  fakeDocument,
  fakePageSidebar,
  fakeUiSession,
  finish,
  harness,
  keydown,
  session,
  shortcutContext,
  sidebarTree,
  statusTable,
  FOCUS_COMPOSER_ID,
  FOCUS_COMPOSER_MAC_PRESS,
  FOCUS_COMPOSER_PRESS,
  PAGE_CYCLE_ID,
  PAGE_NEXT_MAC_PRESS,
  PAGE_NEXT_PRESS,
  SESSION_ACTIVE_CYCLE_ID,
  SESSION_ACTIVE_NEXT_MAC_PRESS,
  SESSION_ACTIVE_NEXT_PRESS,
  SESSION_CYCLE_ID,
  SESSION_NEXT_MAC_PRESS,
  SESSION_NEXT_PRESS,
} from './helpers.mjs'

/** 装假 document(侧栏树),用完还原。 */
function withDocument(root) {
  const previous = globalThis.document
  globalThis.document = fakeDocument({ root })
  return () => {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

/** 一段可聚焦的假 composer facade。 */
function focusingFacade() {
  const facade = { calls: 0, focus() { facade.calls += 1 } }
  return facade
}

/** 一份三个会话的目录摘要:主视图停在 s1。 */
function summary() {
  return {
    s1: session('s1', { running: false }),
    s2: session('s2', { mainView: 0, running: false }),
    s3: session('s3', { mainView: 0, running: false }),
  }
}

const MAC_MODIFIERS = ['alt', 'meta']
const WINDOWS_MODIFIERS = ['control', 'alt']

console.log('--- R① 固定行按平台落成物理键位与键帽 ---')
{
  const mac = harness({ platform: 'macos' }).shortcuts.fixedCatalog.getSnapshot()
  const byId = (rows, id) => rows.find((row) => row.id === id)
  check('macOS 聚焦输入框行绑定', byId(mac, FOCUS_COMPOSER_ID).bindings, [{ code: 'KeyJ', modifiers: MAC_MODIFIERS }])
  check('macOS 聚焦输入框键帽', byId(mac, FOCUS_COMPOSER_ID).keys, ['⌘', '⌥', 'J'])
  check('macOS 页面循环行绑定', byId(mac, PAGE_CYCLE_ID).bindings, [
    { code: 'ArrowLeft', modifiers: MAC_MODIFIERS },
    { code: 'ArrowRight', modifiers: MAC_MODIFIERS },
  ])
  check('macOS 页面循环键帽', byId(mac, PAGE_CYCLE_ID).keys, ['⌘', '⌥', '←/→'])
  check('macOS 全部候选会话行绑定', byId(mac, SESSION_CYCLE_ID).bindings, [
    { code: 'ArrowUp', modifiers: ['meta'] },
    { code: 'ArrowDown', modifiers: ['meta'] },
  ])
  check('macOS 全部候选会话行键帽', byId(mac, SESSION_CYCLE_ID).keys, ['⌘', '↑/↓'])
  check('macOS 活跃会话行绑定', byId(mac, SESSION_ACTIVE_CYCLE_ID).bindings, [
    { code: 'ArrowUp', modifiers: MAC_MODIFIERS },
    { code: 'ArrowDown', modifiers: MAC_MODIFIERS },
  ])
  check('macOS 活跃会话行键帽', byId(mac, SESSION_ACTIVE_CYCLE_ID).keys, ['⌘', '⌥', '↑/↓'])

  const windows = harness({ platform: 'windows' }).shortcuts.fixedCatalog.getSnapshot()
  check('Windows 聚焦输入框行绑定', byId(windows, FOCUS_COMPOSER_ID).bindings, [{ code: 'KeyJ', modifiers: WINDOWS_MODIFIERS }])
  check('Windows 聚焦输入框键帽', byId(windows, FOCUS_COMPOSER_ID).keys, ['Ctrl', 'Alt', 'J'])
  check('Windows 页面循环行绑定', byId(windows, PAGE_CYCLE_ID).bindings, [
    { code: 'ArrowLeft', modifiers: WINDOWS_MODIFIERS },
    { code: 'ArrowRight', modifiers: WINDOWS_MODIFIERS },
  ])
  check('Windows 页面循环键帽', byId(windows, PAGE_CYCLE_ID).keys, ['Ctrl', 'Alt', '←/→'])
  check('Windows 全部候选会话行绑定', byId(windows, SESSION_CYCLE_ID).bindings, [
    { code: 'ArrowUp', modifiers: ['control'] },
    { code: 'ArrowDown', modifiers: ['control'] },
  ])
  check('Windows 全部候选会话行键帽', byId(windows, SESSION_CYCLE_ID).keys, ['Ctrl', '↑/↓'])
  check('Windows 活跃会话行绑定', byId(windows, SESSION_ACTIVE_CYCLE_ID).bindings, [
    { code: 'ArrowUp', modifiers: WINDOWS_MODIFIERS },
    { code: 'ArrowDown', modifiers: WINDOWS_MODIFIERS },
  ])
  check('Windows 活跃会话行键帽', byId(windows, SESSION_ACTIVE_CYCLE_ID).keys, ['Ctrl', 'Alt', '↑/↓'])
}

console.log('--- R② 聚焦输入框:各平台只认自己那一组 ---')
{
  const macFacade = focusingFacade()
  const mac = harness({ platform: 'macos', conversation: { input: { for: () => macFacade } } })
  const macPress = keydown(FOCUS_COMPOSER_MAC_PRESS, shortcutContext({ target: domBody }))
  mac.shortcuts.emit(macPress.input)
  check('macOS ⌘⌥J 聚焦', macFacade.calls, 1)
  check('macOS ⌘⌥J 消费', macPress.consumed.count, 1)
  const macCtrl = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  mac.shortcuts.emit(macCtrl.input)
  check('macOS 上 Ctrl+Alt+J 不聚焦', macFacade.calls, 1)
  check('macOS 上 Ctrl+Alt+J 不消费', macCtrl.consumed.count, 0)

  const winFacade = focusingFacade()
  const win = harness({ platform: 'windows', conversation: { input: { for: () => winFacade } } })
  const winPress = keydown(FOCUS_COMPOSER_PRESS, shortcutContext({ target: domBody }))
  win.shortcuts.emit(winPress.input)
  check('Windows Ctrl+Alt+J 聚焦', winFacade.calls, 1)
  check('Windows Ctrl+Alt+J 消费', winPress.consumed.count, 1)
  const winMeta = keydown(FOCUS_COMPOSER_MAC_PRESS, shortcutContext({ target: domBody }))
  win.shortcuts.emit(winMeta.input)
  check('Windows 上 ⌘⌥J 不聚焦', winFacade.calls, 1)
  check('Windows 上 ⌘⌥J 不消费', winMeta.consumed.count, 0)
}

console.log('--- R③ 页面循环:各平台只认自己那一组 ---')
{
  const macSidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const mac = harness({ platform: 'macos', sidebar: macSidebar })
  const macPress = keydown(PAGE_NEXT_MAC_PRESS, shortcutContext({ target: null }))
  mac.shortcuts.emit(macPress.input)
  check('macOS ⌘⌥→ 切页', macSidebar.focusCalls, ['t2'])
  check('macOS ⌘⌥→ 消费', macPress.consumed.count, 1)
  const macCtrl = keydown(PAGE_NEXT_PRESS, shortcutContext({ target: null }))
  mac.shortcuts.emit(macCtrl.input)
  check('macOS 上 Ctrl+Alt+→ 不切页', macSidebar.focusCalls, ['t2'])
  check('macOS 上 Ctrl+Alt+→ 不消费', macCtrl.consumed.count, 0)

  const winSidebar = fakePageSidebar({ list: ['t1', 't2'], active: 't1' })
  const win = harness({ platform: 'windows', sidebar: winSidebar })
  const winPress = keydown(PAGE_NEXT_PRESS, shortcutContext({ target: null }))
  win.shortcuts.emit(winPress.input)
  check('Windows Ctrl+Alt+→ 切页', winSidebar.focusCalls, ['t2'])
  check('Windows Ctrl+Alt+→ 消费', winPress.consumed.count, 1)
  const winMeta = keydown(PAGE_NEXT_MAC_PRESS, shortcutContext({ target: null }))
  win.shortcuts.emit(winMeta.input)
  check('Windows 上 ⌘⌥→ 不切页', winSidebar.focusCalls, ['t2'])
  check('Windows 上 ⌘⌥→ 不消费', winMeta.consumed.count, 0)
}

console.log('--- R④ 会话导航:各平台只认自己那一组(全部候选与活跃池两条行) ---')
{
  const restore = withDocument(sidebarTree([{ key: 'w1', sessions: ['s1', 's2', 's3'] }]))
  try {
    const sidebar = () => fakePageSidebar({ list: ['t1', 't2'], active: 't1' })

    const mac = harness({
      platform: 'macos',
      sidebar: sidebar(),
      summary: summary(),
      uiSession: fakeUiSession({ status: statusTable({ s3: { running: true } }) }),
    })
    const macNext = keydown(SESSION_NEXT_MAC_PRESS, shortcutContext({ target: null }))
    mac.shortcuts.emit(macNext.input)
    check('macOS ⌘↓ 走全部候选', mac.navigation.opened, ['s2'])
    check('macOS ⌘↓ 消费', macNext.consumed.count, 1)
    const macActive = keydown(SESSION_ACTIVE_NEXT_MAC_PRESS, shortcutContext({ target: null }))
    mac.shortcuts.emit(macActive.input)
    check('macOS ⌘⌥↓ 走活跃池', mac.navigation.opened, ['s2', 's3'])
    const macCtrl = keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null }))
    mac.shortcuts.emit(macCtrl.input)
    check('macOS 上 Ctrl+↓ 不动', mac.navigation.opened, ['s2', 's3'])
    check('macOS 上 Ctrl+↓ 不消费', macCtrl.consumed.count, 0)
    const macCtrlActive = keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null }))
    mac.shortcuts.emit(macCtrlActive.input)
    check('macOS 上 Ctrl+Alt+↓ 不动', mac.navigation.opened, ['s2', 's3'])
    check('macOS 上 Ctrl+Alt+↓ 不消费', macCtrlActive.consumed.count, 0)

    const win = harness({
      platform: 'windows',
      sidebar: sidebar(),
      summary: summary(),
      uiSession: fakeUiSession({ status: statusTable({ s3: { running: true } }) }),
    })
    const winNext = keydown(SESSION_NEXT_PRESS, shortcutContext({ target: null }))
    win.shortcuts.emit(winNext.input)
    check('Windows Ctrl+↓ 走全部候选', win.navigation.opened, ['s2'])
    check('Windows Ctrl+↓ 消费', winNext.consumed.count, 1)
    const winActive = keydown(SESSION_ACTIVE_NEXT_PRESS, shortcutContext({ target: null }))
    win.shortcuts.emit(winActive.input)
    check('Windows Ctrl+Alt+↓ 走活跃池', win.navigation.opened, ['s2', 's3'])
    const winMeta = keydown(SESSION_NEXT_MAC_PRESS, shortcutContext({ target: null }))
    win.shortcuts.emit(winMeta.input)
    check('Windows 上 ⌘↓ 不动', win.navigation.opened, ['s2', 's3'])
    check('Windows 上 ⌘↓ 不消费', winMeta.consumed.count, 0)

    checkTrue('两条会话行都在录', [SESSION_CYCLE_ID, SESSION_ACTIVE_CYCLE_ID].every((id) => mac.shortcuts.fixedCatalog.getSnapshot().some((row) => row.id === id)))
  } finally {
    restore()
  }
}

finish()
