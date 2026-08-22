/** Pairing codes and allow-list checks for desktop IM channels. */

import { randomInt } from 'node:crypto'

/** Platforms that share the desktop pairing store. */
export const CHANNEL_PLATFORMS = ['telegram', 'discord', 'feishu', 'wechat', 'mobile'] as const

/** Platforms that share the desktop pairing store. */
export type ChannelPlatform = (typeof CHANNEL_PLATFORMS)[number]

/** One remote identity authorized to drive the local Agent. */
export interface PairedUser {
  /** Opaque platform user id. */
  readonly userId: string
  /** Last known display name; not used for authorization. */
  readonly displayName: string
  /** Epoch milliseconds when pairing succeeded. */
  readonly pairedAt: number
}

/** One-shot pairing secret shown on the desktop tray. */
export interface PairingCode {
  /** Six-character code using the visually unambiguous alphabet. */
  readonly code: string
  /** Epoch milliseconds after which the code is rejected. */
  readonly expiresAt: number
  /** Epoch milliseconds when the code was minted. */
  readonly createdAt: number
}

/** Alphabet excludes 0/O/1/I/L so codes stay readable in notifications. */
export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Length of a generated pairing code. */
export const PAIRING_CODE_LENGTH = 6

/** Pairing codes expire after one hour. */
export const PAIRING_TTL_MS = 60 * 60 * 1000

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000
const RATE_LIMIT_MAX_ATTEMPTS = 5

/** Reasons a pairing attempt is refused. */
export type PairingFailure = 'missing' | 'expired' | 'mismatch' | 'rate-limited'

/** Outcome of {@link tryPair}. */
export type PairingAttempt =
  | { readonly ok: true; readonly users: readonly PairedUser[] }
  | { readonly ok: false; readonly reason: PairingFailure }

/**
 * Mint a pairing code using a caller-owned integer source.
 * @param random - exclusive upper-bound integer generator; tests inject a sequence.
 * @returns a six-character code.
 */
export function generatePairingCode(random: (max: number) => number = randomInt): string {
  let code = ''
  for (let index = 0; index < PAIRING_CODE_LENGTH; index++) {
    const pick = random(PAIRING_ALPHABET.length)
    if (!Number.isInteger(pick) || pick < 0 || pick >= PAIRING_ALPHABET.length) {
      throw new Error('dsh-plugin-desktop: pairing random source returned an out-of-range integer')
    }
    code += PAIRING_ALPHABET[pick]
  }
  return code
}

/**
 * Build a fresh pairing secret with a TTL relative to `now`.
 * @param now - current epoch milliseconds.
 * @param random - exclusive upper-bound integer generator.
 * @returns the code and its expiry.
 */
export function mintPairingCode(
  now = Date.now(),
  random: (max: number) => number = randomInt,
): PairingCode {
  const createdAt = now
  return {
    code: generatePairingCode(random),
    createdAt,
    expiresAt: createdAt + PAIRING_TTL_MS,
  }
}

/**
 * Normalize user input before comparing it to a pairing code.
 * @param text - inbound IM text.
 * @returns uppercase trimmed text with interior whitespace removed.
 */
export function normalizePairingInput(text: string): string {
  return text.trim().replace(/\s+/gu, '').toUpperCase()
}

/**
 * Return whether text is shaped like a pairing code.
 * @param text - inbound IM text.
 */
export function isPairingCodeShape(text: string): boolean {
  const normalized = normalizePairingInput(text)
  return normalized.length === PAIRING_CODE_LENGTH
    && [...normalized].every(character => PAIRING_ALPHABET.includes(character))
}

/**
 * Return whether a platform user is already authorized.
 * @param users - persisted allow-list.
 * @param userId - opaque platform user id.
 */
export function isPaired(users: readonly PairedUser[], userId: string): boolean {
  return users.some(user => user.userId === userId)
}

/**
 * In-memory failed-attempt window used to slow guessing.
 */
export class PairingLimiter {
  private readonly attempts = new Map<string, { count: number; firstAttempt: number }>()

  /**
   * Record whether this identity may attempt pairing.
   * @param userId - opaque platform user id.
   * @param now - current epoch milliseconds.
   */
  isLimited(userId: string, now = Date.now()): boolean {
    const record = this.attempts.get(userId)
    if (record === undefined) return false
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      this.attempts.delete(userId)
      return false
    }
    return record.count >= RATE_LIMIT_MAX_ATTEMPTS
  }

  /**
   * Count one failed guess.
   * @param userId - opaque platform user id.
   * @param now - current epoch milliseconds.
   */
  recordFailure(userId: string, now = Date.now()): void {
    const record = this.attempts.get(userId)
    if (record === undefined || now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      this.attempts.set(userId, { count: 1, firstAttempt: now })
      return
    }
    record.count += 1
  }

  /**
   * Clear the window after a successful pair.
   * @param userId - opaque platform user id.
   */
  clear(userId: string): void {
    this.attempts.delete(userId)
  }
}

/**
 * Consume a pairing code when the inbound text matches.
 * @param pairing - current one-shot secret, or null when none is active.
 * @param users - existing allow-list.
 * @param limiter - failed-attempt window.
 * @param sender - remote identity.
 * @param text - inbound IM text.
 * @param now - current epoch milliseconds.
 */
export function tryPair(
  pairing: PairingCode | null,
  users: readonly PairedUser[],
  limiter: PairingLimiter,
  sender: { readonly userId: string; readonly displayName: string },
  text: string,
  now = Date.now(),
): PairingAttempt {
  if (limiter.isLimited(sender.userId, now)) {
    return { ok: false, reason: 'rate-limited' }
  }
  if (pairing === null) return { ok: false, reason: 'missing' }
  if (now > pairing.expiresAt) return { ok: false, reason: 'expired' }
  if (normalizePairingInput(text) !== pairing.code) {
    limiter.recordFailure(sender.userId, now)
    return { ok: false, reason: 'mismatch' }
  }
  limiter.clear(sender.userId)
  if (isPaired(users, sender.userId)) return { ok: true, users }
  return {
    ok: true,
    users: [...users, {
      userId: sender.userId,
      displayName: sender.displayName,
      pairedAt: now,
    }],
  }
}
