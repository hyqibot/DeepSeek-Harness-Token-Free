import { describe, expect, it } from 'vitest'
import {
  generatePairingCode,
  isPaired,
  isPairingCodeShape,
  mintPairingCode,
  PairingLimiter,
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_MS,
  tryPair,
} from '../src/channel-pairing.ts'

describe('channel pairing', () => {
  it('mints codes from the unambiguous alphabet', () => {
    let next = 0
    const code = generatePairingCode(() => {
      const value = next
      next += 1
      return value
    })
    expect(code).toHaveLength(PAIRING_CODE_LENGTH)
    expect(code).toBe('ABCDEF')
    expect(isPairingCodeShape(` ${code.toLowerCase()} `)).toBe(true)
    expect(isPairingCodeShape('hello')).toBe(false)
  })

  it('pairs a matching code once and ignores already-authorized users', () => {
    const limiter = new PairingLimiter()
    const pairing = mintPairingCode(1_000, () => 0)
    const first = tryPair(pairing, [], limiter, { userId: '7', displayName: 'Ada' }, pairing.code, 1_001)
    expect(first).toEqual({
      ok: true,
      users: [{ userId: '7', displayName: 'Ada', pairedAt: 1_001 }],
    })
    const again = tryPair(pairing, first.ok ? first.users : [], limiter, {
      userId: '7',
      displayName: 'Ada',
    }, pairing.code, 1_002)
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.users).toHaveLength(1)
  })

  it('rate-limits failed guesses and rejects expired codes', () => {
    const limiter = new PairingLimiter()
    const pairing = mintPairingCode(1_000, () => 0)
    for (let attempt = 0; attempt < 5; attempt++) {
      const failed = tryPair(pairing, [], limiter, { userId: '9', displayName: 'Bob' }, 'ZZZZZZ', 1_001)
      expect(failed.ok).toBe(false)
      if (!failed.ok) expect(failed.reason).toBe('mismatch')
    }
    const limited = tryPair(pairing, [], limiter, { userId: '9', displayName: 'Bob' }, pairing.code, 1_002)
    expect(limited).toEqual({ ok: false, reason: 'rate-limited' })
    const expired = tryPair(
      pairing,
      [],
      limiter,
      { userId: '8', displayName: 'Cara' },
      pairing.code,
      1_000 + PAIRING_TTL_MS + 1,
    )
    expect(expired).toEqual({ ok: false, reason: 'expired' })
    expect(isPaired([], '8')).toBe(false)
  })
})
