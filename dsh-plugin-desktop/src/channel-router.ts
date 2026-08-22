/** Route inbound IM text through pairing, session mapping, and one Agent turn. */

import type { ChannelTurnResult, ChannelAgentFactory } from './channel-agent.ts'
import { runChannelTurn } from './channel-agent.ts'
import {
  isPaired,
  isPairingCodeShape,
  mintPairingCode,
  tryPair,
  PairingLimiter,
  type ChannelPlatform,
  type PairingCode,
} from './channel-pairing.ts'
import {
  channelBucket,
  withChannelBucket,
  withChannelSession,
  type ChannelState,
} from './channel-store.ts'

/** Inbound text from one remote identity. */
export interface ChannelInbound {
  readonly platform: ChannelPlatform
  readonly userId: string
  readonly displayName: string
  readonly text: string
}

/** Reply plus the next durable channel document. */
export interface ChannelDispatch {
  readonly reply: string
  readonly state: ChannelState
  readonly pairing?: PairingCode
}

const HELP = [
  'DSH Desktop remote control',
  '/new — start a new Agent session',
  '/cancel — stop the current turn',
  '/status — pairing and session status',
  '/help — this message',
].join('\n')

/**
 * Handle one inbound IM message against the current channel document.
 * @param state - persisted pairing and session map.
 * @param limiter - failed pairing-attempt window.
 * @param inbound - remote identity and text.
 * @param factory - Agent create/resume adapter; absent until Loader settles.
 * @param cwd - Agent working directory.
 * @param now - current epoch milliseconds.
 */
export async function dispatchChannelMessage(
  state: ChannelState,
  limiter: PairingLimiter,
  inbound: ChannelInbound,
  factory: ChannelAgentFactory | undefined,
  cwd: string,
  now = Date.now(),
): Promise<ChannelDispatch> {
  const command = parseCommand(inbound.text)
  if (command?.name === 'help' || command?.name === 'start') {
    return { reply: HELP, state }
  }

  const bucket = channelBucket(state, inbound.platform)
  if (!isPaired(bucket.pairedUsers, inbound.userId)) {
    return pairOrRefuse(state, limiter, inbound, now)
  }

  if (command?.name === 'status') {
    const sessionId = bucket.sessions[inbound.userId]
    return {
      reply: sessionId === undefined
        ? 'Paired. Send a message to start an Agent session.'
        : `Paired. Active session: ${sessionId}`,
      state,
    }
  }

  if (command?.name === 'new') {
    return {
      reply: 'Started a new Agent session. Send a task.',
      state: withChannelSession(state, inbound.platform, inbound.userId, undefined),
    }
  }

  if (command?.name === 'cancel') {
    return { reply: 'There is no in-flight turn to cancel from this channel yet. Use /new to drop the mapped session.', state }
  }

  if (factory === undefined) {
    return { reply: 'The desktop Agent is not ready yet. Try again in a moment.', state }
  }

  const prompt = command?.name === undefined ? inbound.text.trim() : command.rest
  if (prompt.length === 0) return { reply: HELP, state }

  try {
    const { sessionId, result } = await runChannelTurn(
      factory,
      bucket.sessions[inbound.userId],
      cwd,
      prompt,
    )
    return {
      reply: formatTurn(result),
      state: withChannelSession(state, inbound.platform, inbound.userId, sessionId),
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { reply: `Agent failed: ${message}`, state }
  }
}

/**
 * Mint a pairing code and persist it on the channel document.
 * @param state - current document.
 * @param now - current epoch milliseconds.
 * @param random - exclusive upper-bound integer generator.
 */
export function attachPairingCode(
  state: ChannelState,
  now = Date.now(),
  random?: (max: number) => number,
): { readonly state: ChannelState; readonly pairing: PairingCode } {
  const pairing = mintPairingCode(now, random)
  return { pairing, state: { ...state, pairing } }
}

function pairOrRefuse(
  state: ChannelState,
  limiter: PairingLimiter,
  inbound: ChannelInbound,
  now: number,
): ChannelDispatch {
  if (!isPairingCodeShape(inbound.text)) {
    return {
      reply: 'This desktop is locked. Open the DSH Desktop tray, generate a pairing code, then send that code here.',
      state,
    }
  }
  const bucket = channelBucket(state, inbound.platform)
  const attempt = tryPair(state.pairing, bucket.pairedUsers, limiter, inbound, inbound.text, now)
  if (!attempt.ok) {
    const reply = attempt.reason === 'rate-limited'
      ? 'Too many pairing attempts. Wait a few minutes and try again.'
      : 'That pairing code is invalid or expired. Generate a new one from the DSH Desktop tray.'
    return { reply, state }
  }
  return {
    reply: 'Paired. Send a task, or /help for commands.',
    state: {
      ...withChannelBucket(state, inbound.platform, {
        pairedUsers: attempt.users,
        sessions: bucket.sessions,
      }),
      pairing: null,
    },
  }
}

function parseCommand(text: string): { readonly name: string; readonly rest: string } | undefined {
  const match = text.trim().match(/^\/([a-z]+)(?:@\S+)?(?:\s+([\s\S]*))?$/iu)
  if (match === null || match[1] === undefined) return undefined
  return { name: match[1].toLowerCase(), rest: match[2]?.trim() ?? '' }
}

function formatTurn(result: ChannelTurnResult): string {
  const text = result.text.trim()
  if (result.error !== undefined && text === '') return `Agent error: ${result.error}`
  if (text === '') return 'The agent finished without a text reply.'
  if (result.error === undefined) return text
  return `${text}\n\n(Agent error: ${result.error})`
}
