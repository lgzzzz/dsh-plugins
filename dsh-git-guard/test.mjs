import assert from 'node:assert/strict'
import guard, { name, apply } from './index.ts'

assert.equal(name, 'dsh-git-guard')
assert.equal(typeof apply, 'function')
assert.equal(guard.name, name)
assert.equal(guard.apply, apply)

const listeners = new Map()
const sections = []

let defaultMode = 'workspace-write'
const sessionModes = new Map()
let policyMounted = true
let policyHasResolve = true
let policyFails = false
const requestedServices = []
let resolveCalls = 0
let lastResolvedSession

const ctx = {
  on(eventName, callback) {
    listeners.set(eventName, callback)
    return () => true
  },
  inject(deps, callback) {
    assert.ok(deps.includes('systemPrompt'), 'inject 请求 systemPrompt 服务')
    callback({
      systemPrompt: {
        section(section) {
          sections.push(section)
          return () => true
        },
        getSectionOrder(slotName) {
          return slotName === 'TEAM_POLICY' ? 600 : 0
        },
      },
      get: ctx.get,
    })
    return () => true
  },
  get(serviceName) {
    requestedServices.push(serviceName)
    if (serviceName !== 'sandboxPolicy' || !policyMounted) return undefined
    if (!policyHasResolve) return {}
    return {
      resolve(request = {}) {
        resolveCalls += 1
        lastResolvedSession = request.session
        if (policyFails) throw new Error('sandbox policy exploded')
        const session = request.session
        const override = session === undefined ? undefined : sessionModes.get(session)
        return { mode: override ?? defaultMode }
      },
    }
  },
}
guard.apply(ctx)
const hook = listeners.get('tools/pre-execute')
assert.ok(hook, 'tools/pre-execute hook registered')

assert.equal(sections.length, 1, '恰注册一个系统提示词区段')
const [policySection] = sections
assert.equal(policySection.name, 'git-guard:push-policy')
assert.equal(policySection.order, 600, '区段位于 TEAM_POLICY 槽位')
assert.equal(typeof policySection.text, 'function', '区段文本按组装上下文求值')

function sectionText(session) {
  return policySection.text({ agent: session === undefined ? undefined : { session } })
}

const workspaceSession = { id: 'session-workspace-write' }
const fullAccessSession = { id: 'session-full-access' }
sessionModes.set(fullAccessSession, 'danger-full-access')

for (const [label, text] of [
  ['无 agent 的组装', sectionText()],
  ['workspace-write 会话', sectionText(workspaceSession)],
]) {
  assert.match(text, /git push/, `${label}：区段提及 git push`)
  assert.match(text, /git commit/, `${label}：区段提及 git commit`)
  assert.match(text, /用户许可/, `${label}：区段声明需要用户许可`)
  assert.match(text, /git push --force|rebase/, `${label}：区段提及破坏性操作同样须获许可`)
}
assert.equal(sectionText(fullAccessSession), '', '完全权限会话：区段文本为空，不向模型提出授权要求')

function decide(command, options = {}) {
  const { toolName = 'pwsh', session } = options
  const exec = { name: toolName, arguments: { command } }
  if (session !== undefined) exec.agent = { session }
  return hook(exec, async () => ({ kind: 'allow', passthrough: true }))
}

for (const command of [
  'git commit -m x',
  'git add . && git commit',
  'git add .; git commit -m "msg"',
  'git add dsh-git-guard; git commit -m "refactor(dsh-git-guard): git push 由 deny 改为 ask"',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(commit): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知提交需用户许可')
}

for (const command of [
  'git push',
  'git push origin main',
  'GIT_SSH_COMMAND="ssh -i k" git push',
  'git -C /repo push',
  'git -C "C:/some path with space/my repo" push',
  '& git push',
  'VAR="a b" git push',
  'sudo git push',
  'sudo -u user git push',
  'env git push',
  'command git push',
  'bash -c \'git push\'',
  'bash -c "git push"',
  'cmd /c git push',
  'pwsh -Command "git push"',
  '( git push )',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(push): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知推送需用户许可')
}

for (const command of [
  'git push --force',
  'git push -f',
  'git push --force-with-lease',
  'git push --force-if-includes',
  'git rebase',
  'git rebase -i HEAD~3',
  'git merge feature',
  'git cherry-pick abc123',
  'git reset --hard HEAD~1',
  'git reset --keep',
  'git reset --merge',
  'git revert abc123',
  'git am < patch.diff',
  'git filter-branch -- --all',
  'git filter-repo --force',
  'git add . && git push --force',
  'bash -c "git rebase -i HEAD~3"',
  'sudo git reset --hard HEAD~1',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'ask', `ask(破坏性): ${command}`)
  assert.match(decision?.reason ?? '', /许可/, 'ask reason 告知需用户许可')
  assert.match(decision?.reason ?? '', /批准或拒绝/, 'ask reason 交给用户裁决')
}

for (const command of [
  'git commit -m x',
  'git push',
  'git push --force',
  'git rebase -i HEAD~3',
  'git merge feature',
  'git cherry-pick abc123',
  'git reset --hard HEAD~1',
  'git revert abc123',
  'git filter-branch -- --all',
]) {
  const decision = await decide(command)
  assert.notEqual(decision?.kind, 'deny', `不再产生 deny: ${command}`)
}

{
  const decision = await decide('git commit -m x && git push --force')
  assert.equal(decision?.kind, 'ask', '混合命令仍是 ask')
  assert.match(decision?.reason ?? '', /--force/, '混合命令优先提示破坏性操作')
  assert.deepEqual(Object.keys(decision).sort(), ['kind', 'reason'], '交出的决定只含 kind / reason（内部标记已剥掉）')
}

{
  const decision = await decide('git add .; git commit -m x; git reset --hard HEAD~1')
  assert.equal(decision?.kind, 'ask')
  assert.match(decision?.reason ?? '', /reset --hard/, '后续语句段里的破坏性操作仍优先提示')
}
{
  const decision = await decide('bash -c "git push --force"')
  assert.equal(decision?.kind, 'ask')
  assert.match(decision?.reason ?? '', /--force/, 'shell 负载内的破坏性操作同样优先提示')
}

for (const command of [
  'git status',
  'git log && echo done',
  'git add .',
  'git reset HEAD~1',
  'ls -la',
  'Get-ChildItem',
  'echo git commit',
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'allow', `allow: ${command}`)
  assert.equal(decision?.passthrough, true, `allow 由 next() 放行: ${command}`)
}

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
assert.equal(lastResolvedSession, fullAccessSession, 'resolve 收到本次调用所属会话')

const callsBefore = resolveCalls
await decide('git status', { session: fullAccessSession })
await decide('ls -la', { session: fullAccessSession })
assert.equal(resolveCalls, callsBefore, '不产生决定的命令不解析权限')
await decide('git commit -m x', { session: fullAccessSession })
assert.equal(resolveCalls, callsBefore + 1, '将要介入的命令解析一次权限')

defaultMode = 'danger-full-access'
assert.equal((await decide('git commit -m x'))?.passthrough, true, '部署默认完全权限时放行')
defaultMode = 'workspace-write'

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

policyMounted = false
assert.equal((await decide('git commit -m x', { session: fullAccessSession }))?.kind, 'ask', '服务缺席仍 ask')
assert.equal((await decide('git push --force', { session: fullAccessSession }))?.kind, 'ask', '服务缺席仍 ask(force push)')
policyMounted = true

policyHasResolve = false
assert.equal((await decide('git commit -m x', { session: fullAccessSession }))?.kind, 'ask', '服务无 resolve 仍 ask')
policyHasResolve = true

policyFails = true
assert.equal((await decide('git commit -m x', { session: fullAccessSession }))?.kind, 'ask', 'resolve 抛错仍 ask')
assert.equal((await decide('git rebase', { session: fullAccessSession }))?.kind, 'ask', 'resolve 抛错仍 ask(破坏性操作)')
assert.notEqual(sectionText(fullAccessSession), '', 'resolve 抛错时区段仍保留（不误判为完全权限）')
policyFails = false

assert.equal((await hook({ name: 'read', arguments: { file: 'x' } }, async () => ({ kind: 'allow', passthrough: true })))?.passthrough, true)

console.log('all behavioral checks passed')
