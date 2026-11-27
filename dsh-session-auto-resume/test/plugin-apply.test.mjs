/**
 * 假宿主集成测试：`apply` 的启动扫描、过滤器、恢复动作、错误隔离与 dry-run。
 *
 * 用假的 sessionController / sessionQuery / sessions / agents 复刻插件真正调用的
 * 那几个方法，不启动 DSH，也不读写任何真实会话。
 *
 * 运行：`node test/plugin-apply.test.mjs`。
 */
import assert from 'node:assert/strict'
import { apply } from '../index.ts'

/** 每次运行都重新取“现在”，避免跨测试文件的时间漂移。 */
const NOW = Date.now()

/** 造一条会话摘要（`sessionController.list()` 的一行）。 */
const summary = (sessionId, overrides = {}) => ({
  sessionId,
  updatedAt: NOW - 60_000,
  running: false,
  blank: false,
  cwd: '/work',
  ...overrides,
})

/** 造一段会话日志：一轮结束于给定的原因。 */
const turnLog = (kind, cause) => [
  { type: 'turn/start', seq: 0, time: NOW - 120_000, data: { turn: 1 } },
  {
    type: 'turn/end',
    seq: 1,
    time: NOW - 60_000,
    data: {
      turn: 1,
      reason: { kind, ...(cause === undefined ? {} : { reason: { kind: cause } }) },
    },
  },
]

/** 造默认配置，测试里只覆盖关心的字段。 */
const defaultConfig = (overrides = {}) => ({
  windowDays: 7,
  maxResumes: 10,
  scanLimit: 300,
  startupDelayMs: 0,
  continuationMessage: '（DSH 自动恢复：{reason}）继续未完成的工作。',
  includeHookCancelled: true,
  dryRun: false,
  ...overrides,
})

/**
 * 造一个假 Host。
 * @param options.sessions - `sessionController.list()` 返回的行。
 * @param options.logs - 会话 id → 事件数组（或要抛出的错误）。
 * @param options.archived - 已归档会话 id。
 * @param options.live - 已有 live Agent 的会话 id。
 * @param options.agents - 会话 id → `resolveAgent()` 返回的 Agent（覆盖默认 idle Agent）。
 * @param options.resolve - 会话 id → `resolveAgent()` 的返回值（覆盖默认）。
 * @param options.readErrors - 会话 id → 读日志要抛的错误。
 * @param options.promptErrors - 会话 id → prompt 要抛的错误。
 * @param options.flush - `sessions.flush()` 的返回值。
 */
function makeHost(options = {}) {
  const prompts = []
  const infos = []
  const warnings = []
  const disposers = []
  const calls = { list: 0 }
  const live = new Map((options.live ?? []).map((id) => [id, { id, status: 'idle', session: { id } }]))
  const resolveMap = options.resolve ?? {}

  const ctx = {
    logger: {
      info: (message) => infos.push(String(message)),
      warn: (message) => warnings.push(String(message)),
    },
    effect: (body) => {
      disposers.push(body())
    },
    get: (name) => (name === 'workspaceRegistry'
      ? { archivedSessionIds: options.archived ?? [] }
      : undefined),
    agents: {
      list: () => [...live.values()],
      get: (id) => live.get(id),
    },
    sessions: {
      flush: async () => options.flush ?? true,
    },
    sessionQuery: {
      readSession: async (id) => {
        if (options.readErrors?.[id] !== undefined) throw options.readErrors[id]
        const events = options.logs?.[id]
        if (events === undefined) throw new Error(`no log for ${id}`)
        return { session: { id }, inheritedEventCount: 0, events }
      },
    },
    sessionController: {
      list: async () => {
        calls.list += 1
        return { items: options.sessions ?? [] }
      },
      resolveAgent: async (id) => {
        if (resolveMap[id] !== undefined) return resolveMap[id]
        const agent = { id, status: 'idle', session: { id } }
        live.set(id, agent)
        return { agent }
      },
      prompt: async (request) => {
        if (options.promptErrors?.[request.sessionId] !== undefined) throw options.promptErrors[request.sessionId]
        prompts.push(request)
        return { accepted: true }
      },
    },
  }

  return { ctx, prompts, infos, warnings, disposers, calls, live }
}

/** 等扫描的异步链跑完：list → read → resolve → prompt → flush 各有一两个微任务。 */
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 1))
}

/** 起一次插件并等扫描结束。 */
async function run(host, config = {}) {
  apply(host.ctx, defaultConfig(config))
  await settle()
}

// 结局口径：只恢复 interrupted 与非用户 aborted

{
  const cases = [
    ['interrupted', turnLog('interrupted'), true, 'interrupted'],
    ['disposed', turnLog('aborted', 'disposed'), true, 'aborted:disposed'],
    ['parent', turnLog('aborted', 'parent'), true, 'aborted:parent'],
    ['hook', turnLog('aborted', 'hook'), true, 'aborted:hook'],
    ['user', turnLog('aborted', 'user'), false, undefined],
    ['legacy', turnLog('aborted', 'legacy'), false, undefined],
    ['completed', turnLog('completed'), false, undefined],
    ['error', turnLog('error'), false, undefined],
    ['max-tokens', turnLog('max-tokens'), false, undefined],
    ['blocked', turnLog('blocked'), false, undefined],
    ['open', [{ type: 'turn/start', seq: 0, time: NOW - 60_000, data: { turn: 1 } }], true, 'interrupted'],
    ['blank-log', [], false, undefined],
  ]
  const logs = Object.fromEntries(cases.map(([id, log]) => [id, log]))
  const host = makeHost({ sessions: cases.map(([id]) => summary(id)), logs })
  await run(host)

  const prompted = host.prompts.map((request) => request.sessionId).sort()
  assert.deepEqual(prompted, ['disposed', 'hook', 'interrupted', 'open', 'parent'], '只恢复没跑完就被打断的几种')
  for (const [id, , expected, label] of cases) {
    if (!expected) continue
    const request = host.prompts.find((item) => item.sessionId === id)
    assert.ok(request, `${id} 应该被恢复`)
    assert.match(request.content[0].text, new RegExp(label), `${id} 的续跑文案带原因标签`)
    assert.equal(typeof request.requestId, 'string', 'prompt 带 requestId')
    assert.ok(request.requestId.length > 0, 'requestId 非空')
    assert.equal(request.mode, 'queue', '默认排到下一轮')
  }
  assert.equal(host.live.size, 5, '恢复过的会话都建立了 live Agent')
  assert.ok(
    host.infos.some((line) => line.includes('已恢复会话 interrupted')),
    '恢复成功要记日志',
  )
}

// hook 口径可关

{
  const host = makeHost({
    sessions: [summary('hook')],
    logs: { hook: turnLog('aborted', 'hook') },
  })
  await run(host, { includeHookCancelled: false })
  assert.deepEqual(host.prompts, [], '关掉 hook 口径后不恢复')
}

// 便宜过滤：归档、subagent、running、blank、无 cwd、已有 live Agent、过期

{
  const host = makeHost({
    sessions: [
      summary('ok'),
      summary('archived'),
      summary('subagent', { origin: 'subagent' }),
      summary('running', { running: true }),
      summary('blank', { blank: true }),
      summary('no-cwd', { cwd: undefined }),
      summary('already-live'),
      summary('stale', { updatedAt: NOW - 8 * 86_400_000 }),
    ],
    logs: Object.fromEntries(
      ['ok', 'archived', 'subagent', 'running', 'blank', 'no-cwd', 'already-live', 'stale']
        .map((id) => [id, turnLog('interrupted')]),
    ),
    archived: ['archived'],
    live: ['already-live'],
  })
  await run(host)
  assert.deepEqual(host.prompts.map((request) => request.sessionId), ['ok'], '只有干净的候选被恢复')
}

// 时间窗与数量上限：按最近活动倒序，只恢复最新的 N 个

{
  const host = makeHost({
    sessions: [
      summary('a', { updatedAt: NOW - 10_000 }),
      summary('b', { updatedAt: NOW - 20_000 }),
      summary('c', { updatedAt: NOW - 30_000 }),
    ],
    logs: { a: turnLog('interrupted'), b: turnLog('interrupted'), c: turnLog('interrupted') },
  })
  await run(host, { maxResumes: 2 })
  assert.deepEqual(host.prompts.map((request) => request.sessionId), ['a', 'b'], '先恢复最新的两个')
  assert.ok(
    host.infos.some((line) => line.includes('扫描 2/3 个候选会话')),
    '汇总行报告检查了几个候选',
  )
}

// maxResumes=0：连列表都不读

{
  const host = makeHost({
    sessions: [summary('a')],
    logs: { a: turnLog('interrupted') },
  })
  await run(host, { maxResumes: 0 })
  assert.deepEqual(host.prompts, [], 'maxResumes=0 不恢复')
  assert.equal(host.calls.list, 0, 'maxResumes=0 时不去读会话列表')
}

// dry-run：只记日志，不恢复

{
  const host = makeHost({
    sessions: [summary('a')],
    logs: { a: turnLog('interrupted') },
  })
  await run(host, { dryRun: true })
  assert.deepEqual(host.prompts, [], 'dry-run 不写任何消息')
  assert.ok(
    host.infos.some((line) => line.includes('[dry-run] 会恢复会话 a')),
    'dry-run 逐条报告会恢复谁',
  )
  assert.ok(
    host.infos.some((line) => line.includes('dry-run，未真正恢复')),
    'dry-run 的汇总行有标记',
  )
}

// 错误隔离：读日志 / 恢复失败只跳过该会话，后面的继续

{
  const host = makeHost({
    sessions: ['read-fail', 'resolve-fail', 'prompt-fail', 'ok'].map((id) => summary(id)),
    logs: {
      'read-fail': turnLog('interrupted'),
      'resolve-fail': turnLog('interrupted'),
      'prompt-fail': turnLog('interrupted'),
      ok: turnLog('interrupted'),
    },
    readErrors: { 'read-fail': new Error('log unreadable') },
    resolve: {
      'resolve-fail': { error: { code: 'session/writer-held', message: 'held elsewhere' } },
    },
    promptErrors: { 'prompt-fail': new Error('queue write failed') },
  })
  await run(host)
  assert.deepEqual(host.prompts.map((request) => request.sessionId), ['ok'], '失败只影响自己，后续照常')
  assert.ok(
    host.warnings.some((line) => line.includes('读取会话 read-fail 失败') && line.includes('log unreadable')),
    '读日志失败有告警',
  )
  assert.ok(
    host.warnings.some((line) => line.includes('无法恢复会话 resolve-fail') && line.includes('writer-held')),
    '恢复失败有告警',
  )
  assert.ok(
    host.warnings.some((line) => line.includes('恢复会话 prompt-fail') && line.includes('queue write failed')),
    '写消息失败有告警',
  )
}

// 恢复后已经在跑：不追加消息

{
  const host = makeHost({
    sessions: [summary('busy')],
    logs: { busy: turnLog('interrupted') },
    resolve: { busy: { agent: { id: 'busy', status: 'running', session: { id: 'busy' } } } },
  })
  await run(host)
  assert.deepEqual(host.prompts, [], '已经跑起来的会话不追加续跑消息')
}

// flush 未确认：仍然算恢复成功，但要告警

{
  const host = makeHost({
    sessions: [summary('a')],
    logs: { a: turnLog('interrupted') },
    flush: false,
  })
  await run(host)
  assert.equal(host.prompts.length, 1, 'flush 失败不回滚恢复')
  assert.ok(
    host.warnings.some((line) => line.includes('没有持久化监听确认')),
    'flush 未确认要告警',
  )
}

// 销毁时清理：生命周期中止后定时器与 effect 都被撤销

{
  const host = makeHost({ sessions: [], logs: {} })
  apply(host.ctx, defaultConfig({ startupDelayMs: 50 }))
  assert.equal(host.disposers.length, 2, '注册了“中止扫描”和“清定时器”两个 effect')
  for (const dispose of host.disposers) dispose()
  await settle()
  assert.equal(host.calls.list, 0, '销毁后定时器不再触发扫描')
}

console.log('plugin-apply.test.mjs: 全部通过')
