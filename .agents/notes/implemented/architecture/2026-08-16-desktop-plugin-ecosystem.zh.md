# Agent Note：桌面插件组合、频道、Zero Token、手机壳、市场

Status: implemented

[English](2026-08-16-desktop-plugin-ecosystem.md) | 中文

## 问题

DSH Desktop 对外宣传了插件市场、微信/飞书、原生手机 App 和 Zero Token，但实际仍依赖 cc-haha 的 cookie 网关，并把这些能力写成“即将推出”。

## 决策

桌面能力都是 `cordis.patch.yml` 里的普通 Cordis Host 行：

- `desktop-channels` — 共享 `desktopChannels` 服务，Telegram / Discord / 飞书 / 微信
- `desktop-mobile` — 局域网 PWA + bearer HTTP API（只接受私网地址）
- `desktop-zero-token` — localhost Anthropic Messages 网关。官方 API key 不走授权服务。可选的 CoPaw 网页 Zero Token（vendored Python/Playwright/PoW）需要激活码和 `/v1/session` 心跳。
- `desktop-marketplace` — 通过 `ctx.desktopPnpm.runPlugin(['add', spec])` 安装目录插件；不预装 `dshmarket`

手机遥控仍然是 IM 加上 PWA。仓库里没有 App Store 安装包。version 1 的 `desktop-channels.json` 会就地升级。

发布建议：GitHub Release + npm `dsh-plugin-desktop`，再到 DSH Discussions 和 awesome 列表。官方 Harness 没有独立插件商店。

## 验证

- `tests/channel-store.spec.ts`、`channel-router.spec.ts`、`channel-im.spec.ts`、`channels.spec.ts`
- `tests/zero-token-gateway.spec.ts`、`zero-token-license.spec.ts`、`zero-token-copaw.spec.ts`、`mobile-marketplace.spec.ts`
- `tests/package.spec.ts` 与 `tests/profile.spec.ts` 断言新 export 和 Loader 行
- `scripts/verify-packaged-runtime.ts` 要求 `lib/mobile.js`、`lib/zero-token.js`、`lib/marketplace.js` 与 `mobile/index.html`
