import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startMobileServer } from '../src/channel-mobile-http.ts'
import type { DesktopChannels } from '../src/channel-service.ts'
import { emptyChannelState } from '../src/channel-store.ts'
import { assertMarketplaceSpec, parseMarketplaceCatalog } from '../src/marketplace-catalog.ts'
import { collectPnpmOutput, inject, name } from '../src/marketplace.ts'
import { MOBILE_SETTINGS_NAMESPACE, MobileSettingsSchema, inject as mobileInject, type MobileSettings } from '../src/mobile.ts'
import type { DesktopPnpmHandle } from '../src/pnpm.ts'

const homes: string[] = []

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('mobile remote control', () => {
  it('owns the LAN settings namespace', () => {
    expect(mobileInject).toEqual(['desktopRuntime', 'desktopProfiles', 'desktopChannels', 'settings', 'webServer'])
    expect(String(MOBILE_SETTINGS_NAMESPACE)).toBe('dsh-desktop-mobile')
    expect(MobileSettingsSchema({} as MobileSettings)).toEqual({
      enabled: true,
      port: 8787,
    })
  })

  it('pairs over the LAN API with a bearer token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-mobile-'))
    homes.push(dir)
    const page = join(dir, 'index.html')
    writeFileSync(page, '<html>ok</html>')
    const persist = vi.fn(async () => {})
    const channels = {
      snapshot: () => ({
        ...emptyChannelState(),
        pairing: { code: 'ABCDEF', expiresAt: Date.now() + 60_000, createdAt: Date.now() },
        mobileBearer: 'secret-token-secret-token-aaaa',
      }),
      ensureMobileBearer: async () => 'secret-token-secret-token-aaaa',
      enqueue: (
        inbound: { text: string },
        reply: (text: string) => Promise<void>,
      ) => { void reply(inbound.text === 'ABCDEF' ? 'Paired.' : 'ok') },
      persist,
    } as unknown as DesktopChannels
    const server = await startMobileServer({
      host: '127.0.0.1',
      port: 0,
      channels,
      pagePath: page,
    })
    try {
      const pageResponse = await fetch(`http://127.0.0.1:${String(server.port)}/`)
      expect(await pageResponse.text()).toContain('ok')
      const pair = await fetch(`http://127.0.0.1:${String(server.port)}/v1/pair`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret-token-secret-token-aaaa',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ code: 'ABCDEF', deviceId: 'phone-1' }),
      })
      expect(await pair.json()).toEqual({ reply: 'Paired.' })
    } finally {
      await server.close()
    }
  })
})

describe('marketplace catalog', () => {
  it('installs through desktopPnpm and rejects unaudited dshmarket', () => {
    expect(name).toBe('desktop-marketplace')
    expect(inject).toEqual(['desktopRuntime', 'desktopProfiles', 'desktopPnpm', 'settings', 'webServer'])
    expect(() => assertMarketplaceSpec('dshmarket')).toThrow('dshmarket')
    expect(parseMarketplaceCatalog([{
      id: 'demo',
      name: 'Demo',
      spec: 'demo-plugin',
      description: 'ok',
      homepage: 'https://example.com',
    }])).toHaveLength(1)
  })

  it('collects pnpm output and fails on a nonzero exit', async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const handle = {
      stdout,
      stderr,
      done: Promise.resolve({ exitCode: 1, signal: null }),
      cancel() {},
    } as unknown as DesktopPnpmHandle
    const pending = collectPnpmOutput(handle)
    stdout.end('boom')
    stderr.end()
    await expect(pending).rejects.toThrow('boom')
  })
})
