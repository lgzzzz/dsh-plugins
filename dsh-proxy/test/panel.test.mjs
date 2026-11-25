/**
 * 浏览器半部的装配测试：直接把构建产物 `lib/client.js` 当模块加载，用替身 Context + 真实 React 验证。
 *
 * 覆盖五件事：
 *   1. 工厂只向模块表要 `react` / `react/jsx-runtime`，不夹带别的包；
 *   2. `apply` 注册两个槽位（侧栏 id 与主面板 key 都是 `proxy`，与宿主约定一致）；
 *   3. 中英词条键集合一致，切换语言后侧栏 thunk 立刻换文案；
 *   4. 样式走 CSS Modules：两条 `<style data-plugin>` 注入、选择器是哈希类名、没有遗留全局 `.proxy-*`；
 *   5. 主面板能在真实 React 下渲染出首帧（加载占位用的是样式表里的哈希类名）。
 *
 * 需要先 `pnpm build`：测试读的是产物，不是源码 —— 产物才是宿主真正加载的东西。
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runInThisContext } from 'node:vm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { check, checkEqual, finish, pluginRoot } from './helpers.mjs'

const require = createRequire(import.meta.url)
const bundlePath = join(pluginRoot, 'lib', 'client.js')

/**
 * 造一个只够样式注入用的 document：`createElement` / `head.appendChild` / 去重用的 `querySelector`。
 * @returns `{ tags, createElement, head, querySelector }` 替身。
 */
function createDocumentStub() {
  /** 已注入的 `<style>`；`remove()` 会把它摘掉。 */
  const tags = []
  return {
    tags,
    createElement(tagName) {
      const element = {
        tagName,
        dataset: {},
        textContent: '',
        remove() {
          const at = tags.indexOf(element)
          if (at >= 0) tags.splice(at, 1)
        },
      }
      return element
    },
    head: {
      appendChild(element) {
        tags.push(element)
      },
    },
    querySelector(selector) {
      // 构建产物只用这一种选择器做去重：style[data-plugin-css="<包名>/<文件>.module.css"]
      const matched = /^style\[data-plugin-css="(.*)"\]$/.exec(selector)
      if (matched === null) return null
      return tags.find((element) => element.dataset.pluginCss === matched[1]) ?? null
    },
  }
}

/**
 * 造一个语言服务替身：字典注册、按当前语言走回退链、快照订阅。
 * @returns 替身服务与可以中途改语言的把手。
 */
function createLocaleStub() {
  const state = { active: 'zh', revision: 1 }
  const dictionaries = new Map()
  const listeners = new Set()
  const service = {
    register(ns, tag, dict) {
      const namespaced = dictionaries.get(ns) ?? {}
      namespaced[tag] = dict
      dictionaries.set(ns, namespaced)
      return () => {}
    },
    bind(ns) {
      return (key) => {
        const namespaced = dictionaries.get(ns) ?? {}
        const chain = state.active === 'zh' ? ['zh', 'en'] : ['en', 'zh']
        for (const tag of chain) {
          const dict = namespaced[tag]
          if (dict !== undefined && Object.prototype.hasOwnProperty.call(dict, key)) return dict[key]
        }
        return key
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return {
        active: state.active,
        locales: [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }],
        revision: state.revision,
      }
    },
  }

  /** 切换当前语言并通知订阅者，模拟宿主 `locale/change`。 */
  const switchTo = (id) => {
    state.active = id
    state.revision += 1
    for (const listener of listeners) listener()
  }

  return { service, dictionaries, switchTo }
}

/**
 * 加载构建产物：先摆好 `window.__ModuleLoader__` 与 `document`，再执行工厂。
 * @returns 工厂返回的模块导出（`inject` / `apply`）与被请求过的模块 id。
 */
function loadClientBundle() {
  const documentStub = createDocumentStub()
  const loaded = []
  let entry = null

  globalThis.window = { __ModuleLoader__: { load(value) { entry = value } } }
  globalThis.document = documentStub
  try {
    runInThisContext(readFileSync(bundlePath, 'utf8'), { filename: bundlePath })
    if (entry === null) throw new Error('client bundle 没有调用 __ModuleLoader__.load')
    if (entry.id !== 'dsh-proxy') throw new Error(`client bundle id 是 ${String(entry.id)}，应为 dsh-proxy`)
    const exports = entry.factory((id) => {
      loaded.push(id)
      if (id === 'react') return require('react')
      if (id === 'react/jsx-runtime') return require('react/jsx-runtime')
      throw new Error(`client bundle 请求了预期之外的模块：${id}`)
    })
    return { exports, documentStub, loaded }
  } finally {
    delete globalThis.window
    delete globalThis.document
  }
}

/**
 * 跑完整个装配测试。
 */
function main() {
  const { exports, documentStub, loaded } = loadClientBundle()

  checkEqual(
    [...new Set(loaded)].sort(),
    ['react', 'react/jsx-runtime'],
    '浏览器半部只请求 react 与 react/jsx-runtime',
  )
  checkEqual(exports.inject, ['slots', 'locale'], '声明依赖 slots 与 locale')

  const { service, dictionaries, switchTo } = createLocaleStub()
  /** 槽位注册记录，按调用顺序。 */
  const registrations = []
  /** `ctx.effect` 记录下来的清理函数。 */
  const effects = []
  const ctx = {
    locale: service,
    slots: {
      inject: (name, callback) => callback(),
      register: (metadata, component) => {
        registrations.push({ metadata, component })
        return () => {}
      },
    },
    effect: (setup, label) => {
      effects.push({ label, dispose: setup() })
      return () => {}
    },
  }

  exports.apply(ctx)

  checkEqual(
    registrations.map((entry) => entry.metadata.name),
    ['sidebar.panellist', 'main'],
    '注册侧栏入口与主面板两个槽位',
  )
  const [sidebar, main] = registrations
  checkEqual(sidebar.metadata.id, 'proxy', '侧栏 id 与主面板 key 都是 proxy（宿主按 id 选面板）')
  checkEqual(main.metadata.key, 'proxy', '主面板 key 是 proxy')
  checkEqual(sidebar.metadata.order, 30, '侧栏顺序沿用 30，排在内置入口之后')
  check(typeof sidebar.metadata.label === 'function', '侧栏标签是 thunk，切语言时会被重新读取')
  checkEqual(sidebar.metadata.label(), '分流路由', '侧栏标签走中文词条')

  switchTo('en')
  checkEqual(sidebar.metadata.label(), 'Split routing', '切到英文后侧栏标签跟着变')
  switchTo('zh')

  const dicts = dictionaries.get('proxy.panel')
  check(dicts !== undefined, '字典注册在 proxy.panel 命名空间下')
  checkEqual(
    Object.keys(dicts.zh).sort(),
    Object.keys(dicts.en).sort(),
    '中英词条键集合一致',
  )
  check(Object.keys(dicts.zh).length >= 60, '词条数量覆盖四个页签与状态条')
  checkEqual(effects.length, 4, 'apply 只留四个 effect：两套字典 + 两个槽位（样式由构建产物自注入）')

  checkEqual(documentStub.tags.length, 2, '两份 CSS Modules 各自注入一条 <style>')
  for (const tag of documentStub.tags) {
    const css = tag.textContent
    checkEqual(tag.dataset.plugin, 'dsh-proxy', `<style> 归属 dsh-proxy：${String(tag.dataset.pluginCss)}`)
    check(tag.dataset.pluginCss.endsWith('.module.css'), '注入来源是 .module.css 虚拟模块')
    check(css.includes('--dsw-alias-'), '样式只消费 --dsw-alias-* 令牌')
    check(!/(^|[}\s])\.proxy-/.test(css), '样式里没有遗留的全局 .proxy-* 类名')
    check(/\.[A-Za-z0-9]+_(?:panel|button)\{/.test(css), '类名已换成构建哈希')
  }

  const markup = renderToStaticMarkup(createElement(main.component))
  check(markup.includes('加载中…'), '首帧渲染出加载占位')
  const panelClass = /\.([A-Za-z0-9]+_panel)\{/.exec(documentStub.tags.map((tag) => tag.textContent).join(''))
  check(panelClass !== null, '样式表里有面板根元素的哈希类名')
  if (panelClass !== null) {
    check(markup.includes(panelClass[1]), '首帧的根元素用上了样式表里的类名')
  }

  finish('浏览器半部装配')
}

if (!existsSync(bundlePath)) {
  check(false, 'lib/client.js 存在（先跑 `pnpm build`）')
  finish('浏览器半部装配')
} else {
  main()
}
