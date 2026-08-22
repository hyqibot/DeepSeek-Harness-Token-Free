/** Register the Zero Token settings section in both shell modes. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ZeroTokenSection } from './ZeroTokenSection.tsx'

const ZERO_TOKEN_SECTION_CSS = `
.dshZeroTokenCard { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.dshZeroTokenHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dshZeroTokenTitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-text-primary); }
.dshZeroTokenRaw { margin-top: 4px; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--dsw-alias-text-tertiary); word-break: break-all; }
.dshZeroTokenHint { margin: 0; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-text-tertiary); }
.dshZeroTokenOk { margin: 0; font-size: 11px; color: var(--dsw-alias-text-success, #16a34a); }
.dshZeroTokenWarn { margin: 0; font-size: 11px; color: var(--dsw-alias-text-warning, #d97706); }
.dshZeroTokenError { margin: 0; font-size: 11px; color: var(--dsw-alias-text-danger, #dc2626); }
.dshZeroTokenBadge { flex-shrink: 0; padding: 2px 8px; font-size: 10px; border-radius: 4px; background: color-mix(in srgb, var(--dsw-alias-text-tertiary) 14%, transparent); color: var(--dsw-alias-text-tertiary); }
.dshZeroTokenBadgeOn { background: color-mix(in srgb, var(--dsw-alias-text-success, #16a34a) 14%, transparent); color: var(--dsw-alias-text-success, #16a34a); }
.dshZeroTokenBadgeDefault { border: 1px solid color-mix(in srgb, var(--dsw-alias-text-brand, #2563eb) 18%, transparent); background: color-mix(in srgb, var(--dsw-alias-text-brand, #2563eb) 14%, transparent); color: var(--dsw-alias-text-brand, #2563eb); }
.dshZeroTokenLicense { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base)); display: flex; flex-direction: column; gap: 8px; }
.dshZeroTokenLicenseTitle { font-size: 12px; font-weight: 600; color: var(--dsw-alias-text-primary); }
.dshZeroTokenRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshZeroTokenRow input, .dshZeroTokenRow select { height: 32px; max-width: min(100%, 280px); padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-text-primary); font-size: 12px; }
.dshZeroTokenCheck { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
.dshZeroTokenCheck input[type="checkbox"] { height: auto; width: auto; max-width: none; margin-top: 3px; padding: 0; accent-color: var(--dsw-alias-text-brand, #2563eb); }
.dshZeroTokenCheckTitle { display: block; font-size: 12px; font-weight: 600; color: var(--dsw-alias-text-primary); }
.dshZeroTokenRow button, .dshZeroTokenLicense button { height: 32px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base)); color: var(--dsw-alias-text-primary); font-size: 12px; cursor: pointer; }
.dshZeroTokenRow button:disabled, .dshZeroTokenLicense button:disabled { opacity: 0.55; cursor: default; }
.dshZeroTokenPurchase { display: flex; justify-content: flex-end; align-items: center; gap: 16px; flex-wrap: wrap; }
.dshZeroTokenLink { height: auto !important; padding: 0 !important; border: 0 !important; background: transparent !important; color: var(--dsw-alias-text-brand, #2563eb) !important; font-size: 12px; font-weight: 600; cursor: pointer; }
.dshZeroTokenLog { margin: 0; max-height: 12rem; overflow: auto; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-text-secondary); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-all; }
`

/**
 * Own a settings.section page for Zero Token in compatibility and advanced mode.
 * @param ctx - browser Cordis context.
 */
export function applyZeroTokenSettings(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-plugin-desktop/zero-token'
    style.textContent = ZERO_TOKEN_SECTION_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'desktop: zero-token settings styles')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zero-token',
    order: 15,
    label: () => (
      typeof navigator === 'undefined' || navigator.language.toLowerCase().startsWith('zh')
        ? '免token 网关'
        : 'Token-free Gateway'
    ),
  }, ZeroTokenSection))
}
