# Desktop 频道

[English](channels.md) | 中文

DSH Desktop 把 **IM 和局域网手机 PWA 当作遥控**。配对后的身份通过 `ctx.agents.create()` / `resume()` 驱动与桌面窗口同一个进程内 Agent，而不是走 loopback Web UI。

Host 组合（见 `cordis.patch.yml`）：

| Row | Export | 职责 |
| --- | --- | --- |
| `desktop-channels` | `dsh-plugin-desktop/channels` | 配对存储、Telegram、Discord、飞书、微信 |
| `desktop-mobile` | `dsh-plugin-desktop/mobile` | 局域网 PWA + 鉴权 HTTP API |
| `desktop-zero-token` | `dsh-plugin-desktop/zero-token` | 本机 Anthropic Messages 网关 |
| `desktop-marketplace` | `dsh-plugin-desktop/marketplace` | 通过 `desktopPnpm.runPlugin` 安装目录插件 |

## 配对

1. 打开 **设置 → 远程控制**，点击 **生成配对码**。6 位码会直接显示在页面上。配对码一小时过期，且一次性有效。托盘 **Channels** 仍可作为快捷方式生成配对码。
2. 在 Telegram、Discord 私信、飞书、微信或手机 PWA 里发送该配对码。之后的消息会作为 Agent follow-up。`/new` 会丢掉已映射的 session。`/help` 列出命令。

配对状态保存在当前 profile 的 `desktop-channels.json`（权限 `0600`）。失败猜测只在内存里做速率限制。旧版只含 Telegram 的 version 1 文件会就地升级。

桌面 Web 服务器仍绑定 `127.0.0.1`。IM 适配器由 Host 进程向外 long poll 或建连。

### Telegram

```yaml
dsh-desktop-channels:
  telegramBotToken: '123:abc'
```

```sh
DSH_TELEGRAM_BOT_TOKEN=123:abc
```

两者同时存在时环境变量优先。token 不会写入日志。

### Discord

创建 Bot 并打开 Message Content intent，然后：

```yaml
dsh-desktop-channels:
  discordBotToken: '...'
```

或 `DSH_DISCORD_BOT_TOKEN`。在私信中发送 6 位配对码。

### 飞书 / Lark

创建自建应用，开通 IM 权限与长连接事件：

```yaml
dsh-desktop-channels:
  feishuAppId: 'cli_...'
  feishuAppSecret: '...'
```

或 `DSH_FEISHU_APP_ID` / `DSH_FEISHU_APP_SECRET`。

### 微信

打开 **设置 → 远程控制**，点击 **生成微信绑定二维码**。页面上会直接显示可扫的二维码，不必从系统通知里复制链接再开浏览器。扫码成功后凭据写入 `desktop-channels.json`。也可以设置 `wechatBotToken` / `DSH_WECHAT_BOT_TOKEN`。

## 手机 PWA

`desktop-mobile` 在局域网监听（`0.0.0.0`，默认端口 `8787`），并拒绝非私网远端地址。**设置 → 远程控制** 会在页面上显示手机地址二维码（`http://<lan-ip>:8787/?token=<bearer>`）。用手机打开该 URL，发送配对码，再把页面添加到主屏幕，即可当作 App 使用。

```yaml
dsh-desktop-mobile:
  enabled: true
  port: 8787
```

本仓库不含 App Store 安装包。PWA 就是可安装的手机客户端；以后的商店壳可以复用同一套 `/v1/chat` API。

## Zero Token

`desktop-zero-token` 启动 **本机 Anthropic Messages 网关**（默认 `http://127.0.0.1:3002`）。官方 API key **不经过**授权服务。可选的 CoPaw 网页通路（Python / Playwright / DeepSeek PoW）需要购买激活码，并在运行期间轮询 `/v1/session` 心跳。

```yaml
dsh-desktop-zero-token:
  enabled: true
  gatewayUrl: http://127.0.0.1:3002
  model: deepseek-chat
  apiKey: ''          # 官方 Anthropic 或 DeepSeek key；环境变量 DSH_ZERO_TOKEN_API_KEY
  upstream: anthropic # anthropic | deepseek | chrome | copaw
  chromeDebugUrl: http://127.0.0.1:9222
  licenseServerUrl: https://license.hyqibot.com
  licenseApiSecret: ''  # 写在本机 $DSH_HOME/settings.yaml，与授权服务 GATEWAY_LICENSE_API_SECRET 一致；不要提交仓库
  activationCode: ''  # 仅 CoPaw 网页 Zero Token 需要；环境变量 DSH_ZERO_TOKEN_ACTIVATION_CODE
  heartbeatMs: 300000
  onboardMode: webauth
  insecureTls: true   # DeepSeek 网页在 Clash TUN / HTTPS MITM 下默认放宽 chat.deepseek.com 证书校验
```

聊天框的 Zero Token 供应商会**内置**这 10 个网页模型（`deepseek-chat`、`doubao-web`、`claude-web`、`qwen-web`、`qwen-cn-web`、`kimi-web`、`chatgpt-web`、`gemini-web`、`glm-web`、`glm-intl-web`），授权后可随时切换。`model` 是默认选中项；若填写了目录外的官方 key 模型 id，会额外追加一项。pi-ai 的 Anthropic 协议要求带 key，因此路由会写入与 cc-haha 相同的占位值 `zero-token-local`（凭据 `DSH_ZERO_TOKEN_ROUTE_KEY`）；本机网关仍用已捕获的网页登录态，不校验这个占位值。

豆包等通道走调试 Chrome **页内**请求；**DeepSeek 网页**走 Node `fetch` 访问 `chat.deepseek.com`（还要 cookie + PoW）。Windows 上 Clash TUN 会把证书装进系统证书库，Chrome 能过、Node 不能，看起来像 `fetch failed` + `NEED_WEBAUTH`。sidecar 默认给 DeepSeek 域名放宽 TLS（`COPAW_INSECURE_TLS=1`），并用 `node --import` 加载与 cc-haha 相同的 TLS shim。开关在 **设置 → 免token 网关** 本页的「在 HTTPS 代理下信任证书」，不是「设置 → 通用」；关掉后 sidecar 会写成 `0`。同时把 `127.0.0.1` 写入 `NO_PROXY`，避免 CDP 再被代理劫持。不要把 Windows IE 系统代理写进 `HTTP_PROXY`（Clash TUN 本身已透明拦截；硬塞 mixed 端口会让 undici 报 `UND_ERR_INVALID_ARG`）。网关和一键授权优先用 PATH 上的 `node.exe`，没有才回退 Electron-as-Node。各网站要分别一键授权。

- **官方 key**（填写 `apiKey`，`upstream` 为 `anthropic` 或 `deepseek`）：进程内网关，不要激活码。
- **CoPaw**（`upstream: copaw`，或空 key 且不是 Chrome）：网页免 Token 仅 Releases 安装包可用；公开 clone 无法拉起 CoPaw sidecar。
- **Chrome CDP**（`upstream: chrome`）：复用已登录的 `chat.deepseek.com` 标签（`--remote-debugging-port=9222`），不要授权。

公开仓不含 Zero-Token 网关源码。网页免 Token **必须安装 [Releases](https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases) 桌面版**；官方 API Key 路径不需要激活码。

## 插件市场

见 [Desktop 插件市场](marketplace.zh.md)。
