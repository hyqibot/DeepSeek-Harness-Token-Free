/** Loopback HTTP surface for shell mode on the Desktop settings page. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loopbackRestPath, readLoopbackJson, writeLoopbackJson } from './loopback-json.ts'
import type { DesktopShellMode } from './runtime.ts'

/** Loopback prefix owned by `desktop-shell`. */
export const SHELL_HTTP_PREFIX = '/api/desktop-shell'

/** Snapshot consumed by Settings → Desktop. */
export interface ShellStatusPayload {
  readonly mode: DesktopShellMode
  readonly platform: 'darwin' | 'win32' | 'linux'
  readonly advancedSupported: boolean
}

/** Host-side actions used by the mode card. */
export interface ShellHttpController {
  snapshot(): ShellStatusPayload
  setMode(mode: DesktopShellMode): Promise<ShellStatusPayload>
}

/**
 * Dispatch one same-origin shell API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live shell controller.
 */
export async function dispatchShellHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: ShellHttpController,
): Promise<void> {
  try {
    const rest = loopbackRestPath(req.url, SHELL_HTTP_PREFIX)
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      writeLoopbackJson(res, 200, controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/mode') {
      const body = await readLoopbackJson(req)
      const mode = body.mode
      if (mode !== 'compatibility' && mode !== 'advanced') {
        writeLoopbackJson(res, 400, { error: 'mode must be compatibility or advanced' })
        return
      }
      writeLoopbackJson(res, 200, await controller.setMode(mode))
      return
    }
    writeLoopbackJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    writeLoopbackJson(res, 500, { error: message })
  }
}
