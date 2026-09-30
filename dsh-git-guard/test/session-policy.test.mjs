/**
 * C 会话权限解析:完全权限放行、resolve 收到本次会话、只在将要介入时解析、
 * 部署默认 danger-full-access、workspace-write / read-only 仍 ask,以及
 * 权限判定只取用 sandboxPolicy 服务。
 *
 * 运行:`node test/session-policy.test.mjs`(或 pnpm test 跑全部)。
 */
import assert from 'node:assert/strict'
import { createHarness, fullAccessSession, workspaceSession } from './helpers.mjs'

const harness = createHarness()
const { decide, sectionText, sessionModes, requestedServices, state } = harness

for (const command of [
  'git commit -m x',
  'git add . && git commit -m "msg"',
  'git push',
  'git push origin main',
  'git push --force',
  'git push --force-with-lease',
  'git rebase -i HEAD~3',
  'git merge feature',
  'git cherry-pick abc123',
  'git reset --hard HEAD~1',
  'git filter-branch -- --all',
]) {
  const decision = await decide(command, { session: fullAccessSession })
  assert.equal(decision?.kind, 'allow', `完全权限放行: ${command}`)
  assert.equal(decision?.passthrough, true, `完全权限下本插件不产生决定: ${command}`)
}

await decide('git commit -m x', { session: fullAccessSession })
assert.equal(state.lastResolvedSession, fullAccessSession, 'resolve 收到本次调用所属会话')

const callsBefore = state.resolveCalls
await decide('git status', { session: fullAccessSession })
await decide('ls -la', { session: fullAccessSession })
assert.equal(state.resolveCalls, callsBefore, '不产生决定的命令不解析权限')
await decide('git commit -m x', { session: fullAccessSession })
assert.equal(state.resolveCalls, callsBefore + 1, '将要介入的命令解析一次权限')

state.defaultMode = 'danger-full-access'
assert.equal((await decide('git commit -m x'))?.passthrough, true, '部署默认完全权限时放行')
state.defaultMode = 'workspace-write'

assert.equal((await decide('git commit -m x', { session: workspaceSession }))?.kind, 'ask')
assert.equal((await decide('git push --force', { session: workspaceSession }))?.kind, 'ask')

const readOnlySession = { id: 'session-read-only' }
sessionModes.set(readOnlySession, 'read-only')
assert.equal((await decide('git commit -m x', { session: readOnlySession }))?.kind, 'ask', 'read-only 仍 ask')
assert.match(sectionText(readOnlySession), /用户许可/, 'read-only 仍收到约束区段')
sessionModes.delete(readOnlySession)

assert.deepEqual(
  [...new Set(requestedServices)],
  ['sandboxPolicy'],
  '权限判定只取用 sandboxPolicy 服务',
)

console.log('session-policy checks passed')
