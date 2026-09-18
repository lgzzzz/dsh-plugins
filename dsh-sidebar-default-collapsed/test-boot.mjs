/**
 * 诊断脚本(非插件产物):纯 Node,无浏览器。两部分:
 *   A. 直接以 Node Type Stripping 载入 src/boot-collapse.ts,覆盖全部判定分支(宽/窄、已收起、一次性标记、
 *      取数不可用、服务缺席、toggle 抛错、root 上混入其它 store);
 *   B. 用 window.__ModuleLoader__ 桩载入构建产物 lib/client.js,验证包名 / inject 声明与 apply 装配。
 * 桩里上游方法写成读 this 的类方法形态:插件若摘引用调用会抛错 → 落 'failed',本脚本能测出该类缺陷。
 * 用法:node test-boot.mjs(需先 npm run build)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { BOOT_MARK, SIDEBAR_AUTO_COLLAPSE, collapseSidebarOnBoot, readLayoutInfo } from './src/boot-collapse.ts'

const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
/** 断言并按仓库脚本惯例记账。 */
function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

// ---- 桩 -------------------------------------------------------------------

/** 与上游同一语义的左栏状态机(宽窗 280 ⟷ 0);方法读 this,故摘引用调用会抛错。 */
class FakeLayout {
  constructor(info) {
    this.info = info
    this.toggles = 0
  }
  toggleSidebar() {
    this.toggles += 1
    this.info.sidebar = this.info.sidebar === 0 ? 280 : 0
  }
}

/** toggle 抛错的 layout。 */
class ThrowingLayout {
  toggleSidebar() {
    throw new Error('boom')
  }
}

/** 造一个布局 store 座位:handle 对象 + 活实例 + 可断言的 layoutInfo(resolveStore 以对象标识查表)。 */
function layoutSeat(sidebar, viewportWidth) {
  const info = { sidebar, viewportWidth }
  const handle = {}
  const instance = { getSnapshot: () => ({ layoutInfo: info }) }
  handle.create = () => instance
  return { handle, instance, info }
}

/** root 上混入的其它插件 store(快照形状不含 layoutInfo)。 */
function alienSeat() {
  const handle = {}
  const instance = { getSnapshot: () => ({ draft: { selected: [] } }) }
  handle.create = () => instance
  return { handle, instance }
}

/** 只给快照、不要 layoutInfo 形状的裸座位。 */
function rawSeat(snapshot) {
  const handle = {}
  const instance = { getSnapshot: () => snapshot }
  handle.create = () => instance
  return { handle, instance }
}

/** slots 桩:entries('root') 按注册顺序给页面,resolveStore 按对象标识查表(与上游 _stores Map 同形)。 */
function makeSlots(seats, options = {}) {
  const table = new Map(seats.map((seat) => [seat.handle, seat.instance]))
  return {
    entries: (key) => {
      if (options.entriesThrows === true) throw new Error('entries unavailable')
      if (key !== 'root') return []
      return [...table.keys()].map((handle) => ({ store: handle }))
    },
    resolveStore: (() => {
      if (options.noResolveStore === true) return undefined
      return (handle, binding) => {
        if (binding !== undefined) throw new Error('root store must resolve without a binding')
        if (options.resolveThrows === true) throw new Error('store handle is not registered')
        const instance = table.get(handle)
        if (instance === undefined) throw new Error('store handle is not registered')
        return instance
      }
    })(),
  }
}

/** 页面级窗口桩(一次性标记的宿主)。 */
function makeWindow() {
  return {}
}

const services = (slots, layout) => ({ slots, layout })

// ---- A. 判定分支 -----------------------------------------------------------

console.log('--- A① 宽窗 + 上游初值 280 → 收起一次 ---')
{
  const seat = layoutSeat(280, 1440)
  const layout = new FakeLayout(seat.info)
  const win = makeWindow()
  check('outcome', collapseSidebarOnBoot(services(makeSlots([seat]), layout), win), 'closed')
  check('toggle 次数', layout.toggles, 1)
  check('sidebar 写入后', seat.info.sidebar, 0)
  check('窗口一次性标记', win[BOOT_MARK], true)
}

console.log('--- A② 宽窗但已收起 → 不写(纯 toggle 会把它打开) ---')
{
  const seat = layoutSeat(0, 1440)
  const layout = new FakeLayout(seat.info)
  const win = makeWindow()
  check('outcome', collapseSidebarOnBoot(services(makeSlots([seat]), layout), win), 'already-closed')
  check('toggle 次数', layout.toggles, 0)
  check('sidebar 未变', seat.info.sidebar, 0)
}

console.log('--- A③ 窄窗 → 不动(上游本就收起,toggle 会走 narrowExpanded 分支反而展开) ---')
{
  const seat = layoutSeat(280, 900)
  const layout = new FakeLayout(seat.info)
  const win = makeWindow()
  check('outcome', collapseSidebarOnBoot(services(makeSlots([seat]), layout), win), 'narrow')
  check('toggle 次数', layout.toggles, 0)
  check('sidebar 未变', seat.info.sidebar, 280)
  check('窗口一次性标记', win[BOOT_MARK], true)
}

console.log(`--- A④ 断点边界(${SIDEBAR_AUTO_COLLAPSE},与上游 viewportWidth < 1024 一致) ---`)
{
  const narrow = layoutSeat(280, SIDEBAR_AUTO_COLLAPSE - 1)
  const narrowLayout = new FakeLayout(narrow.info)
  check('1023 → narrow', collapseSidebarOnBoot(services(makeSlots([narrow]), narrowLayout), makeWindow()), 'narrow')
  check('1023 toggle 次数', narrowLayout.toggles, 0)

  const wide = layoutSeat(280, SIDEBAR_AUTO_COLLAPSE)
  const wideLayout = new FakeLayout(wide.info)
  check('1024 → closed', collapseSidebarOnBoot(services(makeSlots([wide]), wideLayout), makeWindow()), 'closed')
  check('1024 toggle 次数', wideLayout.toggles, 1)
}

console.log('--- A⑤ 本次页面加载已判定过(fiber 重建不重复插手用户选择) ---')
{
  const seat = layoutSeat(280, 1440)
  const win = makeWindow()
  collapseSidebarOnBoot(services(makeSlots([seat]), new FakeLayout(seat.info)), win)
  // 用户手动打开后重建 fiber:标记在窗口上 ⇒ 不再关闭
  const reopened = new FakeLayout(seat.info)
  seat.info.sidebar = 280
  check('outcome', collapseSidebarOnBoot(services(makeSlots([seat]), reopened), win), 'visited')
  check('toggle 次数', reopened.toggles, 0)
  check('sidebar 保持用户选择', seat.info.sidebar, 280)
}

console.log('--- A⑥ 取数不可用 → no-store 且不置标记(留给下次 apply 重试) ---')
{
  const seat = layoutSeat(280, 1440)

  const win1 = makeWindow()
  check('slots 服务缺席', collapseSidebarOnBoot(services(undefined, new FakeLayout(seat.info)), win1), 'no-store')
  check('标记未置', win1[BOOT_MARK], undefined)

  const win2 = makeWindow()
  check('无 resolveStore', collapseSidebarOnBoot(services(makeSlots([seat], { noResolveStore: true }), new FakeLayout(seat.info)), win2), 'no-store')
  check('标记未置', win2[BOOT_MARK], undefined)

  const win3 = makeWindow()
  check('entries 抛错', collapseSidebarOnBoot(services(makeSlots([seat], { entriesThrows: true }), new FakeLayout(seat.info)), win3), 'no-store')

  const win4 = makeWindow()
  check('resolveStore 抛错', collapseSidebarOnBoot(services(makeSlots([seat], { resolveThrows: true }), new FakeLayout(seat.info)), win4), 'no-store')
}

console.log('--- A⑦ root 上混入其它 store:按形状跳到布局 store;全不匹配则 no-store ---')
{
  const alien = alienSeat()
  const seat = layoutSeat(280, 1440)
  const layout = new FakeLayout(seat.info)
  check('跳过非布局 store', collapseSidebarOnBoot(services(makeSlots([alien, seat]), layout), makeWindow()), 'closed')
  check('toggle 次数', layout.toggles, 1)

  check('只有非布局 store', collapseSidebarOnBoot(services(makeSlots([alienSeat()]), new FakeLayout({ sidebar: 280 })), makeWindow()), 'no-store')
  check('layoutInfo 形状不符(字符串)', readLayoutInfo(makeSlots([rawSeat({ layoutInfo: { sidebar: '280', viewportWidth: 1440 } })])), undefined)
  check('layoutInfo 缺席', readLayoutInfo(makeSlots([rawSeat({ panelInfo: {} })])), undefined)
  check('快照为 null', readLayoutInfo(makeSlots([rawSeat(null)])), undefined)
  check('快照为数组', readLayoutInfo(makeSlots([rawSeat([])])), undefined)
}

console.log('--- A⑧ layout 服务缺席 / 方法缺席 / 抛错 ---')
{
  const seat = layoutSeat(280, 1440)
  const win = makeWindow()
  check('服务缺席', collapseSidebarOnBoot(services(makeSlots([seat]), undefined), win), 'no-service')
  check('标记已置(判定已完成)', win[BOOT_MARK], true)

  check('方法缺席', collapseSidebarOnBoot(services(makeSlots([layoutSeat(280, 1440)]), {}), makeWindow()), 'no-service')

  const seat3 = layoutSeat(280, 1440)
  check('toggle 抛错', collapseSidebarOnBoot(services(makeSlots([seat3]), new ThrowingLayout()), makeWindow()), 'failed')
  check('sidebar 未变', seat3.info.sidebar, 280)
}

// ---- B. 构建产物装配 -------------------------------------------------------

console.log('--- B① lib/client.js 注册与声明 ---')
let registration = null
globalThis.window = { __ModuleLoader__: { load: (reg) => { registration = reg } } }
// eslint-disable-next-line no-eval
;(0, eval)(readFileSync(join(here, 'lib', 'client.js'), 'utf8'))
check('registration 非空', registration !== null, true)
check('模块 id', registration.id, 'dsh-sidebar-default-collapsed')
const plugin = registration.factory(() => { throw new Error('unexpected external require') })
check('插件名', plugin.name, 'dsh-sidebar-default-collapsed')
check('服务 inject', plugin.inject, ['layout', 'slots'])

console.log('--- B② apply 装配:启动即收起 + 重复 apply 幂等 ---')
{
  const seat = layoutSeat(280, 1440)
  const layout = new FakeLayout(seat.info)
  globalThis.window = makeWindow()
  const ctx = { get: (serviceName) => ({ layout, slots: makeSlots([seat]) })[serviceName] }
  plugin.apply(ctx)
  check('首次 apply → 收起', layout.toggles, 1)
  check('sidebar', seat.info.sidebar, 0)
  plugin.apply(ctx)
  check('二次 apply(HMR 重建)→ 不再 toggle', layout.toggles, 1)
  check('窗口标记', globalThis.window[BOOT_MARK], true)

  // 新的一次页面加载:标记随窗口重置
  const seat2 = layoutSeat(280, 1440)
  const layout2 = new FakeLayout(seat2.info)
  globalThis.window = makeWindow()
  plugin.apply({ get: (serviceName) => ({ layout: layout2, slots: makeSlots([seat2]) })[serviceName] })
  check('新页面加载 → 再收起一次', layout2.toggles, 1)
}

console.log('--- B③ apply 容错:ctx.get 缺席 / 服务全缺 不抛 ---')
{
  globalThis.window = makeWindow()
  plugin.apply({})
  check('无 ctx.get 不抛', true, true)
  plugin.apply({ get: () => undefined })
  check('服务全缺不抛', true, true)
}

console.log(failures === 0 ? '\nall boot probes passed' : `\n${failures} probe(s) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
