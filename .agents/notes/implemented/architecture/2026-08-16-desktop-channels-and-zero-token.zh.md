# Agent Note: Desktop 频道与 Zero Token 路由

Status: implemented

[English](2026-08-16-desktop-channels-and-zero-token.md) | 中文

## Problem

DSH Desktop 宣传了 IM 通道和手机遥控，但 Host 里没有实现。整栈复制 cc-haha adapters 会把 Telegram 接到 Claude Code 的 `POST /api/sessions` 与 WebSocket 协议，而 DSH 并不讲这套协议。整栈复制 cc-haha Zero Token 会把 Chromium cookie 边车、license 门闸和 Claude Code 工具 XML 拉进 Electron Host，而 Host 已经有 pi-ai 的 `anthropic-messages`。

## Decision

这一期的手机遥控 **就是** IM。`desktop-channels` Cordis row（`dsh-plugin-desktop/channels`）负责：

- 从原生托盘展示 6 位配对码
- profile 私有的 `desktop-channels.json` 白名单
- 由 Host 进程对 Telegram Bot API 做 long poll
- Loader 结算后通过 `ctx.agents.create()` / `resume()` 与 `agent.followup()` 跑 Agent 轮次

loopback Web 服务器仍绑定 `127.0.0.1`。不开放入站端口。微信、飞书、Discord 和原生手机 App 不在范围内；它们可以复用 `dispatchChannelMessage`。

Zero Token **不是** cookie 边车。当 `dsh-desktop-channels.zeroTokenEnabled` 为 true 时，插件会把名为 `zero-token` 的 provider 合并进 `llm-pi-ai` settings：`api: anthropic-messages`，`baseURL` 限制为 localhost。网关仍由用户自己运行（例如 cc-haha 的 `:3002`）。Claude Code 的 DSML/XML 不会被翻译。

## Verification

- `tests/channel-pairing.spec.ts`、`channel-store.spec.ts`、`channel-router.spec.ts`、`channel-agent.spec.ts`、`channel-telegram.spec.ts`、`channel-zero-token.spec.ts`、`channels.spec.ts`
- `tests/package.spec.ts` 与 `tests/profile.spec.ts` 断言公开 export 与 `desktop-channels` Loader row
- `scripts/verify-packaged-runtime.ts` 要求 `lib/channels.js` 以及 `dsh-plugin-desktop/channels` export
