/**
 * git 操作保护:在 shell 工具真正执行前拦下敏感的 git 子命令,并用一段系统提示词声明同一条策略。
 *
 * 两条通路各管一半:
 *   - `systemPrompt` 区段(`git-guard:push-policy`,与 TEAM_POLICY 同序)要求模型在 commit /
 *     push、checkout / switch、clean 等删除操作与破坏性历史改写之前取得用户许可;
 *   - `tools/pre-execute` 钩子解析命令里的 git 子命令,命中即返回 `kind: 'ask'`。
 *
 * 命令判定是保守的启发式解析:只认能静态解析出 git 子命令的形态。解析不出(自定义包装器、
 * 嵌套的命令替换、超过 `MAX_DEPTH`)就不介入 —— 这类漏判由上面那段提示词兜底,而不是在解析器
 * 里猜。会话生效沙箱模式为 `danger-full-access` 时,两条通路都不介入。
 *
 * 两条通路都只把决定交给用户:命中时返回 `kind: 'ask'`,否则原样交回 `next()`,从不 deny、
 * 也不改写命令参数。插件不声明 `export const inject` —— 提示词服务在装配时用
 * `ctx.inject(['systemPrompt'])` 现取,沙箱模式用 `ctx.get('sandboxPolicy')` 只读。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
// 三个类型导入(均为 type-only):dsh-tools 给 ctx.on('tools/pre-execute') 与 PreToolDecision 的类型,
// dsh-system-prompt 给 ctx.systemPrompt,dsh-agent 给组装上下文上的 agent。
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-agent'

type SessionRef = NonNullable<Parameters<SandboxPolicyService['resolve']>[0]>['session']

/**
 * shell 类工具的参数形状。上游把 `ToolExecution.arguments` 暴露为 `unknown`，没有公开的
 * 参数类型，所以这里只做一次结构收窄：shell 工具读 `command`,`terminal_send` 读 `text`。
 */
interface ShellArguments {
  readonly command?: unknown
  readonly text?: unknown
}

/** 把文本送进终端执行的工具:命令文本在 `text`,且无论 `submit` 真假都可能带换行执行。 */
const SHELL_TEXT_TOOL = 'terminal_send'

/**
 * 取出一条工具调用要检查的命令文本:`arguments.command` 优先(所有 shell 工具);
 * 仅 `terminal_send` 回退到 `arguments.text`,其它工具的 `text` 不参与判定。
 */
function commandFrom(exec: {
  readonly name: string
  readonly arguments?: unknown
}): string | undefined {
  const args = exec.arguments as ShellArguments | undefined
  if (typeof args?.command === 'string') return args.command
  if (exec.name === SHELL_TEXT_TOOL && typeof args?.text === 'string') return args.text
  return undefined
}

const GUARD_POLICY_TEXT =
  '`git commit`、`git push`、`git checkout` 与 `git switch` 均须获得用户许可后才能执行; ' +
  '`git clean`、`git pull --rebase`、`git branch -D/-f`、`git tag -d/-f` 与 `git worktree remove` ' +
  '这类会删除文件、移除工作树或改写分支/标签引用的操作也须先获得用户许可; ' +
  '破坏性历史改写、引用改写、远程改写与工作区覆盖操作(如 `git rebase`、`git merge`、`git cherry-pick`、' +
  '`git revert`、`git reset --hard`、`git checkout --force`、`git push --force`、`git commit-tree`、' +
  '`git update-ref`、`git stash`、以及 `git restore` 覆盖工作区的形态)同样须先获得用户许可, ' +
  '未获明确许可不得执行; 这些操作会以授权请求的形式征求你的用户同意, 不得自行绕过. ' +
  '若用户拒绝了某次代码提交、推送或检出, 请停止, 不得再次尝试; ' +
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

/** 引号外有转义语义的字符:空白、两种引号、反斜杠、`$` 与反引号。 */
const UNQUOTED_ESCAPABLE = /[\s"'\\$`]/

/** 双引号内有转义语义的字符:`$`、反引号、`"`、`\`(换行另行按行续接处理)。 */
const DOUBLE_QUOTE_ESCAPABLE = /[$`"\\]/

/**
 * 按 shell 词法切 token。
 *
 * - 引号只做分组、不进 token;开引号即视为有 token,因此空引号也留下空 token;
 * - 引号外只去掉有转义语义的反斜杠;Windows 路径里的 `\` 原样保留;
 * - 双引号内只对 `$`、反引号、`"`、`\` 与换行保留转义语义,其它 `\` 按字面保留;
 * - 单引号内反斜杠是字面量;
 * - 引号外的反斜杠 + 换行做行续接(LF 跳过两个字符,CRLF 跳过三个);
 * - `$'...'` / `$"..."` 跳过 `$`,按对应引号处理。
 */
function tokenize(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let hasCurrent = false
  let quote: '"' | "'" | null = null
  const n = command.length
  let i = 0

  const pushToken = (): void => {
    if (!hasCurrent) return
    tokens.push(current)
    current = ''
    hasCurrent = false
  }

  /** 反斜杠后是 LF / CRLF 时返回要跳过的字符数,否则返回 0。 */
  const lineContinuationLength = (): number => {
    if (command[i + 1] === '\n') return 2
    if (command[i + 1] === '\r' && command[i + 2] === '\n') return 3
    return 0
  }

  while (i < n) {
    const ch = command[i]!
    if (quote !== null) {
      if (ch === '\\') {
        if (quote === "'") {
          // 单引号内反斜杠保持字面。
          current += ch
          hasCurrent = true
          i += 1
          continue
        }
        const next = command[i + 1]
        if (next === undefined) {
          current += ch
          hasCurrent = true
          i += 1
          continue
        }
        const continuation = lineContinuationLength()
        if (continuation > 0) {
          i += continuation
          continue
        }
        if (DOUBLE_QUOTE_ESCAPABLE.test(next)) {
          current += next
          hasCurrent = true
          i += 2
          continue
        }
        // 不具转义语义(如双引号里的 Windows 路径):保留反斜杠与下一个字符。
        current += ch + next
        hasCurrent = true
        i += 2
        continue
      }
      if (ch === quote) {
        // 结束引号只做分组,不进 token。
        quote = null
        i += 1
        continue
      }
      current += ch
      hasCurrent = true
      i += 1
      continue
    }
    const dollarQuote = ch === '$' ? command[i + 1] : undefined
    if (dollarQuote === '"' || dollarQuote === "'") {
      // `$'...'` / `$"..."`:跳过 `$`,按对应引号分组。
      quote = dollarQuote
      hasCurrent = true
      i += 2
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      // 开引号即视为有 token,空引号也要保留。
      hasCurrent = true
      i += 1
      continue
    }
    if (ch === '\\' && i + 1 < n) {
      const continuation = lineContinuationLength()
      if (continuation > 0) {
        i += continuation
        continue
      }
      const next = command[i + 1]!
      if (UNQUOTED_ESCAPABLE.test(next)) {
        current += next
        hasCurrent = true
        i += 2
        continue
      }
      // 不具转义语义(如 Windows 路径分隔符):保留 `\`,继续处理下一个字符。
      current += ch
      hasCurrent = true
      i += 1
      continue
    }
    if (/\s/.test(ch)) {
      pushToken()
      i += 1
      continue
    }
    current += ch
    hasCurrent = true
    i += 1
  }
  pushToken()
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

/** 破坏性重置的旗标:`--soft` / `--mixed` 只动 HEAD 与索引、不碰工作区,故不在此列。 */
const RESET_DESTRUCTIVE = new Set(['--hard', '--merge', '--keep'])

/** 强切工作区的 checkout 旗标。 */
const CHECKOUT_FORCE_FLAGS = new Set(['-f', '--force'])

/**
 * checkout 是否会覆盖工作区:`-f` / `--force` 强切,或 `--` 之后跟着路径的还原形态。
 * 只认这两种明确的写法,不猜「哪个 token 是路径名」——其余 checkout 一律按普通形态请许可。
 */
function overwritesWorktreeOnCheckout(args: string[]): boolean {
  if (args.some(flag => CHECKOUT_FORCE_FLAGS.has(flag))) return true
  const separator = args.indexOf('--')
  return separator >= 0 && separator < args.length - 1
}

/**
 * 参数里是否有任一旗标:长选项按整 token 精确匹配,短选项按字符匹配(兼容 `-fC` 这类簇)。
 * 只用于「命中即 ask」的判定,簇里出现同名取值字样最多多问一次,不会漏拦。
 */
function hasFlag(args: readonly string[], longFlags: readonly string[], shortFlags: string): boolean {
  return args.some(arg => {
    if (arg.startsWith('--')) return longFlags.includes(arg)
    if (!arg.startsWith('-') || arg === '-') return false
    for (const ch of arg.slice(1)) {
      if (shortFlags.includes(ch)) return true
    }
    return false
  })
}

/** `git switch` 会丢弃工作区改动或重置分支的旗标。 */
function resetsWorktreeOnSwitch(args: readonly string[]): boolean {
  return hasFlag(args, ['--force', '--discard-changes'], 'fC')
}

/**
 * `git clean` 的 dry-run 形态:`--dry-run`,或短选项簇里的 `n`。
 * `-e <pattern>` / `--exclude <pattern>` 的取值要整段跳过(包括 `-e<pattern>`),否则 pattern 里的 `n`
 * (或取值恰好是 `-n`)会被误判成 dry-run,让真正会删文件的 clean 放行。
 */
function cleansWithoutDeleting(args: readonly string[]): boolean {
  let skipNext = false
  for (const arg of args) {
    if (skipNext) {
      skipNext = false
      continue
    }
    if (arg === '--') break
    if (arg === '--dry-run') return true
    if (arg === '--exclude') {
      skipNext = true
      continue
    }
    if (!arg.startsWith('-') || arg.startsWith('--') || arg === '-') continue
    const cluster = arg.slice(1)
    for (let index = 0; index < cluster.length; index += 1) {
      const ch = cluster[index]!
      if (ch === 'n') return true
      if (ch === 'e') {
        // `-e<pattern>`:余下字符是取值;单独的 `-e`:取值在下一个参数。
        if (index === cluster.length - 1) skipNext = true
        break
      }
    }
  }
  return false
}

/** `git pull` 的 rebase 形态:`--rebase`、`--rebase=*`,或短选项簇里的 `r`。 */
function pullsWithRebase(args: readonly string[]): boolean {
  return args.some(arg => {
    if (arg === '--rebase' || arg.startsWith('--rebase=')) return true
    if (!arg.startsWith('-') || arg.startsWith('--') || arg === '-') return false
    return arg.slice(1).includes('r')
  })
}

/** `git branch` 的删除 / 强制 / 强制移动旗标。 */
function deletesOrForcesBranch(args: readonly string[]): boolean {
  return hasFlag(args, ['--delete', '--force'], 'dDfM')
}

/** `git tag` 的删除 / 强制旗标。 */
function deletesOrForcesTag(args: readonly string[]): boolean {
  return hasFlag(args, ['--delete', '--force'], 'df')
}

/** `git worktree remove` 的强制删除旗标。 */
function forcesWorktreeRemove(args: readonly string[]): boolean {
  return hasFlag(args, ['--force'], 'f')
}

/** 只读的 stash 动作:`list` / `show` 只查不改,`--help` 只打印用法。 */
const STASH_READ_ONLY = new Set(['list', 'show', 'help'])

/** `git stash` 的动作名:第一个非选项 token(`git stash -q` 视为 `push`);`-h` / `--help` 归入 `help`。 */
function stashAction(args: string[]): string | undefined {
  for (const arg of args) {
    if (arg === '-h' || arg === '--help') return 'help'
    if (!arg.startsWith('-')) return arg
  }
  return undefined
}

/**
 * restore 是否会覆盖工作区:`--worktree` / `-W` 显式指定,或没给 `--staged` / `-S`
 * (默认索引与工作区都恢复)。只带 `--staged` 时只动索引、不碰工作区文件,因此不介入。
 */
function restoresWorktree(args: string[]): boolean {
  let worktree = false
  let staged = false
  for (const arg of args) {
    if (arg === '--worktree') worktree = true
    else if (arg === '--staged') staged = true
    else if (/^-[^-]/.test(arg)) {
      if (arg.includes('W')) worktree = true
      if (arg.includes('S')) staged = true
    }
  }
  return worktree || !staged
}

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

/**
 * 一次「请用户许可」的判定：上游 `PreToolDecision` 的 ask 变体，加上插件内部的
 * `destructive` 优先级标记。上游允许无理由的 ask，本插件的每次判定都给出 `reason`，故收窄为必填。
 */
type AskDecision = Extract<PreToolDecision, { kind: 'ask' }> & {
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
  if (subcommand === 'checkout') {
    if (overwritesWorktreeOnCheckout(args)) {
      return {
        kind: 'ask',
        reason: `git checkout --force 或按路径还原会覆盖工作区改动, ${ASK_SUFFIX}`,
        destructive: true,
      }
    }
    return {
      kind: 'ask',
      reason: `git checkout 会切换分支或按路径还原文件, ${ASK_SUFFIX}`,
      destructive: false,
    }
  }
  if (subcommand === 'switch') {
    if (resetsWorktreeOnSwitch(args)) {
      return {
        kind: 'ask',
        reason: `git switch --force / --discard-changes / -C 会丢弃工作区改动或重置分支, ${ASK_SUFFIX}`,
        destructive: true,
      }
    }
    return {
      kind: 'ask',
      reason: `git switch 会切换分支或重置工作区, ${ASK_SUFFIX}`,
      destructive: false,
    }
  }
  if (subcommand === 'clean') {
    // dry-run 只列出将被删除的文件,不删任何东西,放行。
    if (cleansWithoutDeleting(args)) return undefined
    return {
      kind: 'ask',
      reason: `git clean 会删除未跟踪文件与目录, ${ASK_SUFFIX}`,
      destructive: true,
    }
  }
  if (subcommand === 'pull') {
    // 普通 pull 可能产生 merge 提交,本次只拦 rebase 形态;rebase 形态会改写本地提交历史。
    if (!pullsWithRebase(args)) return undefined
    return {
      kind: 'ask',
      reason: `git pull --rebase 会 rebase 并改写本地提交历史, ${ASK_SUFFIX}`,
      destructive: true,
    }
  }
  if (subcommand === 'branch') {
    if (!deletesOrForcesBranch(args)) return undefined
    return {
      kind: 'ask',
      reason: `git branch -d/-D/-f/-M 会删除、强制移动或改写分支引用, ${ASK_SUFFIX}`,
      destructive: true,
    }
  }
  if (subcommand === 'tag') {
    if (!deletesOrForcesTag(args)) return undefined
    return {
      kind: 'ask',
      reason: `git tag -d/--delete 或 -f/--force 会删除或覆盖标签引用, ${ASK_SUFFIX}`,
      destructive: true,
    }
  }
  if (subcommand === 'worktree' && args[0] === 'remove') {
    if (forcesWorktreeRemove(args)) {
      return {
        kind: 'ask',
        reason: `git worktree remove --force 会强制删除工作树目录, ${ASK_SUFFIX}`,
        destructive: true,
      }
    }
    return {
      kind: 'ask',
      reason: `git worktree remove 会移除工作树目录, ${ASK_SUFFIX}`,
      destructive: false,
    }
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
  if (subcommand === 'commit-tree') {
    return {
      kind: 'ask',
      reason: `git commit-tree 会绕开索引与工作区直接构造提交对象, 常被用来重写历史, ${ASK_SUFFIX}`,
      destructive: true,
    }
  }
  if (subcommand === 'update-ref') {
    const deleting = args.some(arg => arg === '-d' || arg === '--delete')
    return {
      kind: 'ask',
      reason: deleting
        ? `git update-ref -d 会删除引用, 让提交脱离分支或标签, ${ASK_SUFFIX}`
        : `git update-ref 会改写分支或标签的指向, ${ASK_SUFFIX}`,
      destructive: true,
    }
  }
  if (subcommand === 'restore') {
    // 只动暂存区的 `--staged` 形态不覆盖工作区,放行;其余一律按覆盖工作区处理。
    if (!restoresWorktree(args)) return undefined
    return {
      kind: 'ask',
      reason: `git restore 会用索引或指定来源覆盖工作区文件, ${ASK_SUFFIX}`,
      destructive: true,
    }
  }
  if (subcommand === 'stash') {
    const action = stashAction(args)
    if (action !== undefined && STASH_READ_ONLY.has(action)) return undefined
    const destroying = action === 'drop' || action === 'clear'
    return {
      kind: 'ask',
      reason: destroying
        ? `git stash ${action} 会丢弃暂存栈里的改动, ${ASK_SUFFIX}`
        : `git stash ${action ?? 'push'} 会把工作区改动移出或取回暂存栈, ${ASK_SUFFIX}`,
      destructive: destroying,
    }
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

/**
 * 判定一条命令行:先看命令替换,再逐段判定,取其中后果最强的一条。
 *
 * 返回 undefined 表示不介入(`apply` 会原样 `next()`)。返回的决定里 `destructive` 只用于同时
 * 命中多条时挑更具体的文案,交给工具调度前会被剥掉 —— 外面只看得到 `kind` 与 `reason`。
 */
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

/**
 * 装上两条通路:与 TEAM_POLICY 同序的 systemPrompt 区段,以及 tools/pre-execute 钩子。
 *
 * 钩子只把能静态解析出的 git 子命令拦成 `kind: 'ask'`;完全访问模式或解析不出时原样交回
 * `next()`,所以本插件从不 deny、也不改写命令参数。
 */
export function apply(ctx: Context): void {
  // 区段与 TEAM_POLICY 同序;完全访问模式下文本为空 —— 区段仍注册,但不向模型提出授权要求。
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.systemPrompt.section({
      name: 'git-guard:push-policy',
      order: promptCtx.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: assembleContext =>
        isFullAccess(promptCtx, assembleContext.agent?.session) ? '' : GUARD_POLICY_TEXT,
    })
  })

  // 解析不出 git 子命令、或会话处于完全访问模式时原样放行(见文件头)。
  ctx.on('tools/pre-execute', async (exec, next) => {
    const command = commandFrom(exec)
    if (command === undefined || command.trim().length === 0) return await next()
    const decision = decide(command)
    if (decision === undefined) return await next()
    if (isFullAccess(ctx, exec.agent?.session)) return await next()
    return { kind: 'ask' as const, reason: decision.reason }
  })
}

export default { name, apply }
