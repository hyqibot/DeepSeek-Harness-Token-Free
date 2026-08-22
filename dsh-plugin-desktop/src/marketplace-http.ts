/** Loopback HTTP surface for the plugin marketplace card. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loopbackRestPath, readLoopbackJson, writeLoopbackJson } from './loopback-json.ts'
import type { MarketplacePlugin } from './marketplace-catalog.ts'

/** Loopback prefix owned by `desktop-marketplace`. */
export const MARKETPLACE_HTTP_PREFIX = '/api/desktop-marketplace'

/** Snapshot consumed by Settings → Desktop. */
export interface MarketplaceStatusPayload {
  readonly status: string
  readonly catalog: readonly MarketplacePlugin[]
}

/** Host-side actions used by the marketplace card. */
export interface MarketplaceHttpController {
  snapshot(): MarketplaceStatusPayload
  refresh(): Promise<MarketplaceStatusPayload>
  install(spec: string): Promise<MarketplaceStatusPayload>
}

/**
 * Dispatch one same-origin marketplace API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live marketplace controller.
 */
export async function dispatchMarketplaceHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: MarketplaceHttpController,
): Promise<void> {
  try {
    const rest = loopbackRestPath(req.url, MARKETPLACE_HTTP_PREFIX)
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      writeLoopbackJson(res, 200, controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/refresh') {
      writeLoopbackJson(res, 200, await controller.refresh())
      return
    }
    if (method === 'POST' && rest === '/install') {
      const body = await readLoopbackJson(req)
      const spec = typeof body.spec === 'string' ? body.spec : ''
      if (spec.trim() === '') {
        writeLoopbackJson(res, 400, { error: 'spec is required' })
        return
      }
      writeLoopbackJson(res, 200, await controller.install(spec))
      return
    }
    writeLoopbackJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    writeLoopbackJson(res, 500, { error: message })
  }
}
