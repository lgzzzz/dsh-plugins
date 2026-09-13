/**
 * dsh-rightbar-split-open — 以 Type Stripping 直载 src/*.ts 的行为断言。
 *
 * 覆盖:
 *  1. 纯判定层:新文件落在树面板才触发;装载基线只记不动作;浮窗 / 已有文件面板分支;
 *  2. 比例:目标 [0.2, 0.8] 恰为 1 : 4、不低于上游 minPaneFraction、树侧不在首位不写;
 *  3. 端到端(桩 store + 桩 uiSession/slots):点开文件 → 分栏 → 搬迁 → 调比例 → 回焦树;
 *  4. 守卫:分栏被上游拒绝(空间不够)时不动作、不搬标签、不写比例;
 *     文件标签已不在树面板时不误搬;缺动作面时静默跳过而不是抛错;
 *  5. 接线:uiSession.resolve 只被包装一次且 dispose 可还原;resolveStore 抛错时 no-op。
 */
import assert from 'node:assert/strict'

import {
  FILE_RATIO,
  TREE_RATIO,
  clampFractions,
  newFileTabsIn,
  planSplitOpen,
  siblingPaneOf,
  sizesForTreeFirst,
  splitHolding,
  targetSizes,
} from './src/split-open.ts'
import { createSplitHandler } from './src/session-split.ts'
import { installSessionWiring, readLayout, resolveStore } from './src/rightbar.ts'

/* ------------------------------------------------------------------ *
 * 桩:dockkit 布局 + defineStore 形状的活实例
 * ------------------------------------------------------------------ */

const SESSION = 'session-1'

/** 造一个「单面板 + 文件树」的初始布局。 */
function initialLayout(paneId = 'pane1') {
  return {
    nodes: {
      [paneId]: { kind: 'pane', id: paneId, host: 'dock', tabs: ['files-tab'], activeTabId: 'files-tab' },
    },
    tabs: {
      'files-tab': { id: 'files-tab', kind: 'files', contentId: 'sidebar://files' },
    },
    rootId: paneId,
    activePaneId: paneId,
    expanded: true,
  }
}

/** 一条文件资源标签记录。 */
function fileRecord(id, path) {
  return { id, kind: 'dsh-text-editor/editor', contentId: `dsh-resource://file/${path}` }
}

/** 桩现场:持有当前布局与它的 store(提交即通知订阅者)。 */
function createScene(layout, splitOutcome = 'ok') {
  const calls = { placeTab: [], resizeSplit: [], focusTab: [], closeTab: [], split: [] }
  let current = layout
  let snapshot = { bySession: { [SESSION]: { layout: current } } }
  const listeners = new Set()

  /** 提交一份新布局(重新赋快照并同步通知订阅者)。 */
  function commit(next) {
    current = next
    snapshot = { bySession: { [SESSION]: { layout: next } } }
    for (const listener of [...listeners]) listener()
  }

  const store = {
    calls,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    actions: {
      placeTab(sessionId, tabId, paneId, index) {
        calls.placeTab.push([sessionId, tabId, paneId, index])
        const next = structuredClone(current)
        const target = next.nodes[paneId]
        if (target === undefined || target.kind !== 'pane' || target.host !== 'dock') {
          throw new Error(`layout: cannot place a tab into ${paneId}`)
        }
        for (const node of Object.values(next.nodes)) {
          if (node.kind !== 'pane') continue
          const at = node.tabs.indexOf(tabId)
          if (at < 0) continue
          node.tabs.splice(at, 1)
          if (node.activeTabId === tabId) node.activeTabId = node.tabs[0]
        }
        target.tabs.splice(Math.max(0, Math.min(index, target.tabs.length)), 0, tabId)
        target.activeTabId = tabId
        next.activePaneId = paneId
        commit(next)
      },
      closeTab(sessionId, tabId) {
        calls.closeTab.push([sessionId, tabId])
        const next = structuredClone(current)
        for (const node of Object.values(next.nodes)) {
          if (node.kind !== 'pane') continue
          const at = node.tabs.indexOf(tabId)
          if (at < 0) continue
          node.tabs.splice(at, 1)
          if (node.activeTabId === tabId) node.activeTabId = node.tabs[0]
        }
        delete next.tabs[tabId]
        commit(next)
      },
      resizeSplit(sessionId, splitId, sizes) {
        calls.resizeSplit.push([sessionId, splitId, [...sizes]])
        const next = structuredClone(current)
        const split = next.nodes[splitId]
        if (split === undefined || split.kind !== 'split') throw new Error(`layout: ${splitId} is not a split`)
        split.sizes = [...sizes]
        commit(next)
      },
      focusTab(sessionId, tabId) {
        calls.focusTab.push([sessionId, tabId])
        const next = structuredClone(current)
        for (const node of Object.values(next.nodes)) {
          if (node.kind !== 'pane') continue
          if (!node.tabs.includes(tabId)) continue
          node.activeTabId = tabId
          next.activePaneId = node.id
        }
        commit(next)
      },
    },
  }

  /**
   * 桩 sidebarRight:split 成功时按 dockkit 语义把原面板与新面板放进同一个 row 分栏,
   * 并按上游 store 的 `advance -> planSettle` 行为给这个**新格** seed 一个默认页
   * ——当前组合下默认页就是文件树本身(`defaultSeed` 只有一个引导入口时选它),
   * 这正是「新分栏里多出一个 file 标签」的来源。
   */
  const sidebarRight = {
    calls: calls.split,
    split(paneId) {
      calls.split.push(paneId)
      if (splitOutcome !== 'ok') return undefined
      const next = structuredClone(current)
      const source = next.nodes[paneId]
      if (source === undefined || source.kind !== 'pane') return undefined
      const used = Object.keys(next.nodes).length
      const newPaneId = `pane${used + 1}`
      const splitId = `split${used + 1}`
      const seededTabId = `files-seed${used + 1}`
      next.tabs[seededTabId] = { id: seededTabId, kind: 'files', contentId: 'sidebar://files' }
      next.nodes[newPaneId] = {
        kind: 'pane',
        id: newPaneId,
        host: 'dock',
        tabs: [seededTabId],
        activeTabId: seededTabId,
      }
      next.nodes[splitId] = { kind: 'split', id: splitId, axis: 'row', children: [paneId, newPaneId], sizes: [0.5, 0.5] }
      next.rootId = splitId
      next.activePaneId = newPaneId
      commit(next)
      return newPaneId
    },
  }

  return {
    store,
    sidebarRight,
    calls,
    /** 现场当前(权威)布局。 */
    state: () => current,
    /** 模拟一次上游提交。 */
    apply: commit,
  }
}

/** 桩服务集合:把会话解析到给定 store。 */
function servicesFor(store, uiSession) {
  return {
    uiSession,
    slots: { entries: () => [{ store: {} }], resolveStore: () => store },
  }
}

/** 让在飞的微任务落地(接线与执行都排在微任务里)。 */
async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

/* ------------------------------------------------------------------ *
 * 1. 纯判定层
 * ------------------------------------------------------------------ */

const base = initialLayout()

// 没有新标签 → 不触发
assert.equal(planSplitOpen(base, initialLayout()), undefined, '没有新标签时不应触发')

// 树面板里新开一个文件 → 触发,且还没有文件面板(需要分栏)
const opened = initialLayout()
opened.nodes.pane1.tabs = ['files-tab', 'file-a']
opened.nodes.pane1.activeTabId = 'file-a'
opened.tabs['file-a'] = fileRecord('file-a', 'w/a.ts')
assert.deepEqual(
  planSplitOpen(base, opened),
  { treePaneId: 'pane1', fileTabId: 'file-a' },
  '树面板里新开文件应规划「分栏」',
)

// 装载前就开着的文件(基线里已有)不算「刚点开」
const preexisting = structuredClone(opened)
assert.equal(planSplitOpen(preexisting, preexisting), undefined, '基线里已存在的标签不应触发')

// 没有文件树面板时不触发
const noTree = {
  nodes: { pane1: { kind: 'pane', id: 'pane1', host: 'dock', tabs: ['other'], activeTabId: 'other' } },
  tabs: { other: { id: 'other', kind: 'terminal', contentId: 'sidebar://terminal' } },
  rootId: 'pane1',
  activePaneId: 'pane1',
  expanded: true,
}
assert.equal(planSplitOpen(base, noTree), undefined, '没有文件树时不应触发')

// 已经分过栏:新文件仍落在树面板 → 直接搬去已有的文件面板
const splitLayout = {
  nodes: {
    pane1: { kind: 'pane', id: 'pane1', host: 'dock', tabs: ['files-tab'], activeTabId: 'files-tab' },
    pane2: { kind: 'pane', id: 'pane2', host: 'dock', tabs: ['file-a'], activeTabId: 'file-a' },
    split1: { kind: 'split', id: 'split1', axis: 'row', children: ['pane1', 'pane2'], sizes: [0.2, 0.8] },
  },
  tabs: {
    'files-tab': { id: 'files-tab', kind: 'files', contentId: 'sidebar://files' },
    'file-a': fileRecord('file-a', 'w/a.ts'),
  },
  rootId: 'split1',
  activePaneId: 'pane1',
  expanded: true,
}
assert.equal(planSplitOpen(base, splitLayout), undefined, '文件没落在树面板(新开进文件格)不应触发')

const secondOpen = structuredClone(splitLayout)
secondOpen.nodes.pane1.tabs = ['files-tab', 'file-b']
secondOpen.nodes.pane1.activeTabId = 'file-b'
secondOpen.tabs['file-b'] = fileRecord('file-b', 'w/b.ts')
assert.deepEqual(
  planSplitOpen(splitLayout, secondOpen),
  { treePaneId: 'pane1', fileTabId: 'file-b', filePaneId: 'pane2' },
  '已分栏时新开的文件应规划「搬移到已有文件面板」',
)

// 浮窗里的新文件标签不参与
const floating = structuredClone(base)
floating.nodes.float1 = { kind: 'pane', id: 'float1', host: 'float', tabs: ['file-f'], activeTabId: 'file-f' }
floating.tabs['file-f'] = fileRecord('file-f', 'w/f.ts')
assert.equal(planSplitOpen(base, floating), undefined, '浮窗里的新标签不应触发')

// newFileTabsIn:顺序跟随面板标签顺序
assert.deepEqual(newFileTabsIn(base, secondOpen, secondOpen.nodes.pane1), ['file-b'])

/* ------------------------------------------------------------------ *
 * 2. 比例
 * ------------------------------------------------------------------ */

const sizes = targetSizes(2)
assert.equal(sizes.length, 2)
assert.ok(Math.abs(sizes[0] - TREE_RATIO) < 0.01, `树侧比例应≈0.2,实际 ${sizes[0]}`)
assert.ok(Math.abs(sizes[1] - FILE_RATIO) < 0.01, `文件侧比例应≈0.8,实际 ${sizes[1]}`)
// 目标比例带 RATIO_EPSILON 余量(把浮点边界变成严格不等式),仍在 1:4 的可感知范围内
assert.ok(Math.abs(sizes[0] / sizes[1] - 0.25) < 0.005, '两侧宽度比应≈1:4')
assert.ok(Math.abs(targetSizes(2)[0] - 0.2) < 0.002, '树侧比例应贴着上游最小分栏比例(1:4 的 20%)')
assert.ok(Math.abs(sizes[0] + sizes[1] - 1) < 1e-9, '比例之和应为 1')
assert.ok(sizes[0] >= 0.2 && sizes[1] >= 0.2, '两侧都不应低于上游 minPaneFraction')
// 1 : 4 的精确值在浮点上贴着上游下界,故写入值带一个 1e-3 量级的余量(RATIO_EPSILON)
const ratio = targetSizes(2)[0] / targetSizes(2)[1]
assert.ok(Math.abs(ratio - 0.25) < 0.005, `树 : 文件 应≈1:4,实际 ${ratio.toFixed(4)}`)
// clampFractions 与 dockkit 的 es() 同语义:已满足下界时原样返回
assert.deepEqual(clampFractions([TREE_RATIO, FILE_RATIO]), [TREE_RATIO, FILE_RATIO])
// 低于下界时抬到下界,其余按比例重分(与 dockkit es() 同算式)
assert.deepEqual(clampFractions([0.05, 0.95]), [0.2, 0.8])
assert.deepEqual(
  clampFractions([0.1, 0.6, 0.3]).map((value) => Number(value.toFixed(4))),
  [0.2, 0.5333, 0.2667],
)

// 树侧必须在分栏成员最前面,否则不写比例
assert.deepEqual(sizesForTreeFirst(splitLayout.nodes.split1, 'pane1'), targetSizes(2))
const reversed = { ...splitLayout.nodes.split1, children: ['pane2', 'pane1'] }
assert.equal(sizesForTreeFirst(reversed, 'pane1'), undefined, '树侧不在首位时不应写比例')
assert.equal(sizesForTreeFirst(undefined, 'pane1'), undefined)

// 定位承载树面板的分栏
assert.equal(splitHolding(splitLayout, ['pane1'])?.id, 'split1')
assert.equal(splitHolding(splitLayout, ['pane9']), undefined)

// 兄弟格:与树面板同处一个分栏的另一格(搬移的确定落点)
assert.equal(siblingPaneOf(splitLayout, 'pane1')?.id, 'pane2')
assert.equal(siblingPaneOf(splitLayout, 'pane2')?.id, 'pane1')
assert.equal(siblingPaneOf(base, 'pane1'), undefined, '未分栏时没有兄弟格')

// 上游给新分栏 seed 的默认页就是文件树(defaultSeed 只有一个引导入口时选它),
// 所以两格都可能有文件树标签:此时「文件面板」只能认兄弟格,不能靠内容判定。
const bothTrees = {
  nodes: {
    pane1: { kind: 'pane', id: 'pane1', host: 'dock', tabs: ['files-tab'], activeTabId: 'files-tab' },
    pane2: { kind: 'pane', id: 'pane2', host: 'dock', tabs: ['files-seeded', 'file-a'], activeTabId: 'file-a' },
    split1: { kind: 'split', id: 'split1', axis: 'row', children: ['pane1', 'pane2'], sizes: [0.2, 0.8] },
  },
  tabs: {
    'files-tab': { id: 'files-tab', kind: 'files', contentId: 'sidebar://files' },
    'files-seeded': { id: 'files-seeded', kind: 'files', contentId: 'sidebar://files' },
    'file-a': fileRecord('file-a', 'w/a.ts'),
  },
  rootId: 'split1',
  activePaneId: 'pane1',
  expanded: true,
}
assert.equal(siblingPaneOf(bothTrees, 'pane1')?.id, 'pane2', '兄弟格判定不依赖内容')
const reopened = structuredClone(bothTrees)
reopened.nodes.pane1.tabs = ['files-tab', 'file-b']
reopened.tabs['file-b'] = fileRecord('file-b', 'w/b.ts')
assert.deepEqual(
  planSplitOpen(bothTrees, reopened)?.filePaneId,
  undefined,
  '两格都有文件树时内容判定给不出文件面板(故执行层以兄弟格为准)',
)

/* ------------------------------------------------------------------ *
 * 3. 端到端:点开文件 → 分栏 → 搬迁 → 调比例 → 回焦树
 * ------------------------------------------------------------------ */

{
  const scene = createScene(initialLayout())
  const uiSession = { resolve: (sessionId) => ({ key: sessionId, ctx: {} }) }
  const handle = installSessionWiring(servicesFor(scene.store, uiSession), createSplitHandler(scene.sidebarRight))
  assert.ok(handle !== undefined, '接线应安装成功')

  // 第一次物化:只记基线
  uiSession.resolve(SESSION)
  await settle()
  assert.deepEqual(scene.calls.resizeSplit, [], '建立基线时不应写任何东西')

  // 用户点开一个文件:上游把它开进树面板(同一次提交)
  const afterOpen = structuredClone(scene.state())
  afterOpen.nodes.pane1.tabs = ['files-tab', 'file-a']
  afterOpen.nodes.pane1.activeTabId = 'file-a'
  afterOpen.tabs['file-a'] = fileRecord('file-a', 'w/a.ts')
  scene.apply(afterOpen)
  await settle()

  assert.deepEqual(scene.calls.split, ['pane1'], '应在文件树面板上分栏')

  const finalLayout = scene.state()
  const filePaneId = Object.keys(finalLayout.nodes).find(
    (id) => finalLayout.nodes[id].kind === 'pane' && finalLayout.nodes[id].tabs.includes('file-a'),
  )
  assert.notEqual(filePaneId, undefined, '文件标签应落在某个面板里')
  assert.notEqual(filePaneId, 'pane1', '文件应被搬到树面板之外的分栏')

  // 搬迁走的是 placeTab(标签拖拽同一入口),不是关掉重开
  assert.deepEqual(scene.calls.placeTab, [[SESSION, 'file-a', filePaneId, 0]], '应把新文件搬到新面板首位')

  // 比例:写入含树面板的那个分栏,树侧在前
  const split = Object.values(finalLayout.nodes).find((node) => node.kind === 'split')
  assert.notEqual(split, undefined, '应产生一个分栏节点')
  assert.deepEqual(split.children, ['pane1', filePaneId], '树面板应在分栏最前面')
  assert.deepEqual(scene.calls.resizeSplit, [[SESSION, split.id, [...targetSizes(2)]]], '应写入 1:4 比例')
  assert.deepEqual(split.sizes, [...targetSizes(2)], '布局里的比例应已落地')

  // 回焦树:活跃标签还给文件树(便于连续点开)。
  // 搬迁本身可能已让树面板回落到文件树标签(上游 placeTab 会重选 activeTabId),
  // 那时 focusTab 不再提交 —— 两种路径都必须以「树面板活跃标签 = 文件树」收尾。
  const lastFocus = scene.calls.focusTab.at(-1)
  if (lastFocus !== undefined) {
    assert.deepEqual(lastFocus, [SESSION, 'files-tab'], '若提交了 focusTab,目标必须是文件树标签')
  }
  assert.equal(finalLayout.nodes.pane1.activeTabId, 'files-tab', '收尾时文件树必须是活跃标签')

  // 上游给新分栏 seed 的默认页(当前组合下就是文件树本身)由本插件收掉 ——
  // 否则「文件面板」里会多出一个无人打开过的 file 标签。
  const sealedSeed = Object.keys(finalLayout.tabs).filter(
    (id) => id.startsWith('files-seed') && finalLayout.tabs[id] !== undefined,
  )
  assert.deepEqual(sealedSeed, [], '新分栏里上游 seed 的默认页应被关掉')
  assert.deepEqual(
    scene.calls.closeTab,
    [[SESSION, 'files-seed2']],
    '应通过 store closeTab 关掉那一枚 seed(与标签菜单关闭同一入口)',
  )
  const filePane = finalLayout.nodes[filePaneId]
  assert.deepEqual(filePane.tabs, ['file-a'], '文件面板只留自己打开的那一个标签')
  assert.equal(filePane.activeTabId, 'file-a', '文件面板的活跃标签就是刚打开的文件')

  // 第二次点开:已分栏 → 只搬不重分栏
  const splitCallsBefore = scene.calls.split.length
  const closeCallsBefore = scene.calls.closeTab.length
  const afterSecond = structuredClone(scene.state())
  afterSecond.nodes.pane1.tabs = ['files-tab', 'file-b']
  afterSecond.nodes.pane1.activeTabId = 'file-b'
  afterSecond.tabs['file-b'] = fileRecord('file-b', 'w/b.ts')
  scene.apply(afterSecond)
  await settle()
  assert.equal(scene.calls.split.length, splitCallsBefore, '已分栏时不应再次分栏')
  assert.deepEqual(scene.calls.placeTab.at(-1), [SESSION, 'file-b', filePaneId, 0], '第二个文件应搬进同一文件面板')
  assert.equal(scene.calls.closeTab.length, closeCallsBefore, '已分栏路径上没有 seed 可关,不应多关标签')
  const afterSecondLayout = scene.state()
  assert.deepEqual(
    afterSecondLayout.nodes[filePaneId].tabs,
    ['file-b', 'file-a'],
    '第二个文件排在文件面板标签条首位,原有文件标签保留',
  )
  assert.deepEqual(
    Object.keys(afterSecondLayout.tabs).filter((id) => id.startsWith('files-seed')),
    [],
    '文件面板里始终不应残留 seed 标签',
  )

  handle.dispose()
  assert.equal(typeof uiSession.resolve, 'function')
}

// 已分栏且新格也被 seed 了文件树(真实现场):文件必须搬进兄弟格,而不是被内容判定带偏
{
  const seeded = {
    nodes: {
      pane1: { kind: 'pane', id: 'pane1', host: 'dock', tabs: ['files-tab'], activeTabId: 'files-tab' },
      pane2: { kind: 'pane', id: 'pane2', host: 'dock', tabs: ['files-seeded'], activeTabId: 'files-seeded' },
      split1: { kind: 'split', id: 'split1', axis: 'row', children: ['pane1', 'pane2'], sizes: [0.2, 0.8] },
    },
    tabs: {
      'files-tab': { id: 'files-tab', kind: 'files', contentId: 'sidebar://files' },
      'files-seeded': { id: 'files-seeded', kind: 'files', contentId: 'sidebar://files' },
    },
    rootId: 'split1',
    activePaneId: 'pane1',
    expanded: true,
  }
  const scene = createScene(seeded)
  const uiSession = { resolve: (sessionId) => ({ key: sessionId }) }
  const handle = installSessionWiring(servicesFor(scene.store, uiSession), createSplitHandler(scene.sidebarRight))
  uiSession.resolve(SESSION)
  await settle()

  const afterOpen = structuredClone(scene.state())
  afterOpen.nodes.pane1.tabs = ['files-tab', 'file-a']
  afterOpen.nodes.pane1.activeTabId = 'file-a'
  afterOpen.tabs['file-a'] = fileRecord('file-a', 'w/a.ts')
  scene.apply(afterOpen)
  await settle()

  assert.deepEqual(scene.calls.split, [], '已有分栏时不应再分栏')
  assert.deepEqual(scene.calls.placeTab, [[SESSION, 'file-a', 'pane2', 0]], '文件应搬进兄弟格')
  // 这条路径（分栏不是本插件建立的，例如插件是在旧版本下分好后热加载进来）不清理
  // 现场里既有的文件树标签：只搬自己打开的那一个，绝不动不属于这次打开的标签。
  assert.deepEqual(
    scene.state().nodes.pane2.tabs,
    ['file-a', 'files-seeded'],
    '兄弟格接收文件并排在标签条首位；既有的文件树标签原样保留',
  )
  assert.deepEqual(scene.calls.closeTab, [], '不清理不属于本次打开的标签')
  handle?.dispose()
}

/* ------------------------------------------------------------------ *
 * 4. 守卫与降级
 * ------------------------------------------------------------------ */

// 分栏被上游拒绝(空间不够):不搬标签、不写比例
{
  const scene = createScene(initialLayout(), 'blocked')
  const uiSession = { resolve: (sessionId) => ({ key: sessionId }) }
  const handle = installSessionWiring(servicesFor(scene.store, uiSession), createSplitHandler(scene.sidebarRight))
  uiSession.resolve(SESSION)
  await settle()

  const afterOpen = structuredClone(scene.state())
  afterOpen.nodes.pane1.tabs = ['files-tab', 'file-a']
  afterOpen.tabs['file-a'] = fileRecord('file-a', 'w/a.ts')
  scene.apply(afterOpen)
  await settle()

  assert.deepEqual(scene.calls.split, ['pane1'], '仍应询问上游能否分栏')
  assert.deepEqual(scene.calls.placeTab, [], '放不下时不得搬动标签')
  assert.deepEqual(scene.calls.resizeSplit, [], '放不下时不得写比例')
  assert.equal(scene.state().nodes.pane1.tabs.includes('file-a'), true, '文件应保持上游默认位置')
  handle?.dispose()
}

// 文件标签在「登记 → 执行」之间被关掉:不误搬
{
  const scene = createScene(initialLayout())
  const handler = createSplitHandler(scene.sidebarRight)
  const withFile = structuredClone(scene.state())
  withFile.nodes.pane1.tabs = ['files-tab', 'file-a']
  withFile.tabs['file-a'] = fileRecord('file-a', 'w/a.ts')
  scene.apply(withFile)
  // 事件携带的布局里文件标签存在,但现场此刻已被改回(模拟执行前被关掉)
  const vanished = structuredClone(initialLayout())
  scene.apply(vanished)
  handler({
    sessionId: SESSION,
    store: scene.store,
    layout: withFile,
    plan: { treePaneId: 'pane1', fileTabId: 'file-a', filePaneId: 'pane2' },
  })
  assert.deepEqual(scene.calls.placeTab, [], '文件标签已不在树面板时不应搬动')
}

// 缺动作面:整体静默跳过,不抛错
{
  const layout = initialLayout()
  layout.nodes.pane2 = { kind: 'pane', id: 'pane2', host: 'dock', tabs: [], activeTabId: undefined }
  const bare = { getSnapshot: () => ({ bySession: { [SESSION]: { layout } } }) }
  const scene = createScene(layout)
  const handler = createSplitHandler(scene.sidebarRight)
  handler({
    sessionId: SESSION,
    store: bare,
    layout,
    plan: { treePaneId: 'pane1', fileTabId: 'file-a', filePaneId: 'pane2' },
  })
  assert.equal(readLayout(bare, SESSION).nodes.pane2.tabs.length, 0, '缺动作面时不应有任何写入')
}

// resolveStore 的各条不可用路径一律 undefined(无降级)
{
  const throwing = {
    entries: () => [{ store: {} }],
    resolveStore: () => {
      throw new Error('store handle is not registered')
    },
  }
  assert.equal(resolveStore(throwing, { key: SESSION }), undefined)
  assert.equal(resolveStore(undefined, { key: SESSION }), undefined)
  assert.equal(resolveStore({ entries: () => [{ store: {} }] }, { key: SESSION }), undefined, '缺 resolveStore 即不可用')
  assert.equal(resolveStore({ entries: () => [], resolveStore: () => ({}) }, { key: SESSION }), undefined, '无注册项即不可用')
  assert.equal(resolveStore({ entries: () => [{ store: {} }], resolveStore: () => ({}) }, {}), undefined, '无作用域 key 即不可用')
}

// 接线:只包装一次、dispose 可还原、重复安装被拒
{
  const original = (sessionId) => ({ key: sessionId })
  const uiSession = { resolve: original }
  const first = installSessionWiring({ uiSession, slots: { entries: () => [], resolveStore: () => undefined } }, () => {})
  assert.ok(first !== undefined)
  const wrapped = uiSession.resolve
  assert.notEqual(wrapped, original, 'resolve 应被包装')
  assert.equal(installSessionWiring({ uiSession, slots: undefined }, () => {}), undefined, '重复安装应被拒')
  first.dispose()
  assert.equal(uiSession.resolve, original, 'dispose 应还原 resolve')
}

// 会话物化后 store 句柄还没注册好:有界微任务重试应把它接上(而不是永久 no-op)
{
  const scene = createScene(initialLayout())
  const uiSession = { resolve: (sessionId) => ({ key: sessionId }) }
  let attempts = 0
  const slots = {
    entries: () => [{ store: {} }],
    resolveStore: () => {
      attempts += 1
      // 前两次「句柄尚未注册」,模拟渲染端物化尚未收尾
      if (attempts <= 2) throw new Error('store handle is not registered')
      return scene.store
    },
  }
  const handle = installSessionWiring({ uiSession, slots }, createSplitHandler(scene.sidebarRight))
  uiSession.resolve(SESSION)
  await settle()
  assert.ok(attempts >= 3, `应重试到句柄可用,实际尝试 ${attempts} 次`)

  const afterOpen = structuredClone(scene.state())
  afterOpen.nodes.pane1.tabs = ['files-tab', 'file-a']
  afterOpen.tabs['file-a'] = fileRecord('file-a', 'w/a.ts')
  scene.apply(afterOpen)
  await settle()
  assert.deepEqual(scene.calls.split, ['pane1'], '重试接上的订阅同样应驱动分栏')
  handle?.dispose()
}

// 现场没有文件树时,任何提交都不触发
{
  const scene = createScene(initialLayout())
  const uiSession = { resolve: (sessionId) => ({ key: sessionId }) }
  const handle = installSessionWiring(servicesFor(scene.store, uiSession), createSplitHandler(scene.sidebarRight))
  uiSession.resolve(SESSION)
  await settle()
  scene.apply(noTree)
  await settle()
  assert.deepEqual(scene.calls.placeTab, [], '没有文件树时不应搬动任何标签')
  handle?.dispose()
}

console.log('dsh-rightbar-split-open: all assertions passed')
