/** Cordis Host plugin contributing the packaged DSH terminal to the native tray. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { dispatchTerminalHttp, TERMINAL_HTTP_PREFIX } from './terminal-http.ts'
import type {} from './runtime.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-terminal'

/** Native adapter and the loopback Web carrier. */
export const inject = ['desktopRuntime', 'webServer']

/**
 * Register the system-terminal command for one Host generation.
 * @param ctx - Host context carrying the Electron adapter.
 */
export function apply(ctx: Context): void {
  if (ctx.desktopRuntime.platform === 'linux') {
    throw new Error('dsh-plugin-desktop: the packaged terminal is supported on macOS and Windows')
  }
  ctx.effect(() => {
    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 10,
      label: () => 'Open DSH Terminal',
      invoke: () => { ctx.desktopRuntime.openTerminal() },
    })
    const unregisterHttp = ctx.webServer.register({
      kind: 'prefix',
      path: TERMINAL_HTTP_PREFIX,
      handler: (req, res) => {
        void dispatchTerminalHttp(req, res, {
          snapshot: () => ({ supported: true }),
          open: () => { ctx.desktopRuntime.openTerminal() },
        })
      },
    })
    return () => {
      unregisterHttp()
      registration.dispose()
    }
  }, 'dsh-plugin-desktop: packaged terminal tray command')
}
