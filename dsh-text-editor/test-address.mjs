/**
 * 纯逻辑验证（Node 22+ Type Stripping 直载 src/address.ts，不需要浏览器 / React）：
 *
 *   1. 地址解析：`dsh-resource://file/session/<id>/<path>` 的往返、编码、以及各种
 *      非本编辑器认领的形态（非 file 地址、absolute 作用域、缺路径）；
 *   2. 地址构造：fileAddressFor 的「工作区内绝对路径 → 工作区相对地址」折叠规则；
 *   3. 接管域：isTextFile 的文本 / 图片 / PDF 判定——即右侧栏 tab 类型 canOpen 的
 *      核心谓词（canOpen = 可解析的 session 地址 && path 非空 && isTextFile(path)）。
 *
 * 运行：node test-address.mjs
 */
import assert from 'node:assert/strict'
import {
  fileAddressFor,
  isAbsolutePath,
  isTextFile,
  parseSessionFileAddress,
  sessionFileAddress,
} from './src/address.ts'

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('dsh-text-editor / src/address.ts')

// ── 1. 解析 ──────────────────────────────────────────────────────────────────
check('session 地址往返（相对路径）', () => {
  const address = sessionFileAddress('s1', 'src/client.ts')
  assert.equal(address, 'dsh-resource://file/session/s1/src/client.ts')
  assert.deepEqual(parseSessionFileAddress(address), { sessionId: 's1', path: 'src/client.ts' })
})

check('路径与会话 id 逐段编码后仍可解析（空格 / 中文 / # ?）', () => {
  const address = sessionFileAddress('s 1', 'a b/中文#1?.md')
  const parsed = parseSessionFileAddress(address)
  assert.deepEqual(parsed, { sessionId: 's 1', path: 'a b/中文#1?.md' })
})

check('反斜杠归一化 + 去掉前导 ./', () => {
  assert.equal(
    sessionFileAddress('s1', '.\\src\\a.ts'),
    'dsh-resource://file/session/s1/src/a.ts',
  )
})

check('Windows 盘符保留 `:` 字面量', () => {
  const address = sessionFileAddress('s1', 'C:/work/a.ts')
  assert.equal(address, 'dsh-resource://file/session/s1/C:/work/a.ts')
  assert.deepEqual(parseSessionFileAddress(address), { sessionId: 's1', path: 'C:/work/a.ts' })
})

check('非 file 地址 / absolute 作用域 / 缺路径 → undefined（不由本编辑器认领）', () => {
  assert.equal(parseSessionFileAddress('sidebar://guide'), undefined)
  assert.equal(parseSessionFileAddress('dsh-resource://file/absolute/C:/a.ts'), undefined)
  assert.equal(parseSessionFileAddress('dsh-resource://file/session/s1'), undefined)
  assert.equal(parseSessionFileAddress('dsh-resource://file/session//a.ts'), undefined)
})

check('工作区根本身（尾斜杠地址）解析出空 path —— 由 canOpen 的空 path 守卫否决', () => {
  // 与上游 parseFileAddress 语义一致：段落存在但为空串。
  assert.deepEqual(parseSessionFileAddress('dsh-resource://file/session/s1/'), {
    sessionId: 's1',
    path: '',
  })
})

check('查询串 / 片段被忽略', () => {
  assert.deepEqual(
    parseSessionFileAddress('dsh-resource://file/session/s1/a.ts?x=1#L2'),
    { sessionId: 's1', path: 'a.ts' },
  )
})

check('非法百分号编码 → undefined（不抛错）', () => {
  assert.equal(parseSessionFileAddress('dsh-resource://file/session/s1/%E0%A4%A'), undefined)
})

// ── 2. 构造 ──────────────────────────────────────────────────────────────────
check('isAbsolutePath：POSIX / 盘符 / UNC', () => {
  assert.equal(isAbsolutePath('/home/a'), true)
  assert.equal(isAbsolutePath('C:\\work\\a'), true)
  assert.equal(isAbsolutePath('C:/work/a'), true)
  assert.equal(isAbsolutePath('\\\\srv\\share\\a'), true)
  assert.equal(isAbsolutePath('src/a.ts'), false)
  assert.equal(isAbsolutePath('./src/a.ts'), false)
})

check('工作区内绝对路径折叠成工作区相对地址', () => {
  assert.equal(
    fileAddressFor('s1', 'C:\\work', 'C:\\work\\src\\a.ts'),
    'dsh-resource://file/session/s1/src/a.ts',
  )
  // 工作区根带尾斜杠也照样折叠
  assert.equal(
    fileAddressFor('s1', '/home/me/proj/', '/home/me/proj/a/b.md'),
    'dsh-resource://file/session/s1/a/b.md',
  )
})

check('工作区外绝对路径保持绝对（仍在 session 地址里）', () => {
  assert.deepEqual(
    parseSessionFileAddress(fileAddressFor('s1', '/home/me/proj', '/etc/hosts')),
    { sessionId: 's1', path: '/etc/hosts' },
  )
})

check('相对路径原样（cwd 未知时也不丢路径）', () => {
  assert.equal(
    fileAddressFor('s1', undefined, 'src/a.ts'),
    'dsh-resource://file/session/s1/src/a.ts',
  )
})

// ── 3. 接管域（canOpen 的核心谓词） ──────────────────────────────────────────
check('文本类（代码 / Markdown / HTML / 无扩展名）由本编辑器接管', () => {
  for (const path of [
    'src/client.ts', 'a.tsx', 'a.js', 'a.json', 'README.md', 'a.markdown',
    'a.html', 'a.htm', 'a.css', 'a.yml', 'a.toml', 'a.sql', 'a.sh',
    'Dockerfile', 'LICENSE', 'a.txt', 'a.log', 'a.diff', 'dir/无扩展名',
  ]) {
    assert.equal(isTextFile(path), true, `${path} 应被接管`)
  }
})

check('图片 / PDF 交回内置预览器', () => {
  for (const path of [
    'a.png', 'a.jpg', 'a.JPEG', 'a.gif', 'a.webp', 'a.bmp', 'a.ico', 'a.svg', 'a.pdf',
    'dir/图片.PNG',
  ]) {
    assert.equal(isTextFile(path), false, `${path} 不应被接管`)
  }
})

check('canOpen 谓词：可解析 session 地址 && path 非空 && 文本', () => {
  const canOpen = (address) => {
    const ref = parseSessionFileAddress(address)
    return ref !== undefined && ref.path !== '' && isTextFile(ref.path)
  }
  assert.equal(canOpen('dsh-resource://file/session/s1/src/a.ts'), true)
  assert.equal(canOpen('dsh-resource://file/session/s1/a.png'), false)
  assert.equal(canOpen('dsh-resource://file/session/s1/a.pdf'), false)
  assert.equal(canOpen('dsh-resource://file/absolute/C:/a.ts'), false)
  assert.equal(canOpen('dsh-resource://file/session/s1/'), false)
})

console.log(`\n${passed} checks passed`)
