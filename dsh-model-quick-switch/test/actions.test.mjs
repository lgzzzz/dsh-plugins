/**
 * 快捷操作行的纯投影：forge 面板的 `worktree` / `agentTeam` 投影收窄、两行的副标题与角标、
 * 以及「哪一行是操作」的判定。
 *
 * 运行：`node test/actions.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  ACTION_TEAM_KEY,
  ACTION_WORKTREE_KEY,
  EMPTY_TEAM_FACTS,
  EMPTY_WORKTREE_FACTS,
  actionOfKey,
  actionRowCount,
  checkoutStateOf,
  firstModelRowIndex,
  quickActionRows,
  sameTeamFacts,
  sameWorktreeFacts,
  teamFacts,
  worktreeFacts,
} from '../src/actions.ts'
import { check, checkTrue, finish } from './helpers.mjs'

const ROW_WORKTREE = 'action:worktree'
const ROW_TEAM = 'action:team'

/** 一份「有会话、两条链路都在、Git 检查通过、什么都没开」的输入。 */
function base(overrides = {}) {
  return {
    sessionOpen: true,
    worktreeAvailable: true,
    teamAvailable: true,
    worktree: { request: null, created: null },
    team: { enabled: false },
    checkout: 'ready',
    ...overrides,
  }
}

console.log('--- A① 行 key 与操作判定 ---')
{
  check('工作树行 key', ACTION_WORKTREE_KEY, ROW_WORKTREE)
  check('团队行 key', ACTION_TEAM_KEY, ROW_TEAM)
  check('工作树 key 解出操作', actionOfKey(ROW_WORKTREE), 'worktree')
  check('团队 key 解出操作', actionOfKey(ROW_TEAM), 'team')
  check('模型 key 不是操作', actionOfKey(JSON.stringify(['deepseek', 'deepseek-chat', ''])), null)
  const rows = quickActionRows(base())
  check('两行都是操作', actionRowCount(rows), 2)
  check('第一行模型下标', firstModelRowIndex([...rows, { key: 'm', title: 'm', subtitle: 'm' }]), 2)
  check('没有模型时是 -1', firstModelRowIndex(rows), -1)
  const noRepo = quickActionRows(base({ checkout: 'none' }))
  check('非 Git 仓库只剩团队行', noRepo.map((row) => row.key), [ACTION_TEAM_KEY])
  check('非 Git 仓库的操作计数', actionRowCount(noRepo), 1)
  check('非 Git 仓库时第一行模型下标', firstModelRowIndex([...noRepo, { key: 'm', title: 'm', subtitle: 'm' }]), 1)
}

console.log('--- A② 工作树行：副标题只报开启 / 关闭，非 Git 仓库整行隐藏 ---')
{
  const closed = quickActionRows(base())
  check('默认标题', closed[0].title, '新建工作树')
  check('默认角标只有「操作」', closed[0].badges, ['操作'])
  check('默认副标题就是关闭', closed[0].subtitle, '已关闭')

  const requested = quickActionRows(base({ worktree: { request: { from: null }, created: null } }))
  check('已请求时副标题是开启', requested[0].subtitle, '已开启')
  check('已请求不额外加角标', requested[0].badges, ['操作'])

  const created = quickActionRows(base({ worktree: { request: null, created: { branch: 'forge/s1', path: '/tmp/wt' } } }))
  check('已创建也报开启', created[0].subtitle, '已开启')

  const noSession = quickActionRows(base({ sessionOpen: false }))
  check('没有会话时两行都不显示', noSession, [])

  const unavailable = quickActionRows(base({ worktreeAvailable: false }))
  check('forge 链路缺席时只剩团队行', unavailable.map((row) => row.key), [ACTION_TEAM_KEY])

  const noRepo = quickActionRows(base({ checkout: 'none' }))
  check('工作区不是 Git 仓库时只剩团队行', noRepo.map((row) => row.key), [ACTION_TEAM_KEY])

  const pending = quickActionRows(base({ checkout: 'pending' }))
  check('Git 检查还没完成时先保留两行', pending.map((row) => row.key), [ACTION_WORKTREE_KEY, ACTION_TEAM_KEY])
  check('检查未完成时按关闭显示', pending[0].subtitle, '已关闭')

  const unknown = quickActionRows(base({ worktree: null }))
  check('工作树事实尚未读取时按关闭显示', unknown[0].subtitle, '已关闭')
}

console.log('--- A③ 团队协作行：与工作树行同一套显示规则 ---')
{
  const teamRow = (input) => quickActionRows(input).find((row) => row.key === ACTION_TEAM_KEY)
  const off = teamRow(base())
  check('默认角标只有「操作」', off.badges, ['操作'])
  check('默认副标题就是关闭', off.subtitle, '已关闭')

  const on = teamRow(base({ team: { enabled: true } }))
  check('开启后角标仍是「操作」', on.badges, ['操作'])
  check('开启后副标题就是开启', on.subtitle, '已开启')

  check('没有会话时不显示团队行', teamRow(base({ sessionOpen: false })), undefined)
  check('团队服务缺席时不显示团队行', teamRow(base({ teamAvailable: false })), undefined)
  check('投影尚未读取时按关闭显示', teamRow(base({ team: null })).subtitle, '已关闭')
}

console.log('--- A④ 事实收窄与同值比较 ---')
{
  check('undefined 工作树投影', worktreeFacts(undefined), null)
  check('null 工作树投影', worktreeFacts(null), null)
  check('数组工作树投影', worktreeFacts([]), null)
  check('字符串工作树投影', worktreeFacts('x'), null)
  check('完整面板工作树事实', worktreeFacts({
    editable: true,
    request: { from: 'main' },
    created: { path: '/tmp/wt', branch: 'forge/s1', from: 'main' },
    creation: null,
  }), {
    request: { from: 'main' },
    created: { branch: 'forge/s1', path: '/tmp/wt' },
  })
  check('坏字段收成 null 字段', worktreeFacts({ request: {}, created: { branch: '' } }), {
    request: { from: null },
    created: { branch: null, path: null },
  })
  check('没有 request / created 的面板对象是关闭', worktreeFacts({ editable: true }), EMPTY_WORKTREE_FACTS)

  check('undefined 团队投影', teamFacts(undefined), null)
  check('null 团队投影', teamFacts(null), null)
  check('空团队投影', teamFacts({}), { enabled: false })
  check('开启的团队投影', teamFacts({ enabled: true }), { enabled: true })
  check('truthy 不算开启', teamFacts({ enabled: 'true' }), { enabled: false })
}

console.log('--- A⑥ 写入后的目标与迟到投影比较 ---')
{
  checkTrue('空工作树事实与关闭基准相同', sameWorktreeFacts(EMPTY_WORKTREE_FACTS, { request: null, created: null }))
  checkTrue('同分支同请求相同', sameWorktreeFacts(
    { request: { from: 'main' }, created: null },
    { request: { from: 'main' }, created: null },
  ))
  check('请求基分支不同', sameWorktreeFacts(
    { request: { from: 'main' }, created: null },
    { request: { from: 'dev' }, created: null },
  ), false)
  check('创建结果不同', sameWorktreeFacts(
    { request: null, created: { branch: 'forge/a', path: '/tmp/a' } },
    { request: null, created: { branch: 'forge/b', path: '/tmp/b' } },
  ), false)
  check('null 与关闭不同', sameWorktreeFacts(null, EMPTY_WORKTREE_FACTS), false)

  checkTrue('开启相同', sameTeamFacts({ enabled: true }, { enabled: true }))
  check('开关不同', sameTeamFacts({ enabled: true }, { enabled: false }), false)
  check('null 与关闭不同', sameTeamFacts(null, EMPTY_TEAM_FACTS), false)
}

console.log('--- A⑤ 面板流里的 Git 检查结果 ---')
{
  check('ready', checkoutStateOf({ checkout: { state: 'ready', checkout: { root: '/repo' } } }), 'ready')
  check('none', checkoutStateOf({ checkout: { state: 'none' } }), 'none')
  check('pending', checkoutStateOf({ checkout: { state: 'pending' } }), 'pending')
  check('failed', checkoutStateOf({ checkout: { state: 'failed', message: 'boom' } }), 'failed')
  check('未知状态', checkoutStateOf({ checkout: { state: 'other' } }), null)
  check('没有 checkout', checkoutStateOf({}), null)
  check('不是对象', checkoutStateOf(null), null)
  check('字符串', checkoutStateOf('ready'), null)
}

finish()
