/** Which Loader rows the Settings toggle may change. */

/** Rows that keep the window, Settings, and profile composition alive. */
export const LOCKED_PLUGIN_ENTRY_IDS = new Set([
  'desktop-shell',
  'desktop-pnpm',
  'desktop-profiles',
  'desktop-plugin-toggles',
  'web-runtime',
  'webserver',
  'ui-settings',
  'ui-settings-plugins',
  'ui-settings-plugin-inventory',
  'ui-sidebar',
  'ui-conversation',
  'ui-layout',
])

/** Module specifiers whose disable would take down the desktop shell. */
const LOCKED_MODULE_NAMES = new Set([
  'dsh-plugin-desktop',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/dsh-settings-file',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-settings-plugin-inventory',
])

/**
 * Why this row cannot be toggled, or null when the Settings switch is allowed.
 * @param entryId - Loader-tree identity shown in the plugin inventory.
 * @param moduleName - exact module specifier imported by the row.
 */
export function pluginToggleLockReason(entryId: string, moduleName: string): string | null {
  if (LOCKED_PLUGIN_ENTRY_IDS.has(entryId)) {
    return 'keeping this row enabled is required for Desktop Settings'
  }
  if (LOCKED_MODULE_NAMES.has(moduleName)) {
    return 'keeping this module enabled is required for Desktop Settings'
  }
  return null
}
