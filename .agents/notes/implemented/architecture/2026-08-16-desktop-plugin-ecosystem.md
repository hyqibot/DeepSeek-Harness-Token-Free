# Agent Note: Desktop plugin composition, channels, Zero Token, mobile, marketplace

Status: implemented

English | [中文](2026-08-16-desktop-plugin-ecosystem.zh.md)

## Problem

DSH Desktop advertised a plugin marketplace, WeChat/Feishu, a native phone app, and Zero Token while still depending on cc-haha's cookie gateway and treating those surfaces as "coming soon".

## Decision

Desktop capabilities are ordinary Cordis Host rows in `cordis.patch.yml`:

- `desktop-channels` — shared `desktopChannels` service, Telegram/Discord/Feishu/WeChat
- `desktop-mobile` — LAN PWA + bearer HTTP API (private addresses only)
- `desktop-zero-token` — localhost Anthropic Messages gateway. Official API keys skip the license server. Optional CoPaw web Zero Token (vendored Python/Playwright/PoW) requires an activation code and `/v1/session` heartbeat.
- `desktop-marketplace` — catalog install through `ctx.desktopPnpm.runPlugin(['add', spec])`; `dshmarket` is not bundled

Phone remote control remains IM plus the PWA. There is no App Store binary. Version 1 `desktop-channels.json` files upgrade in place.

Distribution guidance: GitHub Releases + npm `dsh-plugin-desktop`, then DSH Discussions and awesome lists. There is no official Harness plugin store.

## Verification

- `tests/channel-store.spec.ts`, `channel-router.spec.ts`, `channel-im.spec.ts`, `channels.spec.ts`
- `tests/zero-token-gateway.spec.ts`, `zero-token-license.spec.ts`, `zero-token-copaw.spec.ts`, `mobile-marketplace.spec.ts`
- `tests/package.spec.ts` and `tests/profile.spec.ts` assert the new exports and Loader rows
- `scripts/verify-packaged-runtime.ts` requires `lib/mobile.js`, `lib/zero-token.js`, `lib/marketplace.js`, and `mobile/index.html`
