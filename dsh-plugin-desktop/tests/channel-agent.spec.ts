import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  runChannelTurn,
  summarizeChannelTurn,
  type ChannelAgent,
  type ChannelAgentFactory,
} from '../src/channel-agent.ts'

function event(type: string, seq: number, data: object): SessionEvent {
  return { type, seq, time: seq, data } as SessionEvent
}

describe('channel agent turns', () => {
  it('keeps the last non-empty assistant text in the owned interval', () => {
    expect(summarizeChannelTurn([
      event('assistant/message', 0, { message: { content: [{ type: 'text', text: 'stale' }] } }),
      event('turn/start', 1, {}),
      event('assistant/message', 2, { message: { content: [{ type: 'text', text: '' }] } }),
      event('assistant/message', 3, { message: { content: [{ type: 'text', text: 'hello' }] } }),
      event('turn/end', 4, { reason: { kind: 'completed' } }),
    ], 1)).toEqual({ text: 'hello' })
  })

  it('resumes a mapped session, follows up, and flushes', async () => {
    const agent: ChannelAgent = {
      id: 'channel-1',
      seq: 4,
      events: [
        event('turn/start', 4, {}),
        event('assistant/message', 5, { message: { content: [{ type: 'text', text: 'done' }] } }),
        event('turn/end', 6, { reason: { kind: 'completed' } }),
      ],
      followup: vi.fn(),
      cancel: vi.fn(),
      whenIdle: vi.fn(async () => {}),
    }
    const factory: ChannelAgentFactory = {
      create: vi.fn(async () => agent),
      resume: vi.fn(async () => agent),
      flush: vi.fn(async () => {}),
    }

    const outcome = await runChannelTurn(factory, 'channel-1', '/tmp/profile', 'list files')

    expect(factory.resume).toHaveBeenCalledWith('channel-1', '/tmp/profile')
    expect(factory.create).not.toHaveBeenCalled()
    expect(agent.followup).toHaveBeenCalledWith('list files')
    expect(factory.flush).toHaveBeenCalledWith(agent)
    expect(outcome).toEqual({ sessionId: 'channel-1', result: { text: 'done' } })
  })
})
