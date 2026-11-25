/**
 * 走真实网络的测试小工具：找可执行文件、要空闲端口、起本机 HTTP 服务、
 * 通过 SOCKS 代理发请求。
 */

import { execFile as execFileCallback } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/**
 * 在 PATH 上找可执行文件。
 * @param name - 命令名。
 * @returns 绝对路径；找不到返回 null。`XRAY_BIN` 可强制覆盖 xray 的位置。
 */
export function findOnPath(name) {
  if (name === 'xray' && process.env.XRAY_BIN !== undefined && process.env.XRAY_BIN !== '') return process.env.XRAY_BIN
  for (const directory of (process.env.PATH ?? '').split(':')) {
    if (directory === '') continue
    const candidate = join(directory, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * 取 N 个互不相同的空闲回环端口。
 * @param count - 需要的端口数。
 */
export async function freePorts(count) {
  const ports = new Set()
  const servers = []
  try {
    while (ports.size < count) {
      const server = createNetServer()
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      ports.add(server.address().port)
      servers.push(server)
    }
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  }
  return [...ports]
}

/**
 * 起一个只回固定文本的本机 HTTP 服务。
 * @param body - 响应体。
 * @returns 端口与关闭函数。
 */
export async function echoServer(body) {
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { connection: 'close' })
    response.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/**
 * 通过 SOCKS 代理请求本机 HTTP 服务。
 * @param socksPort - 代理的 SOCKS 端口。
 * @param targetPort - 本机 HTTP 服务的端口。
 * @returns 响应体。
 */
export async function curlThroughSocks(socksPort, targetPort) {
  const result = await execFile(
    'curl',
    ['-m', '6', '-sS', '--socks5-hostname', `127.0.0.1:${socksPort}`, `http://127.0.0.1:${targetPort}/`],
    { encoding: 'utf8' },
  )
  return result.stdout
}
