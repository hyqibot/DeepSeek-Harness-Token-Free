/** Loopback HTTP surface for the Channels settings page. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { loopbackRestPath, readLoopbackJson, writeLoopbackJson } from './loopback-json.ts'
import type { PairingCode } from './channel-pairing.ts'
import type { ChannelSettings } from './channels.ts'

/** Loopback prefix owned by `desktop-channels`. */
export const CHANNELS_HTTP_PREFIX = '/api/desktop-channels'

/** Live WeChat QR bind phase shown on the settings page. */
export type WechatQrPhase = 'idle' | 'starting' | 'waiting' | 'bound' | 'expired' | 'failed'

/** QR widget state. `qrDataUrl` is an `<img src>` value, never a browser link. */
export interface WechatQrState {
  readonly phase: WechatQrPhase
  readonly qrDataUrl: string | null
  readonly hint: string
}

/** Pairing code as shown in the UI. */
export interface ChannelPairingView {
  readonly code: string
  readonly expiresAt: number
}

/** Snapshot consumed by Settings → Channels. */
export interface ChannelStatusPayload {
  readonly telegram: string
  readonly discord: string
  readonly feishu: string
  readonly wechat: string
  readonly wechatBound: boolean
  readonly pairing: ChannelPairingView | null
  readonly wechatQr: WechatQrState
  readonly credentials: {
    readonly telegramConfigured: boolean
    readonly discordConfigured: boolean
    readonly feishuConfigured: boolean
    readonly wechatConfigured: boolean
  }
}

/** Host-side actions used by the Channels settings page. */
export interface ChannelHttpController {
  snapshot(): ChannelStatusPayload
  generatePairing(): Promise<PairingCode>
  startWechatQr(): Promise<ChannelStatusPayload>
  unbindWechat(): Promise<ChannelStatusPayload>
  updateCredentials(patch: Partial<ChannelSettings>): Promise<ChannelStatusPayload>
}

const EMPTY_QR: WechatQrState = { phase: 'idle', qrDataUrl: null, hint: '' }

/**
 * Build the idle WeChat QR widget state.
 */
export function idleWechatQr(): WechatQrState {
  return EMPTY_QR
}

/**
 * Dispatch one same-origin Channels API request.
 * @param req - incoming loopback request.
 * @param res - response owned by this handler.
 * @param controller - live channel controller.
 */
export async function dispatchChannelHttp(
  req: IncomingMessage,
  res: ServerResponse,
  controller: ChannelHttpController,
): Promise<void> {
  try {
    const rest = loopbackRestPath(req.url, CHANNELS_HTTP_PREFIX)
    const method = req.method ?? 'GET'
    if (method === 'GET' && (rest === '/' || rest === '/status')) {
      writeLoopbackJson(res, 200, controller.snapshot())
      return
    }
    if (method === 'POST' && rest === '/pairing') {
      const pairing = await controller.generatePairing()
      writeLoopbackJson(res, 200, { pairing, status: controller.snapshot() })
      return
    }
    if (method === 'POST' && rest === '/wechat-qr') {
      const status = await controller.startWechatQr()
      writeLoopbackJson(res, 200, status)
      return
    }
    if (method === 'POST' && rest === '/wechat-unbind') {
      const status = await controller.unbindWechat()
      writeLoopbackJson(res, 200, status)
      return
    }
    if (method === 'POST' && rest === '/credentials') {
      const body = await readLoopbackJson(req)
      const status = await controller.updateCredentials(credentialsPatch(body))
      writeLoopbackJson(res, 200, status)
      return
    }
    writeLoopbackJson(res, 404, { error: 'not found' })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    writeLoopbackJson(res, 500, { error: message })
  }
}

function credentialsPatch(body: Record<string, unknown>): Partial<ChannelSettings> {
  const patch: Partial<ChannelSettings> = {}
  const assign = (key: keyof ChannelSettings): void => {
    const value = body[key]
    if (typeof value === 'string') patch[key] = value
  }
  assign('telegramBotToken')
  assign('discordBotToken')
  assign('feishuAppId')
  assign('feishuAppSecret')
  assign('wechatBotToken')
  assign('wechatBaseUrl')
  return patch
}
