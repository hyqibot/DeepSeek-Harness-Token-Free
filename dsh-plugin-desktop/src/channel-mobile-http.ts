/** LAN HTTP remote-control API and PWA for DSH Desktop. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import type { DesktopChannels } from './channel-service.ts'
import { isPrivateRemoteAddress } from './channel-lan.ts'

/** Options for one mobile listener. */
export interface MobileServerOptions {
  readonly port: number
  readonly host: string
  readonly channels: DesktopChannels
  readonly pagePath?: string
}

/** Running mobile listener. */
export interface MobileServer {
  readonly port: number
  close(): Promise<void>
}

const PACKAGE_ROOT = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

/**
 * Resolve the packaged PWA entry.
 */
export function mobilePagePath(): string {
  return join(PACKAGE_ROOT, 'mobile', 'index.html')
}

/**
 * Start the LAN remote-control listener.
 * @param options - bind address, port, and channel service.
 */
export async function startMobileServer(options: MobileServerOptions): Promise<MobileServer> {
  const pagePath = options.pagePath ?? mobilePagePath()
  const server = createServer((req, res) => {
    void handleMobileRequest(req, res, options.channels, pagePath)
  })
  await listen(server, options.port, options.host)
  const address = server.address()
  const port = address !== null && typeof address === 'object' ? address.port : options.port
  return {
    port,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
    }),
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function handleMobileRequest(
  req: IncomingMessage,
  res: ServerResponse,
  channels: DesktopChannels,
  pagePath: string,
): Promise<void> {
  try {
    if (!isPrivateRemoteAddress(req.socket.remoteAddress)) {
      json(res, 403, { error: 'mobile remote control only accepts private LAN addresses' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const html = await readFile(pagePath, 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    if (req.method === 'GET' && url.pathname === '/manifest.webmanifest') {
      json(res, 200, {
        name: 'DSH Desktop',
        short_name: 'DSH',
        display: 'standalone',
        start_url: '/',
        background_color: '#0b1220',
        theme_color: '#0b1220',
      })
      return
    }
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      json(res, 200, { ok: true })
      return
    }
    const bearer = await channels.ensureMobileBearer()
    if (!bearerMatches(req, url, bearer)) {
      json(res, 401, { error: 'missing or invalid mobile token' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/v1/status') {
      const pairing = channels.snapshot().pairing
      json(res, 200, {
        pairing: pairing === null || Date.now() > pairing.expiresAt ? null : pairing.code,
        paired: channels.snapshot().mobile.pairedUsers.length,
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/v1/pair') {
      const body = await readJson(req)
      const code = typeof body.code === 'string' ? body.code : ''
      const deviceId = typeof body.deviceId === 'string' && body.deviceId.length > 0
        ? body.deviceId
        : 'mobile'
      const displayName = typeof body.displayName === 'string' && body.displayName.length > 0
        ? body.displayName
        : 'Mobile'
      const reply = await dispatch(channels, deviceId, displayName, code)
      json(res, 200, { reply })
      return
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat') {
      const body = await readJson(req)
      const text = typeof body.text === 'string' ? body.text : ''
      const deviceId = typeof body.deviceId === 'string' && body.deviceId.length > 0
        ? body.deviceId
        : 'mobile'
      const displayName = typeof body.displayName === 'string' && body.displayName.length > 0
        ? body.displayName
        : 'Mobile'
      const reply = await dispatch(channels, deviceId, displayName, text)
      json(res, 200, { reply })
      return
    }
    json(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    json(res, 500, { error: message })
  }
}

function dispatch(
  channels: DesktopChannels,
  userId: string,
  displayName: string,
  text: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    channels.enqueue({
      platform: 'mobile',
      userId,
      displayName,
      text,
    }, async (reply) => { resolve(reply) })
    setTimeout(() => { reject(new Error('mobile dispatch timed out')) }, 10 * 60_000)
  })
}

function bearerMatches(req: IncomingMessage, url: URL, expected: string): boolean {
  const header = req.headers.authorization
  const fromHeader = typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
    ? header.slice(7).trim()
    : ''
  const fromQuery = url.searchParams.get('token') ?? ''
  const provided = fromHeader.length > 0 ? fromHeader : fromQuery
  if (provided.length === 0 || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('mobile JSON body must be an object')
  }
  return parsed as Record<string, unknown>
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.length,
  })
  res.end(payload)
}
