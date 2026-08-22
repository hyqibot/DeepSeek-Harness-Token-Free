/** Telegram Bot API long-poll client used by the desktop channel plugin. */

/** One text message extracted from getUpdates. */
export interface TelegramTextMessage {
  readonly updateId: number
  readonly chatId: number
  readonly userId: string
  readonly displayName: string
  readonly text: string
}

/** Injectable Bot API surface. */
export interface TelegramTransport {
  getUpdates(token: string, offset: number, signal: AbortSignal): Promise<readonly TelegramTextMessage[]>
  sendMessage(token: string, chatId: number, text: string, signal: AbortSignal): Promise<void>
}

const TELEGRAM_LIMIT = 4000

/**
 * Split a reply so each chunk stays under Telegram's text limit.
 * @param text - complete reply.
 */
export function splitTelegramText(text: string): readonly string[] {
  if (text.length <= TELEGRAM_LIMIT) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > TELEGRAM_LIMIT) {
    const window = remaining.slice(0, TELEGRAM_LIMIT)
    const breakAt = window.lastIndexOf('\n')
    const length = breakAt >= TELEGRAM_LIMIT / 2 ? breakAt : TELEGRAM_LIMIT
    chunks.push(remaining.slice(0, length).trimEnd())
    remaining = remaining.slice(length).trimStart()
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

/**
 * Fetch-backed Telegram Bot API client.
 * @param request - injectable fetch; tests substitute a fake.
 */
export function createTelegramTransport(
  request: typeof fetch = fetch,
): TelegramTransport {
  return {
    async getUpdates(token, offset, signal) {
      const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`)
      url.searchParams.set('offset', String(offset))
      url.searchParams.set('timeout', '25')
      url.searchParams.set('allowed_updates', JSON.stringify(['message']))
      const response = await request(url, { signal })
      if (!response.ok) {
        throw new Error(`telegram getUpdates failed: ${String(response.status)}`)
      }
      const body: unknown = await response.json()
      return parseUpdates(body)
    },
    async sendMessage(token, chatId, text, signal) {
      for (const chunk of splitTelegramText(text)) {
        const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            disable_web_page_preview: true,
          }),
          signal,
        })
        if (!response.ok) {
          throw new Error(`telegram sendMessage failed: ${String(response.status)}`)
        }
      }
    },
  }
}

/**
 * Mask a bot token for logs and tray labels.
 * @param token - raw bot token.
 */
export function maskTelegramToken(token: string): string {
  if (token.length < 8) return '(invalid token)'
  return `${token.slice(0, 4)}…${token.slice(-3)}`
}

function parseUpdates(body: unknown): readonly TelegramTextMessage[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('telegram getUpdates returned a non-object')
  }
  const record = body as Record<string, unknown>
  if (record.ok !== true || !Array.isArray(record.result)) {
    throw new Error('telegram getUpdates was not ok')
  }
  const messages: TelegramTextMessage[] = []
  for (const update of record.result) {
    const parsed = parseUpdate(update)
    if (parsed !== undefined) messages.push(parsed)
  }
  return messages
}

function parseUpdate(update: unknown): TelegramTextMessage | undefined {
  if (update === null || typeof update !== 'object' || Array.isArray(update)) return undefined
  const record = update as Record<string, unknown>
  if (typeof record.update_id !== 'number') return undefined
  const message = record.message
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined
  const payload = message as Record<string, unknown>
  if (typeof payload.text !== 'string' || payload.text.trim() === '') return undefined
  const chat = payload.chat
  const from = payload.from
  if (chat === null || typeof chat !== 'object' || Array.isArray(chat)) return undefined
  if (from === null || typeof from !== 'object' || Array.isArray(from)) return undefined
  const chatId = (chat as Record<string, unknown>).id
  const userId = (from as Record<string, unknown>).id
  if (typeof chatId !== 'number' || typeof userId !== 'number') return undefined
  const firstName = (from as Record<string, unknown>).first_name
  const username = (from as Record<string, unknown>).username
  const displayName = typeof firstName === 'string' && firstName.length > 0
    ? firstName
    : typeof username === 'string' && username.length > 0
      ? username
      : String(userId)
  return {
    updateId: record.update_id,
    chatId,
    userId: String(userId),
    displayName,
    text: payload.text,
  }
}
