# Desktop channels

English | [中文](channels.zh.md)

DSH Desktop treats **IM and the LAN phone PWA as remote control**. A paired identity drives the same in-process Agent as the desktop window through `ctx.agents.create()` / `resume()`, not through the loopback Web UI.

Host composition (see `cordis.patch.yml`):

| Row | Export | Role |
| --- | --- | --- |
| `desktop-channels` | `dsh-plugin-desktop/channels` | Pairing store, Telegram, Discord, Feishu, WeChat |
| `desktop-mobile` | `dsh-plugin-desktop/mobile` | LAN PWA + authenticated HTTP API |
| `desktop-zero-token` | `dsh-plugin-desktop/zero-token` | Localhost Anthropic Messages gateway |
| `desktop-marketplace` | `dsh-plugin-desktop/marketplace` | Catalog install via `desktopPnpm.runPlugin` |

## Pairing

1. Open **Settings → Channels** (远程控制) and click **Generate pairing code**. The six-character code appears on that page. The code expires after one hour and is single-use. The tray **Channels** command still mints a code as a shortcut.
2. Send that code from Telegram, Discord DM, Feishu, WeChat, or the phone PWA. Later messages become Agent follow-ups. `/new` drops the mapped session. `/help` lists commands.

Pairing state lives in the active profile as `desktop-channels.json` (mode `0600`). Failed guesses are rate-limited in memory. Version 1 telegram-only files are upgraded in place.

The desktop Web server stays on `127.0.0.1`. IM adapters long-poll or connect outbound from the Host process.

### Telegram

```yaml
dsh-desktop-channels:
  telegramBotToken: '123:abc'
```

```sh
DSH_TELEGRAM_BOT_TOKEN=123:abc
```

The environment variable wins when both are present. The token is never written to logs.

### Discord

Create a bot with the Message Content intent, then:

```yaml
dsh-desktop-channels:
  discordBotToken: '...'
```

or `DSH_DISCORD_BOT_TOKEN`. Pair in a DM with the six-character code.

### Feishu / Lark

Create a self-built app with IM permission and long-connection events:

```yaml
dsh-desktop-channels:
  feishuAppId: 'cli_...'
  feishuAppSecret: '...'
```

or `DSH_FEISHU_APP_ID` / `DSH_FEISHU_APP_SECRET`.

### WeChat

Open **Settings → Channels** and click **Bind WeChat QR**. The page renders a scannable QR; do not copy a URL from a system notification. After you scan, credentials are stored in `desktop-channels.json`. You can also set `wechatBotToken` / `DSH_WECHAT_BOT_TOKEN`.

## Mobile PWA

`desktop-mobile` listens on the LAN (`0.0.0.0`, default port `8787`) and rejects non-private remote addresses. **Settings → Channels** shows the phone URL as a QR on the page (`http://<lan-ip>:8787/?token=<bearer>`). Open that URL on the phone, send the pairing code, then add the page to the home screen for an app-like client.

```yaml
dsh-desktop-mobile:
  enabled: true
  port: 8787
```

There is no App Store binary in this repository. The PWA is the native-feeling phone client; a future store wrapper can load the same `/v1/chat` API.

## Zero Token

`desktop-zero-token` starts a **localhost Anthropic Messages gateway** (default `http://127.0.0.1:3002`). Official API keys never talk to a license server. The optional CoPaw web path (Python / Playwright / DeepSeek PoW) requires a purchased activation code and a `/v1/session` heartbeat.

```yaml
dsh-desktop-zero-token:
  enabled: true
  gatewayUrl: http://127.0.0.1:3002
  model: deepseek-chat
  apiKey: ''          # official Anthropic or DeepSeek key; env: DSH_ZERO_TOKEN_API_KEY
  upstream: anthropic # anthropic | deepseek | chrome | copaw
  chromeDebugUrl: http://127.0.0.1:9222
  licenseServerUrl: https://license.hyqibot.com
  licenseApiSecret: ''  # set in local $DSH_HOME/settings.yaml; must match GATEWAY_LICENSE_API_SECRET; do not commit
  activationCode: ''  # required only for CoPaw web Zero Token; env: DSH_ZERO_TOKEN_ACTIVATION_CODE
  heartbeatMs: 300000
  onboardMode: webauth
  insecureTls: true   # DeepSeek web: relax chat.deepseek.com TLS under Clash TUN / HTTPS MITM
```

The chat picker always lists the ten CoPaw web models (`deepseek-chat`, `doubao-web`, `claude-web`, `qwen-web`, `qwen-cn-web`, `kimi-web`, `chatgpt-web`, `gemini-web`, `glm-web`, `glm-intl-web`) under the Zero Token provider. `model` is the preferred default; an extra id outside that catalog is appended for the official-key path. pi-ai requires a key on `anthropic-messages`, so the route stores cc-haha's dummy `zero-token-local` (credential `DSH_ZERO_TOKEN_ROUTE_KEY`); the localhost gateway still authenticates the captured web session, not that placeholder.

Doubao-class channels use in-page Chrome fetches. **DeepSeek web** uses Node `fetch` to `chat.deepseek.com` (cookie + PoW). Clash TUN on Windows trusts a MITM CA in the system store that Chrome sees and Node does not, which surfaces as `fetch failed`. The sidecar defaults `COPAW_INSECURE_TLS=1` (scoped to that host) and loads the same `node --import` TLS shim as cc-haha. The toggle lives on **Settings → Token-free Gateway** (“Trust certificates under HTTPS proxy”), not Settings → General; turning it off writes `0`. Loopback is merged into `NO_PROXY` so CDP stays direct. Do not inject the Windows IE system proxy into `HTTP_PROXY` (Clash TUN is already transparent; forcing a mixed-port proxy makes undici throw `UND_ERR_INVALID_ARG`). The gateway and one-click login prefer PATH `node` and only fall back to Electron-as-Node. Each site still needs its own one-click login.

- **Official key** (`apiKey` set, `upstream` `anthropic` or `deepseek`): in-process gateway, no activation code.
- **CoPaw** (`upstream: copaw`, or empty `apiKey` with a non-Chrome upstream): web free-token is installer-only; a public clone cannot spawn the CoPaw sidecar.
- **Chrome CDP** (`upstream: chrome`): reuse a logged-in `chat.deepseek.com` tab on `--remote-debugging-port=9222`, no license.

The public tree does not ship the Zero-Token gateway. Web free-token mode **requires the [Release installer](https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases)**. Official API keys do not need an activation code.

## Marketplace

See [Desktop marketplace](marketplace.md).
