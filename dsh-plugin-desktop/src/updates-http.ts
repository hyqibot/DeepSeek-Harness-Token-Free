/** Loopback HTTP surface for the desktop update card. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loopbackRestPath, writeLoopbackJson } from './loopback-json.ts'

/** Loopback prefix owned by `desktop-updates`. */
export const UPDATES_HTTP_PREFIX = '/api/desktop-updates'

/** Snapshot consumed by Settings → Desktop. */
export interface UpdatesStatusPayload {
  readonly currentVersion: string
  readonly checking: boolean
  readonly availableVersion: string | null
  readonly downloadingVersion: string | null
  readonly canDownload: boolean
  readonly isPackaged: boolean
  readonly label: string
  readonly lastResult: 'idle' | 'up-to-date' | 'available' | 'unavailable'
}

/** Host-side actions used by the update card. */
export interface UpdatesHttpController {
  snapshot(): UpdatesStatusPayload
  check(): Promise<UpdatesStatusPayload>
  download(): Promise<UpdatesStatusPayload>
}

/**
 * Dispatch one same-origin updates API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live update controller.
 */
export async function dispatchUpdatesHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: UpdatesHttpController,
): Promise<void> {
  try {
    const rest = loopbackRestPath(req.url, UPDATES_HTTP_PREFIX)
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      writeLoopbackJson(res, 200, controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/check') {
      writeLoopbackJson(res, 200, await controller.check())
      return
    }
    if (method === 'POST' && rest === '/download') {
      writeLoopbackJson(res, 200, await controller.download())
      return
    }
    writeLoopbackJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    writeLoopbackJson(res, 500, { error: message })
  }
}
