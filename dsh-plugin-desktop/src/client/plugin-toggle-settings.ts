/** Register the plugin-toggle settings section in both shell modes. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginTogglesSection } from './PluginTogglesSection.tsx'

const PLUGIN_TOGGLES_SECTION_CSS = `
.dshPluginTogglesCard { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.dshPluginTogglesTitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-text-primary); }
.dshPluginTogglesHint { margin: 0; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-text-tertiary); }
.dshPluginTogglesError { margin: 0; font-size: 11px; color: var(--dsw-alias-text-danger, #dc2626); }
.dshPluginTogglesOk { margin: 0; font-size: 11px; color: var(--dsw-alias-text-success, #16a34a); }
.dshPluginTogglesSearch { height: 32px; width: 100%; max-width: 360px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-text-primary); font-size: 12px; }
.dshPluginTogglesList { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dshPluginTogglesRow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshPluginTogglesMeta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dshPluginTogglesName { font-size: 12px; font-weight: 600; color: var(--dsw-alias-text-primary); }
.dshPluginTogglesId { font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--dsw-alias-text-tertiary); word-break: break-all; }
.dshPluginTogglesLock { margin: 0; font-size: 11px; color: var(--dsw-alias-text-warning, #d97706); }
.dshPluginTogglesSwitch { display: flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 12px; color: var(--dsw-alias-text-primary); cursor: pointer; }
.dshPluginTogglesSwitch input { accent-color: var(--dsw-alias-text-brand, #2563eb); }
.dshPluginTogglesSwitch[data-locked="true"] { opacity: 0.55; cursor: default; }
.dshPluginTogglesBackdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.35); }
.dshPluginTogglesDialog { width: min(420px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.dshPluginTogglesDialogActions { display: flex; justify-content: flex-end; gap: 8px; }
.dshPluginTogglesDialogActions button { height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-text-primary); cursor: pointer; }
`

/**
 * Own a settings.section page that can disable one Loader row at a time.
 * @param ctx - browser Cordis context.
 */
export function applyPluginToggleSettings(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-plugin-desktop/plugin-toggles'
    style.textContent = PLUGIN_TOGGLES_SECTION_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'desktop: plugin-toggles settings styles')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugin-toggles',
    order: 18,
    label: () => (
      typeof navigator === 'undefined' || navigator.language.toLowerCase().startsWith('zh')
        ? '插件开关'
        : 'Plugin switches'
    ),
  }, PluginTogglesSection))
}
