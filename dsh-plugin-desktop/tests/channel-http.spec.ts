import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  CHANNELS_HTTP_PREFIX,
  dispatchChannelHttp,
  idleWechatQr,
  type ChannelHttpController,
  type ChannelStatusPayload,
} from '../src/channel-http.ts'
import type { PairingCode } from '../src/channel-pairing.ts'

function sampleStatus(overrides: Partial<ChannelStatusPayload> = {}): ChannelStatusPayload {
  return {
    telegram: 'Telegram: not configured',
    discord: 'Discord: not configured',
    feishu: 'Feishu: not configured',
    wechat: 'WeChat: not configured',
    wechatBound: false,
    pairing: null,
    wechatQr: idleWechatQr(),
    credentials: {
      telegramConfigured: false,
      discordConfigured: false,
      feishuConfigured: false,
      wechatConfigured: false,
    },
    ...overrides,
  }
}

function controller(overrides: Partial<ChannelHttpController> = {}): ChannelHttpController {
  return {
    snapshot: () => sampleStatus(),
    generatePairing: async () => ({ code: 'ABCDEF', expiresAt: Date.now() + 60_000, createdAt: Date.now() }),
    startWechatQr: async () => sampleStatus({
      wechat: 'WeChat: scan the QR',
      wechatQr: {
        phase: 'waiting',
        qrDataUrl: 'data:image/png;base64,qq',
        hint: 'Scan with WeChat',
      },
    }),
    unbindWechat: async () => sampleStatus(),
    updateCredentials: async () => sampleStatus({ credentials: {
      telegramConfigured: true,
      discordConfigured: false,
      feishuConfigured: false,
      wechatConfigured: false,
    } }),
    ...overrides,
  }
}

async function listen(handler: ChannelHttpController): Promise<{ origin: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void dispatchChannelHttp(req, res, handler)
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
    }),
  }
}

describe('channels settings HTTP', () => {
  it(`owns the ${CHANNELS_HTTP_PREFIX} loopback prefix`, async () => {
    const server = await listen(controller())
    try {
      const response = await fetch(`${server.origin}${CHANNELS_HTTP_PREFIX}/status`)
      expect(response.ok).toBe(true)
      const body = await response.json() as ChannelStatusPayload
      expect(body.wechatQr.phase).toBe('idle')
      expect(body.wechatQr.qrDataUrl).toBeNull()
    } finally {
      await server.close()
    }
  })

  it('mints a pairing code without putting a URL in the payload', async () => {
    const pairing: PairingCode = { code: 'XYZ234', expiresAt: 1, createdAt: 0 }
    const generatePairing = vi.fn(async () => pairing)
    const server = await listen(controller({ generatePairing }))
    try {
      const response = await fetch(`${server.origin}${CHANNELS_HTTP_PREFIX}/pairing`, { method: 'POST', body: '{}' })
      const body = await response.json() as { pairing: PairingCode }
      expect(body.pairing.code).toBe('XYZ234')
      expect(generatePairing).toHaveBeenCalledOnce()
    } finally {
      await server.close()
    }
  })

  it('returns an in-page WeChat QR data URL instead of a browser link', async () => {
    const startWechatQr = vi.fn(async () => sampleStatus({
      wechatQr: {
        phase: 'waiting',
        qrDataUrl: 'data:image/png;base64,abc',
        hint: 'Scan with WeChat',
      },
    }))
    const server = await listen(controller({ startWechatQr }))
    try {
      const response = await fetch(`${server.origin}${CHANNELS_HTTP_PREFIX}/wechat-qr`, { method: 'POST', body: '{}' })
      const body = await response.json() as ChannelStatusPayload
      expect(body.wechatQr.qrDataUrl).toMatch(/^data:image\/png;base64,/u)
      expect(body.wechatQr.qrDataUrl).not.toMatch(/^https?:/u)
      expect(startWechatQr).toHaveBeenCalledOnce()
    } finally {
      await server.close()
    }
  })
})
