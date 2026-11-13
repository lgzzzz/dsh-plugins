/**
 * 启动期单文件卡片补丁的测试：文本三态（打上 / 已打 / 锚点缺失）、幂等、
 * 写后只 `rebuilt` 一次、卸载恢复，以及各条失败路径只告警不抛错。
 *
 * 运行：`node test/single-card.test.mjs`（或 pnpm test 跑全部）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MARKER,
  PATCHED,
  UPSTREAM_ID,
  installSingleCardPatch,
  patchBundleText,
} from '../src/host/single-card.ts'
import { check, checkTrue, finish } from './card-helpers.mjs'

/** 与上游 packed bundle 同形的一小段文本。 */
const BUNDLE = '/* upstream */;const singleFile=changes.total===1?changes.files[0]:void 0;const foldable=changes.files.length>4;\n'

/** 临时目录里放一份 bundle；测试结束由调用方清理。 */
const dir = mkdtempSync(join(tmpdir(), 'dsh-single-card-'))
let serial = 0

/**
 * 新建一个「磁盘上的产物 + 假 clientModules」组合。
 * @param {string} source - 初始全文。
 * @returns {{ path: string, modules: object, calls: unknown[][] }} 组合。
 */
function fixture(source) {
  const path = join(dir, `client-${serial += 1}.js`)
  writeFileSync(path, source)
  const calls = []
  return {
    path,
    calls,
    modules: {
      clientPath(id) {
        calls.push(['clientPath', id])
        return path
      },
      rebuilt(id) {
        calls.push(['rebuilt', id])
        return 'rev-next'
      },
    },
  }
}

/** 记录 info / warn 的诊断输出。 */
function diagnostics() {
  const lines = { info: [], warn: [] }
  return {
    lines,
    info: message => { lines.info.push(message) },
    warn: message => { lines.warn.push(message) },
  }
}

// ---- 纯文本三态 ----

const patchedResult = patchBundleText(BUNDLE)
check('锚点在时判为 patched', patchedResult.status, 'patched')
checkTrue('补丁文本带插件标记', patchedResult.text?.includes(MARKER) === true)
checkTrue('补丁文本不再含单文件分支', patchedResult.text?.includes('changes.total===1') === false)
checkTrue('补丁行与常量一致', patchedResult.text?.includes(PATCHED) === true)

const alreadyResult = patchBundleText(patchedResult.text ?? '')
check('已打过的文本判为 already', alreadyResult.status, 'already')

check('陌生文本判为 missing', patchBundleText('const x=1;\n').status, 'missing')

const spaced = 'const singleFile = changes.total === 1 ? changes.files[0] : undefined;'
check('容忍空白差异与 undefined', patchBundleText(spaced).status, 'patched')

// ---- 写入 / rebuilt / 卸载恢复 ----

{
  const { path, calls, modules } = fixture(BUNDLE)
  const log = diagnostics()
  const dispose = installSingleCardPatch(modules, log)
  check('首次安装写入补丁', readFileSync(path, 'utf8').includes(MARKER), true)
  check('只 rebuilt 一次且带上游 id', calls.filter(([name]) => name === 'rebuilt'), [['rebuilt', UPSTREAM_ID]])
  check('记录一条 info', log.lines.info.length, 1)
  check('没有 warn', log.lines.warn.length, 0)
  dispose()
  check('卸载后恢复原文', readFileSync(path, 'utf8'), BUNDLE)
}

// ---- 幂等：已经打过就不写、不 rebuilt ----

{
  const { path, calls, modules } = fixture(patchedResult.text ?? '')
  const log = diagnostics()
  const dispose = installSingleCardPatch(modules, log)
  check('已打过时文件不变', readFileSync(path, 'utf8'), patchedResult.text)
  check('已打过时不 rebuilt', calls.filter(([name]) => name === 'rebuilt').length, 0)
  check('已打过时记录 info', log.lines.info.length, 1)
  dispose()
  check('已打过时卸载不动文件', readFileSync(path, 'utf8'), patchedResult.text)
}

// ---- 锚点缺失：只告警 ----

{
  const original = 'const other=1;\n'
  const { path, calls, modules } = fixture(original)
  const log = diagnostics()
  const dispose = installSingleCardPatch(modules, log)
  check('锚点缺失时文件不变', readFileSync(path, 'utf8'), original)
  check('锚点缺失时不 rebuilt', calls.filter(([name]) => name === 'rebuilt').length, 0)
  check('锚点缺失时记录 warn', log.lines.warn.length, 1)
  dispose()
}

// ---- 服务端没有该 entry：只告警、不抛错 ----

{
  const log = diagnostics()
  const modules = {
    clientPath() { return undefined },
    rebuilt() { throw new Error('不应被调用') },
  }
  let threw = false
  try {
    installSingleCardPatch(modules, log)()
  } catch {
    threw = true
  }
  check('clientPath 为空不抛错', threw, false)
  check('clientPath 为空记录 warn', log.lines.warn.length, 1)
}

// ---- 卸载不覆盖别人改过的文件 ----

{
  const { path, modules } = fixture(BUNDLE)
  const dispose = installSingleCardPatch(modules, diagnostics())
  writeFileSync(path, `${BUNDLE}// dsh 升级替换了整个文件\n`)
  dispose()
  checkTrue('文件被替换后卸载不恢复', readFileSync(path, 'utf8').includes('dsh 升级替换了整个文件'))
}

// ---- 产物登记有延迟：轮询到就绪再打 ----

{
  const { path } = fixture(BUNDLE)
  let calls = 0
  const modules = {
    clientPath() {
      calls += 1
      return calls < 3 ? undefined : path
    },
    rebuilt() { return 'rev' },
  }
  const log = diagnostics()
  const dispose = installSingleCardPatch(modules, log, { retryMs: 5, timeoutMs: 500 })
  await new Promise(resolve => setTimeout(resolve, 60))
  check('轮询后写入补丁', readFileSync(path, 'utf8').includes(MARKER), true)
  check('轮询期间没有 warn', log.lines.warn.length, 0)
  check('登记前访问了几次', calls >= 3, true)
  dispose()
  check('轮询成功后卸载恢复', readFileSync(path, 'utf8'), BUNDLE)
}

{
  let calls = 0
  const modules = {
    clientPath() { calls += 1; return undefined },
    rebuilt() { throw new Error('不应被调用') },
  }
  const log = diagnostics()
  let threw = false
  let dispose = () => {}
  try {
    dispose = installSingleCardPatch(modules, log, { retryMs: 5, timeoutMs: 20 })
    await new Promise(resolve => setTimeout(resolve, 80))
  } catch {
    threw = true
  }
  dispose()
  check('超时后不抛错', threw, false)
  check('超时后记录 warn', log.lines.warn.length, 1)
  check('超时后仍在轮询过', calls >= 2, true)
}

rmSync(dir, { recursive: true, force: true })
finish()
