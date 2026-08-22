/** Cordis Host plugin: LAN mobile remote-control PWA. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { lanIPv4Addresses, mobileRemoteUrl } from './channel-lan.ts'
import { startMobileServer, type MobileServer } from './channel-mobile-http.ts'
import {
  dispatchMobileHttp,
  MOBILE_HTTP_PREFIX,
  type MobileHttpController,
  type MobileStatusPayload,
} from './mobile-http.ts'
import { renderQrDataUrl } from './qr-data-url.ts'
import type {} from './channel-service.ts'
import type {} from './runtime.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-mobile'

/** Channel service, tray, settings, and the loopback Web carrier. */
export const inject = ['desktopRuntime', 'desktopProfiles', 'desktopChannels', 'settings', 'webServer']

/** Settings namespace for the LAN phone client. */
export const MOBILE_SETTINGS_NAMESPACE = settingsNamespace('dsh-desktop-mobile')

/** User-editable mobile listener settings. */
export interface MobileSettings {
  /** Bind the LAN HTTP listener. */
  enabled: boolean
  /** TCP port. `0` selects an ephemeral port. */
  port: number
}

/** Schema registered with the standard settings service. */
export const MobileSettingsSchema: z<MobileSettings> = z.object({
  enabled: z.boolean().default(true),
  port: z.number().default(8787),
})

/**
 * Serve the phone PWA on the LAN and show the pairing URL from the tray.
 * @param ctx - Host context carrying channels, tray, and settings.
 */
export function apply(ctx: Context): void {
  const settings = ctx.settings.register(MOBILE_SETTINGS_NAMESPACE, MobileSettingsSchema)

  ctx.effect(() => {
    let server: MobileServer | undefined
    let status = 'Mobile: starting'
    let refreshTray = (): void => {}

    let urlCache: { url: string; qrDataUrl: string } | undefined

    const currentUrl = async (): Promise<string | undefined> => {
      if (server === undefined) return undefined
      const bearer = await ctx.desktopChannels.ensureMobileBearer()
      const host = lanIPv4Addresses()[0] ?? '127.0.0.1'
      return mobileRemoteUrl(host, server.port, bearer)
    }

    const snapshot = async (): Promise<MobileStatusPayload> => {
      const live = await currentUrl()
      if (live === undefined) {
        urlCache = undefined
        return {
          enabled: settings.get().enabled,
          status,
          url: null,
          qrDataUrl: null,
          port: null,
        }
      }
      if (urlCache?.url !== live) {
        urlCache = { url: live, qrDataUrl: await renderQrDataUrl(live) }
      }
      return {
        enabled: settings.get().enabled,
        status,
        url: live,
        qrDataUrl: urlCache.qrDataUrl,
        port: server?.port ?? null,
      }
    }

    const stop = async (): Promise<void> => {
      const active = server
      server = undefined
      if (active !== undefined) await active.close().catch(() => {})
    }

    const start = async (): Promise<void> => {
      await stop()
      const current = settings.get()
      if (!current.enabled) {
        status = 'Mobile: off'
        refreshTray()
        return
      }
      try {
        await ctx.desktopChannels.load()
        await ctx.desktopChannels.ensureMobileBearer()
        server = await startMobileServer({
          host: '0.0.0.0',
          port: current.port,
          channels: ctx.desktopChannels,
        })
        const hosts = lanIPv4Addresses()
        const host = hosts[0] ?? '127.0.0.1'
        status = `Mobile: ${host}:${String(server.port)}`
      } catch (cause) {
        ctx.logger.error('dsh-plugin-desktop: mobile listener failed')
        ctx.logger.error(cause)
        status = 'Mobile: listen failed'
      }
      refreshTray()
    }

    const showUrl = async (): Promise<MobileStatusPayload> => {
      if (server === undefined) await start()
      ctx.desktopRuntime.show()
      await ctx.desktopChannels.generatePairing(false)
      return snapshot()
    }

    const httpController: MobileHttpController = {
      snapshot,
      setEnabled: async (enabled) => {
        if (settings.get().enabled !== enabled) await settings.update({ enabled })
        return snapshot()
      },
      showUrl,
    }

    const tray = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 22,
      label: () => status,
      invoke: () => { void showUrl() },
      submenu: () => [
        {
          label: () => 'Show mobile URL and pairing code',
          invoke: () => { void showUrl() },
        },
      ],
    })
    refreshTray = () => { tray.refresh() }

    const unregisterHttp = ctx.webServer.register({
      kind: 'prefix',
      path: MOBILE_HTTP_PREFIX,
      handler: (req, res) => {
        void dispatchMobileHttp(req, res, httpController)
      },
    })

    const stopWatching = settings.watch(() => { void start() })
    void start()

    return () => {
      stopWatching()
      unregisterHttp()
      tray.dispose()
      void stop()
    }
  }, 'dsh-plugin-desktop: mobile remote control')
}
