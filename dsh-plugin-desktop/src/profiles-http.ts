/** Loopback HTTP surface for the desktop profile card. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loopbackRestPath, readLoopbackJson, writeLoopbackJson } from './loopback-json.ts'

/** Loopback prefix owned by `desktop-profiles`. */
export const PROFILES_HTTP_PREFIX = '/api/desktop-profiles'

/** One profile row on the settings page. */
export interface ProfileRow {
  readonly name: string
  readonly label: string
  readonly selectable: boolean
  readonly current: boolean
}

/** Snapshot consumed by Settings → Desktop. */
export interface ProfilesStatusPayload {
  readonly current: string
  readonly profiles: readonly ProfileRow[]
}

/** Host-side actions used by the profile card. */
export interface ProfilesHttpController {
  snapshot(): ProfilesStatusPayload
  select(name: string): Promise<ProfilesStatusPayload>
}

/**
 * Dispatch one same-origin profiles API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live profile controller.
 */
export async function dispatchProfilesHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: ProfilesHttpController,
): Promise<void> {
  try {
    const rest = loopbackRestPath(req.url, PROFILES_HTTP_PREFIX)
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      writeLoopbackJson(res, 200, controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/select') {
      const body = await readLoopbackJson(req)
      const name = typeof body.name === 'string' ? body.name : ''
      if (name.trim() === '') {
        writeLoopbackJson(res, 400, { error: 'name is required' })
        return
      }
      writeLoopbackJson(res, 200, await controller.select(name))
      return
    }
    writeLoopbackJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    writeLoopbackJson(res, 500, { error: message })
  }
}
