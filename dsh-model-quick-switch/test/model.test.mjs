/**
 * 模型列表的纯投影：配置读写、身份比较、当前标记、目录展开与显示名回退。
 * 不碰 React、不碰 DOM 服务。
 *
 * 运行：`node test/model.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  addChoice,
  choiceKey,
  choicePresentation,
  choiceRows,
  currentChoiceIndex,
  effortName,
  findCatalogModel,
  flattenCatalog,
  hasChoice,
  matchesCurrent,
  normalizeChoice,
  orderCatalogGroups,
  readChoices,
  removeChoice,
  sameSelection,
  selectionOfChoice,
} from '../src/model.ts'
import { check, checkTrue, checkUndefined, finish } from './helpers.mjs'

const GROUPS = [
  { id: 'opencode-go', name: 'OpenCode Go', models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }] },
  { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] },
  { id: 'deepseek-account', name: 'DeepSeek Account', models: [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' }] },
]

console.log('--- M① 配置读写:容忍坏形状、去重、保序 ---')
{
  checkUndefined('null 不是选择', normalizeChoice(null))
  checkUndefined('缺 provider 不是选择', normalizeChoice({ model: 'x' }))
  checkUndefined('空 provider 不是选择', normalizeChoice({ provider: '   ', model: 'x' }))
  checkUndefined('非字符串 model 不是选择', normalizeChoice({ provider: 'p', model: 42 }))
  check('收下合法选择', normalizeChoice({ provider: ' p ', model: ' m ', reasoningEffort: ' high ' }), {
    provider: 'p',
    model: 'm',
    reasoningEffort: 'high',
  })
  checkUndefined('空强度按缺席', normalizeChoice({ provider: 'p', model: 'm', reasoningEffort: '' }).reasoningEffort)

  check('不是对象 → 空列表', readChoices(null), [])
  check('models 不是数组 → 空列表', readChoices({ models: 'x' }), [])
  const choices = readChoices({
    models: [
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
      { provider: '', model: 'bad' },
      { provider: 'deepseek-account', model: 'deepseek-flash' },
    ],
  })
  check('去重且保序(带强度的算另一条)', choices, [
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
    { provider: 'deepseek-account', model: 'deepseek-flash' },
  ])
}

console.log('--- M② 身份比较与增删 ---')
{
  check('强度算进身份', choiceKey({ provider: 'p', model: 'm', reasoningEffort: 'high' }) === choiceKey({ provider: 'p', model: 'm' }), false)
  check('id 里有分隔符也不撞车', choiceKey({ provider: 'a\u0000b', model: 'c' }) === choiceKey({ provider: 'a', model: 'b\u0000c' }), false)
  checkTrue('同一条选择相等', sameSelection({ provider: 'p', model: 'm' }, { provider: 'p', model: 'm' }))
  check('null 不相等', sameSelection(null, { provider: 'p', model: 'm' }), false)

  let list = []
  list = addChoice(list, { provider: 'p', model: 'm' })
  list = addChoice(list, { provider: 'p', model: 'm' })
  check('重复添加不新增', list.length, 1)
  checkTrue('已存在', hasChoice(list, { provider: 'p', model: 'm' }))
  const same = addChoice(list, { provider: 'p', model: 'm' })
  checkTrue('无变化时返回原引用', same === list)
  list = addChoice(list, { provider: 'p', model: 'm', reasoningEffort: 'high' })
  check('不同强度是另一条', list.length, 2)
  list = removeChoice(list, { provider: 'p', model: 'm' })
  check('删掉默认强度那条', list, [{ provider: 'p', model: 'm', reasoningEffort: 'high' }])
  const unchanged = removeChoice(list, { provider: 'x', model: 'y' })
  checkTrue('删不存在时返回原引用', unchanged === list)
  check('selectionOfChoice 原样带强度', selectionOfChoice({ provider: 'p', model: 'm', reasoningEffort: 'high' }), {
    provider: 'p',
    model: 'm',
    reasoningEffort: 'high',
  })
}

console.log('--- M③ 当前标记:没写强度覆盖同模型的任意强度 ---')
{
  checkTrue('同模型 + 无强度 → 当前', matchesCurrent({ provider: 'p', model: 'm' }, { provider: 'p', model: 'm', reasoningEffort: 'high' }))
  checkTrue('同模型 + 同强度 → 当前', matchesCurrent({ provider: 'p', model: 'm', reasoningEffort: 'high' }, { provider: 'p', model: 'm', reasoningEffort: 'high' }))
  check('同模型 + 不同强度 → 不是', matchesCurrent({ provider: 'p', model: 'm', reasoningEffort: 'low' }, { provider: 'p', model: 'm', reasoningEffort: 'high' }), false)
  check('不同模型 → 不是', matchesCurrent({ provider: 'p', model: 'x' }, { provider: 'p', model: 'm' }), false)
  check('没有当前 → 不是', matchesCurrent({ provider: 'p', model: 'm' }, null), false)
}

console.log('--- M④ 目录:排序、展开与显示名 ---')
{
  const ordered = orderCatalogGroups(GROUPS)
  check('账号第一、DeepSeek 第二、第三方保持相对顺序', ordered.map((group) => group.id), ['deepseek-account', 'deepseek', 'opencode-go'])

  const catalog = flattenCatalog(ordered)
  check('展开成一行一个模型', catalog.map((row) => `${row.provider}/${row.model}`), [
    'deepseek-account/deepseek-flash',
    'deepseek/deepseek-chat',
    'opencode-go/deepseek-v4.1-flash',
  ])
  check('带出提供方名与模型名', [catalog[1].providerName, catalog[1].modelName], ['DeepSeek', 'DeepSeek Chat'])
  check('带出推理强度', catalog[1].efforts.map((effort) => effort.id), ['low', 'high'])

  const found = findCatalogModel(catalog, { provider: 'opencode-go', model: 'deepseek-v4.1-flash' })
  check('按 provider/model 找行', [found?.provider, found?.modelName], ['opencode-go', 'DeepSeek V4.1 Flash'])
  check('强度名', effortName(found, 'high'), 'high')
  check('目录没有的强度退回 id', effortName(catalog[1], 'max'), 'max')
  check('目录没有的模型返回 undefined', findCatalogModel(catalog, { provider: 'nope', model: 'nope' }), undefined)
}

console.log('--- M⑤ 一行候选:标题、副标题、目录外与当前 ---')
{
  const ordered = orderCatalogGroups(GROUPS)
  const catalog = flattenCatalog(ordered)
  const known = choicePresentation({ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, catalog)
  check('目录里有的模型用目录名', [known.title, known.subtitle, known.known], ['DeepSeek Chat', 'DeepSeek · High', true])
  const unknown = choicePresentation({ provider: 'retired', model: 'old-model' }, catalog)
  check('目录里没有就退回 id', [unknown.title, unknown.subtitle, unknown.known], ['old-model', 'retired', false])

  const rows = choiceRows(
    [
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'retired', model: 'old-model' },
    ],
    catalog,
    { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
  )
  check('浮层行顺序照抄列表', rows.map((row) => row.title), ['DeepSeek Chat', 'old-model'])
  check('当前选择打标', rows.map((row) => row.current === true), [true, false])
  check('目录外标角标', rows[1].badges, ['目录外'])
  check('行身份是完整选择', rows[0].key, choiceKey({ provider: 'deepseek', model: 'deepseek-chat' }))
  check('当前下标', currentChoiceIndex(rows), 0)
  check('没有当前时 -1', currentChoiceIndex([{ key: 'k', title: 't', subtitle: 's' }]), -1)

  const defaultRow = choiceRows([{ provider: 'deepseek', model: 'deepseek-chat' }], catalog, { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'low' })
  check('目录默认强度同样算当前', defaultRow[0].current, true)
}

finish()
