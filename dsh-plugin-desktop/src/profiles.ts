/** Cordis Host surface for selecting the launcher-owned DSH profile. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { DesktopProfileSummary } from './profile-manager.ts'
import {
  dispatchProfilesHttp,
  PROFILES_HTTP_PREFIX,
  type ProfilesStatusPayload,
} from './profiles-http.ts'
import type {} from './profile-service.ts'
import type {} from './runtime.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-profiles'

/** Native tray, launcher profile services, and the loopback Web carrier. */
export const inject = ['desktopRuntime', 'desktopProfiles', 'webServer']

/** Return whether a discovered profile can back the desktop Web surface. */
function selectable(profile: DesktopProfileSummary): boolean {
  return profile.webCapable && profile.problem === undefined
}

/** Render unavailable profiles without exposing manifest diagnostics in native menus. */
function profileLabel(profile: DesktopProfileSummary): string {
  return selectable(profile) ? profile.name : `${profile.name} (Unavailable for Desktop)`
}

/** Register the current profile and restart-safe switch commands in the native tray. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const snapshot = (): ProfilesStatusPayload => ({
      current: ctx.desktopProfiles.current.name,
      profiles: ctx.desktopProfiles.list().map(profile => ({
        name: profile.name,
        label: profileLabel(profile),
        selectable: selectable(profile),
        current: profile.name === ctx.desktopProfiles.current.name,
      })),
    })

    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'profiles',
      order: 10,
      label: () => `Profile: ${ctx.desktopProfiles.current.name}`,
      invoke: () => {},
      submenu: () => ctx.desktopProfiles.list().map(profile => ({
        label: () => profileLabel(profile),
        type: 'radio',
        checked: () => profile.name === ctx.desktopProfiles.current.name,
        enabled: () => selectable(profile),
        invoke: async () => {
          if (profile.name === ctx.desktopProfiles.current.name) return
          await ctx.desktopProfiles.select(profile.name)
        },
      })),
    })
    const unregisterHttp = ctx.webServer.register({
      kind: 'prefix',
      path: PROFILES_HTTP_PREFIX,
      handler: (req, res) => {
        void dispatchProfilesHttp(req, res, {
          snapshot,
          async select(name) {
            if (name !== ctx.desktopProfiles.current.name) {
              await ctx.desktopProfiles.select(name)
            }
            return snapshot()
          },
        })
      },
    })
    return () => {
      unregisterHttp()
      registration.dispose()
    }
  }, 'dsh-plugin-desktop: native profile selector')
}
