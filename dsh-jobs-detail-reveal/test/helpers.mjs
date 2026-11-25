/**
 * dsh-jobs-detail-reveal 测试的共享装置：断言、失败计数、最小 DOM 替身。
 *
 * 跑全部请用 `node test/run-all.mjs`（或 pnpm test）。依赖 Node 22+ 的 Type Stripping
 * 直接 import `.ts`。
 *
 * 替身只实现本插件真正用到的那点 DOM：`closest` / `querySelector` / `parentElement` /
 * `isConnected` / `getBoundingClientRect` / `style` / `scrollTop` / `clientTop`。不装 jsdom，
 * 也不模拟 React——测试关心的是「拿到这几个数之后做什么」，不是上游怎么渲染。
 *
 * 选择器只支持本插件用到的两种写法：`tag` 与 `tag[attr]`（可带 `="value"`）。`querySelector`
 * 按**完整选择器字符串**查调用方登记的表，`closest` 则逐级往上跑 `matches`。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 本插件的包根目录（测试文件在 test/ 下，所以是上一级）。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0

/** 已失败的断言数。 */
export function failureCount() {
  return failures
}

export function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 ${e},实得 ${a}`}`)
}

export function checkTrue(label, actual) {
  const ok = actual === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — 期望 true,实得 ${JSON.stringify(actual)}`}`)
}

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

const SELECTOR = /^([a-z0-9]*)(?:\[([a-zA-Z-]+)(?:="([^"]*)")?\])?$/

/**
 * 极简选择器匹配：`tag`、`[attr]`、`tag[attr]`、`tag[attr="value"]`。
 * @param {any} element 元素替身
 * @param {string} selector 选择器
 */
export function matchesSelector(element, selector) {
  const parsed = SELECTOR.exec(selector)
  if (parsed === null) throw new Error(`测试替身不支持的选择器：${selector}`)
  const [, tag = '', attribute, expected] = parsed
  if (tag !== '' && element.tag !== tag) return false
  if (attribute === undefined) return true
  const value = element.getAttribute(attribute)
  if (value === null) return false
  return expected === undefined || value === expected
}

/**
 * 最小元素替身。
 * @param {object} [options]
 * @param {string} [options.tag] 标签名
 * @param {Record<string, string>} [options.attributes] 初始属性
 * @param {Record<string, any>} [options.children] 选择器 → 子元素
 * @param {object} [options.rect] `getBoundingClientRect()` 的返回值
 */
export function fakeElement({ tag = 'div', attributes = {}, children = {}, rect = { top: 0, left: 0, width: 0, height: 0 } } = {}) {
  const styleValues = new Map()
  const element = {
    tag,
    children,
    parentElement: null,
    attributes: { ...attributes },
    isConnected: true,
    scrollTop: 0,
    clientTop: 0,
    rect,
    /** `max-height` 只记录本插件写的值；计算样式由 fakeWindow 读它。 */
    style: {
      setProperty(name, value) { styleValues.set(name, value) },
      removeProperty(name) { styleValues.delete(name) },
      getPropertyValue(name) { return styleValues.get(name) ?? '' },
      get size() { return styleValues.size },
    },
    getAttribute(name) { return name in element.attributes ? element.attributes[name] : null },
    setAttribute(name, value) { element.attributes[name] = String(value) },
    getBoundingClientRect() { return { ...element.rect } },
    querySelector(selector) { return children[selector] ?? null },
    matches(selector) { return matchesSelector(element, selector) },
    contains(other) {
      let current = other ?? null
      while (current !== null) {
        if (current === element) return true
        current = current.parentElement ?? null
      }
      return false
    },
    /** 挂一个子元素：登记选择器表，并回填 `parentElement`。 */
    attach(selector, child) {
      children[selector] = child
      child.parentElement = element
      return child
    },
    closest(selector) {
      let current = element
      while (current !== null) {
        if (current.matches?.(selector) === true) return current
        current = current.parentElement ?? null
      }
      return null
    },
  }
  return element
}
