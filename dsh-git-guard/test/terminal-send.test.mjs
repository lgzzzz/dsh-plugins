/**
 * terminal_send 覆盖:该工具把 `text` 送进终端执行,参数里没有 `command`。
 * 只要文本里含敏感 git 子命令(包括带换行、submit 为 false 的情形)就要求用户许可;
 * 其余文本、缺 text 或其它工具的 text 一律放行。
 *
 * 运行:`node test/terminal-send.test.mjs`(或 pnpm test 跑全部)。
 */
import assert from 'node:assert/strict'
import { createHarness } from './helpers.mjs'

const { decide, decideTool } = createHarness()

for (const [label, toolArguments] of [
  ['text 为强推', { text: 'git push --force' }],
  ['text 为提交', { text: 'git commit -m x' }],
  ['text 为普通 push', { text: 'git push' }],
  ['text 带换行执行', { text: 'echo hi\ngit push --force\n' }],
  ['submit 为 false 的强推', { text: 'git push --force', submit: false }],
  ['submit 为 true 的强推', { text: 'git push --force', submit: true }],
  ['Windows 路径的强推', { text: 'C:\\Git\\bin\\git.exe push --force' }],
]) {
  const decision = await decideTool('terminal_send', toolArguments)
  assert.equal(decision?.kind, 'ask', `ask(terminal_send): ${label}`)
  assert.match(decision?.reason ?? '', /许可/, `ask reason 告知需用户许可: ${label}`)
}

{
  const decision = await decideTool('terminal_send', { text: 'git push --force' })
  assert.match(decision?.reason ?? '', /--force/, 'terminal_send 的强推仍优先给出破坏性文案')
  assert.deepEqual(Object.keys(decision).sort(), ['kind', 'reason'], '交出的决定只含 kind / reason')
}

for (const [label, toolArguments] of [
  ['普通命令', { text: 'echo hi' }],
  ['多条普通命令', { text: 'ls -la\npwd' }],
  ['空文本', { text: '' }],
  ['无 text', {}],
  ['只有 submit', { submit: true }],
  ['text 非字符串', { text: 42 }],
]) {
  const decision = await decideTool('terminal_send', toolArguments)
  assert.equal(decision?.kind, 'allow', `allow(terminal_send): ${label}`)
  assert.equal(decision?.passthrough, true, `allow 由 next() 放行: ${label}`)
}

// 只对 terminal_send 认 text,其它工具即使带 text 也不介入。
assert.equal(
  (await decideTool('read', { text: 'git push --force' }))?.kind,
  'allow',
  '其它工具的 text 不参与判定',
)

// 既有 shell 工具的 command 通路不受影响。
assert.equal((await decide('git push --force'))?.kind, 'ask', 'shell 工具的 command 仍 ask')
assert.equal((await decide('echo hi'))?.kind, 'allow', 'shell 工具的普通命令仍放行')
assert.equal(
  (await decideTool('bash', { command: 'git push --force' }))?.kind,
  'ask',
  'bash 工具的 command 仍 ask',
)

console.log('terminal-send checks passed')
