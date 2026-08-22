import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activateLicense,
  buildLicenseSpawnEnv,
  DEFAULT_LICENSE_SERVER_URL,
  ensureLicenseForCopaw,
  formatDeviceFingerprint,
  licenseCheckFromRemote,
  licenseClientConfig,
  licenseRequiredForAccess,
  licenseSessionPath,
  normalizeLicenseServerUrl,
  readLicenseSession,
  remoteSessionStatus,
  resolveLicenseApiSecret,
  resolveZeroTokenAccessMode,
  startLicenseHeartbeat,
  writeLicenseSession,
} from '../src/zero-token-license.ts'

const dirs: string[] = []

function tempProfile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-license-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('zero-token license', () => {
  it('keeps official API keys off the license gate', () => {
    expect(resolveZeroTokenAccessMode('sk-test', 'anthropic')).toBe('official-api')
    expect(resolveZeroTokenAccessMode('sk-test', 'deepseek')).toBe('official-api')
    expect(licenseRequiredForAccess('official-api')).toBe(false)
    expect(licenseRequiredForAccess('chrome')).toBe(false)
    expect(licenseRequiredForAccess('copaw')).toBe(true)
  })

  it('routes empty API keys to licensed CoPaw unless Chrome CDP is selected', () => {
    expect(resolveZeroTokenAccessMode('', 'anthropic')).toBe('copaw')
    expect(resolveZeroTokenAccessMode('', 'chrome')).toBe('chrome')
    expect(resolveZeroTokenAccessMode('', 'copaw')).toBe('copaw')
  })

  it('normalizes the public license origin', () => {
    expect(normalizeLicenseServerUrl(`${DEFAULT_LICENSE_SERVER_URL}/`)).toBe(DEFAULT_LICENSE_SERVER_URL)
    expect(formatDeviceFingerprint('0123456789abcdef0123')).toHaveLength(12)
  })

  it('sends Authorization only when settings.yaml or env provides apiSecret', async () => {
    expect(resolveLicenseApiSecret()).toBe('')
    expect(resolveLicenseApiSecret('custom')).toBe('custom')
    expect(resolveLicenseApiSecret('custom', 'from-env')).toBe('from-env')
    await expect(activateLicense(
      { serverUrl: DEFAULT_LICENSE_SERVER_URL },
      tempProfile(),
      'ACTIVATION',
      'DEVICE',
    )).rejects.toThrow(/licenseApiSecret is not set/)

    const profileDir = tempProfile()
    mkdirSync(profileDir, { recursive: true })
    let authorization = ''
    const request: typeof fetch = async (_input, init) => {
      const headers = init?.headers as Record<string, string> | undefined
      authorization = headers?.Authorization ?? ''
      return new Response(JSON.stringify({
        sessionToken: 'sess-auth',
        endtime: '2099-01-01',
        activationCodeMasked: 'AB****YZ',
        remark: 'ok',
      }), { status: 200 })
    }
    await activateLicense(
      licenseClientConfig(DEFAULT_LICENSE_SERVER_URL, 'from-settings', request),
      profileDir,
      'ACTIVATION',
      'DEVICE',
    )
    expect(authorization).toBe('Bearer from-settings')
  })

  it('activates, persists, and heartbeats a CoPaw session', async () => {
    const profileDir = tempProfile()
    mkdirSync(profileDir, { recursive: true })
    const request: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/v1/activate') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          sessionToken: 'sess-1',
          endtime: '2099-01-01',
          activationCodeMasked: 'AB****YZ',
          remark: 'ok',
        }), { status: 200 })
      }
      if (url.endsWith('/v1/session')) {
        return new Response(JSON.stringify({ valid: true, endtime: '2099-01-01' }), { status: 200 })
      }
      return new Response('missing', { status: 404 })
    }
    const session = await activateLicense(
      { serverUrl: DEFAULT_LICENSE_SERVER_URL, apiSecret: 'from-settings', request },
      profileDir,
      'ACTIVATION',
      'DEVICE',
    )
    expect(session.sessionToken).toBe('sess-1')
    expect(readLicenseSession(profileDir)?.activationCode).toBe('ACTIVATION')
    expect(JSON.parse(readFileSync(licenseSessionPath(profileDir), 'utf8')).sessionToken).toBe('sess-1')
    const env = buildLicenseSpawnEnv(profileDir, session.sessionToken)
    expect(env.CC_HAHA_REQUIRE_GATEWAY_LICENSE).toBe('1')
    expect(env.CC_HAHA_GATEWAY_LICENSE_SEAL_FILE).toContain('desktop-zero-token-license-seal.json')

    const resumed = await ensureLicenseForCopaw(
      { serverUrl: DEFAULT_LICENSE_SERVER_URL, apiSecret: 'from-settings', request },
      profileDir,
    )
    expect(resumed.sessionToken).toBe('sess-1')
  })

  it('stops the CoPaw sidecar when the heartbeat sees an invalid session', async () => {
    const checks: Array<'ok' | 'invalid'> = ['ok', 'invalid']
    let invalid = 0
    const timers: Array<() => void> = []
    const heartbeat = startLicenseHeartbeat({
      intervalMs: 10,
      check: async () => checks.shift() ?? 'invalid',
      onInvalid: () => { invalid += 1 },
      setIntervalFn: ((fn: () => void) => {
        timers.push(fn)
        return 1 as unknown as NodeJS.Timeout
      }) as typeof setInterval,
      clearIntervalFn: (() => {}) as typeof clearInterval,
    })
    timers[0]?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(invalid).toBe(0)
    timers[0]?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(invalid).toBe(1)
    heartbeat.stop()
  })

  it('does not treat a network drop as an invalid license', () => {
    expect(licenseCheckFromRemote({
      valid: false,
      activationCodeMasked: null,
      endtime: null,
      remark: null,
      networkError: true,
    })).toBe('unreachable')
    writeLicenseSession(tempProfile(), null)
  })

  it('treats HTTP 504 HTML as unreachable rather than an invalid session', async () => {
    const remote = await remoteSessionStatus(
      {
        serverUrl: DEFAULT_LICENSE_SERVER_URL,
        request: async () => new Response('<html>CLOUD_FUNCTION_INVOCATION_TIMEOUT</html>', { status: 504 }),
      },
      'sess-1',
    )
    expect(remote.networkError).toBe(true)
    expect(licenseCheckFromRemote(remote)).toBe('unreachable')
  })
})
