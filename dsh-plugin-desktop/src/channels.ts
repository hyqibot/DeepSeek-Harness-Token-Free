/** Cordis Host plugin: multi-platform IM remote control. */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import {
  CHANNELS_HTTP_PREFIX,
  dispatchChannelHttp,
  idleWechatQr,
  type ChannelHttpController,
  type ChannelPairingView,
  type ChannelStatusPayload,
  type WechatQrState,
} from './channel-http.ts'
import { createDiscordTransport, maskSecret } from './channel-discord.ts'
import { createFeishuTransport } from './channel-feishu.ts'
import { DesktopChannels } from './channel-service.ts'
import { sleep } from './channel-sleep.ts'
import { createTelegramTransport, type TelegramTransport } from './channel-telegram.ts'
import {
  createWechatTransport,
  WECHAT_DEFAULT_BASE_URL,
  type WechatQrStart,
  type WechatTransport,
} from './channel-wechat.ts'
import { renderQrDataUrl } from './qr-data-url.ts'
import type {} from './profile-service.ts'
import type {} from './runtime.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-channels'

/** Native tray, profile directory, settings, and the loopback Web carrier. */
export const inject = ['desktopRuntime', 'desktopProfiles', 'settings', 'webServer']

/** Settings namespace for IM credentials. */
export const CHANNEL_SETTINGS_NAMESPACE = settingsNamespace('dsh-desktop-channels')

const TELEGRAM_TOKEN_ENV = 'DSH_TELEGRAM_BOT_TOKEN'
const DISCORD_TOKEN_ENV = 'DSH_DISCORD_BOT_TOKEN'
const FEISHU_APP_ID_ENV = 'DSH_FEISHU_APP_ID'
const FEISHU_APP_SECRET_ENV = 'DSH_FEISHU_APP_SECRET'
const WECHAT_TOKEN_ENV = 'DSH_WECHAT_BOT_TOKEN'

/** User-editable IM channel settings. */
export interface ChannelSettings {
  /** Telegram bot token; empty defers to `DSH_TELEGRAM_BOT_TOKEN`. */
  telegramBotToken: string
  /** Discord bot token; empty defers to `DSH_DISCORD_BOT_TOKEN`. */
  discordBotToken: string
  /** Feishu app id; empty defers to `DSH_FEISHU_APP_ID`. */
  feishuAppId: string
  /** Feishu app secret; empty defers to `DSH_FEISHU_APP_SECRET`. */
  feishuAppSecret: string
  /** Optional WeChat iLink token; empty defers to QR bind or `DSH_WECHAT_BOT_TOKEN`. */
  wechatBotToken: string
  /** WeChat iLink API origin. */
  wechatBaseUrl: string
}

/** Schema registered with the standard settings service. */
export const ChannelSettingsSchema: z<ChannelSettings> = z.object({
  telegramBotToken: z.string().default(''),
  discordBotToken: z.string().default(''),
  feishuAppId: z.string().default(''),
  feishuAppSecret: z.string().default(''),
  wechatBotToken: z.string().default(''),
  wechatBaseUrl: z.string().default(WECHAT_DEFAULT_BASE_URL),
})

/**
 * Resolve a settings string, preferring a launch-environment override.
 * @param configured - settings value.
 * @param envValue - optional environment value.
 */
export function resolveSecret(configured: string, envValue: string | undefined): string {
  const fromEnv = envValue?.trim() ?? ''
  if (fromEnv.length > 0) return fromEnv
  return configured.trim()
}

/**
 * Resolve the live Telegram bot token without logging it.
 * @param settings - registered channel settings.
 * @param envToken - optional launch-environment override.
 */
export function resolveTelegramBotToken(
  settings: ChannelSettings,
  envToken: string | undefined,
): string {
  return resolveSecret(settings.telegramBotToken, envToken)
}

/**
 * Register pairing, IM transports, and the shared channel service.
 * @param ctx - Host context carrying native tray, profile identity, and settings.
 */
export function apply(ctx: Context): void {
  const settings = ctx.settings.register(CHANNEL_SETTINGS_NAMESPACE, ChannelSettingsSchema)
  const channels = new DesktopChannels(ctx)
  const telegram = createTelegramTransport()
  const discord = createDiscordTransport()
  const feishu = createFeishuTransport()
  const wechat = createWechatTransport()

  ctx.effect(() => {
    let disposed = false
    const envValue = (key: string): string | undefined => {
      try {
        return launchEnvironmentOf(ctx).get(key)?.value
      } catch {
        return undefined
      }
    }
    const loops = new Map<string, AbortController>()
    let telegramStatus = 'Telegram: not configured'
    let discordStatus = 'Discord: not configured'
    let feishuStatus = 'Feishu: not configured'
    let wechatStatus = 'WeChat: not configured'
    let refreshTray = (): void => {}

    const tokenOf = (key: 'telegram' | 'discord' | 'feishuId' | 'feishuSecret' | 'wechat'): string => {
      const current = settings.get()
      switch (key) {
        case 'telegram':
          return resolveSecret(current.telegramBotToken, envValue(TELEGRAM_TOKEN_ENV))
        case 'discord':
          return resolveSecret(current.discordBotToken, envValue(DISCORD_TOKEN_ENV))
        case 'feishuId':
          return resolveSecret(current.feishuAppId, envValue(FEISHU_APP_ID_ENV))
        case 'feishuSecret':
          return resolveSecret(current.feishuAppSecret, envValue(FEISHU_APP_SECRET_ENV))
        case 'wechat':
          return resolveSecret(
            current.wechatBotToken || (channels.snapshot().wechatAuth?.botToken ?? ''),
            envValue(WECHAT_TOKEN_ENV),
          )
      }
    }

    const restart = (name: string, run: (signal: AbortSignal) => Promise<void>): void => {
      loops.get(name)?.abort()
      const controller = new AbortController()
      loops.set(name, controller)
      void (async () => {
        while (!disposed && !controller.signal.aborted) {
          try {
            await run(controller.signal)
            return
          } catch (cause) {
            if (disposed || controller.signal.aborted) return
            ctx.logger.warn(`dsh-plugin-desktop: ${name} loop failed; retrying`)
            ctx.logger.warn(cause)
            await sleep(5_000, controller.signal)
          }
        }
      })()
    }

    const startTelegram = (): void => {
      const token = tokenOf('telegram')
      if (token.length === 0) {
        telegramStatus = 'Telegram: not configured'
        refreshTray()
        loops.get('telegram')?.abort()
        return
      }
      telegramStatus = 'Telegram: polling'
      refreshTray()
      restart('telegram', signal => pollTelegram(telegram, token, channels, signal, (status) => {
        telegramStatus = status
        refreshTray()
      }))
    }

    const startDiscord = (): void => {
      const token = tokenOf('discord')
      if (token.length === 0) {
        discordStatus = 'Discord: not configured'
        refreshTray()
        loops.get('discord')?.abort()
        return
      }
      discordStatus = 'Discord: connected'
      refreshTray()
      restart('discord', async (signal) => {
        await discord.connect(token, (message) => {
          channels.enqueue({
            platform: 'discord',
            userId: message.userId,
            displayName: message.displayName,
            text: message.text,
          }, reply => discord.sendMessage(token, message.channelId, reply, signal))
        }, signal)
      })
    }

    const startFeishu = (): void => {
      const appId = tokenOf('feishuId')
      const appSecret = tokenOf('feishuSecret')
      if (appId.length === 0 || appSecret.length === 0) {
        feishuStatus = 'Feishu: not configured'
        refreshTray()
        loops.get('feishu')?.abort()
        return
      }
      feishuStatus = 'Feishu: connected'
      refreshTray()
      restart('feishu', async (signal) => {
        const token = await feishu.tenantAccessToken(appId, appSecret, signal)
        await feishu.connect(appId, appSecret, (message) => {
          channels.enqueue({
            platform: 'feishu',
            userId: message.userId,
            displayName: message.displayName,
            text: message.text,
          }, reply => feishu.sendMessage(token, message.chatId, message.receiveIdType, reply, signal))
        }, signal)
      })
    }

    const startWechat = (): void => {
      const token = tokenOf('wechat')
      const auth = channels.snapshot().wechatAuth
      const baseUrl = auth?.baseUrl ?? settings.get().wechatBaseUrl.trim() ?? WECHAT_DEFAULT_BASE_URL
      if (token.length === 0) {
        wechatStatus = 'WeChat: not configured'
        refreshTray()
        loops.get('wechat')?.abort()
        return
      }
      wechatStatus = 'WeChat: polling'
      refreshTray()
      restart('wechat', signal => pollWechat(wechat, token, baseUrl, channels, signal, (status) => {
        wechatStatus = status
        refreshTray()
      }))
    }

    let wechatQr: WechatQrState = idleWechatQr()
    let wechatBind: AbortController | undefined

    const pairingView = (): ChannelPairingView | null => {
      const pairing = channels.snapshot().pairing
      if (pairing === null || Date.now() > pairing.expiresAt) return null
      return { code: pairing.code, expiresAt: pairing.expiresAt }
    }

    const snapshot = (): ChannelStatusPayload => {
      return {
        telegram: telegramStatus,
        discord: discordStatus,
        feishu: feishuStatus,
        wechat: wechatStatus,
        wechatBound: channels.snapshot().wechatAuth !== null || tokenOf('wechat').length > 0,
        pairing: pairingView(),
        wechatQr,
        credentials: {
          telegramConfigured: tokenOf('telegram').length > 0,
          discordConfigured: tokenOf('discord').length > 0,
          feishuConfigured: tokenOf('feishuId').length > 0 && tokenOf('feishuSecret').length > 0,
          wechatConfigured: tokenOf('wechat').length > 0,
        },
      }
    }

    const pollWechatQr = async (qr: WechatQrStart, controller: AbortController): Promise<void> => {
      let baseUrl = WECHAT_DEFAULT_BASE_URL
      const deadline = Date.now() + 5 * 60_000
      while (!disposed && !controller.signal.aborted && Date.now() < deadline) {
        const poll = await wechat.pollQr(qr.qrcode, baseUrl, controller.signal)
        if (poll.baseUrl !== undefined) baseUrl = poll.baseUrl
        if (poll.connected && poll.botToken !== undefined && poll.accountId !== undefined) {
          await channels.setWechatAuth({
            botToken: poll.botToken,
            accountId: poll.accountId,
            baseUrl: poll.baseUrl ?? baseUrl,
          })
          wechatStatus = 'WeChat: bound'
          wechatQr = {
            phase: 'bound',
            qrDataUrl: null,
            hint: 'WeChat bound',
          }
          refreshTray()
          startWechat()
          return
        }
        await sleep(2_000, controller.signal)
      }
      if (controller.signal.aborted || disposed) return
      wechatStatus = 'WeChat: QR expired'
      wechatQr = { phase: 'expired', qrDataUrl: wechatQr.qrDataUrl, hint: 'QR expired' }
      refreshTray()
    }

    const startWechatQr = async (): Promise<ChannelStatusPayload> => {
      wechatBind?.abort()
      const controller = new AbortController()
      wechatBind = controller
      wechatQr = { phase: 'starting', qrDataUrl: null, hint: 'Generating QR…' }
      wechatStatus = 'WeChat: generating QR'
      refreshTray()
      ctx.desktopRuntime.show()
      try {
        const qr = await wechat.startQr(controller.signal)
        const qrDataUrl = await renderQrDataUrl(qr.qrcodeUrl)
        if (controller.signal.aborted || disposed) return snapshot()
        wechatQr = { phase: 'waiting', qrDataUrl, hint: 'Scan with WeChat' }
        wechatStatus = 'WeChat: scan the QR'
        refreshTray()
        void pollWechatQr(qr, controller).catch(cause => {
          if (disposed || controller.signal.aborted) return
          ctx.logger.warn('dsh-plugin-desktop: WeChat QR bind failed')
          ctx.logger.warn(cause)
          wechatStatus = 'WeChat: bind failed'
          wechatQr = { phase: 'failed', qrDataUrl: null, hint: cause instanceof Error ? cause.message : String(cause) }
          refreshTray()
        })
        return snapshot()
      } catch (cause) {
        if (!controller.signal.aborted && !disposed) {
          ctx.logger.warn('dsh-plugin-desktop: WeChat QR bind failed')
          ctx.logger.warn(cause)
          wechatStatus = 'WeChat: bind failed'
          wechatQr = {
            phase: 'failed',
            qrDataUrl: null,
            hint: cause instanceof Error ? cause.message : String(cause),
          }
          refreshTray()
        }
        return snapshot()
      }
    }

    const unbindWechat = async (): Promise<ChannelStatusPayload> => {
      wechatBind?.abort()
      wechatBind = undefined
      await channels.setWechatAuth(null)
      if (settings.get().wechatBotToken.trim() !== '') {
        await settings.update({ wechatBotToken: '' })
      }
      wechatQr = idleWechatQr()
      startWechat()
      return snapshot()
    }

    const httpController: ChannelHttpController = {
      snapshot,
      generatePairing: () => channels.generatePairing(false),
      startWechatQr,
      unbindWechat,
      async updateCredentials(patch) {
        if (Object.keys(patch).length > 0) await settings.update(patch)
        return snapshot()
      },
    }

    const tray = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 20,
      label: () => {
        const pairing = channels.snapshot().pairing
        if (pairing !== null && Date.now() <= pairing.expiresAt) {
          return `Channels · pairing ${pairing.code}`
        }
        return 'Channels'
      },
      invoke: async () => { await channels.generatePairing() },
      submenu: () => [
        {
          label: () => {
            const pairing = channels.snapshot().pairing
            return pairing === null || Date.now() > pairing.expiresAt
              ? 'Generate pairing code'
              : `Pairing code: ${pairing.code}`
          },
          invoke: async () => { await channels.generatePairing() },
        },
        { label: () => telegramStatus, enabled: () => false, invoke: () => {} },
        { label: () => discordStatus, enabled: () => false, invoke: () => {} },
        { label: () => feishuStatus, enabled: () => false, invoke: () => {} },
        { label: () => wechatStatus, enabled: () => false, invoke: () => {} },
        {
          label: () => 'Bind WeChat QR',
          invoke: () => { void startWechatQr() },
        },
      ],
    })
    refreshTray = () => { tray.refresh() }
    channels.watch(() => { refreshTray() })

    const unregisterHttp = ctx.webServer.register({
      kind: 'prefix',
      path: CHANNELS_HTTP_PREFIX,
      handler: (req, res) => {
        void dispatchChannelHttp(req, res, httpController)
      },
    })

    const stopWatching = settings.watch((next, prev) => {
      if (next.telegramBotToken !== prev.telegramBotToken) startTelegram()
      if (next.discordBotToken !== prev.discordBotToken) startDiscord()
      if (next.feishuAppId !== prev.feishuAppId || next.feishuAppSecret !== prev.feishuAppSecret) {
        startFeishu()
      }
      if (next.wechatBotToken !== prev.wechatBotToken || next.wechatBaseUrl !== prev.wechatBaseUrl) {
        startWechat()
      }
    })

    void (async () => {
      await channels.load()
      if (disposed) return
      refreshTray()
      startTelegram()
      startDiscord()
      startFeishu()
      startWechat()
    })()

    return () => {
      disposed = true
      wechatBind?.abort()
      stopWatching()
      unregisterHttp()
      tray.dispose()
      for (const controller of loops.values()) controller.abort()
    }
  }, 'dsh-plugin-desktop: IM channels')
}

async function pollTelegram(
  transport: TelegramTransport,
  token: string,
  channels: DesktopChannels,
  signal: AbortSignal,
  setStatus: (status: string) => void,
): Promise<void> {
  let offset = 0
  while (!signal.aborted) {
    const updates = await transport.getUpdates(token, offset, signal)
    for (const update of updates) {
      offset = update.updateId + 1
      channels.enqueue({
        platform: 'telegram',
        userId: update.userId,
        displayName: update.displayName,
        text: update.text,
      }, reply => transport.sendMessage(token, update.chatId, reply, signal))
    }
  }
  setStatus(`Telegram: ${maskSecret(token)}`)
}

async function pollWechat(
  transport: WechatTransport,
  token: string,
  baseUrl: string,
  channels: DesktopChannels,
  signal: AbortSignal,
  setStatus: (status: string) => void,
): Promise<void> {
  let cursor = ''
  while (!signal.aborted) {
    const batch = await transport.getUpdates(token, baseUrl, cursor, signal)
    cursor = batch.cursor
    for (const message of batch.messages) {
      channels.enqueue({
        platform: 'wechat',
        userId: message.userId,
        displayName: message.displayName,
        text: message.text,
      }, reply => transport.sendMessage(token, baseUrl, message.userId, reply, signal))
    }
  }
  setStatus('WeChat: polling')
}

export { maskSecret }
