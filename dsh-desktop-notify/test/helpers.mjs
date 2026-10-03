/**
 * dsh-desktop-notify 行为测试的共享装置:断言、失败计数,以及各测试共用的 fixture。
 *
 * 跑全部请用 `node test/run-all.mjs`(或 pnpm test)。
 * 依赖 Node 22+ 的 Type Stripping 直接 import .ts。
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 本插件的包根目录(测试文件在 test/ 下,所以是上一级)。 */
export const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0

/** 已失败的断言数,供测试文件自行判断。 */
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

/** 捕获 console.warn 的文本,供断言诊断输出。 */
export function captureWarnings(run) {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))
  try {
    run()
  } finally {
    console.warn = original
  }
  return warnings
}

/** 打印本文件的结论并设置退出码。每个测试文件末尾调用一次。 */
export function finish() {
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
  process.exitCode = failures === 0 ? 0 : 1
}

/** 会话目录快照:`s-1` 是普通会话,`s-2` 是子会话。 */
export const ROWS = {
  's-1': { id: 's-1', displayTitle: '修复登录 bug' },
  's-2': { id: 's-2', displayTitle: '子会话', origin: 'subagent' },
}
