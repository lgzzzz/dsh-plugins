/**
 * 浏览器半部的行为测试：假工作区控制器 + 假客户端 ctx + 假侧栏 DOM。
 *
 * 覆盖：某个工作区被排到第一位时排一帧、帧跑到才滚回最上面；同一帧内的多条增量只滚一次；
 * 基线 / 新建插到最前 / 删除第一名 / 改名都不滚；断线恢复后的第一份顺序只当基线；本地工作区
 * 拖拽期间与结束后的静默窗口不滚；单列表视图没有分组行时不滚；卸载取消待排帧、退订、移除
 * document 监听且不再动作；没有 document 时帧跑空也不抛错。
 *
 * 运行：`node test/client-apply.test.mjs`。
 */
import assert from 'node:assert/strict'
import { apply, inject, name } from '../src/client.ts'
import { DRAG_GRACE_MS, DRAG_STALE_MS } from '../src/scroll.ts'
import {
  createClientContext,
  createSidebarDom,
  createWorkspaceSource,
  installFrameEnvironment,
  otherDragTarget,
  workspaceDragTarget,
} from './client-helpers.mjs'

// 导出形态：浏览器半部与其它客户端插件一样只用具名导出

assert.equal(name, 'dsh-workspace-activity-sort', '模块名与包名一致（浏览器模块 id 取自包名）')
assert.equal(typeof apply, 'function', '导出 apply')
assert.deepEqual(inject, ['workspaces'], '缺工作区控制器时等待，就绪后才挂载')

/**
 * 跑一个隔离的用例：装好假侧栏与帧队列、挂载插件，结束时卸载并还原全局。
 * `scrollTop` 写入次数由这里统计。
 */
function scenario({ order = ['a', 'b', 'c'], scrollTop = 240, workspaceRows = true, document: withDocument = true }, body) {
  const workspaces = createWorkspaceSource(order)
  const dom = createSidebarDom({ scrollTop, workspaceRows })
  let stored = dom.area.scrollTop
  let writes = 0
  Object.defineProperty(dom.area, 'scrollTop', {
    configurable: true,
    get: () => stored,
    set: (value) => {
      stored = value
      writes += 1
    },
  })
  const env = installFrameEnvironment(withDocument ? dom.document : undefined)
  const { ctx, dispose } = createClientContext(workspaces)
  try {
    body({
      workspaces,
      dom,
      env,
      ctx,
      dispose,
      scrollTop: () => stored,
      writes: () => writes,
    })
  } finally {
    dispose()
    env.restore()
  }
}

// 重排到最前：排一帧，帧跑到才滚

scenario({}, ({ ctx, workspaces, dom, env, scrollTop, writes }) => {
  apply(ctx)
  assert.equal(env.pending(), 0, '挂载本身不滚动')
  workspaces.setOrder(['c', 'a', 'b'])
  assert.equal(env.pending(), 1, '重排到最前排了一帧')
  assert.equal(scrollTop(), 240, '帧还没跑，滚动位置不动')
  assert.equal(writes(), 0, '帧还没跑，不写 scrollTop')
  env.flush()
  assert.equal(scrollTop(), 0, '帧跑到：滚回最上面')
  assert.equal(writes(), 1, '只写一次')
  assert.equal(dom.area.scrollTop, 0, '写入的是侧栏区块自己的滚动容器')
})

// 同一帧内的多条增量只滚一次

scenario({}, ({ ctx, workspaces, env, scrollTop, writes }) => {
  apply(ctx)
  workspaces.setOrder(['b', 'a', 'c'])
  workspaces.setOrder(['c', 'b', 'a'])
  assert.equal(env.pending(), 1, '帧已排上时不再重复排')
  env.flush()
  assert.equal(scrollTop(), 0, '两跳之后仍然滚到最上面')
  assert.equal(writes(), 1, '同一帧只写一次')
  workspaces.setOrder(['b', 'c', 'a'])
  assert.equal(env.pending(), 1, '下一跳重新排帧')
})

// 不构成重排到最前：不排帧

scenario({ order: [] }, ({ ctx, workspaces, env, scrollTop, writes }) => {
  apply(ctx)
  workspaces.setOrder(['a', 'b', 'c'])
  assert.equal(env.pending(), 0, '空列表 → 完整顺序是基线，不滚动')
  workspaces.setOrder(['n', 'a', 'b', 'c'])
  assert.equal(env.pending(), 0, '新建工作区插到最前不算重排')
  workspaces.setOrder(['a', 'b', 'c'])
  assert.equal(env.pending(), 0, '删除原第一名后下一个顶上来不算重排')
  env.flush()
  assert.equal(scrollTop(), 240, '滚动位置始终没动')
  assert.equal(writes(), 0, '一次 scrollTop 都没写')
})

scenario({}, ({ ctx, workspaces, env, scrollTop }) => {
  apply(ctx)
  workspaces.notify()
  assert.equal(env.pending(), 0, '改名 / 视图更新（顺序不变）不滚动')
  workspaces.setOrder(['a', 'b', 'c'])
  assert.equal(env.pending(), 0, '顺序没变不滚动')
  env.flush()
  assert.equal(scrollTop(), 240, '滚动位置没动')
})

// 单列表视图：没有分组行，不滚

scenario({ workspaceRows: false }, ({ ctx, workspaces, env, scrollTop, writes }) => {
  apply(ctx)
  workspaces.setOrder(['c', 'a', 'b'])
  assert.equal(env.pending(), 1, '判定已经成立，仍然排帧')
  env.flush()
  assert.equal(scrollTop(), 240, '单列表视图里工作区顺序不可见，不滚动')
  assert.equal(writes(), 0, '没有写 scrollTop')
})

// 已经在最上面：帧跑空，不写

scenario({ order: ['a', 'b'], scrollTop: 0 }, ({ ctx, workspaces, env, writes }) => {
  apply(ctx)
  workspaces.setOrder(['b', 'a'])
  env.flush()
  assert.equal(writes(), 0, '本来就在最上面：不重复写')
})

// 卸载：取消待排帧、退订、不再动作

scenario({}, ({ workspaces, dom, env, ctx, dispose, scrollTop }) => {
  apply(ctx)
  assert.equal(dom.listenerCount(), 3, '挂载时注册 dragstart / dragend / drop 三个 document 监听')
  workspaces.setOrder(['c', 'a', 'b'])
  assert.equal(env.pending(), 1, '卸载前排了一帧')
  dispose()
  assert.equal(env.pending(), 0, '卸载取消待排帧')
  assert.equal(workspaces.listenerCount(), 0, '卸载退订顺序变化')
  assert.equal(dom.listenerCount(), 0, '卸载移除 document 监听')
  workspaces.setOrder(['b', 'c', 'a'])
  assert.equal(env.pending(), 0, '卸载后不再排帧')
  assert.equal(scrollTop(), 240, '卸载后不再写滚动位置')
  assert.equal(dom.area.scrollTop, 240, '滚动容器保持原样')
})

// 断线恢复：恢复后的第一份顺序只当基线

scenario({}, ({ ctx, workspaces, env, scrollTop, writes }) => {
  apply(ctx)
  workspaces.setState('loading')
  assert.equal(env.pending(), 0, '载体失联本身不排帧')
  workspaces.resync(['c', 'a', 'b'])
  assert.equal(env.pending(), 0, '恢复后的整份替换不当作上浮')
  env.flush()
  assert.equal(writes(), 0, '恢复基线不写 scrollTop')
  workspaces.setOrder(['b', 'c', 'a'])
  assert.equal(env.pending(), 1, '恢复后真正的重排照常排帧')
  env.flush()
  assert.equal(scrollTop(), 0, '恢复后重排仍滚回最上面')
})

scenario({ order: [] }, ({ ctx, workspaces, env, writes }) => {
  workspaces.setState('loading')
  apply(ctx)
  workspaces.resync(['a', 'b', 'c'])
  assert.equal(env.pending(), 0, '页面加载时控制器还在 loading：第一份完整顺序是基线')
  env.flush()
  assert.equal(writes(), 0, '页面加载完成不写 scrollTop')
})

// 本地工作区拖拽：期间与刚结束都不滚

scenario({}, ({ ctx, workspaces, dom, env, scrollTop }) => {
  apply(ctx)
  dom.dispatch('dragstart', { target: workspaceDragTarget() })
  workspaces.setOrder(['b', 'a', 'c'])
  assert.equal(env.pending(), 1, '拖拽期间顺序变化仍排帧')
  env.flush()
  assert.equal(scrollTop(), 240, '拖拽期间不滚')
  dom.dispatch('drop')
  workspaces.setOrder(['c', 'b', 'a'])
  env.flush()
  assert.equal(scrollTop(), 240, '拖拽结束后静默窗口内不滚')
  env.advance(DRAG_GRACE_MS + 1)
  workspaces.setOrder(['a', 'c', 'b'])
  env.flush()
  assert.equal(scrollTop(), 0, '静默窗口过去后照常滚回最上面')
})

scenario({}, ({ ctx, workspaces, dom, env, scrollTop }) => {
  apply(ctx)
  dom.dispatch('dragstart', { target: otherDragTarget() })
  workspaces.setOrder(['c', 'a', 'b'])
  env.flush()
  assert.equal(scrollTop(), 0, '会话行上的拖拽不静默工作区滚动')
})

scenario({}, ({ ctx, workspaces, dom, env, scrollTop }) => {
  apply(ctx)
  dom.dispatch('dragstart', { target: workspaceDragTarget() })
  env.advance(DRAG_STALE_MS + 1)
  workspaces.setOrder(['c', 'a', 'b'])
  env.flush()
  assert.equal(scrollTop(), 0, '丢失 dragend 的拖拽超过上限后不再静默')
})

// 非浏览器环境：没有 document 时帧跑空也不抛错

scenario({ document: false }, ({ ctx, workspaces, env }) => {
  apply(ctx)
  workspaces.setOrder(['c', 'a', 'b'])
  assert.equal(env.pending(), 1, '判定与排帧不依赖 document')
  env.flush()
})

console.log('client-apply: 全部通过')
