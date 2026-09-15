/**
 * dsh-git-guard 行为冒烟测试。
 *
 * 全部敏感 git 操作（commit / push，含 force push 与 rebase、merge、cherry-pick、
 * reset --hard 等破坏性历史改写）一律断言为 `ask`：本插件不再直接 deny。
 *
 * 直接用支持 Type Stripping 的运行时加载 index.ts（Node 22.18+ / 23.6+ / 24+，
 * 或 App 内置运行时）：
 *
 *   node test.mjs
 *   ELECTRON_RUN_AS_NODE=1 "/path/to/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" test.mjs
 */
import assert from 'node:assert/strict'
import guard, { name, apply } from './index.ts'

assert.equal(name, 'dsh-git-guard')
assert.equal(typeof apply, 'function')
assert.equal(guard.name, name)
assert.equal(guard.apply, apply)

// --- 宿主桩：钩子注册、系统提示词区段注册、沙箱权限服务 ---
const listeners = new Map()
const sections = []

/** 部署默认文件沙箱模式（无会话覆盖时生效）。 */
let defaultMode = 'workspace-write'
/** 会话覆盖：session 对象 → 模式（模拟 sandbox/mode 事件折叠出的会话级结果）。 */
const sessionModes = new Map()
/** 失败关闭三态：服务未挂载 / 服务没有 resolve / resolve 抛错。 */
let policyMounted = true
let policyHasResolve = true
let policyFails = false
/** 观测：插件向宿主问过哪些服务、resolve 被调用几次、最后收到的会话身份。 */
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
          // 仅解析仓库预留槽位 TEAM_POLICY(=600)，其余返回 0。
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

// --- 系统提示词：提交推送策略区段（按会话权限动态求值）---
assert.equal(sections.length, 1, '恰注册一个系统提示词区段')
const [policySection] = sections
assert.equal(policySection.name, 'git-guard:push-policy')
assert.equal(policySection.order, 600, '区段位于 TEAM_POLICY 槽位')
assert.equal(typeof policySection.text, 'function', '区段文本按组装上下文求值')

/** 以「某会话（或缺席）」求值一次区段文本。 */
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

// 模拟流水线：next() 落到链尾的默认 allow，passthrough 标记用来区分
// 「本插件未介入（交给下一个监听器）」与「本插件的决定恰好是 allow」。
// 门禁与工具名解耦：命令经由任何 shell 工具（bash / pwsh / cmd …）都应被审查。
function decide(command, options = {}) {
  const { toolName = 'pwsh', session } = options
  const exec = { name: toolName, arguments: { command } }
  if (session !== undefined) exec.agent = { session }
  return hook(exec, async () => ({ kind: 'allow', passthrough: true }))
}

// --- ask：git commit / git push（非 force）---
for (const command of [
  'git commit -m x',
  'git add . && git commit',
  'git add .; git commit -m "msg"',
  // 本次实际漏拦截的命令（经 pwsh 工具）：
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

// --- ask：破坏性 / 历史改写操作（原先直接 deny，现一律改为请求用户授权）---
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

// 回归：任何命令都不再由本插件直接拒绝（deny 语义已全部改为 ask）。
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

// 同一条命令行内多处命中：破坏性措辞优先于普通措辞，且只产生一个决定。
{
  const decision = await decide('git commit -m x && git push --force')
  assert.equal(decision?.kind, 'ask', '混合命令仍是 ask')
  assert.match(decision?.reason ?? '', /--force/, '混合命令优先提示破坏性操作')
  assert.deepEqual(Object.keys(decision).sort(), ['kind', 'reason'], '交出的决定只含 kind / reason（内部标记已剥掉）')
}

// 逐段 / 逐层审查：破坏性操作在后续语句段里也能被优先挑出。
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

// --- 放行：安全 git 子命令与非 git 命令（本插件不介入 → 交给链尾）---
for (const command of [
  'git status',
  'git log && echo done',
  'git add .',
  'git reset HEAD~1', // 普通 mixed/smooth 重置放行
  'ls -la',
  'Get-ChildItem',
  'echo git commit', // git 不在命令位 → 不应误拦截
]) {
  const decision = await decide(command)
  assert.equal(decision?.kind, 'allow', `allow: ${command}`)
  assert.equal(decision?.passthrough, true, `allow 由 next() 放行: ${command}`)
}

// --- 完全权限（danger-full-access）：不拦截、不索取授权 ---
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

// 判定交给沙箱策略服务：把本次调用所属会话透传给它，由它按「会话覆盖 > 部署默认」裁决。
await decide('git commit -m x', { session: fullAccessSession })
assert.equal(lastResolvedSession, fullAccessSession, 'resolve 收到本次调用所属会话')

// 只有本插件本来会介入的命令才解析权限，其余命令（含大量非 git 命令）零开销。
const callsBefore = resolveCalls
await decide('git status', { session: fullAccessSession })
await decide('ls -la', { session: fullAccessSession })
assert.equal(resolveCalls, callsBefore, '不产生决定的命令不解析权限')
await decide('git commit -m x', { session: fullAccessSession })
assert.equal(resolveCalls, callsBefore + 1, '将要介入的命令解析一次权限')

// 部署默认即完全权限、且调用无 agent（无会话可查）时同样放行。
defaultMode = 'danger-full-access'
assert.equal((await decide('git commit -m x'))?.passthrough, true, '部署默认完全权限时放行')
defaultMode = 'workspace-write'

// 权限是 per-session 的：别的会话不因某会话是完全权限而失去护栏。
assert.equal((await decide('git commit -m x', { session: workspaceSession }))?.kind, 'ask')
assert.equal((await decide('git push --force', { session: workspaceSession }))?.kind, 'ask')

// 只有 danger-full-access 是「完全权限」：read-only 照旧拦截且照旧告知模型。
const readOnlySession = { id: 'session-read-only' }
sessionModes.set(readOnlySession, 'read-only')
assert.equal((await decide('git commit -m x', { session: readOnlySession }))?.kind, 'ask', 'read-only 仍 ask')
assert.match(sectionText(readOnlySession), /用户许可/, 'read-only 仍收到约束区段')
sessionModes.delete(readOnlySession)

// 只问沙箱模式，不问 approval 策略：上游把子代理的 approval 一律钉为 never，
// 若以 approval=never 判定完全权限，子代理会绕过全部护栏。
assert.deepEqual(
  [...new Set(requestedServices)],
  ['sandboxPolicy'],
  '权限判定只取用 sandboxPolicy 服务',
)

// --- 失败关闭：权限未知按「非完全权限」处理，照常索取授权 ---
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

// --- 非 shell 工具（无 command 字段）不拦截 ---
assert.equal((await hook({ name: 'read', arguments: { file: 'x' } }, async () => ({ kind: 'allow', passthrough: true })))?.passthrough, true)

console.log('all behavioral checks passed')
