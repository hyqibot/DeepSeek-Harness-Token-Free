/** Drive one DSH Agent turn from an IM channel without depending on the Web UI. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** Outcome of one owned IM turn. */
export interface ChannelTurnResult {
  /** Last non-empty assistant text in the owned interval. */
  readonly text: string
  /** Optional turn-end error message. */
  readonly error?: string
}

/** Narrow Agent surface the channel runner programs against. */
export interface ChannelAgent {
  readonly id: string
  readonly seq: number
  readonly events: readonly SessionEvent[]
  followup(text: string): void
  cancel(): void
  whenIdle(): Promise<void>
}

/** Factory used by tests and the Cordis Host adapter. */
export interface ChannelAgentFactory {
  create(cwd: string): Promise<ChannelAgent>
  resume(sessionId: string, cwd: string): Promise<ChannelAgent | undefined>
  flush(agent: ChannelAgent): Promise<void>
}

/**
 * Fold the last assistant text and turn error from one owned interval.
 * @param events - durable session feed.
 * @param firstSeq - seq captured before the followup was queued.
 */
export function summarizeChannelTurn(
  events: readonly SessionEvent[],
  firstSeq: number,
): ChannelTurnResult {
  let started = false
  let text = ''
  let error: string | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end' && event.data.reason?.kind === 'error') {
      error = `${event.data.reason.error.code}: ${event.data.reason.error.message}`
    }
  }
  return error === undefined ? { text } : { text, error }
}

/**
 * Queue one user followup and wait until the Agent is idle.
 * @param factory - create/resume/flush adapter.
 * @param sessionId - previously mapped session, if any.
 * @param cwd - Agent working directory.
 * @param text - inbound user text.
 */
export async function runChannelTurn(
  factory: ChannelAgentFactory,
  sessionId: string | undefined,
  cwd: string,
  text: string,
): Promise<{ readonly sessionId: string; readonly result: ChannelTurnResult }> {
  let agent: ChannelAgent | undefined
  if (sessionId !== undefined) {
    agent = await factory.resume(sessionId, cwd)
  }
  agent ??= await factory.create(cwd)
  await agent.whenIdle()
  const firstSeq = agent.seq
  agent.followup(text)
  await agent.whenIdle()
  await factory.flush(agent)
  return {
    sessionId: agent.id,
    result: summarizeChannelTurn(agent.events, firstSeq),
  }
}

/**
 * Bind the live Cordis Agent registry as a channel factory.
 * @param ctx - Host context after Loader settlement.
 * @returns a factory, or undefined when core Agent services are absent.
 */
export function cordisChannelAgentFactory(ctx: Context): ChannelAgentFactory | undefined {
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return undefined

  const setup = (agentCtx: Context): void => {
    const selection = defaultModel.currentSelection()
    const selected: ModelSelectionRef = { current: selection, assembled: undefined }
    installModelSelection(agentCtx, selected)
  }

  return {
    async create(cwd) {
      const selection = defaultModel.currentSelection()
      const { agent } = await agents.create({
        sessionId: SessionId(`channel-${randomUUID()}`),
        meta: { cwd },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup,
      })
      return wrap(agent)
    },
    async resume(sessionId, _cwd) {
      try {
        const { agent } = await agents.resume({
          resumeSessionId: SessionId(sessionId),
          setup,
        })
        return wrap(agent)
      } catch {
        return undefined
      }
    },
    async flush(agent) {
      const live = agents.get(SessionId(agent.id))
      if (live === undefined) return
      await sessions.flush(live.session)
    },
  }
}

function wrap(agent: {
  readonly id: { toString(): string } | string
  readonly session: { readonly seq: number; readonly events: readonly SessionEvent[] }
  followup(message: ReturnType<typeof createUserMessage>): void
  cancel(cause: { readonly kind: 'user' }): void
  whenIdle(): Promise<void>
}): ChannelAgent {
  return {
    get id() {
      return String(agent.id)
    },
    get seq() {
      return agent.session.seq
    },
    get events() {
      return agent.session.events
    },
    followup(text) {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    cancel() {
      agent.cancel({ kind: 'user' })
    },
    whenIdle: () => agent.whenIdle(),
  }
}
