/** Register the Desktop tools settings section in both shell modes. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DesktopToolsSection } from './DesktopToolsSection.tsx'

const DESKTOP_TOOLS_SECTION_CSS = `
.dshDesktopToolsCard { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.dshDesktopToolsTitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-text-primary); }
.dshDesktopToolsHint { margin: 0; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-text-tertiary); }
.dshDesktopToolsError { margin: 0; font-size: 11px; color: var(--dsw-alias-text-danger, #dc2626); }
.dshDesktopToolsStatus { margin: 0; font-size: 12px; color: var(--dsw-alias-text-secondary); }
.dshDesktopToolsRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshDesktopToolsRow button { height: 32px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base)); color: var(--dsw-alias-text-primary); font-size: 12px; cursor: pointer; }
.dshDesktopToolsRow button:disabled { opacity: 0.55; cursor: default; }
.dshDesktopToolsBlock { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopToolsList { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
.dshDesktopToolsList label { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-text-primary); cursor: pointer; }
.dshDesktopToolsPlugin { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--dsw-alias-text-primary); }
`

/**
 * Own a settings.section page for tray tools: profile, terminal, updates, marketplace, mode.
 * @param ctx - browser Cordis context.
 */
export function applyDesktopToolsSettings(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-plugin-desktop/desktop-tools'
    style.textContent = DESKTOP_TOOLS_SECTION_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'desktop: desktop-tools settings styles')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'desktop-tools',
    order: 17,
    label: () => (
      typeof navigator === 'undefined' || navigator.language.toLowerCase().startsWith('zh')
        ? '桌面'
        : 'Desktop'
    ),
  }, DesktopToolsSection))
}
