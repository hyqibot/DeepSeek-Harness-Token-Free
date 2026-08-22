/** Cordis Host plugin: directory marketplace over `desktopPnpm.runPlugin`. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import {
  assertMarketplaceSpec,
  BUNDLED_MARKETPLACE_CATALOG,
  parseMarketplaceCatalog,
  type MarketplacePlugin,
} from './marketplace-catalog.ts'
import {
  dispatchMarketplaceHttp,
  MARKETPLACE_HTTP_PREFIX,
  type MarketplaceStatusPayload,
} from './marketplace-http.ts'
import type { Readable } from 'node:stream'
import type { DesktopPnpmHandle } from './pnpm.ts'
import type {} from './pnpm.ts'
import type {} from './profile-service.ts'
import type {} from './runtime.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-marketplace'

/** Package manager, profile, tray, and the loopback Web carrier. */
export const inject = ['desktopRuntime', 'desktopProfiles', 'desktopPnpm', 'settings', 'webServer']

/** Settings namespace for catalog URL and ad-hoc installs. */
export const MARKETPLACE_SETTINGS_NAMESPACE = settingsNamespace('dsh-desktop-marketplace')

/** User-editable marketplace settings. */
export interface MarketplaceSettings {
  /** Optional HTTPS catalog JSON URL. Empty uses the bundled list. */
  catalogUrl: string
  /** Optional extra spec installed from the tray. */
  installSpec: string
}

/** Schema registered with the standard settings service. */
export const MarketplaceSettingsSchema: z<MarketplaceSettings> = z.object({
  catalogUrl: z.string().default(''),
  installSpec: z.string().default(''),
})

/**
 * Collect stdout and stderr from one managed package operation.
 * @param handle - live `desktopPnpm` handle.
 */
export async function collectPnpmOutput(handle: DesktopPnpmHandle): Promise<string> {
  const [stdout, stderr, outcome] = await Promise.all([
    readUtf8(handle.stdout),
    readUtf8(handle.stderr),
    handle.done,
  ])
  const text = `${stdout}${stderr}`.trim()
  if (outcome.exitCode !== 0) {
    throw new Error(text.length > 0 ? text : `dsh plugin exited ${String(outcome.exitCode)}`)
  }
  return text
}

function readUtf8(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => { chunks.push(chunk) })
    stream.on('end', () => { resolve(chunks.join('')) })
    stream.on('error', reject)
  })
}

/**
 * Register a tray marketplace that installs plugins through the official CLI.
 * @param ctx - Host context carrying pnpm, profile, and tray.
 */
export function apply(ctx: Context): void {
  const settings = ctx.settings.register(MARKETPLACE_SETTINGS_NAMESPACE, MarketplaceSettingsSchema)

  ctx.effect(() => {
    let catalog: readonly MarketplacePlugin[] = BUNDLED_MARKETPLACE_CATALOG
    let status = 'Marketplace'
    let refreshTray = (): void => {}

    const loadCatalog = async (): Promise<void> => {
      const url = settings.get().catalogUrl.trim()
      if (url.length === 0) {
        catalog = BUNDLED_MARKETPLACE_CATALOG
        status = `Marketplace · ${String(catalog.length)} plugins`
        refreshTray()
        return
      }
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:') throw new Error('catalog URL must be https')
        const response = await fetch(parsed)
        if (!response.ok) throw new Error(`catalog fetch failed: ${String(response.status)}`)
        catalog = parseMarketplaceCatalog(await response.json())
        status = `Marketplace · ${String(catalog.length)} plugins`
      } catch (cause) {
        ctx.logger.warn('dsh-plugin-desktop: marketplace catalog fetch failed; using bundled list')
        ctx.logger.warn(cause)
        catalog = BUNDLED_MARKETPLACE_CATALOG
        status = 'Marketplace · bundled catalog'
      }
      refreshTray()
    }

    const install = async (spec: string): Promise<void> => {
      const resolved = assertMarketplaceSpec(spec)
      status = `Marketplace · installing ${resolved}`
      refreshTray()
      try {
        const handle = ctx.desktopPnpm.runPlugin(['add', resolved], ctx.desktopProfiles.current.dir)
        await collectPnpmOutput(handle)
        status = `Marketplace · installed ${resolved}`
        ctx.desktopRuntime.updates.notify({
          title: 'DSH Desktop marketplace',
          body: `Installed ${resolved}`,
        })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        status = 'Marketplace · install failed'
        ctx.logger.error('dsh-plugin-desktop: marketplace install failed')
        ctx.logger.error(cause)
        ctx.desktopRuntime.updates.notify({
          title: 'DSH Desktop marketplace',
          body: message.slice(0, 180),
        })
      }
      refreshTray()
    }

    const snapshot = (): MarketplaceStatusPayload => ({
      status,
      catalog,
    })

    const tray = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 23,
      label: () => status,
      invoke: () => { void loadCatalog() },
      submenu: () => [
        {
          label: () => 'Refresh catalog',
          invoke: () => { void loadCatalog() },
        },
        ...catalog.map(plugin => ({
          label: () => `Install ${plugin.name}`,
          invoke: () => { void install(plugin.spec) },
        })),
        {
          label: () => settings.get().installSpec.trim().length === 0
            ? 'Install spec from settings'
            : `Install ${settings.get().installSpec.trim()}`,
          enabled: () => settings.get().installSpec.trim().length > 0,
          invoke: () => { void install(settings.get().installSpec) },
        },
      ],
    })
    refreshTray = () => { tray.refresh() }

    const unregisterHttp = ctx.webServer.register({
      kind: 'prefix',
      path: MARKETPLACE_HTTP_PREFIX,
      handler: (req, res) => {
        void dispatchMarketplaceHttp(req, res, {
          snapshot,
          async refresh() {
            await loadCatalog()
            return snapshot()
          },
          async install(spec) {
            await install(spec)
            return snapshot()
          },
        })
      },
    })

    const stopWatching = settings.watch((next, prev) => {
      if (next.catalogUrl !== prev.catalogUrl) void loadCatalog()
    })
    void loadCatalog()

    return () => {
      stopWatching()
      unregisterHttp()
      tray.dispose()
    }
  }, 'dsh-plugin-desktop: plugin marketplace')
}
