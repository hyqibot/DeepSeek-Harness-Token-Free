import { describe, expect, it } from 'vitest'
import { buildCopawSpawnPlan, resolveCopawGatewayEntry } from '../src/zero-token-copaw.ts'
import {
  copawSidecarNetworkEnv,
  hasForwardProxyEnv,
  mergeLoopbackNoProxy,
  parseWindowsProxyServer,
  windowsProxyEnableOn,
} from '../src/zero-token-copaw-network.ts'

describe('CoPaw sidecar upstream network env', () => {
  it('parses Windows Internet Settings ProxyServer values', () => {
    expect(parseWindowsProxyServer('127.0.0.1:7897')).toBe('http://127.0.0.1:7897')
    expect(parseWindowsProxyServer('http=127.0.0.1:7890;https=127.0.0.1:7890')).toBe('http://127.0.0.1:7890')
    expect(parseWindowsProxyServer('socks=127.0.0.1:7891')).toBeUndefined()
    expect(parseWindowsProxyServer('')).toBeUndefined()
  })

  it('treats leftover ProxyServer as off when ProxyEnable is 0', () => {
    expect(windowsProxyEnableOn('0x0')).toBe(false)
    expect(windowsProxyEnableOn('0')).toBe(false)
    expect(windowsProxyEnableOn('0x1')).toBe(true)
    expect(windowsProxyEnableOn('1')).toBe(true)
  })

  it('keeps CDP loopback out of a forward proxy', () => {
    expect(mergeLoopbackNoProxy(undefined)).toContain('127.0.0.1')
    expect(mergeLoopbackNoProxy('example.com')).toBe('example.com,localhost,127.0.0.1,::1')
  })

  it('does not inject Windows IE HTTP_PROXY or NODE_USE_ENV_PROXY', () => {
    expect(hasForwardProxyEnv({})).toBe(false)
    const env = copawSidecarNetworkEnv({})
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.NODE_USE_ENV_PROXY).toBeUndefined()
    expect(env.NO_PROXY).toContain('127.0.0.1')
    expect(env.COPAW_INSECURE_TLS).toBe('1')
  })

  it('does not override an explicit COPAW_INSECURE_TLS=0', () => {
    const env = copawSidecarNetworkEnv({ COPAW_INSECURE_TLS: '0' })
    expect(env.COPAW_INSECURE_TLS).toBeUndefined()
  })
})

describe('CoPaw spawn plan network defaults', () => {
  it('defaults scoped insecure TLS and loopback NO_PROXY on the Node sidecar', async () => {
    const entry = await resolveCopawGatewayEntry()
    const plan = buildCopawSpawnPlan({
      listenUrl: 'http://127.0.0.1:3002',
      entryPath: entry,
      extraEnv: { COPAW_INSECURE_TLS: '1' },
      nodeBin: 'node',
    })
    expect(plan.env.COPAW_INSECURE_TLS).toBe('1')
    expect(plan.env.NO_PROXY).toMatch(/127\.0\.0\.1/)
    const off = buildCopawSpawnPlan({
      listenUrl: 'http://127.0.0.1:3002',
      entryPath: entry,
      extraEnv: { COPAW_INSECURE_TLS: '0' },
      nodeBin: 'node',
    })
    expect(off.env.COPAW_INSECURE_TLS).toBe('0')
    expect(off.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined()
    expect(off.args[0]).toBe(entry)
    expect(off.args).not.toContain('--import')
  })
})
