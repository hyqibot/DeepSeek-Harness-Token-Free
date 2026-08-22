# Agent Note: Desktop channels and Zero Token route

Status: implemented

English | [中文](2026-08-16-desktop-channels-and-zero-token.zh.md)

## Problem

DSH Desktop advertised IM channels and phone remote control without a Host implementation. Copying cc-haha adapters wholesale would attach Telegram to Claude Code's `POST /api/sessions` plus WebSocket protocol, which DSH does not speak. Copying cc-haha Zero Token wholesale would pull a Chromium cookie sidecar, a license gate, and Claude Code tool XML into an Electron Host that already has pi-ai `anthropic-messages`.

## Decision

Phone remote control **is** IM for this slice. The `desktop-channels` Cordis row (`dsh-plugin-desktop/channels`) owns:

- a six-character pairing code shown from the native tray
- a profile-private `desktop-channels.json` allow-list
- Telegram Bot API long polling from the Host process
- Agent turns through `ctx.agents.create()` / `resume()` and `agent.followup()` after Loader settlement

The loopback Web server stays on `127.0.0.1`. No inbound port is opened. WeChat, Feishu, Discord, and a native mobile app are out of scope; they can reuse `dispatchChannelMessage`.

Zero Token is **not** the cookie sidecar. When `dsh-desktop-channels.zeroTokenEnabled` is true, the plugin merges a `zero-token` provider into the `llm-pi-ai` settings document: `api: anthropic-messages`, `baseURL` restricted to localhost. Users still run the gateway themselves (for example cc-haha on `:3002`). Claude Code DSML/XML is not translated.

## Verification

- `tests/channel-pairing.spec.ts`, `channel-store.spec.ts`, `channel-router.spec.ts`, `channel-agent.spec.ts`, `channel-telegram.spec.ts`, `channel-zero-token.spec.ts`, `channels.spec.ts`
- `tests/package.spec.ts` and `tests/profile.spec.ts` assert the public export and the `desktop-channels` Loader row
- `scripts/verify-packaged-runtime.ts` requires `lib/channels.js` and the `dsh-plugin-desktop/channels` export
