/** Cordis Host surface for Settings → 插件开关. */

import { open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  dispatchPluginTogglesHttp,
  PLUGIN_TOGGLES_HTTP_PREFIX,
  type PluginToggleRow,
  type PluginTogglesSnapshot,
} from './plugin-toggles-http.ts'
import { applyPluginDisabledPatch } from './plugin-toggles-patch.ts'
import { pluginToggleLockReason } from './plugin-toggles-policy.ts'
import type {} from './profile-service.ts'
import type {} from './runtime.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-plugin-toggles'

/** Native restart, active profile directory, and the loopback Web carrier. */
export const inject = ['desktopRuntime', 'desktopProfiles', 'webServer']

/** Profile-owned overlay written by the Settings switches. */
export const USER_PLUGIN_PATCH = 'cordis.patch.yml'

/** Compact a module specifier for the Settings list. */
export function pluginToggleTitle(moduleName: string): string {
  const unscoped = moduleName.startsWith('@')
    ? moduleName.slice(moduleName.indexOf('/') + 1)
    : moduleName
  return unscoped
    .replace(/^cordis:/u, '')
    .replace(/^cordis-plugin-/u, '')
    .replace(/^dsh-(?:host-|client-)?/u, '')
}

/**
 * Project live Loader rows into the Settings toggle list.
 * @param ctx - Host context whose Loader already mounted the desktop tree.
 */
export function snapshotPluginToggles(ctx: Context): PluginTogglesSnapshot {
  const entries: PluginToggleRow[] = []
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    const lockReason = pluginToggleLockReason(entry.id, entry.options.name)
    entries.push({
      entryId: entry.id,
      moduleName: entry.options.name,
      title: pluginToggleTitle(entry.options.name),
      enabled: !entry.disabled,
      locked: lockReason !== null,
      lockReason,
    })
  }
  return { entries }
}

/**
 * Write `disabled` for one Loader id into the profile user overlay.
 * @param profileDir - absolute directory of the active desktop profile.
 * @param entryId - stable Loader identity.
 * @param enabled - desired Settings switch value.
 */
export async function persistPluginToggle(
  profileDir: string,
  entryId: string,
  enabled: boolean,
): Promise<void> {
  const path = join(profileDir, USER_PLUGIN_PATCH)
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch (cause) {
    if (!isEnoent(cause)) throw cause
  }
  const next = applyPluginDisabledPatch(text, entryId, !enabled)
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(next, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function isEnoent(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && (cause as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Apply one Settings toggle and keep the process running so the user can confirm restart.
 * @param ctx - Host context owning the live Loader and profile directory.
 * @param entryId - stable Loader identity.
 * @param enabled - desired Settings switch value.
 */
export async function setPluginToggleEnabled(
  ctx: Context,
  entryId: string,
  enabled: boolean,
): Promise<PluginTogglesSnapshot> {
  const current = snapshotPluginToggles(ctx)
  const row = current.entries.find(entry => entry.entryId === entryId)
  if (row === undefined) {
    throw new Error(`unknown plugin ${entryId}`)
  }
  if (row.locked) {
    throw new Error(row.lockReason ?? 'keeping this row enabled is required for Desktop Settings')
  }
  if (row.enabled === enabled) return { ...current, restartRequired: false }
  await persistPluginToggle(ctx.desktopProfiles.current.dir, entryId, enabled)
  return {
    restartRequired: true,
    entries: current.entries.map(entry => (
      entry.entryId === entryId ? { ...entry, enabled } : entry
    )),
  }
}

/**
 * Register the loopback Settings API for plugin enable/disable switches.
 * @param ctx - Host context carrying the Electron adapter and Web carrier.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const unregisterHttp = ctx.webServer.register({
      kind: 'prefix',
      path: PLUGIN_TOGGLES_HTTP_PREFIX,
      handler: (req, res) => {
        void dispatchPluginTogglesHttp(req, res, {
          snapshot: () => snapshotPluginToggles(ctx),
          setEnabled: (entryId, enabled) => setPluginToggleEnabled(ctx, entryId, enabled),
          requestRestart: () => ctx.desktopRuntime.requestRestart(),
        })
      },
    })
    return () => { unregisterHttp() }
  }, 'dsh-plugin-desktop: plugin toggles HTTP')
}
