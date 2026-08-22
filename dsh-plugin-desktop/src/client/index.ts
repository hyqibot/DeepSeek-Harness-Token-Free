import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { applyChannelSettings } from './channel-settings.ts'
import { applyDesktopToolsSettings } from './desktop-tools-settings.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyDingTalkCommunity } from './community-sidebar.ts'
import { applyHyqiSettingsTag } from './hyqi-settings.ts'
import { applyPluginToggleSettings } from './plugin-toggle-settings.ts'
import { applyZeroTokenSettings } from './zero-token-settings.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyChannelSettings } from './channel-settings.ts'
export { applyDingTalkCommunity } from './community-sidebar.ts'
export { applyDesktopToolsSettings } from './desktop-tools-settings.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export { applyHyqiSettingsTag } from './hyqi-settings.ts'
export { applyPluginToggleSettings } from './plugin-toggle-settings.ts'
export { applyZeroTokenSettings } from './zero-token-settings.ts'
export type { DesktopClientEnvironment, DesktopClientMode, DesktopClientPlatform } from './environment.ts'

/** Services required by advanced presentation and desktop-owned settings pages. */
export const inject = [
  'slots',
  'sessions',
  'theme',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)
  applyZeroTokenSettings(ctx)
  applyDingTalkCommunity(ctx)
  applyHyqiSettingsTag(ctx)
  applyChannelSettings(ctx)
  applyDesktopToolsSettings(ctx)
  applyPluginToggleSettings(ctx)
}
