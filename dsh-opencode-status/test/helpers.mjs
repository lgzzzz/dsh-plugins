/**
 * dsh-opencode-status 测试的共享装置：断言、失败计数、包根路径与上游形状的假快照。
 *
 * 跑全部请用 `node test/run-all.mjs`（或 pnpm test）。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
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

/**
 * 一份贴近上游真实形状的快照：`components` 里 `go` 的有 `breakdown` 与 `models`，
 * `deepseek-v4.1-flash` 在 `breakdown` 里带 status 与 speed。
 * @param overrides - 覆盖 go 组件上的字段。
 * @returns 上游 JSON 形状的对象。
 */
export function upstreamFixture(overrides = {}) {
  const go = {
    service: 'go',
    status: 'degraded',
    reason: 'latency',
    since: 1795591172497,
    models: [{ id: 'deepseek-v4.1-flash', reason: 'latency' }],
    breakdown: [
      { id: 'deepseek-v4.1-flash', status: 'degraded', reason: 'latency', speed: { ttft: 9058, tps: 148 } },
      { id: 'glm-5.3', status: 'operational', reason: 'none', speed: { ttft: 5258, tps: 115 } },
    ],
    speed: { ttft: 8046, tps: 145 },
    ...overrides,
  }
  return {
    updatedAt: 1795592912497,
    since: 1792028534694,
    stale: false,
    status: 'degraded',
    components: [
      { service: 'console', status: 'degraded', reason: 'errors', models: [], breakdown: [], speed: {} },
      go,
      { service: 'payg', status: 'operational', reason: 'none', models: [], breakdown: [], speed: {} },
    ],
    incidents: [],
    notes: [],
    history: [],
  }
}

/**
 * 中文词典（+ 少数 common 兜底）的插值翻译函数，供纯函数测试使用。
 * @param dictionaries - 本插件字典（默认中文）。
 * @returns `(key, params) => string`。
 */
export function translator(dictionaries) {
  return (key, params) => {
    const template = dictionaries[key]
    if (typeof template !== 'string') throw new Error(`缺少字典键:${key}`)
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? `{${name}}` : String(params[name])))
  }
}
