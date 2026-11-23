/**
 * 变更页地址与面板流解析：地址两段都编码、第一帧只取第一个绑定、读不到或超时回落到
 * undefined（调用方据此打开本地变更页）。
 *
 * 运行：`node test/change-request.test.mjs`（或 pnpm test 跑全部）。
 */
import {
  CHANGE_REQUEST_TIMEOUT_MS,
  changeRequestAddress,
  firstChangeRequestUrl,
} from '../src/change-request.ts'
import { BOUND_URL, check, checkTrue, fakeForgePanel, finish } from './shortcut-helpers.mjs'

console.log('--- D① 地址：会话与变更请求链接都按 URI 组件编码 ---')
{
  check(
    '普通会话',
    changeRequestAddress('s1', BOUND_URL),
    'dsh-resource://forge-changes/s1/change/https%3A%2F%2Fgithub.com%2Fowner%2Frepo%2Fpull%2F7',
  )
  check(
    '会话 id 含斜杠',
    changeRequestAddress('a/b', 'https://h/x?y=1'),
    'dsh-resource://forge-changes/a%2Fb/change/https%3A%2F%2Fh%2Fx%3Fy%3D1',
  )
  check('默认超时', CHANGE_REQUEST_TIMEOUT_MS, 1500)
}

console.log('--- D② 第一帧：取第一个绑定，忽略后续 ---')
{
  const panel = fakeForgePanel({ urls: [BOUND_URL, 'https://github.com/owner/repo/pull/8'] })
  check('第一个链接', await firstChangeRequestUrl(panel, 's1'), BOUND_URL)
  check('按会话读流', panel.calls, ['s1'])
  checkTrue('读完后释放流', panel.disposed >= 1)
}

console.log('--- D③ 没有绑定 / 非字符串 url / 流抛错：undefined ---')
{
  check('没有绑定', await firstChangeRequestUrl(fakeForgePanel({ urls: [] }), 's1'), undefined)
  check('url 非字符串', await firstChangeRequestUrl(fakeForgePanel({ urls: [42] }), 's1'), undefined)
  check('空字符串 url', await firstChangeRequestUrl(fakeForgePanel({ urls: [''] }), 's1'), undefined)
  check('迭代抛错', await firstChangeRequestUrl(fakeForgePanel({ failure: new Error('boom') }), 's1'), undefined)
  const throwing = { follow() { throw new Error('no remote') } }
  check('follow 抛错', await firstChangeRequestUrl(throwing, 's1'), undefined)
}

console.log('--- D④ 超时：中止流并按没有绑定处理 ---')
{
  let disposed = 0
  const panel = {
    follow(sessionId, signal) {
      return {
        async *[Symbol.asyncIterator]() {
          await new Promise((resolve) => {
            if (signal === undefined || signal.aborted) return resolve(undefined)
            signal.addEventListener('abort', () => resolve(undefined), { once: true })
          })
        },
        dispose() { disposed += 1 },
      }
    },
  }
  const started = Date.now()
  const url = await firstChangeRequestUrl(panel, 's1', 30)
  const elapsed = Date.now() - started
  check('超时返回 undefined', url, undefined)
  checkTrue('超时后释放流', disposed >= 1)
  checkTrue(`超时没有拖过上限（${elapsed}ms）`, elapsed < 1000)
}

finish()
