/**
 * 诊断脚本(非插件产物):新建会话:⌘/Ctrl+N(与 macOS ⌘N)→ `uiWorkspace.startSession()`;三态放行、与卡片无关,
 * `bindings` 覆盖,服务 / 动词缺席或抛错时 no-op 不吞键。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/session-new.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, isMain, loadPlugin, report, same, sessions, storage } from './harness.mjs'

// ---- 阶段 3b:⌘/Ctrl+N → uiWorkspace.startSession();三态放行,服务缺席 / 无动词 / 抛错 no-op 不吞键 ----
console.log('\n--- ⌘/Ctrl+N → 新建会话并跳转(uiWorkspace.startSession) ---')
{
  const base = {
    sessions,
    uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }

  const calls = []
  const workspace = loadPlugin({ ...base, uiWorkspace: { startSession: (id) => { calls.push(id) } } })

  let event = workspace({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('browse 态 ⌘/Ctrl+N → startSession()', same(calls, [undefined]), JSON.stringify(calls))
  check('browse 态 ⌘/Ctrl+N 被吞', event.propagationStopped === true)

  // macOS:metaKey 同样命中(mod 同时吸收 ctrl/meta)
  event = workspace({ key: 'n', code: 'KeyN', metaKey: true })
  check('macOS ⌘N(metaKey)→ startSession()', calls.length === 2, JSON.stringify(calls))
  check('macOS ⌘N 被吞', event.propagationStopped === true)

  // editing 态(焦点在输入框)与 card 态(有待回应卡片)同样生效
  event = workspace({ key: 'n', code: 'KeyN', ctrlKey: true, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 ⌘/Ctrl+N → startSession()', calls.length === 3, JSON.stringify(calls))
  check('editing 态 ⌘/Ctrl+N 被吞', event.propagationStopped === true)

  const cardPending = new Map([['sess-b', { kind: 'approval', key: 'approval:1', answer() {} }]])
  const cardCalls = []
  const cardEnv = loadPlugin({
    ...base,
    uiSession: { pendingInteractions: { getSnapshot: () => cardPending } },
    uiWorkspace: { startSession: () => { cardCalls.push(1) } },
  })
  event = cardEnv({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('card 态 ⌘/Ctrl+N → startSession()(新建会话与卡片无关)', cardCalls.length === 1, String(cardCalls.length))
  check('card 态 ⌘/Ctrl+N 被吞', event.propagationStopped === true)

  // bindings 覆盖:session.new 是合法动作 id,键位可自定义
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'session.new': 'mod+alt+n' } }))
  const customCalls = []
  const custom = loadPlugin({ ...base, uiWorkspace: { startSession: () => { customCalls.push(1) } } })
  event = custom({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('覆盖键位后 ⌘/Ctrl+N 不再新建', customCalls.length === 0 && event.propagationStopped !== true)
  event = custom({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+N → startSession()', customCalls.length === 1, String(customCalls.length))
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')

  // 无降级:服务缺席 / 无 startSession / 抛错(无挂载会话面)→ no-op 且不吞键
  const missing = loadPlugin(base)
  event = missing({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('uiWorkspace 缺席 → ⌘/Ctrl+N 不吞键', event.propagationStopped !== true)

  const noMethod = loadPlugin({ ...base, uiWorkspace: {} })
  event = noMethod({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('无 startSession → ⌘/Ctrl+N 不吞键', event.propagationStopped !== true)

  const dead = loadPlugin({
    ...base,
    uiWorkspace: { startSession: () => { throw new Error('uiWorkspace: no mounted session surface') } },
  })
  event = dead({ key: 'n', code: 'KeyN', ctrlKey: true })
  check('startSession 抛错 → ⌘/Ctrl+N 不吞键', event.propagationStopped !== true)
}

if (isMain(import.meta.url)) report()
