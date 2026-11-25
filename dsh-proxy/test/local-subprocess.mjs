/**
 * 测试用的 `ctx.subprocess` 实现：真的启动子进程，但只实现插件用到的那一小部分
 * 契约（`resolveExecutable` / `spawn` + collect 输出 / `terminate` / `waitForExit`）。
 *
 * 这不是 DSH 的 provider；它让 `CoreManager` 在没有 DSH 运行时的测试里走真实进程，
 * 从而验证参数、环境变量、stdout/stderr 与退出码的处理。
 */

import { spawn as spawnChild } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

/** 一个只读、按字节偏移取数的 collect 输出读取器。 */
function readerFor(stream) {
  const chunks = []
  let length = 0
  stream.on('data', (chunk) => {
    chunks.push(chunk)
    length += chunk.length
  })
  return {
    readFrom(offset) {
      const buffer = Buffer.concat(chunks)
      const from = Number.isInteger(offset) && offset >= 0 ? offset : 0
      return { text: buffer.subarray(from).toString('utf8'), nextOffset: length, lossy: false }
    },
  }
}

/**
 * 构造一个本地子进程运行时，形状与 `@deepseek-ai/dsh-subprocess` 的抽象类一致。
 * @returns 可直接塞进替身 Context 的对象。
 */
export function localSubprocess() {
  return {
    async resolveExecutable(command, env) {
      if (command.includes('/') || command.includes('\\')) {
        accessSync(command, constants.X_OK)
        return command
      }
      const searchPath = env?.PATH ?? process.env.PATH ?? ''
      for (const directory of searchPath.split(delimiter)) {
        if (directory === '') continue
        const candidate = join(directory, command)
        try {
          accessSync(candidate, constants.X_OK)
          return candidate
        } catch {
          // 继续找下一个目录。
        }
      }
      throw new Error(`executable not found: ${command}`)
    },

    spawn(spec) {
      const env = { ...process.env }
      for (const [key, value] of Object.entries(spec.env ?? {})) {
        if (value === undefined) delete env[key]
        else env[key] = value
      }
      const child = spawnChild(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const stdout = readerFor(child.stdout)
      const stderr = readerFor(child.stderr)
      let closed = false
      const done = new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode, signal) => {
          closed = true
          resolve({ exitCode, signal })
        })
      })
      // 没人 await 时不要让未处理的拒绝炸掉进程；调用方仍会看到 done。
      done.catch(() => {})

      let killTimer
      const handle = {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: { stdout, stderr },
        done,
        terminate() {
          if (closed) return
          child.kill('SIGTERM')
          killTimer = setTimeout(() => {
            if (!closed) child.kill('SIGKILL')
          }, spec.graceMs)
          killTimer.unref?.()
        },
        async waitForExit(signal) {
          if (closed) return true
          if (signal?.aborted === true) return false
          return await new Promise((resolve) => {
            const abort = () => resolve(false)
            signal?.addEventListener('abort', abort, { once: true })
            void done.then(
              () => {
                signal?.removeEventListener('abort', abort)
                resolve(true)
              },
              () => {
                signal?.removeEventListener('abort', abort)
                resolve(true)
              },
            )
          })
        },
      }
      return handle
    },

    async terminalEnvironment() {
      return { platform: process.platform === 'win32' ? 'windows' : 'posix' }
    },

    async spawnTerminal() {
      throw new Error('测试替身不支持终端')
    },
  }
}
