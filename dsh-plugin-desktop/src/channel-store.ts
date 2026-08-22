/** Durable pairing and per-user session map for desktop IM channels. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  type ChannelPlatform,
  type PairedUser,
  type PairingCode,
} from './channel-pairing.ts'

/** Current on-disk document version. Version 1 documents are upgraded in place. */
export const CHANNEL_STATE_VERSION = 2 as const

/** Per-platform allow-list and Agent session map. */
export interface ChannelBucket {
  readonly pairedUsers: readonly PairedUser[]
  readonly sessions: Readonly<Record<string, string>>
}

/** WeChat iLink credentials captured after QR confirmation. */
export interface WechatAuth {
  readonly botToken: string
  readonly accountId: string
  readonly baseUrl: string
}

/** Persisted channel state for one DSH profile. */
export interface ChannelState {
  readonly version: typeof CHANNEL_STATE_VERSION
  readonly pairing: PairingCode | null
  readonly telegram: ChannelBucket
  readonly discord: ChannelBucket
  readonly feishu: ChannelBucket
  readonly wechat: ChannelBucket
  readonly mobile: ChannelBucket
  readonly wechatAuth: WechatAuth | null
  readonly mobileBearer: string | null
}

const EMPTY_BUCKET: ChannelBucket = { pairedUsers: [], sessions: {} }

const EMPTY_STATE: ChannelState = {
  version: CHANNEL_STATE_VERSION,
  pairing: null,
  telegram: EMPTY_BUCKET,
  discord: EMPTY_BUCKET,
  feishu: EMPTY_BUCKET,
  wechat: EMPTY_BUCKET,
  mobile: EMPTY_BUCKET,
  wechatAuth: null,
  mobileBearer: null,
}

/**
 * Resolve the profile-private channel state file.
 * @param profileDir - absolute DSH profile directory.
 */
export function channelStatePath(profileDir: string): string {
  return join(profileDir, 'desktop-channels.json')
}

/**
 * Return an empty document used when the file is absent.
 */
export function emptyChannelState(): ChannelState {
  return EMPTY_STATE
}

/**
 * Return the allow-list bucket for one platform.
 * @param state - persisted document.
 * @param platform - inbound channel.
 */
export function channelBucket(state: ChannelState, platform: ChannelPlatform): ChannelBucket {
  return state[platform]
}

/**
 * Replace one platform bucket without touching the others.
 * @param state - persisted document.
 * @param platform - inbound channel.
 * @param bucket - next allow-list and session map.
 */
export function withChannelBucket(
  state: ChannelState,
  platform: ChannelPlatform,
  bucket: ChannelBucket,
): ChannelState {
  return { ...state, [platform]: bucket }
}

/**
 * Insert or drop the mapped Agent session for one remote identity.
 * @param state - persisted document.
 * @param platform - inbound channel.
 * @param userId - opaque platform user id.
 * @param sessionId - Agent session id, or undefined to drop the mapping.
 */
export function withChannelSession(
  state: ChannelState,
  platform: ChannelPlatform,
  userId: string,
  sessionId: string | undefined,
): ChannelState {
  const current = channelBucket(state, platform)
  const sessions = { ...current.sessions }
  if (sessionId === undefined) {
    delete sessions[userId]
  } else {
    sessions[userId] = sessionId
  }
  return withChannelBucket(state, platform, { pairedUsers: current.pairedUsers, sessions })
}

/**
 * Parse a persisted document, upgrading version 1 telegram-only files.
 * @param raw - file contents.
 */
export function parseChannelState(raw: string): ChannelState {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('dsh-plugin-desktop: channel state must be an object')
  }
  const record = parsed as Record<string, unknown>
  if (record.version === 1) return upgradeVersion1(record)
  if (record.version !== CHANNEL_STATE_VERSION) {
    throw new Error('dsh-plugin-desktop: unsupported channel state version')
  }
  return {
    version: CHANNEL_STATE_VERSION,
    pairing: parsePairing(record.pairing),
    telegram: parseBucket(record.telegram, 'telegram'),
    discord: parseBucket(record.discord, 'discord'),
    feishu: parseBucket(record.feishu, 'feishu'),
    wechat: parseBucket(record.wechat, 'wechat'),
    mobile: parseBucket(record.mobile, 'mobile'),
    wechatAuth: parseWechatAuth(record.wechatAuth),
    mobileBearer: parseOptionalString(record.mobileBearer, 'mobileBearer'),
  }
}

/**
 * Load the profile-private document, returning empty state when missing.
 * @param path - absolute state file.
 */
export async function readChannelState(path: string): Promise<ChannelState> {
  try {
    return parseChannelState(await readFile(path, 'utf8'))
  } catch (cause) {
    if (isEnoent(cause)) return EMPTY_STATE
    throw cause
  }
}

/**
 * Replace the profile-private document atomically.
 * @param path - absolute state file.
 * @param state - complete next document.
 */
export async function writeChannelState(path: string, state: ChannelState): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(state, undefined, 2)}\n`, {
    mode: 0o600,
    dirMode: 0o700,
  })
}

function upgradeVersion1(record: Record<string, unknown>): ChannelState {
  return {
    version: CHANNEL_STATE_VERSION,
    pairing: parsePairing(record.pairing),
    telegram: parseBucket(record.telegram, 'telegram'),
    discord: EMPTY_BUCKET,
    feishu: EMPTY_BUCKET,
    wechat: EMPTY_BUCKET,
    mobile: EMPTY_BUCKET,
    wechatAuth: null,
    mobileBearer: null,
  }
}

function parsePairing(value: unknown): PairingCode | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('dsh-plugin-desktop: channel pairing must be an object or null')
  }
  const record = value as Record<string, unknown>
  if (typeof record.code !== 'string' || typeof record.expiresAt !== 'number' || typeof record.createdAt !== 'number') {
    throw new Error('dsh-plugin-desktop: channel pairing is malformed')
  }
  return {
    code: record.code,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  }
}

function parseBucket(value: unknown, label: ChannelPlatform): ChannelBucket {
  if (value === undefined) return EMPTY_BUCKET
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`dsh-plugin-desktop: ${label} channel state must be an object`)
  }
  const record = value as Record<string, unknown>
  return {
    pairedUsers: parseUsers(record.pairedUsers),
    sessions: parseSessions(record.sessions, label),
  }
}

function parseUsers(value: unknown): readonly PairedUser[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new Error('dsh-plugin-desktop: pairedUsers must be an array')
  }
  return value.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`dsh-plugin-desktop: pairedUsers[${String(index)}] must be an object`)
    }
    const record = entry as Record<string, unknown>
    if (typeof record.userId !== 'string' || typeof record.displayName !== 'string' || typeof record.pairedAt !== 'number') {
      throw new Error(`dsh-plugin-desktop: pairedUsers[${String(index)}] is malformed`)
    }
    return {
      userId: record.userId,
      displayName: record.displayName,
      pairedAt: record.pairedAt,
    }
  })
}

function parseSessions(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`dsh-plugin-desktop: ${label} sessions must be an object`)
  }
  const sessions: Record<string, string> = {}
  for (const [userId, sessionId] of Object.entries(value as Record<string, unknown>)) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error(`dsh-plugin-desktop: ${label} session for ${userId} must be a non-empty string`)
    }
    sessions[userId] = sessionId
  }
  return sessions
}

function parseWechatAuth(value: unknown): WechatAuth | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('dsh-plugin-desktop: wechatAuth must be an object or null')
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.botToken !== 'string' || record.botToken.length === 0
    || typeof record.accountId !== 'string' || record.accountId.length === 0
    || typeof record.baseUrl !== 'string' || record.baseUrl.length === 0
  ) {
    throw new Error('dsh-plugin-desktop: wechatAuth is malformed')
  }
  return {
    botToken: record.botToken,
    accountId: record.accountId,
    baseUrl: record.baseUrl,
  }
}

function parseOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`dsh-plugin-desktop: ${label} must be a non-empty string or null`)
  }
  return value
}

function isEnoent(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'
}
