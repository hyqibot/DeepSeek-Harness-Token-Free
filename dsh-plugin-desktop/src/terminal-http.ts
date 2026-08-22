/** Loopback HTTP surface for the packaged terminal command. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loopbackRestPath, writeLoopbackJson } from './loopback-json.ts'

/** Loopback prefix owned by `desktop-terminal`. */
export const TERMINAL_HTTP_PREFIX = '/api/desktop-terminal'

/** Snapshot consumed by Settings → Desktop. */
export interface TerminalStatusPayload {
  readonly supported: boolean
}

/** Host-side actions used by the terminal card. */
export interface TerminalHttpController {
  snapshot(): TerminalStatusPayload
  open(): void
}

/**
 * Dispatch one same-origin terminal API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live terminal controller.
 */
export async function dispatchTerminalHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: TerminalHttpController,
): Promise<void> {
  try {
    const rest = loopbackRestPath(req.url, TERMINAL_HTTP_PREFIX)
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      writeLoopbackJson(res, 200, controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/open') {
      controller.open()
      writeLoopbackJson(res, 200, controller.snapshot())
      return
    }
    writeLoopbackJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    writeLoopbackJson(res, 500, { error: message })
  }
}
