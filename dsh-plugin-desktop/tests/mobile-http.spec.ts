import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  dispatchMobileHttp,
  MOBILE_HTTP_PREFIX,
  type MobileHttpController,
  type MobileStatusPayload,
} from '../src/mobile-http.ts'

function sample(overrides: Partial<MobileStatusPayload> = {}): MobileStatusPayload {
  return {
    enabled: true,
    status: 'Mobile: 192.168.1.8:8787',
    url: 'http://192.168.1.8:8787/?token=abc',
    qrDataUrl: 'data:image/png;base64,qq',
    port: 8787,
    ...overrides,
  }
}

async function listen(handler: MobileHttpController): Promise<{ origin: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void dispatchMobileHttp(req, res, handler)
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

describe('mobile settings HTTP', () => {
  it('returns the LAN URL as a page QR instead of a notification body', async () => {
    const showUrl = vi.fn(async () => sample())
    const server = await listen({
      snapshot: async () => sample(),
      setEnabled: async enabled => sample({ enabled }),
      showUrl,
    })
    try {
      const response = await fetch(`${server.origin}${MOBILE_HTTP_PREFIX}/url`, { method: 'POST', body: '{}' })
      const body = await response.json() as MobileStatusPayload
      expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/u)
      expect(showUrl).toHaveBeenCalledOnce()
    } finally {
      await server.close()
    }
  })
})
