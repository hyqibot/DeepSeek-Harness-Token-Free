import { describe, expect, it } from 'vitest'
import { HYQI_PLACEHOLDER_SESSION_TOKEN } from '../src/channel-hyqi.ts'
import { hyqiGateFromRemoteCheck, hyqiLocalSessionAllowsChat } from '../src/hyqi.ts'
import {
  licenseCheckFromRemote,
  remoteSessionStatus,
  sessionStatusFromHttp,
  type LicenseSession,
} from '../src/zero-token-license.ts'

const NOW = Date.parse('2026-08-19T12:00:00+08:00')

function sessionAt(verifiedAt: number): LicenseSession {
  return {
    sessionToken: 'sess-live',
    endtime: '2099-01-01',
    activationCodeMasked: 'AB****YZ',
    remark: null,
    verifiedAt,
  }
}

function noonDaysAgo(days: number): number {
  const date = new Date(NOW)
  date.setDate(date.getDate() - days)
  return date.getTime()
}

const today = sessionAt(NOW)
const yesterday = sessionAt(noonDaysAgo(1))

describe('HYQi license gate', () => {
  it('only keeps local chat open when the activation was verified today', () => {
    expect(hyqiLocalSessionAllowsChat(null, NOW)).toBe(false)
    expect(hyqiLocalSessionAllowsChat(today, NOW)).toBe(true)
    expect(hyqiLocalSessionAllowsChat(yesterday, NOW)).toBe(false)
    expect(hyqiLocalSessionAllowsChat(sessionAt(1), NOW)).toBe(false)
  })

  it('keeps chat open for an unreachable poll only with a same-day record', () => {
    expect(hyqiGateFromRemoteCheck(null, 'missing', NOW)).toEqual({
      activated: false,
      token: HYQI_PLACEHOLDER_SESSION_TOKEN,
      wipe: false,
      refreshVerifiedAt: false,
    })
    expect(hyqiGateFromRemoteCheck(today, 'ok', NOW)).toEqual({
      activated: true,
      token: 'sess-live',
      wipe: false,
      refreshVerifiedAt: true,
    })
    expect(hyqiGateFromRemoteCheck(yesterday, 'ok', NOW)).toEqual({
      activated: true,
      token: 'sess-live',
      wipe: false,
      refreshVerifiedAt: true,
    })
    expect(hyqiGateFromRemoteCheck(today, 'unreachable', NOW)).toEqual({
      activated: true,
      token: 'sess-live',
      wipe: false,
      refreshVerifiedAt: false,
    })
    expect(hyqiGateFromRemoteCheck(yesterday, 'unreachable', NOW)).toEqual({
      activated: false,
      token: HYQI_PLACEHOLDER_SESSION_TOKEN,
      wipe: false,
      refreshVerifiedAt: false,
    })
    expect(hyqiGateFromRemoteCheck(today, 'invalid', NOW)).toEqual({
      activated: false,
      token: HYQI_PLACEHOLDER_SESSION_TOKEN,
      wipe: true,
      refreshVerifiedAt: false,
    })
  })

  it('treats EdgeOne 504 HTML as an outage, not a revoked activation', () => {
    expect(sessionStatusFromHttp(504, null)).toEqual({
      valid: false,
      activationCodeMasked: null,
      endtime: null,
      remark: null,
      networkError: true,
    })
    expect(licenseCheckFromRemote(sessionStatusFromHttp(504, '<html>504</html>'))).toBe('unreachable')
    expect(sessionStatusFromHttp(401, { valid: false })).toEqual({
      valid: false,
      activationCodeMasked: null,
      endtime: null,
      remark: null,
    })
    expect(licenseCheckFromRemote(sessionStatusFromHttp(401, { valid: false }))).toBe('invalid')
    expect(sessionStatusFromHttp(200, { valid: true, endtime: '2099-01-01' }).valid).toBe(true)
  })

  it('maps a 504 heartbeat fetch onto unreachable instead of wiping', async () => {
    const remote = await remoteSessionStatus(
      {
        serverUrl: 'https://license.hyqibot.com',
        request: async () => new Response('<html>504</html>', { status: 504 }),
      },
      'sess-live',
    )
    expect(licenseCheckFromRemote(remote)).toBe('unreachable')
    expect(hyqiGateFromRemoteCheck(today, licenseCheckFromRemote(remote), NOW).wipe).toBe(false)
    expect(hyqiGateFromRemoteCheck(yesterday, licenseCheckFromRemote(remote), NOW).activated).toBe(false)
  })
})
