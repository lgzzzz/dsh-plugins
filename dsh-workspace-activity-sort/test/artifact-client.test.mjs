/**
 * 产物装配：`lib/client.js` 作为独立 bundle 注册正确的模块 id / 插件名 / `inject`，装配后在
 * 顺序变化时真的把侧栏滚回最上面，并在本地拖拽与没有分组行时不动。装配用的是浏览器加载器
 * 给出的那份工厂（`factory(require)`），`require` 在这里一被调用就失败——本插件的产物不请求
 * 任何外部模块。
 *
 * 运行：`node test/artifact-client.test.mjs`（需要先构建 `lib/client.js`）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createClientContext,
  createSidebarDom,
  createWorkspaceSource,
  installFrameEnvironment,
  workspaceDragTarget,
} from './client-helpers.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 用假的 `window.__ModuleLoader__` 执行产物，返回它注册的那份 bundle 描述。 */
function loadClientArtifact() {
  let registration = null
  const previous = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load: (value) => {
        registration = value
      },
    },
  }
  try {
    ;(0, eval)(readFileSync(join(root, 'lib', 'client.js'), 'utf8'))
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
  return registration
}

/** 产物工厂；`require` 被调用即失败，用来证明浏览器半部没有 external 请求。 */
function loadPlugin() {
  const registration = loadClientArtifact()
  assert.ok(registration !== null, '产物注册到 __ModuleLoader__')
  return registration.factory(() => {
    throw new Error('产物请求了外部模块：本插件不应有 external')
  })
}

// 产物登记

{
  const registration = loadClientArtifact()
  assert.equal(registration.id, 'dsh-workspace-activity-sort', '浏览器模块 id 等于包名')
}

// 导出形态

{
  const plugin = loadPlugin()
  assert.equal(plugin.name, 'dsh-workspace-activity-sort', '插件名等于包名')
  assert.equal(typeof plugin.apply, 'function', '导出 apply')
  assert.deepEqual(plugin.inject, ['workspaces'], 'inject 声明活在产物里')
}

// 装配后的滚动行为

{
  const plugin = loadPlugin()
  const workspaces = createWorkspaceSource(['a', 'b', 'c'])
  const dom = createSidebarDom({ scrollTop: 240 })
  const env = installFrameEnvironment(dom.document)
  const { ctx, dispose } = createClientContext(workspaces)
  try {
    plugin.apply(ctx)
    assert.equal(env.pending(), 0, '挂载不滚动')
    workspaces.setOrder(['c', 'a', 'b'])
    assert.equal(env.pending(), 1, '重排到最前排一帧')
    env.flush()
    assert.equal(dom.area.scrollTop, 0, '帧跑到：侧栏区块滚回最上面')
  } finally {
    dispose()
    env.restore()
  }
}

// 装配后的本地拖拽静默窗口

{
  const plugin = loadPlugin()
  const workspaces = createWorkspaceSource(['a', 'b', 'c'])
  const dom = createSidebarDom({ scrollTop: 240 })
  const env = installFrameEnvironment(dom.document)
  const { ctx, dispose } = createClientContext(workspaces)
  try {
    plugin.apply(ctx)
    dom.dispatch('dragstart', { target: workspaceDragTarget() })
    workspaces.setOrder(['c', 'a', 'b'])
    env.flush()
    assert.equal(dom.area.scrollTop, 240, '本地拖拽期间不滚')
  } finally {
    dispose()
    env.restore()
  }
}

// 装配后的视图判定（单列表视图没有分组行）

{
  const plugin = loadPlugin()
  const workspaces = createWorkspaceSource(['a', 'b', 'c'])
  const dom = createSidebarDom({ scrollTop: 240, workspaceRows: false })
  const env = installFrameEnvironment(dom.document)
  const { ctx, dispose } = createClientContext(workspaces)
  try {
    plugin.apply(ctx)
    workspaces.setOrder(['c', 'a', 'b'])
    env.flush()
    assert.equal(dom.area.scrollTop, 240, '单列表视图不滚动')
  } finally {
    dispose()
    env.restore()
  }
}

console.log('artifact-client: 全部通过')
