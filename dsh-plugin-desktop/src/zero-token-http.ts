/** Loopback HTTP surface for the Zero Token settings page. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DeepseekToolMode } from './zero-token-models.ts'
import {
  ZERO_TOKEN_HTTP_PREFIX,
  normalizeDeepseekToolMode,
  onboardModeForCanonicalModelId,
  parseEnsureChromeDebugRequest,
} from './zero-token-models.ts'
import type { GatewayLicenseStatus, ZeroTokenListenStatus, ZeroTokenStatusPayload } from './zero-token-status.ts'

/** Host-side actions used by the settings page. */
export interface ZeroTokenHttpController {
  snapshot(): ZeroTokenStatusPayload
  start(): Promise<ZeroTokenListenStatus>
  stop(): Promise<ZeroTokenListenStatus>
  stopKeepalive(): Promise<void>
  activate(activationCode: string): Promise<GatewayLicenseStatus>
  logout(): Promise<GatewayLicenseStatus>
  setDeepseekToolMode(mode: DeepseekToolMode): Promise<{ deepseekToolMode: DeepseekToolMode; restartRequired: boolean }>
  setInsecureTls(enabled: boolean): Promise<{ insecureTls: boolean; restartRequired: boolean }>
  setDefault(): Promise<{ defaultRoute: boolean }>
  authorize(
    modelId: string,
    onEvent: (event: Record<string, unknown>) => void,
  ): Promise<void>
  ensureChromeDebug(urls: string[]): Promise<{
    urls: string[]
    output: string
    result?: unknown
  }>
}

/**
 * Dispatch one same-origin Zero Token API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live gateway controller.
 */
export async function dispatchZeroTokenHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: ZeroTokenHttpController,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const rest = url.pathname.slice(ZERO_TOKEN_HTTP_PREFIX.length).replace(/\/+$/u, '') || '/'
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      json(res, 200, controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/start') {
      const status = await controller.start()
      json(res, 200, { status })
      return
    }
    if (method === 'POST' && rest === '/stop') {
      const status = await controller.stop()
      json(res, 200, { status })
      return
    }
    if (method === 'POST' && rest === '/stop-keepalive') {
      await controller.stopKeepalive()
      json(res, 200, { ok: true })
      return
    }
    if (method === 'POST' && rest === '/activate') {
      const body = await readJson(req)
      const activationCode = typeof body.activationCode === 'string' ? body.activationCode : ''
      const license = await controller.activate(activationCode)
      json(res, 200, { license })
      return
    }
    if (method === 'POST' && (rest === '/logout' || rest === '/logout-license')) {
      const license = await controller.logout()
      json(res, 200, { license })
      return
    }
    if ((method === 'POST' || method === 'PUT') && rest === '/deepseek-tool-mode') {
      const body = await readJson(req)
      const raw = typeof body.mode === 'string'
        ? body.mode
        : typeof body.deepseekToolMode === 'string' ? body.deepseekToolMode : 'xml'
      const result = await controller.setDeepseekToolMode(normalizeDeepseekToolMode(raw))
      json(res, 200, result)
      return
    }
    if ((method === 'POST' || method === 'PUT') && rest === '/insecure-tls') {
      const body = await readJson(req)
      const raw = body.insecureTls ?? body.enabled
      if (typeof raw !== 'boolean') {
        json(res, 400, { error: 'insecureTls must be a boolean' })
        return
      }
      const result = await controller.setInsecureTls(raw)
      json(res, 200, result)
      return
    }
    if (method === 'POST' && rest === '/set-default') {
      const result = await controller.setDefault()
      json(res, 200, result)
      return
    }
    if (method === 'POST' && rest === '/authorize') {
      const body = await readJson(req)
      const modelId = typeof body.modelId === 'string' ? body.modelId : 'deepseek-chat'
      if (onboardModeForCanonicalModelId(modelId) === null) {
        json(res, 400, { error: `unknown Zero Token model: ${modelId}` })
        return
      }
      const accept = String(req.headers.accept ?? '')
      const stream = accept.includes('application/x-ndjson')
      if (stream) {
        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
        })
        await controller.authorize(modelId, event => {
          res.write(`${JSON.stringify(event)}\n`)
        })
        res.end()
        return
      }
      let complete: Record<string, unknown> | undefined
      let errorMessage: string | undefined
      await controller.authorize(modelId, event => {
        if (event.type === 'complete' && event.result !== undefined && typeof event.result === 'object') {
          complete = event.result as Record<string, unknown>
        }
        if (event.type === 'error' && typeof event.message === 'string') {
          errorMessage = event.message
        }
      })
      if (errorMessage !== undefined) {
        json(res, 500, { error: errorMessage })
        return
      }
      json(res, 200, complete ?? { modelId })
      return
    }
    if (method === 'POST' && rest === '/ensure-chrome-debug') {
      const body = await readJson(req)
      const urls = parseEnsureChromeDebugRequest(body)
      if (urls === null) {
        json(res, 400, {
          error: 'Provide modelId (canonical web model) or non-empty urls[] for ensure_chrome_debug',
        })
        return
      }
      const result = await controller.ensureChromeDebug(urls)
      json(res, 200, result)
      return
    }
    json(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    json(res, 500, { error: message })
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object')
  }
  return parsed as Record<string, unknown>
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  })
  res.end(payload)
}
