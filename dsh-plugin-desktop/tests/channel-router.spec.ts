import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ChannelAgent, ChannelAgentFactory } from '../src/channel-agent.ts'
import { attachPairingCode, dispatchChannelMessage } from '../src/channel-router.ts'
import { PairingLimiter } from '../src/channel-pairing.ts'
import { emptyChannelState } from '../src/channel-store.ts'

function assistant(text: string): ChannelAgent {
  const events = [
    { type: 'turn/start', seq: 1, time: 1, data: {} },
    { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'text', text }] } } },
    { type: 'turn/end', seq: 3, time: 3, data: { reason: { kind: 'completed' } } },
  ] as SessionEvent[]
  return {
    id: 'channel-9',
    seq: 1,
    events,
    followup: vi.fn(),
    cancel: vi.fn(),
    whenIdle: vi.fn(async () => {}),
  }
}

describe('channel message router', () => {
  it('refuses unpaired users until they send a live pairing code', async () => {
    const limiter = new PairingLimiter()
    const attached = attachPairingCode(emptyChannelState(), 1_000, () => 0)
    const refused = await dispatchChannelMessage(
      attached.state,
      limiter,
      { platform: 'telegram', userId: '7', displayName: 'Ada', text: 'hello' },
      undefined,
      '/tmp/profile',
      1_001,
    )
    expect(refused.reply).toContain('locked')

    const paired = await dispatchChannelMessage(
      attached.state,
      limiter,
      { platform: 'telegram', userId: '7', displayName: 'Ada', text: attached.pairing.code },
      undefined,
      '/tmp/profile',
      1_001,
    )
    expect(paired.reply).toContain('Paired')
    expect(paired.state.telegram.pairedUsers).toEqual([
      { userId: '7', displayName: 'Ada', pairedAt: 1_001 },
    ])
    expect(paired.state.pairing).toBeNull()
  })

  it('runs one Agent turn for a paired user and maps the session', async () => {
    const limiter = new PairingLimiter()
    const agent = assistant('ok')
    const factory: ChannelAgentFactory = {
      create: vi.fn(async () => agent),
      resume: vi.fn(async () => undefined),
      flush: vi.fn(async () => {}),
    }
    const paired = {
      ...emptyChannelState(),
      discord: {
        pairedUsers: [{ userId: '7', displayName: 'Ada', pairedAt: 1 }],
        sessions: {},
      },
    }
    const dispatched = await dispatchChannelMessage(
      paired,
      limiter,
      { platform: 'discord', userId: '7', displayName: 'Ada', text: 'summarize this repo' },
      factory,
      '/tmp/profile',
      2,
    )
    expect(factory.create).toHaveBeenCalledWith('/tmp/profile')
    expect(agent.followup).toHaveBeenCalledWith('summarize this repo')
    expect(dispatched.reply).toBe('ok')
    expect(dispatched.state.discord.sessions).toEqual({ '7': 'channel-9' })
  })
})
