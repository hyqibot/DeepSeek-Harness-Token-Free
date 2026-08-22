/** Loopback HTTP surface for the LAN mobile remote-control card. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loopbackRestPath, readLoopbackJson, writeLoopbackJson } from './loopback-json.ts'

/** Loopback prefix owned by `desktop-mobile`. */
export const MOBILE_HTTP_PREFIX = '/api/desktop-mobile'

/** Snapshot consumed by Settings → Channels (mobile card). */
export interface MobileStatusPayload {
  readonly enabled: boolean
  readonly status: string
  readonly url: string | null
  readonly qrDataUrl: string | null
  readonly port: number | null
}

/** Host-side actions used by the mobile card. */
export interface MobileHttpController {
  snapshot(): Promise<MobileStatusPayload>
  setEnabled(enabled: boolean): Promise<MobileStatusPayload>
  showUrl(): Promise<MobileStatusPayload>
}

/**
 * Dispatch one same-origin mobile API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live mobile controller.
 */
export async function dispatchMobileHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: MobileHttpController,
): Promise<void> {
  try {
    const rest = loopbackRestPath(req.url, MOBILE_HTTP_PREFIX)
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      writeLoopbackJson(res, 200, await controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/url') {
      writeLoopbackJson(res, 200, await controller.showUrl())
      return
    }
    if ((method === 'POST' || method === 'PUT') && rest === '/enabled') {
      const body = await readLoopbackJson(req)
      const raw = body.enabled
      if (typeof raw !== 'boolean') {
        writeLoopbackJson(res, 400, { error: 'enabled must be a boolean' })
        return
      }
      writeLoopbackJson(res, 200, await controller.setEnabled(raw))
      return
    }
    writeLoopbackJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    writeLoopbackJson(res, 500, { error: message })
  }
}
