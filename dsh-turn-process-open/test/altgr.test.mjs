/**
 * 折叠键的终端捕获层：AltGraph / 旧 IME 229 必须与 isComposing 一样让位，
 * 不能把 AltGr+字母当成 Ctrl+Alt+. 的固定键。
 *
 * 运行：`node test/altgr.test.mjs`（或 pnpm test 跑全部）。
 */
import assert from 'node:assert/strict'
import { captureGesture } from '../src/capture.ts'

const base = {
  code: 'Period',
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
}

assert.equal(captureGesture(base).composing, false, '普通 Ctrl+Alt+. 不算组合输入')
assert.equal(captureGesture({ ...base, isComposing: true }).composing, true, 'isComposing 让位')
assert.equal(captureGesture({ ...base, keyCode: 229 }).composing, true, 'keyCode 229 让位')
assert.equal(
  captureGesture({ ...base, getModifierState: (state) => state === 'AltGraph' }).composing,
  true,
  'AltGraph 让位',
)

console.log('altgr checks passed')
