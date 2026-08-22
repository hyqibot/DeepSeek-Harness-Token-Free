/** Discord Gateway + REST client used by the desktop channel plugin. */

/** One text message extracted from MESSAGE_CREATE. */
export interface DiscordTextMessage {
  readonly channelId: string
  readonly userId: string
  readonly displayName: string
  readonly text: string
}

/** Injectable Discord Bot surface. */
export interface DiscordTransport {
  connect(
    token: string,
    onMessage: (message: DiscordTextMessage) => void,
    signal: AbortSignal,
  ): Promise<void>
  sendMessage(token: string, channelId: string, text: string, signal: AbortSignal): Promise<void>
}

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_LIMIT = 1900
const IDENTIFY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15)

type GatewayEvent = { op: number; d?: unknown; t?: string; s?: number }

/**
 * Split a reply so each chunk stays under Discord's text limit.
 * @param text - complete reply.
 */
export function splitDiscordText(text: string): readonly string[] {
  if (text.length <= DISCORD_LIMIT) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > DISCORD_LIMIT) {
    const window = remaining.slice(0, DISCORD_LIMIT)
    const breakAt = window.lastIndexOf('\n')
    const length = breakAt >= DISCORD_LIMIT / 2 ? breakAt : DISCORD_LIMIT
    chunks.push(remaining.slice(0, length).trimEnd())
    remaining = remaining.slice(length).trimStart()
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

/**
 * Parse a MESSAGE_CREATE payload, ignoring bots and empty content.
 * @param payload - Gateway dispatch body.
 */
export function parseDiscordMessageCreate(payload: unknown): DiscordTextMessage | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  if (typeof record.content !== 'string' || record.content.trim() === '') return undefined
  if (typeof record.channel_id !== 'string' || record.channel_id.length === 0) return undefined
  const author = record.author
  if (author === null || typeof author !== 'object' || Array.isArray(author)) return undefined
  const from = author as Record<string, unknown>
  if (from.bot === true) return undefined
  if (typeof from.id !== 'string' || from.id.length === 0) return undefined
  const username = typeof from.global_name === 'string' && from.global_name.length > 0
    ? from.global_name
    : typeof from.username === 'string' && from.username.length > 0
      ? from.username
      : from.id
  return {
    channelId: record.channel_id,
    userId: from.id,
    displayName: username,
    text: record.content,
  }
}

/**
 * Fetch-backed Discord Bot client using the official Gateway.
 * @param request - injectable fetch.
 * @param webSocket - injectable WebSocket constructor.
 */
export function createDiscordTransport(
  request: typeof fetch = fetch,
  webSocket: typeof WebSocket = WebSocket,
): DiscordTransport {
  return {
    async connect(token, onMessage, signal) {
      const gateway = await request(`${DISCORD_API}/gateway/bot`, {
        headers: { authorization: `Bot ${token}` },
        signal,
      })
      if (!gateway.ok) throw new Error(`discord gateway bot failed: ${String(gateway.status)}`)
      const body: unknown = await gateway.json()
      const url = discordGatewayUrl(body)
      await runDiscordGateway(webSocket, token, url, onMessage, signal)
    },
    async sendMessage(token, channelId, text, signal) {
      for (const chunk of splitDiscordText(text)) {
        const response = await request(`${DISCORD_API}/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            authorization: `Bot ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ content: chunk }),
          signal,
        })
        if (!response.ok) {
          throw new Error(`discord sendMessage failed: ${String(response.status)}`)
        }
      }
    },
  }
}

/**
 * Mask a bot token for logs and tray labels.
 * @param token - raw bot token.
 */
export function maskSecret(token: string): string {
  if (token.length < 8) return '(invalid token)'
  return `${token.slice(0, 4)}…${token.slice(-3)}`
}

function discordGatewayUrl(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('discord gateway bot returned a non-object')
  }
  const url = (body as Record<string, unknown>).url
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('discord gateway bot omitted url')
  }
  const parsed = new URL(url)
  parsed.searchParams.set('v', '10')
  parsed.searchParams.set('encoding', 'json')
  return parsed.toString()
}

async function runDiscordGateway(
  webSocket: typeof WebSocket,
  token: string,
  url: string,
  onMessage: (message: DiscordTextMessage) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return
  const socket = new webSocket(url)
  let seq: number | null = null
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const closed = new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      socket.close()
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    socket.addEventListener('close', () => {
      signal.removeEventListener('abort', onAbort)
      if (heartbeat !== undefined) clearInterval(heartbeat)
      if (signal.aborted) resolve()
      else reject(new Error('discord gateway closed'))
    })
    socket.addEventListener('error', () => {
      if (!signal.aborted) reject(new Error('discord gateway error'))
    })
    socket.addEventListener('message', (event) => {
      const parsed = parseGatewayEvent(event.data)
      if (parsed === undefined) return
      if (typeof parsed.s === 'number') seq = parsed.s
      if (parsed.op === 10) {
        const hello = parsed.d
        const interval = hello !== null && typeof hello === 'object' && !Array.isArray(hello)
          && typeof (hello as Record<string, unknown>).heartbeat_interval === 'number'
          ? (hello as { heartbeat_interval: number }).heartbeat_interval
          : 41_250
        socket.send(JSON.stringify({
          op: 2,
          d: {
            token,
            intents: IDENTIFY_INTENTS,
            properties: { os: process.platform, browser: 'dsh-plugin-desktop', device: 'dsh-desktop' },
          },
        }))
        heartbeat = setInterval(() => {
          socket.send(JSON.stringify({ op: 1, d: seq }))
        }, interval)
      }
      if (parsed.op === 0 && parsed.t === 'MESSAGE_CREATE') {
        const message = parseDiscordMessageCreate(parsed.d)
        if (message !== undefined) onMessage(message)
      }
    })
  })
  await closed
}

function parseGatewayEvent(data: unknown): GatewayEvent | undefined {
  const text = typeof data === 'string' ? data : data instanceof ArrayBuffer
    ? new TextDecoder().decode(data)
    : undefined
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as GatewayEvent
  } catch {
    return undefined
  }
}
