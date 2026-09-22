/**
 * 诊断脚本(非插件产物):聚焦输入框(J = Jump):⌘/Ctrl+J 经 `binding.ctx → conversation.input.for(actx)` 取
 * `editor.getRootElement()` 后 `focus({ preventScroll: true })`,for 缺席时回退公开的 `shell(id)`;
 * 含 editing 态元素级门闸(焦点已在 composer 内则不重复聚焦但仍吞键)、card 态不接管、
 * 旧键位 ⌘/Ctrl+I 的回归与全部无降级分支。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/composer.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, check, isMain, loadPlugin, report, same, snapshot, storage } from './harness.mjs'

// ---- 阶段 4:⌘/Ctrl+J → 聚焦对话输入框(J = Jump);只走服务链路(DOM 桩查询恒空) ----
// 路径 = binding.ctx → input.for(actx) → editor.getRootElement() → focus({preventScroll:true})
// 键位 mod+j;旧键位 mod+i 已不再绑定(见下方回归断言)。
console.log('\n--- ⌘/Ctrl+J → 聚焦输入框(conversation.input → shell.editor) ---')
{
  const actx = { scope: 'sess-b' } // binding('sess-b').ctx,必须原样传给 input.for
  const makeComposerSessions = (ctx = actx) => ({
    list: { getSnapshot: () => snapshot },
    binding: (id) => (id === 'sess-b' ? { ctx } : undefined),
  })
  const makeRoot = () => new FakeHTMLElement('DIV') // composer editor 宿主 div
  const base = {
    uiSession: { pendingInteractions: { getSnapshot: () => new Map() } },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: [] }) } },
  }

  // --- 主路径:browse 态 ⌘/Ctrl+J 聚焦,且 for() 收到的就是 binding.ctx 本身 ---
  const root = makeRoot()
  const seenActx = []
  const shellCalls = []
  const main = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: {
      input: {
        for: (arg) => { seenActx.push(arg); return { editor: { getRootElement: () => root } } },
        shell: (id) => { shellCalls.push(id); return undefined },
      },
    },
  })
  let event = main({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
  check('browse 态 Ctrl+J → 宿主元素 focus({preventScroll:true})', root.focused === true)
  check('Ctrl+J 被吞', event.propagationStopped === true)
  check('input.for 收到 binding.ctx 本身', same(seenActx, [actx]))
  check('主路径不触碰 shell(id)', shellCalls.length === 0, JSON.stringify(shellCalls))

  // --- 旧键位 ⌘/Ctrl+I 不再聚焦输入框(现为近期对话浮窗,按键仍被吞掉) ---
  const oldRoot = makeRoot()
  const old = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => oldRoot } }) } },
  })
  event = old({ key: 'i', code: 'KeyI', ctrlKey: true, altKey: false })
  check('Ctrl+I 不聚焦输入框(聚焦已改为 ⌘/Ctrl+J)', oldRoot.focused !== true)
  check('Ctrl+I 被近期对话浮窗消费(吞键)', event.propagationStopped === true)
  old({ key: 'Escape', code: 'Escape' })

  // --- macOS ⌘J:metaKey 同样归一化成 mod+j ---
  const macRoot = makeRoot()
  const mac = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => macRoot } }) } },
  })
  event = mac({ key: 'j', code: 'KeyJ', metaKey: true, altKey: false })
  check('macOS ⌘J(metaKey)→ 同样聚焦', macRoot.focused === true)
  check('macOS ⌘J 被吞', event.propagationStopped === true)

  // --- 元素级门闸:editing = 焦点在可编辑元素里,但不一定是 composer ---
  // 右栏终端(.xterm-helper-textarea)与 Monaco(.inputarea)都是真 textarea;焦点在那里时正是要跳回输入框。
  const elsewhereRoot = makeRoot()
  const seenEditing = [] // contains 与 focus 各取一次元素,故一次按键取两次
  const editing = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: {
      input: { for: (arg) => { seenEditing.push(arg); return { editor: { getRootElement: () => elsewhereRoot } } } },
    },
  })
  event = editing({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 + 焦点在别处可编辑元素(终端 / Monaco)→ Ctrl+J 聚焦输入框', elsewhereRoot.focused === true)
  check('editing 态 + 焦点在别处 → Ctrl+J 被吞', event.propagationStopped === true)
  check('editing 态 + 焦点在别处 → 走服务链路且 for 收到 binding.ctx', same(seenEditing, [actx, actx]), JSON.stringify(seenEditing))

  // 焦点已在 composer 内:不重复聚焦,但组合键仍被吞掉(放行会触发 Win/Linux 浏览器 Ctrl+J = 下载页)
  const inComposerTarget = new FakeHTMLElement('DIV')
  inComposerTarget.isContentEditable = true
  const inComposerRoot = makeRoot()
  inComposerRoot.contains = (node) => node === inComposerTarget
  const insideComposer = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => inComposerRoot } }) } },
  })
  event = insideComposer({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false, target: inComposerTarget })
  check('editing 态 + 焦点已在 composer 内 → 不聚焦(动作无事可做)', inComposerRoot.focused !== true)
  check('editing 态 + 焦点已在 composer 内 → 仍吞键(不放行浏览器下载页)', event.propagationStopped === true)

  // 取不到 composer 宿主元素时门闸判为「不在 composer 内」,仍会走一次服务链路 → no-op 不吞键
  const noRootEditable = loadPlugin({ ...base, sessions: makeComposerSessions(), conversation: { input: {} } })
  event = noRootEditable({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false, target: new FakeHTMLElement('TEXTAREA') })
  check('editing 态 + 取不到 composer 宿主 → Ctrl+J 不吞键(no-op)', event.propagationStopped !== true)

  // --- 态门闸:card(有待审批卡片)不接管 ---
  const cardPending = new Map([['sess-b', { kind: 'approval', key: 'a:1', answer() {} }]])
  const cardRoot = makeRoot()
  const card = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    uiSession: { pendingInteractions: { getSnapshot: () => cardPending } },
    conversation: { input: { for: () => ({ editor: { getRootElement: () => cardRoot } }) } },
  })
  event = card({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
  check('card 态 Ctrl+J 不聚焦', cardRoot.focused !== true)
  check('card 态 Ctrl+J 不吞键', event.propagationStopped !== true)

  // --- for 缺席 → 回退公开的 shell(id)(同一 SessionInputShell) ---
  const shellRoot = makeRoot()
  const shellIds = []
  const viaShell = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: {
      input: { shell: (id) => { shellIds.push(id); return { editor: { getRootElement: () => shellRoot } } } },
    },
  })
  event = viaShell({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
  check('input.for 缺席 → shell(id) 回退聚焦', shellRoot.focused === true)
  check('shell(id) 收到当前会话 id', same(shellIds, ['sess-b']), JSON.stringify(shellIds))
  check('shell 回退路径吞键', event.propagationStopped === true)

  // --- 无 binding.ctx → 直接走 shell(id) ---
  const noCtxRoot = makeRoot()
  const noCtx = loadPlugin({
    ...base,
    sessions: makeComposerSessions(undefined),
    conversation: {
      input: {
        for: () => { throw new Error('for must not be called without a scope ctx') },
        shell: () => ({ editor: { getRootElement: () => noCtxRoot } }),
      },
    },
  })
  event = noCtx({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
  check('无 binding.ctx → 走 shell(id)', noCtxRoot.focused === true)
  check('无 binding.ctx 路径吞键', event.propagationStopped === true)

  // --- 无降级:任一环缺失 / 抛错一律 no-op 且不吞键,不回退到 DOM 查询 ---
  const cases = [
    ['conversation 服务缺席', { conversation: undefined }],
    ['input 缺席', { conversation: {} }],
    ['for/shell 都缺席', { conversation: { input: {} } }],
    ['for 返回 undefined 且无 shell', { conversation: { input: { for: () => undefined } } }],
    ['shell 返回 undefined', { conversation: { input: { shell: () => undefined } } }],
    ['shell 抛错(会话无绑定)', { conversation: { input: { shell: () => { throw new Error('no binding') } } } }],
    ['shell 返回无 editor 的壳', { conversation: { input: { shell: () => ({}) } } }],
    [
      'editor 未绑宿主元素(getRootElement → null)',
      { conversation: { input: { shell: () => ({ editor: { getRootElement: () => null } }) } } },
    ],
    ['editor 缺 getRootElement', { conversation: { input: { shell: () => ({ editor: {} }) } } }],
    [
      '宿主元素缺 focus',
      { conversation: { input: { shell: () => ({ editor: { getRootElement: () => ({}) } }) } } },
    ],
  ]
  for (const [label, extra] of cases) {
    const env = loadPlugin({ ...base, sessions: makeComposerSessions(), ...extra })
    event = env({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
    check(`${label} → Ctrl+J 不吞键(no-op)`, event.propagationStopped !== true)
  }

  // 无当前会话 / current 为空串:sessions 有 conversation 也不动作
  for (const [label, current] of [['无当前会话', undefined], ['current 为空串', '']]) {
    const env = loadPlugin({
      ...base,
      sessions: { list: { getSnapshot: () => ({ ...snapshot, current }) }, binding: () => ({ ctx: actx }) },
      conversation: {
        input: { for: () => { throw new Error('must not resolve without a current session') } },
      },
    })
    event = env({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
    check(`${label} → Ctrl+J 不吞键`, event.propagationStopped !== true)
  }

  // 键位可经 localStorage 覆盖(刻意避开默认 ⌘/Ctrl+K,改用 ⌘/Ctrl+Alt+J);
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'composer.focus': 'mod+alt+j' } }))
  const customRoot = makeRoot()
  const custom = loadPlugin({
    ...base,
    sessions: makeComposerSessions(),
    conversation: { input: { for: () => ({ editor: { getRootElement: () => customRoot } }) } },
  })
  event = custom({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: false })
  check('覆盖键位后 ⌘/Ctrl+J 不再聚焦', customRoot.focused !== true)
  event = custom({ key: 'j', code: 'KeyJ', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+J → 聚焦', customRoot.focused === true)
  check('自定义键位被吞', event.propagationStopped === true)
  storage.delete('dsh-kbd-hotkeys:v1')
}

if (isMain(import.meta.url)) report()
