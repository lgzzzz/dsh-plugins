/**
 * 产物装配：`lib/client.js` 以正确的模块 id / 插件名注册；装配后按账本遮蔽
 * `conversation.composer.dock#activity`，包装层把按钮第一段追加成「N 轮 N 步 · 2.3秒」，
 * 不出现「首 token」标签、不碰输出速度与其它译文；无样本时不追加，投影缺席时走窗口
 * 折叠兜底；源项消失时撤回遮蔽，卸载时摘掉订阅与注册。
 *
 * 运行：`node test/artifact-client.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  FakeSlots,
  STATS_ID,
  STATS_SLOT,
  check,
  checkFalse,
  checkIncludes,
  checkSame,
  checkTrue,
  finish,
  loadClientArtifact,
  platformRequire,
} from './helpers.mjs'

const React = platformRequire('react')
const { renderToStaticMarkup } = platformRequire('react-dom/server')

console.log('--- A 产物注册与导出 ---')
const registration = loadClientArtifact()
check('模块 id', registration.id, 'dsh-stats-ttft')
const plugin = registration.factory((specifier) => platformRequire(specifier))
check('导出 name', plugin.name, 'dsh-stats-ttft')
check('导出 inject', plugin.inject, ['slots'])
checkTrue('apply 是函数', typeof plugin.apply === 'function')

console.log('--- B 遮蔽 activity 条目 ---')
const DICT = {
  'stats.counts': (params) => `${params.turns} 轮 ${params.steps} 步`,
  'message.tokensPerSecond': (params) => `${params.tps} tok/s`,
  'stats.dialog.title': () => '会话统计',
  'duration.compactSeconds': (params) => `${params.seconds}秒`,
  'duration.compactMinutes': (params) => `${params.minutes}分${params.seconds}秒`,
}

function fakeT(key, params = {}) {
  const render = DICT[key]
  if (render === undefined) return key
  return render(params)
}

/** 上游 ActivityPill 的替身：把三段译文渲染出来，方便断言只有第一段被改写。 */
function StubActivity(props) {
  const t = props.t
  return React.createElement(
    'span',
    { 'data-stub': '' },
    t('stats.counts', { turns: 12, steps: 34 }),
    '|',
    t('message.tokensPerSecond', { tps: '45.0' }),
    '|',
    t('stats.dialog.title'),
  )
}

const injectFace = () => ({ hooks: { performanceUsage: () => 'detailed' } })
const source = {
  component: StubActivity,
  options: { id: STATS_ID, order: 0 },
  locale: 'chat',
  inject: injectFace,
}

const slots = new FakeSlots()
slots.setEntries(STATS_SLOT, [source])
plugin.apply({ get: (name) => (name === 'slots' ? slots : undefined) })
const dispose = slots.declare()

check('只注册一项', slots.registrations.length, 1)
const reg = slots.registrations[0]
check('注册 id', reg.options.id, 'activity')
check('保持 order', reg.options.order, 0)
check('priority 取源项减一', reg.options.priority, -1)
check('保持 locale', reg.options.locale, 'chat')
checkSame('inject 透传', reg.options.inject, injectFace)
checkFalse('源组件被包装', reg.component === StubActivity)

const Wrapped = reg.component
const render = (props) => renderToStaticMarkup(React.createElement(Wrapped, props))

const detailedProps = {
  t: fakeT,
  useProjection: () => ({
    turns: 12,
    steps: 34,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 6900,
    ttftSteps: 3,
    decodeMs: 1000,
    decodeTokens: 45,
  }),
  useChat: (selector) => selector({ legacy: { nodes: [] } }),
}

console.log('--- C 按钮读数 ---')
{
  const html = render(detailedProps)
  checkIncludes('第一段追加纯时长', html, '12 轮 34 步 · 2.3秒')
  checkFalse('不出现「首 token」标签', html.includes('首 token'))
  checkIncludes('输出速度原样', html, '45.0 tok/s')
  checkIncludes('其它译文原样', html, '会话统计')
}

console.log('--- D 无样本与兜底 ---')
{
  const html = render({ ...detailedProps, useProjection: () => ({ ttftMs: 0, ttftSteps: 0 }) })
  checkIncludes('无样本时保持原读数', html, '12 轮 34 步|')
  checkFalse('无样本时不含时长', html.includes('2.3秒'))

  const fallback = render({
    ...detailedProps,
    useProjection: () => undefined,
    useChat: (selector) => selector({
      legacy: {
        nodes: [
          { kind: 'assistant', timing: { stepStartTime: 1000, firstTokenTime: 3300 } },
          { kind: 'assistant', timing: { stepStartTime: 2000, firstTokenTime: 4300 } },
        ],
      },
    }),
  })
  checkIncludes('投影缺席时窗口折叠', fallback, '12 轮 34 步 · 2.3秒')
}

console.log('--- E 撤回与卸载 ---')
{
  slots.setEntries(STATS_SLOT, [])
  check('源项消失后撤回遮蔽', slots.entries(STATS_SLOT).length, 0)
  dispose()
  check('卸载后订阅已摘', slots.subscribers.length, 0)
}

finish()
