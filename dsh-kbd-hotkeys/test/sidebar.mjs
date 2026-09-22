/**
 * 诊断脚本(非插件产物):左右栏开关:⌘/Ctrl+B → `layout.toggleSidebar`、⌘/Ctrl+O → `sidebarRight.toggleExpanded`,
 * 两者互不串场;三态(含 editing)可用、`bindings` 覆盖、服务缺席 / 抛错一律 no-op 不吞键。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/sidebar.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, isMain, loadPlugin, report, same, sessions, storage } from './harness.mjs'

// ---- 阶段 3:⌘/Ctrl+B → layout.toggleSidebar、⌘/Ctrl+O → sidebarRight.toggleExpanded(互不串场) ----
console.log('\n--- ⌘/Ctrl+B / ⌘/Ctrl+O → 左右栏开关 ---')
{
  const base = {
    sessions,
    uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }

  let left = 0
  let right = 0
  const both = loadPlugin({
    ...base,
    layout: { toggleSidebar: () => { left += 1 } },
    sidebarRight: { toggleExpanded: () => { right += 1 } },
  })

  // ⌘/Ctrl+B:只打左栏
  let event = both({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('browse 态 ⌘/Ctrl+B → layout.toggleSidebar(左栏)', same([left, right], [1, 0]), `${left},${right}`)
  check('browse 态 ⌘/Ctrl+B 被吞', event.propagationStopped === true)

  // ⌘/Ctrl+O:只打右栏
  event = both({ key: 'o', code: 'KeyO', ctrlKey: true })
  check('browse 态 ⌘/Ctrl+O → sidebarRight.toggleExpanded(右栏)', same([left, right], [1, 1]), `${left},${right}`)
  check('browse 态 ⌘/Ctrl+O 被吞', event.propagationStopped === true)

  // editing 态(焦点在输入框)两个键位同样生效
  event = both({ key: 'b', code: 'KeyB', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+B → 左栏', same([left, right], [2, 1]), `${left},${right}`)
  check('editing 态 ⌘/Ctrl+B 被吞', event.propagationStopped === true)
  event = both({ key: 'o', code: 'KeyO', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+O → 右栏', same([left, right], [2, 2]), `${left},${right}`)
  check('editing 态 ⌘/Ctrl+O 被吞', event.propagationStopped === true)

  // bindings 覆盖:sidebar.toggle 是左栏的合法动作 id(键位可自定义)
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'sidebar.toggle': 'mod+alt+s' } }))
  let customLeft = 0
  let customRight = 0
  const custom = loadPlugin({
    ...base,
    layout: { toggleSidebar: () => { customLeft += 1 } },
    sidebarRight: { toggleExpanded: () => { customRight += 1 } },
  })
  event = custom({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('左栏自定义键位后 ⌘/Ctrl+B 不再触发左栏', same([customLeft, customRight], [0, 0]), `${customLeft},${customRight}`)
  event = custom({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+S → 左栏', same([customLeft, customRight], [1, 0]), `${customLeft},${customRight}`)
  event = custom({ key: 'o', code: 'KeyO', ctrlKey: true })
  check('右栏默认键位不受左栏自定义影响', same([customLeft, customRight], [1, 1]), `${customLeft},${customRight}`)
  storage.delete('dsh-kbd-hotkeys:v1')

  // 无降级:服务缺席 / 无挂载会话面(控制器 require 抛错)→ no-op 且不吞键
  const missing = loadPlugin(base)
  event = missing({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('layout 缺席 → ⌘/Ctrl+B 不吞键', event.propagationStopped !== true)
  event = missing({ key: 'o', code: 'KeyO', ctrlKey: true })
  check('sidebarRight 缺席 → ⌘/Ctrl+O 不吞键', event.propagationStopped !== true)

  const dead = loadPlugin({
    ...base,
    layout: { toggleSidebar: () => { throw new Error('layout: not mounted') } },
    sidebarRight: { toggleExpanded: () => { throw new Error('sidebarRight: no session surface is mounted') } },
  })
  event = dead({ key: 'b', code: 'KeyB', ctrlKey: true })
  check('layout 抛错 → ⌘/Ctrl+B 不吞键', event.propagationStopped !== true)
  event = dead({ key: 'o', code: 'KeyO', ctrlKey: true })
  check('无挂载会话面(抛错)→ ⌘/Ctrl+O 不吞键', event.propagationStopped !== true)
}

if (isMain(import.meta.url)) report()
