import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  channelBucket,
  channelStatePath,
  emptyChannelState,
  parseChannelState,
  readChannelState,
  writeChannelState,
} from '../src/channel-store.ts'

const homes: string[] = []

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('channel state store', () => {
  it('round-trips pairing and per-platform maps through the profile file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-channels-'))
    homes.push(dir)
    const path = channelStatePath(dir)
    const state = {
      ...emptyChannelState(),
      pairing: { code: 'ABCDEF', expiresAt: 2, createdAt: 1 },
      telegram: {
        pairedUsers: [{ userId: '7', displayName: 'Ada', pairedAt: 3 }],
        sessions: { '7': 'channel-1' },
      },
      mobileBearer: 'token',
    }
    await writeChannelState(path, state)
    expect(await readChannelState(path)).toEqual(state)
  })

  it('upgrades version 1 telegram-only documents and rejects unknown versions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-channels-'))
    homes.push(dir)
    expect(await readChannelState(channelStatePath(dir))).toEqual(emptyChannelState())
    const upgraded = parseChannelState(JSON.stringify({
      version: 1,
      pairing: null,
      telegram: {
        pairedUsers: [{ userId: '7', displayName: 'Ada', pairedAt: 3 }],
        sessions: { '7': 'channel-1' },
      },
    }))
    expect(upgraded.version).toBe(2)
    expect(channelBucket(upgraded, 'telegram').pairedUsers).toEqual([
      { userId: '7', displayName: 'Ada', pairedAt: 3 },
    ])
    expect(channelBucket(upgraded, 'discord').pairedUsers).toEqual([])
    expect(() => parseChannelState('{"version":9}')).toThrow('unsupported channel state version')
  })
})
