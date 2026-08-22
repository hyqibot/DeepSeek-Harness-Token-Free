/** Register the Channels settings section in both shell modes. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { ChannelsSection } from './ChannelsSection.tsx'

const CHANNELS_SECTION_CSS = `
.dshChannelsCard { display: flex; flex-direction: column; gap: 12px; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.dshChannelsTitle { font-size: 14px; font-weight: 600; color: var(--dsw-alias-text-primary); }
.dshChannelsHint { margin: 0; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-text-tertiary); }
.dshChannelsOk { margin: 0; font-size: 11px; color: var(--dsw-alias-text-success, #16a34a); }
.dshChannelsWarn { margin: 0; font-size: 11px; color: var(--dsw-alias-text-warning, #d97706); }
.dshChannelsError { margin: 0; font-size: 11px; color: var(--dsw-alias-text-danger, #dc2626); }
.dshChannelsRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dshChannelsRow input, .dshChannelsRow select { height: 32px; max-width: min(100%, 280px); padding: 0 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-text-primary); font-size: 12px; }
.dshChannelsRow button { height: 32px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base)); color: var(--dsw-alias-text-primary); font-size: 12px; cursor: pointer; }
.dshChannelsRow button:disabled { opacity: 0.55; cursor: default; }
.dshChannelsCode { font-size: 28px; letter-spacing: 0.28em; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; color: var(--dsw-alias-text-primary); }
.dshChannelsQr { width: 220px; height: 220px; padding: 8px; border-radius: 8px; background: #fff; object-fit: contain; }
.dshChannelsStatus { margin: 0; font-size: 12px; color: var(--dsw-alias-text-secondary); }
.dshChannelsBlock { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshChannelsUrl { margin: 0; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--dsw-alias-text-secondary); word-break: break-all; }
.dshChannelsCheck { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
`

/**
 * Own a settings.section page for IM channels, WeChat QR, and the LAN phone URL.
 * @param ctx - browser Cordis context.
 */
export function applyChannelSettings(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-plugin-desktop/channels'
    style.textContent = CHANNELS_SECTION_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'desktop: channels settings styles')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'channels',
    order: 16,
    label: () => (
      typeof navigator === 'undefined' || navigator.language.toLowerCase().startsWith('zh')
        ? '远程控制'
        : 'Channels'
    ),
  }, ChannelsSection))
}
