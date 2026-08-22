/** Loopback HTTP surface for Settings → Plugins → 开关. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loopbackRestPath, readLoopbackJson, writeLoopbackJson } from './loopback-json.ts'

/** Loopback prefix owned by `desktop-plugin-toggles`. */
export const PLUGIN_TOGGLES_HTTP_PREFIX = '/api/desktop-plugin-toggles'

/** One non-group Loader row shown in the toggle tab. */
export interface PluginToggleRow {
  readonly entryId: string
  readonly moduleName: string
  readonly title: string
  readonly enabled: boolean
  readonly locked: boolean
  readonly lockReason: string | null
}

/** Snapshot consumed by the Settings tab. */
export interface PluginTogglesSnapshot {
  readonly entries: readonly PluginToggleRow[]
  readonly restartRequired?: boolean
}

/** Host-side actions used by the toggle tab. */
export interface PluginTogglesHttpController {
  snapshot(): PluginTogglesSnapshot
  setEnabled(entryId: string, enabled: boolean): Promise<PluginTogglesSnapshot>
  requestRestart(): Promise<void>
}

/**
 * Dispatch one same-origin plugin-toggle API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live toggle controller.
 */
export async function dispatchPluginTogglesHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: PluginTogglesHttpController,
): Promise<void> {
  try {
    const rest = loopbackRestPath(req.url, PLUGIN_TOGGLES_HTTP_PREFIX)
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      writeLoopbackJson(res, 200, controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/enabled') {
      const body = await readLoopbackJson(req)
      const entryId = typeof body.entryId === 'string' ? body.entryId.trim() : ''
      if (entryId === '') {
        writeLoopbackJson(res, 400, { error: 'entryId is required' })
        return
      }
      if (typeof body.enabled !== 'boolean') {
        writeLoopbackJson(res, 400, { error: 'enabled must be a boolean' })
        return
      }
      writeLoopbackJson(res, 200, await controller.setEnabled(entryId, body.enabled))
      return
    }
    if (method === 'POST' && rest === '/restart') {
      await controller.requestRestart()
      writeLoopbackJson(res, 200, { ok: true })
      return
    }
    writeLoopbackJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const status = /required for Desktop Settings|unknown plugin/u.test(message) ? 409 : 500
    writeLoopbackJson(res, status, { error: message })
  }
}
