#!/usr/bin/env node
// 通过本机代理取一个 http(s) 页面，供主机侧工具（web_fetch / web_search）到不了的目标使用。
// 只做 GET，最多跟随 3 次重定向，正文默认写 stdout（--out 写文件）。
// TLS 记录层失败（实测：经本机代理访问部分目标时 TLS 1.3 会报 bad record mac，1.2 正常）时，
// 自动用 TLS 1.2 重试一次，并在 stderr 说明；其余错误不降级。
//
// 用法: node proxy-fetch.mjs <url> [--proxy <url>] [--out <file>] [--timeout <ms>] [--max-bytes <n>]
//
// 退出码：取到响应（含 4xx/5xx）为 0；代理、SOCKS5、TLS 或超时失败为 1；用法错误为 2。

import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import fs from 'node:fs';

const DEFAULT_PROXY = 'http://127.0.0.1:10809';
const MAX_REDIRECTS = 3;
const MAX_HOST_BYTES = 255;
const TLS_RECORD_FAILURE = /BAD_RECORD_MAC|DECRYPTION_FAILED|bad record mac|unexpected message/i;

const USAGE = `用法: node proxy-fetch.mjs <url> [--proxy <url>] [--out <file>] [--timeout <ms>] [--max-bytes <n>]

  --proxy    http:// 或 socks5:// 代理，默认 ${DEFAULT_PROXY}
  --out      正文写入该文件；省略则写 stdout
  --timeout  无数据等待上限，默认 30000 ms
  --max-bytes 正文上限，默认 5000000 字节，超出即截断并关闭连接

状态行、最终 URL、字节数写 stderr；正文写 --out 或 stdout。`;

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function die(message, code = 1) {
  process.stderr.write(`proxy-fetch: ${oneLine(message)}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { proxy: DEFAULT_PROXY, timeoutMs: 30_000, maxBytes: 5_000_000, out: null, url: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--proxy') opts.proxy = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--timeout') opts.timeoutMs = Number(argv[++i]);
    else if (arg === '--max-bytes') opts.maxBytes = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') { process.stdout.write(`${USAGE}\n`); process.exit(0); }
    else if (arg.startsWith('--')) die(`未知选项 ${arg}`, 2);
    else if (opts.url === null) opts.url = arg;
    else die('只支持一个 URL', 2);
  }
  if (opts.url === null) die('缺少 <url>', 2);
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) die('--timeout 必须是正数（毫秒）', 2);
  if (!Number.isFinite(opts.maxBytes) || opts.maxBytes <= 0) die('--max-bytes 必须是正数', 2);
  try {
    opts.target = new URL(opts.url);
  } catch {
    die(`URL 无法解析: ${opts.url}`, 2);
  }
  if (opts.target.protocol !== 'http:' && opts.target.protocol !== 'https:') die('只支持 http/https URL', 2);
  try {
    opts.proxyUrl = new URL(opts.proxy);
  } catch {
    die(`代理地址无法解析: ${opts.proxy}`, 2);
  }
  const scheme = opts.proxyUrl.protocol;
  if (scheme !== 'http:' && scheme !== 'socks5:' && scheme !== 'socks5h:') {
    die(`不支持的代理协议 ${scheme}，请用 http:// 或 socks5://`, 2);
  }
  return opts;
}

function portOf(url) {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

// readExactly 只从 socket 的内部缓冲取走 n 字节，绝不预读，因此握手之后仍在缓冲里的字节会原样交给 TLS。
function readExactly(socket, count, timeoutMs) {
  socket.pause();
  return new Promise((resolve, reject) => {
    const finish = (err, value) => {
      clearTimeout(timer);
      socket.off('readable', onReadable);
      socket.off('end', onEnd);
      socket.off('error', onError);
      if (err) reject(err);
      else resolve(value);
    };
    const pump = () => {
      const chunk = socket.read(count);
      if (chunk !== null) finish(null, chunk);
    };
    const onReadable = () => pump();
    const onEnd = () => finish(new Error('代理在握手完成前关闭了连接'));
    const onError = (err) => finish(err);
    const timer = setTimeout(() => finish(new Error(`等待代理响应超时（${timeoutMs} ms）`)), timeoutMs);
    socket.on('readable', onReadable);
    socket.on('end', onEnd);
    socket.on('error', onError);
    pump();
  });
}

function connectSocket(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);
    const finish = (err) => {
      clearTimeout(timer);
      if (err) { socket.destroy(); reject(err); }
      else resolve(socket);
    };
    const timer = setTimeout(() => finish(new Error(`连接 ${host}:${port} 超时（${timeoutMs} ms）`)), timeoutMs);
    socket.once('connect', () => finish());
    socket.once('error', (err) => finish(new Error(`${host}:${port} ${err.code || err.message}`)));
  });
}

function httpConnect(proxyUrl, host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const authority = `${host}:${port}`;
    const req = http.request({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port) || 80,
      method: 'CONNECT',
      path: authority,
      headers: { Host: authority, 'Proxy-Connection': 'keep-alive' },
    });
    const fail = (err) => { req.destroy(); reject(err); };
    req.setTimeout(timeoutMs, () => fail(new Error(`代理 ${proxyUrl.host} 响应超时（${timeoutMs} ms）`)));
    req.once('error', (err) => reject(new Error(`代理 ${proxyUrl.host} ${err.code || err.message}`)));
    req.once('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理拒绝 CONNECT ${authority}：${res.statusCode} ${res.statusMessage || ''}`.trim()));
        return;
      }
      if (head && head.length > 0) socket.unshift(head);
      socket.setNoDelay(true);
      resolve(socket);
    });
    req.end();
  });
}

async function socksConnect(proxyUrl, host, port, timeoutMs) {
  const socket = await connectSocket(proxyUrl.hostname, Number(proxyUrl.port) || 1080, timeoutMs);
  try {
    socket.write(Buffer.from([0x05, 0x01, 0x00]));
    const greeting = await readExactly(socket, 2, timeoutMs);
    if (greeting[0] !== 0x05 || greeting[1] !== 0x00) {
      throw new Error(`SOCKS5 握手被拒（版本 ${greeting[0]}，方法 ${greeting[1]}）：代理要求认证`);
    }
    const hostBytes = Buffer.from(host, 'utf8');
    if (hostBytes.length > MAX_HOST_BYTES) throw new Error('主机名过长');
    socket.write(Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBytes.length]),
      hostBytes,
      Buffer.from([port >> 8, port & 0xff]),
    ]));
    const reply = await readExactly(socket, 4, timeoutMs);
    if (reply[1] !== 0x00) throw new Error(`SOCKS5 CONNECT ${host}:${port} 失败（reply=${reply[1]}）`);
    const atyp = reply[3];
    if (atyp === 0x01) await readExactly(socket, 6, timeoutMs);
    else if (atyp === 0x04) await readExactly(socket, 18, timeoutMs);
    else if (atyp === 0x03) {
      const [length] = await readExactly(socket, 1, timeoutMs);
      await readExactly(socket, length + 2, timeoutMs);
    } else throw new Error(`SOCKS5 未知地址类型 ${atyp}`);
    return socket;
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

async function openTunnel(opts, host, port) {
  const proxyUrl = opts.proxyUrl;
  if (proxyUrl.protocol === 'http:') return httpConnect(proxyUrl, host, port, opts.timeoutMs);
  return socksConnect(proxyUrl, host, port, opts.timeoutMs);
}

function wrapTls(socket, host, port, timeoutMs, forceTls12) {
  return new Promise((resolve, reject) => {
    const options = { socket };
    if (net.isIP(host) === 0) options.servername = host;
    if (forceTls12) {
      options.minVersion = 'TLSv1.2';
      options.maxVersion = 'TLSv1.2';
    }
    const secure = tls.connect(options, () => {
      secure.setNoDelay(true);
      resolve(secure);
    });
    secure.once('error', (err) => {
      secure.destroy();
      const failure = new Error(`TLS 握手失败（${host}:${port}）：${err.code || err.message}`);
      failure.code = err.code;
      reject(failure);
    });
    secure.setTimeout(timeoutMs, () => secure.destroy(new Error(`TLS 握手超时（${timeoutMs} ms）`)));
  });
}

function dechunk(buffer) {
  const parts = [];
  let pos = 0;
  for (;;) {
    const eol = buffer.indexOf('\r\n', pos);
    if (eol < 0) break;
    const size = Number.parseInt(buffer.subarray(pos, eol).toString('latin1').split(';')[0].trim(), 16);
    if (!Number.isFinite(size) || size < 0) break;
    pos = eol + 2;
    if (size === 0) break;
    parts.push(buffer.subarray(pos, pos + size));
    pos += size + 2;
  }
  return Buffer.concat(parts);
}

function requestOnce(socket, url, opts) {
  const head = [
    `GET ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    'User-Agent: dsh-proxy-fetch/1.0',
    'Accept: */*',
    'Accept-Encoding: identity',
    'Connection: close',
    '',
    '',
  ].join('\r\n');
  const chunks = [];
  let total = 0;
  let truncated = false;
  const settled = new Promise((resolve, reject) => {
    const finish = (err) => {
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.setTimeout(0);
      if (err && !truncated) reject(err);
      else resolve();
    };
    const onData = (chunk) => {
      if (truncated) return;
      chunks.push(chunk);
      total += chunk.length;
      if (total >= opts.maxBytes) {
        truncated = true;
        socket.destroy();
      }
    };
    const onEnd = () => finish();
    const onError = (err) => {
      const failure = new Error(`${err.code ? `${err.code} ` : ''}${err.message}`);
      failure.code = err.code;
      finish(failure);
    };
    const onClose = () => finish();
    socket.on('data', onData);
    socket.on('end', onEnd);
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.setTimeout(opts.timeoutMs, () => socket.destroy(new Error(`读取响应超时（${opts.timeoutMs} ms 无数据）`)));
  });
  socket.write(head, 'latin1');
  return settled.then(() => {
    const raw = Buffer.concat(chunks);
    const sep = raw.indexOf('\r\n\r\n');
    if (sep < 0) throw new Error('代理返回的不是完整 HTTP 响应');
    const lines = raw.subarray(0, sep).toString('latin1').split('\r\n');
    const statusLine = lines.shift();
    const match = /^HTTP\/1\.[01] (\d{3})/.exec(statusLine);
    if (!match) throw new Error(`无法解析状态行：${statusLine}`);
    const headers = new Map();
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
    let body = raw.subarray(sep + 4);
    if ((headers.get('transfer-encoding') || '').toLowerCase().includes('chunked')) body = dechunk(body);
    return { status: Number(match[1]), statusLine, headers, body, truncated };
  });
}

async function fetchThrough(url, opts, hops) {
  const host = url.hostname;
  const port = portOf(url);
  let socket = await openTunnel(opts, host, port);
  try {
    if (url.protocol === 'https:') socket = await wrapTls(socket, host, port, opts.timeoutMs, opts.tls12 === true);
    const response = await requestOnce(socket, url, opts);
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location && hops < MAX_REDIRECTS) {
      socket.destroy();
      return fetchWithProxy(new URL(location, url), opts, hops + 1);
    }
    response.url = url.href;
    socket.destroy();
    return response;
  } catch (err) {
    socket.destroy();
    throw err;
  }
}

async function fetchWithProxy(url, opts, hops = 0) {
  try {
    return await fetchThrough(url, opts, hops);
  } catch (err) {
    const message = String(err.message);
    if (opts.tls12 !== true && TLS_RECORD_FAILURE.test(`${err.code || ''} ${message}`)) {
      process.stderr.write(`proxy-fetch: TLS 1.3 记录层失败（${err.code || oneLine(message)}），用 TLS 1.2 重试一次\n`);
      return fetchThrough(url, { ...opts, tls12: true }, hops);
    }
    throw err;
  }
}

const opts = parseArgs(process.argv.slice(2));
try {
  const response = await fetchWithProxy(opts.target, opts);
  if (opts.out) fs.writeFileSync(opts.out, response.body);
  else process.stdout.write(response.body);
  process.stderr.write(
    `proxy-fetch: ${response.statusLine} 正文 ${response.body.length} 字节`
    + `${response.truncated ? `（已达 --max-bytes ${opts.maxBytes}，正文可能不完整）` : ''}`
    + ` ${response.url} via ${opts.proxy}${opts.out ? ` -> ${opts.out}` : ''}\n`,
  );
} catch (err) {
  die(`${err.message}（代理 ${opts.proxy}）`);
}
