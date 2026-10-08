/**
 * git 操作保护:在 shell 工具真正执行前拦下敏感的 git 子命令,并用一段系统提示词声明同一条策略。
 *
 * 两条通路各管一半:
 *   - `systemPrompt` 区段(`git-guard:push-policy`,与 TEAM_POLICY 同序)要求模型在 commit /
 *     push 与破坏性历史改写之前取得用户许可;
 *   - `tools/pre-execute` 钩子解析命令里的 git 子命令,命中即返回 `kind: 'ask'`。
 *
 * 命令判定是保守的启发式解析:只认能静态解析出 git 子命令的形态。解析不出(自定义包装器、
 * 嵌套的命令替换、超过 `MAX_DEPTH`)就不介入 —— 这类漏判由上面那段提示词兜底,而不是在解析器
 * 里猜。会话生效沙箱模式为 `danger-full-access` 时,两条通路都不介入。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'

type SessionRef = NonNullable<Parameters<SandboxPolicyService['resolve']>[0]>['session']

interface ShellArguments {
  readonly command?: unknown
}

const PUSH_POLICY_TEXT =
  '`git commit` 与 `git push` 均须获得用户许可后才能执行; ' +
  '破坏性历史改写与远程改写操作(如 `git rebase`、`git merge`、`git cherry-pick`、' +
  '`git revert`、`git reset --hard`、`git push --force`)同样须先获得用户许可, ' +
  '未获明确许可不得执行; 这些操作会以授权请求的形式征求你的用户同意, 不得自行绕过. ' +
  '若用户拒绝了某次代码提交或代码推送, 请停止, 不得再次尝试提交或推送; ' +
  '也不要以命令替换、别名、脚本包装等任何间接形式绕过. ' +
  '如需继续, 请等待用户的明确指示.'

const FULL_ACCESS_MODE: SandboxMode = 'danger-full-access'

/** 会话当前生效的沙箱模式;读不到(服务缺席、`resolve` 抛错)时返回 undefined,按「非完全访问」处理。 */
function effectiveSandboxMode(
  ctx: Context,
  session: SessionRef | undefined,
): SandboxMode | undefined {
  const policy = ctx.get('sandboxPolicy')
  if (policy === undefined || policy === null) return undefined
  if (typeof policy.resolve !== 'function') return undefined
  try {
    return policy.resolve({ session })?.mode
  } catch {
    return undefined
  }
}

function isFullAccess(ctx: Context, session: SessionRef | undefined): boolean {
  return effectiveSandboxMode(ctx, session) === FULL_ACCESS_MODE
}

/**
 * 按 `;`、换行、`&&`、`||`、`|` 切段。
 * 引号内与反斜杠转义后的分隔符不算分隔符,切出的每段保留原文(不去引号)。
 */
function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  const n = command.length
  let i = 0
  while (i < n) {
    const ch = command[i]!
    if (quote !== null) {
      if (ch === '\\' && quote === '"' && i + 1 < n) {
        current += ch + command[i + 1]!
        i += 2
        continue
      }
      current += ch
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      i += 1
      continue
    }
    if (ch === '\\' && i + 1 < n) {
      current += ch + command[i + 1]!
      i += 2
      continue
    }
    if (ch === ';' || ch === '\n') {
      if (current.trim().length > 0) segments.push(current)
      current = ''
      i += 1
      continue
    }
    if (ch === '&' && command[i + 1] === '&') {
      if (current.trim().length > 0) segments.push(current)
      current = ''
      i += 2
      continue
    }
    if (ch === '|') {
      if (current.trim().length > 0) segments.push(current)
      current = ''
      if (command[i + 1] === '|') i += 2
      else i += 1
      continue
    }
    current += ch
    i += 1
  }
  if (current.trim().length > 0) segments.push(current)
  return segments
}

/** 按 shell 词法切 token:引号只做分组、不进 token;反斜杠转义保留被转义的那个字符。 */
function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasCurrent = false
  let quote: '"' | "'" | null = null
  const n = command.length
  let i = 0
  while (i < n) {
    const ch = command[i]!
    if (quote !== null) {
      if (ch === '\\' && quote === '"' && i + 1 < n) {
        current += command[i + 1]!
        hasCurrent = true
        i += 2
        continue
      }
      current += ch
      hasCurrent = true
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      i += 1
      continue
    }
    if (ch === '\\' && i + 1 < n) {
      current += command[i + 1]!
      hasCurrent = true
      i += 2
      continue
    }
    if (/\s/.test(ch)) {
      if (hasCurrent) {
        tokens.push(current)
        current = ''
        hasCurrent = false
      }
      i += 1
      continue
    }
    current += ch
    hasCurrent = true
    i += 1
  }
  if (hasCurrent) tokens.push(current)
  return tokens
}

function stripExe(token: string): string {
  return /\.exe$/i.test(token) ? token.slice(0, -4) : token
}

function isShellCommand(token: string): boolean {
  const name = stripExe(token).toLowerCase()
  return (
    name === 'bash' ||
    name === 'sh' ||
    name === 'zsh' ||
    name === 'dash' ||
    name === 'ksh' ||
    name === 'pwsh' ||
    name === 'powershell' ||
    name === 'cmd' ||
    name === 'busybox'
  )
}

function isGitCommand(token: string): boolean {
  const name = stripExe(token).toLowerCase()
  return name === 'git' || name.endsWith('/git') || name.endsWith('\\git')
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/** 前缀包装词:出现在真正的命令之前,跳过它们才能把 `sudo git push` 判成 git push。 */
const WRAPPER_WORDS = new Set([
  'sudo',
  'doas',
  'command',
  'env',
  'nohup',
  'time',
  'nice',
  'stdbuf',
  'script',
  'builtin',
  'exec',
  '&',
])

/** 带取值的包装词选项(`sudo -u root`):跳过选项本身和它的值。 */
const PREFIX_FLAGS_WITH_VALUE = new Set([
  '-u',
  '--user',
  '-g',
  '--group',
  '-p',
  '--prompt',
])

/** 跳过环境变量赋值与前缀包装词 / 选项,返回真正要执行的命令所在的下标。 */
function findMainCommandIndex(tokens: string[]): number {
  let i = 0
  while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i]!)) i += 1
  while (i < tokens.length) {
    const t = tokens[i]!
    if (WRAPPER_WORDS.has(t)) {
      i += 1
      continue
    }
    if (t.startsWith('-')) {
      if (PREFIX_FLAGS_WITH_VALUE.has(t)) i += 2
      else i += 1
      continue
    }
    break
  }
  return i
}

/** git 自身的取值选项:跳过它们,下一个非选项 token 才是子命令。 */
const GIT_FLAGS_WITH_VALUE = new Set([
  '-C',
  '--git-dir',
  '--work-tree',
  '-c',
  '--config-env',
  '--namespace',
  '--exec-path',
  '--git-path',
])

function gitSubcommandOf(
  tokens: string[],
  start: number,
): { subcommand: string; args: string[] } | undefined {
  let subIdx = -1
  for (let i = start; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    if (tok.startsWith('-')) {
      if (GIT_FLAGS_WITH_VALUE.has(tok) && i + 1 < tokens.length) i += 1
      continue
    }
    subIdx = i
    break
  }
  if (subIdx < 0) return undefined
  return { subcommand: tokens[subIdx]!, args: tokens.slice(subIdx + 1) }
}

/** 去掉整段最外层成对的圆括号或花括号(`(git push)`)。 */
function stripBalancedWrap(segment: string): string {
  let s = segment
  while (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim()
  while (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1).trim()
  return s
}

/**
 * 取 `bash -c` / `cmd /c` / `pwsh -Command` 这类 shell 载荷,继续按命令解析。
 * 没有载荷时返回 undefined(该段不介入)。
 */
function shellPayload(tokens: string[], mainIdx: number): string | undefined {
  for (let i = mainIdx + 1; i < tokens.length; i += 1) {
    const flag = tokens[i]!
    if (flag === '-c' || flag === '/c' || flag === '-Command' || flag === '--command') {
      const payloadTokens = tokens.slice(i + 1)
      if (payloadTokens.length === 0) return undefined
      return payloadTokens.join(' ')
    }
  }
  return undefined
}

/**
 * 取出 `$(...)` 与反引号命令替换里的内容,交给 `decide` 递归判定。
 * 两种形态都只匹配不含嵌套的最内层写法,外层的普通文本不再单独解析。
 */
function extractSubstitutions(command: string): string[] {
  const out: string[] = []
  const dollarParen = /\$\(([^()]*)\)/g
  let match: RegExpExecArray | null
  while ((match = dollarParen.exec(command)) !== null) out.push(match[1]!)
  const backtick = /`([^`]*)`/g
  while ((match = backtick.exec(command)) !== null) out.push(match[1]!)
  return out
}

const FORCE_FLAGS = new Set(['--force', '-f', '--force-with-lease', '--force-if-includes'])

const RESET_DESTRUCTIVE = new Set(['--hard', '--merge', '--keep'])

const ASK_SUFFIX = '需要你的许可。请审核后批准或拒绝.'

const ASK_SUBCOMMANDS: Record<string, string> = {
  rebase: `git rebase 会改写提交历史, ${ASK_SUFFIX}`,
  merge: `git merge 会改写提交历史, ${ASK_SUFFIX}`,
  'cherry-pick': `git cherry-pick 会改写提交历史, ${ASK_SUFFIX}`,
  revert: `git revert 操作, ${ASK_SUFFIX}`,
  am: `git am 操作, ${ASK_SUFFIX}`,
  'filter-branch': `git filter-branch 会改写历史, ${ASK_SUFFIX}`,
  'filter-repo': `git filter-repo 会改写历史, ${ASK_SUFFIX}`,
}

interface AskDecision {
  readonly kind: 'ask'
  readonly reason: string
  readonly destructive: boolean
}

/** 同时命中多条判定时优先保留 `destructive: true` 的那条:强推送 / 破坏性重置的告警文案更具体。 */
function preferAsk(current: AskDecision | undefined, candidate: AskDecision | undefined): AskDecision | undefined {
  if (candidate === undefined) return current
  if (current === undefined) return candidate
  if (candidate.destructive && !current.destructive) return candidate
  return current
}

function decideGit(subcommand: string, args: string[]): AskDecision | undefined {
  if (subcommand === 'push') {
    if (args.some(flag => FORCE_FLAGS.has(flag))) {
      return {
        kind: 'ask',
        reason: `git push --force 等强制推送会改写远程历史, ${ASK_SUFFIX}`,
        destructive: true,
      }
    }
    return { kind: 'ask', reason: `git push ${ASK_SUFFIX}`, destructive: false }
  }
  if (subcommand === 'commit') {
    return { kind: 'ask', reason: `git commit ${ASK_SUFFIX}`, destructive: false }
  }
  if (subcommand === 'reset') {
    if (args.some(flag => RESET_DESTRUCTIVE.has(flag))) {
      return {
        kind: 'ask',
        reason: `git reset --hard 等破坏性重置可能丢失工作区改动, ${ASK_SUFFIX}`,
        destructive: true,
      }
    }
    return undefined
  }
  const askReason = ASK_SUBCOMMANDS[subcommand]
  if (askReason !== undefined) return { kind: 'ask', reason: askReason, destructive: true }
  return undefined
}

/** 递归解析的深度上限:命令替换与 shell 载荷可以互相嵌套,这里兜底防爆栈。 */
const MAX_DEPTH = 5

function decideSegment(segment: string, depth: number): AskDecision | undefined {
  const stripped = stripBalancedWrap(segment.trim())
  if (stripped.length === 0) return undefined
  const tokens = tokenize(stripped)
  if (tokens.length === 0) return undefined

  const mainIdx = findMainCommandIndex(tokens)
  if (mainIdx >= tokens.length) return undefined
  const main = tokens[mainIdx]!

  if (isShellCommand(main)) {
    const payload = shellPayload(tokens, mainIdx)
    if (payload === undefined) return undefined
    return decide(payload, depth + 1)
  }

  if (!isGitCommand(main)) return undefined

  const found = gitSubcommandOf(tokens, mainIdx + 1)
  if (found === undefined) return undefined
  return decideGit(found.subcommand, found.args)
}

/** 判定一条命令行:先看命令替换,再逐段判定,取其中后果最强的一条。 */
function decide(command: string, depth = 0): AskDecision | undefined {
  if (depth > MAX_DEPTH) return undefined
  let best: AskDecision | undefined
  for (const inner of extractSubstitutions(command)) {
    best = preferAsk(best, decide(inner, depth + 1))
  }
  for (const segment of splitSegments(command)) {
    best = preferAsk(best, decideSegment(segment, depth))
  }
  return best
}

export const name = 'dsh-git-guard'

export function apply(ctx: Context): void {
  // 区段与 TEAM_POLICY 同序;完全访问模式下文本为空 —— 区段仍注册,但不向模型提出授权要求。
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.systemPrompt.section({
      name: 'git-guard:push-policy',
      order: promptCtx.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: assembleContext =>
        isFullAccess(promptCtx, assembleContext.agent?.session) ? '' : PUSH_POLICY_TEXT,
    })
  })

  // 解析不出 git 子命令、或会话处于完全访问模式时原样放行(见文件头)。
  ctx.on('tools/pre-execute', async (exec, next) => {
    const args = exec.arguments as ShellArguments | undefined
    const command = typeof args?.command === 'string' ? args.command : undefined
    if (command === undefined || command.trim().length === 0) return await next()
    const decision = decide(command)
    if (decision === undefined) return await next()
    if (isFullAccess(ctx, exec.agent?.session)) return await next()
    return { kind: 'ask' as const, reason: decision.reason }
  })
}

export default { name, apply }
