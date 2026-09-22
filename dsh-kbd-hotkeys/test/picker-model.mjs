/**
 * 诊断脚本(非插件产物):模型浮窗 + 思考强度循环:⌘/Ctrl+M 取 `ctx.modelDirectories.directoryFor(当前会话)`
 * (与 /model 弹层同源的 per-session 目录)`load()` 后按宿主顺序展开,Enter 调 `directory.select`;
 * ⇧Tab 在 `effortChoices` 候选里循环(有 `defaultEffort` 时不含 Default 档),只在 composer 编辑区
 * 内接管;含加载态 / 失败提供方小字、load / select 拒绝、无降级与两个动作各自的 `bindings` 覆盖。
 *
 * 共享桩件与夹具见 test/harness.mjs。单独运行:`node test/picker-model.mjs`;
 * 被 test-services.mjs import 时只跑用例,汇总由入口负责。
 */
import { FakeHTMLElement, activeRowIndex, check, classHas, collectNodes, isMain, loadPlugin, nodeText, pickerRows, report, same, sessions, storage, view } from './harness.mjs'

// ---- 阶段 6(浮窗):⌘/Ctrl+M 模型浮窗 + ⇧Tab 思考强度循环 ----
// 取数与提交都走上游同一 per-session 目录 ctx.modelDirectories.directoryFor(session)(与 /model 弹层同源)。
// 行的选择复刻上游 selectionOf;⇧Tab 候选复刻 effortChoices(有 defaultEffort 时不含 Default 档),
// 当前档 = current.reasoningEffort ?? reasoning.defaultEffort。
console.log('\n--- ⌘/Ctrl+M → 模型浮窗 + ⇧Tab 循环思考强度 ---')
{
  const combo = { key: 'm', code: 'KeyM', ctrlKey: true }
  const shiftTab = { key: 'Tab', code: 'Tab', shiftKey: true }
  /** 等一次宏任务:浮窗的列表是异步取的(先绘制「加载中」,落地后重画)。 */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  const groupHeadings = () =>
    collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-group')).map(nodeText)
  const currentLines = () =>
    collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-current')).map(nodeText)
  const emptyNotices = () =>
    collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-empty')).map(nodeText)
  const hintTexts = () =>
    collectNodes(globalThis.document.body, (el) => classHas(el, 'dsh-kbd-hint')).map(nodeText)

  /** 目录行夹具:两个提供方 / 三种模型(有默认档 / 无默认档 / 无推理元数据)。 */
  const groups = [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        {
          id: 'deepseek-v4-flash',
          name: 'DeepSeek V4 Flash',
          reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
        },
        {
          id: 'deepseek-v4-pro',
          name: 'DeepSeek V4 Pro',
          reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' },
        },
      ],
    },
    { id: 'other', name: 'Other Provider', models: [{ id: 'plain', name: 'Plain Model' }] },
  ]
  const proCurrent = { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' }

  /** 假模型目录:复刻上游 ModelDirectory 的 store / load / select;select 成功换 current,失败 reject。 */
  function makeDirectory(over = {}) {
    const state = {
      current: over.current !== undefined ? over.current : proCurrent,
      routable: true,
      groups: over.groups !== undefined ? over.groups : groups,
      failures: over.failures !== undefined ? over.failures : [],
      status: 'ready',
      error: null,
    }
    const calls = []
    return {
      calls,
      state,
      store: { getSnapshot: () => state },
      load() {
        if (over.loadError !== undefined) return Promise.reject(new Error(over.loadError))
        return Promise.resolve(state)
      },
      select(selection) {
        calls.push({ ...selection })
        if (over.selectError !== undefined) return Promise.reject(new Error(over.selectError))
        state.current = { ...selection }
        return Promise.resolve()
      },
    }
  }

  /** 装配:默认「模型目录齐全、当前会话 sess-b」。 */
  function env(over = {}) {
    const directory = over.directory !== undefined ? over.directory : makeDirectory()
    const seen = []
    let resolver
    if ('modelDirectories' in over) resolver = over.modelDirectories
    else if (over.throwOnDirectory === true) {
      resolver = { directoryFor() { throw new Error('ui-model-selection: session resolved no scope') } }
    } else {
      resolver = { directoryFor(sessionId) { seen.push(sessionId); return directory } }
    }
    const press = loadPlugin({
      sessions: over.sessions ?? { ...sessions, binding: () => undefined },
      uiSession: over.uiSession ?? { pendingInteractions: { getSnapshot: () => new Map() } },
      modelDirectories: resolver,
      conversation: over.conversation,
    })
    return { press, directory, seen }
  }

  // ① 打开浮窗:先绘制加载态,异步落地后按宿主顺序渲染行 + 提供方分组标题
  const first = env()
  let event = first.press(combo)
  check('⌘/Ctrl+M 打开模型浮窗并吞键', event.propagationStopped === true)
  check('首次绘制 = 「正在加载模型目录…」', same(emptyNotices(), ['正在加载模型目录…']), JSON.stringify(emptyNotices()))
  await flush()
  check('目录按当前会话 id 取(directoryFor(sess-b))', same(first.seen, ['sess-b']), JSON.stringify(first.seen))
  check(
    '行按宿主顺序展开(模型名 / 提供方,当前行带标记)',
    same(pickerRows().map(nodeText), [
      'DeepSeek V4 Flash DeepSeek',
      'DeepSeek V4 Pro DeepSeek 当前',
      'Plain Model Other Provider',
    ]),
    JSON.stringify(pickerRows().map(nodeText)),
  )
  check('提供方分组标题按相邻同组行插入', same(groupHeadings(), ['DeepSeek', 'Other Provider']), JSON.stringify(groupHeadings()))
  check('「当前」行 = 当前模型 + 当前强度档', same(currentLines(), ['当前：DeepSeek V4 Pro · High']), JSON.stringify(currentLines()))
  check('初始高亮 = 当前选择所在行', activeRowIndex() === 1, String(activeRowIndex()))

  // ② ↑/↓ clamp + Enter 提交**完整**选择(无 defaultEffort 的模型省略 reasoningEffort)
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('↑ 移到第 1 行', activeRowIndex() === 0, String(activeRowIndex()))
  first.press({ key: 'ArrowUp', code: 'ArrowUp' })
  check('首行 clamp(不循环)', activeRowIndex() === 0, String(activeRowIndex()))
  event = first.press({ key: 'Enter', code: 'Enter' })
  check(
    'Enter → directory.select(该行完整选择;无 defaultEffort 时不带 reasoningEffort)',
    same(first.directory.calls, [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }]),
    JSON.stringify(first.directory.calls),
  )
  check('确认后浮窗关闭', event.propagationStopped === true && pickerRows().length === 0)

  // ③ 重新打开:高亮跟随目录里的新 current(store 是唯一真源),↓ 到末行 clamp
  first.press(combo)
  await flush()
  check('重开后高亮 = 新 current 所在行', activeRowIndex() === 0, String(activeRowIndex()))
  check('重开后「当前」行 = 新模型(无 defaultEffort 时显示提供方默认档)', same(currentLines(), ['当前：DeepSeek V4 Flash · Default']), JSON.stringify(currentLines()))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('↓ 移到最后一行', activeRowIndex() === 2, String(activeRowIndex()))
  first.press({ key: 'ArrowDown', code: 'ArrowDown' })
  check('末行 clamp', activeRowIndex() === 2, String(activeRowIndex()))
  first.press({ key: 'Enter', code: 'Enter' })
  check(
    'Enter → 选中别的提供方的模型',
    same(first.directory.calls.at(-1), { provider: 'other', model: 'plain' }),
    JSON.stringify(first.directory.calls),
  )

  // ④ ⇧Tab 全局循环:有 defaultEffort 时候选 = efforts(不含 Default 档),循环回绕
  const cyc = env()
  event = cyc.press(shiftTab)
  check(
    '⇧Tab → 同模型的下一档(high → low)',
    same(cyc.directory.calls, [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' }]),
    JSON.stringify(cyc.directory.calls),
  )
  check('⇧Tab 生效时吞键', event.propagationStopped === true)
  cyc.press(shiftTab)
  check(
    '再按 ⇧Tab 循环到末档后回到首档(low → high)',
    same(cyc.directory.calls[1], { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' }),
    JSON.stringify(cyc.directory.calls),
  )

  // ⑤ 无 defaultEffort:候选首项是「提供方默认档」,故当前档缺席时从第一档开始
  const flash = env({ directory: makeDirectory({ current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }) })
  flash.press(shiftTab)
  check(
    '无 defaultEffort + 当前档缺席 → 切到第一档(Default → off)',
    same(flash.directory.calls, [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'off' }]),
    JSON.stringify(flash.directory.calls),
  )
  flash.press(shiftTab)
  check('再按一次进入下一档(off → low)', flash.directory.calls[1]?.reasoningEffort === 'low', JSON.stringify(flash.directory.calls))

  // ⑥ no-op:模型无推理元数据 / 只有一档 → 不切换、不吞键(⇧Tab 交回页面)
  const plainDir = makeDirectory({ current: { provider: 'other', model: 'plain' } })
  const plain = env({ directory: plainDir })
  event = plain.press(shiftTab)
  check('模型无推理元数据 → ⇧Tab no-op 且不吞键', event.propagationStopped !== true && plainDir.calls.length === 0)
  const oneDir = makeDirectory({
    current: { provider: 'x', model: 'y', reasoningEffort: 'only' },
    groups: [{ id: 'x', name: 'X', models: [{ id: 'y', name: 'Y', reasoning: { efforts: [{ id: 'only', name: 'Only' }], defaultEffort: 'only' } }] }],
  })
  const one = env({ directory: oneDir })
  event = one.press(shiftTab)
  check('只有一档强度 → ⇧Tab no-op 且不吞键', event.propagationStopped !== true && oneDir.calls.length === 0)

  // ⑦ 无降级:服务 / 会话 / 子代理 / directoryFor 抛错 → 浮窗空态、⇧Tab no-op
  for (const [label, over, current = 'sess-b'] of [
    ['modelDirectories 服务缺席', { modelDirectories: undefined }],
    ['directoryFor 抛错(未知会话 / 无挂载会话面)', { throwOnDirectory: true }],
    ['无当前会话', { sessions: { ...sessions, binding: () => undefined } }, null],
    [
      '被寻址的子代理会话',
      {
        sessions: {
          ...sessions,
          binding: () => undefined,
          subagentAddress: () => ({ mode: 'continuation', parentSessionId: 'sess-a', childSessionId: 'sess-b' }),
        },
      },
    ],
  ]) {
    view.current = current === null ? undefined : current
    const target = env(over)
    event = target.press(combo)
    await flush()
    check(`${label} → 浮窗显示空态、不崩、吞键`, event.propagationStopped === true && pickerRows().length === 0, JSON.stringify(emptyNotices()))
    check(`${label} → 空态文案 = 没有可切换模型的会话`, same(emptyNotices(), ['当前没有可切换模型的会话']), JSON.stringify(emptyNotices()))
    // 先关浮窗:浮窗打开时按 ⇧Tab 归浮层模态分发(见 ⑩),测的是浮窗外的全局行为
    target.press({ key: 'Escape', code: 'Escape' })
    event = target.press(shiftTab)
    check(`${label} → ⇧Tab no-op 且不吞键`, event.propagationStopped !== true)
  }
  view.current = 'sess-b'

  // ⑧ load() 拒绝 / select() 拒绝:浮窗照常开关,失败只落在提示与 store 上
  const broken = env({ directory: makeDirectory({ loadError: 'host catalog unavailable' }) })
  event = broken.press(combo)
  await flush()
  check('load() 拒绝 → 浮窗仍打开并吞键(加载失败提示)', event.propagationStopped === true)
  check(
    'load() 拒绝 → 底部小字给出失败原因',
    hintTexts().some((text) => text.includes('模型目录加载失败：host catalog unavailable')),
    JSON.stringify(hintTexts()),
  )
  broken.press({ key: 'Escape', code: 'Escape' })
  const rejectSelect = env({ directory: makeDirectory({ selectError: 'session.selectModel failed' }) })
  rejectSelect.press(combo)
  await flush()
  event = rejectSelect.press({ key: 'Enter', code: 'Enter' })
  check('select() 拒绝 → 浮窗仍关闭、不崩、吞键', event.propagationStopped === true && pickerRows().length === 0)
  rejectSelect.press(shiftTab)
  check('select() 拒绝的 ⇧Tab 仍算已发出(吞键)', rejectSelect.press(shiftTab).propagationStopped === true)

  // ⑨ 失败提供方只做底部小字提示(不可选中,不占行)
  const withFailure = env({
    directory: makeDirectory({ failures: [{ id: 'broken-provider', name: 'Broken', message: 'unauthorized' }] }),
  })
  withFailure.press(combo)
  await flush()
  check('失败提供方不占行,只出现在底部小字', pickerRows().length === 3, String(pickerRows().length))
  check(
    '底部小字含失败提供方计数',
    hintTexts().some((text) => text.includes('1 个提供方的目录加载失败')),
    JSON.stringify(hintTexts()),
  )
  withFailure.press({ key: 'Escape', code: 'Escape' })

  // ⑩ 浮窗内按 ⇧Tab:提交切换并**原地**更新「当前」行(列表与高亮都不动)
  const inside = env()
  inside.press(combo)
  await flush()
  event = inside.press(shiftTab)
  check(
    '浮窗内 ⇧Tab → 提交切换并吞键',
    event.propagationStopped === true &&
      same(inside.directory.calls, [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'low' }]),
    JSON.stringify(inside.directory.calls),
  )
  check('浮窗内 ⇧Tab 后「当前」行就地更新为 Low', same(currentLines(), ['当前：DeepSeek V4 Pro · Low']), JSON.stringify(currentLines()))
  check('浮窗内 ⇧Tab 不改变列表与高亮', pickerRows().length === 3 && activeRowIndex() === 1, String(activeRowIndex()))
  inside.press({ key: 'Escape', code: 'Escape' })

  // ⑪ ⇧Tab 的 editing 态门闸:只在 composer 自己的编辑区内接管
  const composerTarget = new FakeHTMLElement('DIV')
  composerTarget.isContentEditable = true
  const composerRoot = new FakeHTMLElement('DIV')
  composerRoot.contains = (node) => node === composerTarget
  const elsewhere = new FakeHTMLElement('TEXTAREA')
  const conversation = { input: { shell: () => ({ editor: { getRootElement: () => composerRoot } }) } }
  const gated = env({ conversation })
  event = gated.press({ ...shiftTab, target: composerTarget })
  check(
    'editing 态 + 焦点在 composer 内 → ⇧Tab 生效并吞键',
    event.propagationStopped === true && gated.directory.calls.length === 1,
    JSON.stringify(gated.directory.calls),
  )
  const outside = env({ conversation })
  event = outside.press({ ...shiftTab, target: elsewhere })
  check('editing 态 + 焦点在别处可编辑元素 → ⇧Tab 不吞键', event.propagationStopped !== true)
  check('editing 态 + 焦点在别处 → 不改模型强度', outside.directory.calls.length === 0)
  const noConversation = env()
  event = noConversation.press({ ...shiftTab, target: elsewhere })
  check('conversation 服务缺席 → editing 态 ⇧Tab no-op 不吞键', event.propagationStopped !== true && noConversation.directory.calls.length === 0)

  // ⑫ card 态:模型浮窗照开(带修饰键),⇧Tab 归卡片自己
  const cardEnv = env({
    uiSession: {
      pendingInteractions: {
        getSnapshot: () => new Map([['sess-b', { kind: 'question', key: 'question:9', sessionId: 'sess-b', questions: [{ id: 'q1', options: [{ label: 'A' }] }] }]]),
      },
    },
  })
  event = cardEnv.press(combo)
  await flush()
  check('card 态 ⌘/Ctrl+M 仍打开模型浮窗', event.propagationStopped === true && pickerRows().length === 3)
  cardEnv.press({ key: 'Escape', code: 'Escape' })
  event = cardEnv.press(shiftTab)
  check('card 态 ⇧Tab 不接管(交回卡片)', event.propagationStopped !== true && cardEnv.directory.calls.length === 0)

  // ⑬ 两个动作 id 的键位各自独立可覆盖
  storage.set('dsh-kbd-hotkeys:v1', JSON.stringify({ bindings: { 'model.pick': 'mod+alt+8', 'model.effortNext': 'mod+alt+u' } }))
  const custom = env()
  event = custom.press(combo)
  check('覆盖键位后 ⌘/Ctrl+M 不再打开', event.propagationStopped !== true && pickerRows().length === 0)
  event = custom.press({ key: '8', code: 'Digit8', ctrlKey: true, altKey: true })
  await flush()
  check('自定义 ⌘/Ctrl+Alt+8 打开模型浮窗并吞键', event.propagationStopped === true && pickerRows().length === 3)
  custom.press({ key: 'Escape', code: 'Escape' })
  event = custom.press(shiftTab)
  check('覆盖后 ⇧Tab 不再切换强度', event.propagationStopped !== true && custom.directory.calls.length === 0)
  event = custom.press({ key: 'u', code: 'KeyU', ctrlKey: true, altKey: true })
  check('自定义 ⌘/Ctrl+Alt+U → 切换强度并吞键', event.propagationStopped === true && custom.directory.calls.length === 1)
  storage.delete('dsh-kbd-hotkeys:v1')
}

if (isMain(import.meta.url)) report()
