/** Feishu / Lark Bot REST + long-connection client. */

/** One inbound IM text event. */
export interface FeishuTextMessage {
  readonly chatId: string
  readonly receiveIdType: 'chat_id' | 'open_id'
  readonly userId: string
  readonly displayName: string
  readonly text: string
}

/** Injectable Feishu Bot surface. */
export interface FeishuTransport {
  tenantAccessToken(appId: string, appSecret: string, signal: AbortSignal): Promise<string>
  connect(
    appId: string,
    appSecret: string,
    onMessage: (message: FeishuTextMessage) => void,
    signal: AbortSignal,
  ): Promise<void>
  sendMessage(
    token: string,
    chatId: string,
    receiveIdType: 'chat_id' | 'open_id',
    text: string,
    signal: AbortSignal,
  ): Promise<void>
}

const FEISHU_OPEN = 'https://open.feishu.cn/open-apis'
const FEISHU_LIMIT = 4000

/**
 * Split a reply so each chunk stays under Feishu's text limit.
 * @param text - complete reply.
 */
export function splitFeishuText(text: string): readonly string[] {
  if (text.length <= FEISHU_LIMIT) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > FEISHU_LIMIT) {
    chunks.push(remaining.slice(0, FEISHU_LIMIT))
    remaining = remaining.slice(FEISHU_LIMIT)
  }
  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

/**
 * Parse an `im.message.receive_v1` event payload.
 * @param payload - Feishu event body.
 */
export function parseFeishuReceiveEvent(payload: unknown): FeishuTextMessage | undefined {
  const event = unwrapFeishuEvent(payload)
  if (event === undefined) return undefined
  const sender = event.sender
  const message = event.message
  if (sender === null || typeof sender !== 'object' || Array.isArray(sender)) return undefined
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return undefined
  const senderRecord = sender as Record<string, unknown>
  const messageRecord = message as Record<string, unknown>
  if (messageRecord.message_type !== 'text') return undefined
  const text = parseFeishuTextContent(messageRecord.content)
  if (text === undefined || text.trim() === '') return undefined
  const senderId = senderRecord.sender_id
  const openId = senderId !== null && typeof senderId === 'object' && !Array.isArray(senderId)
    ? (senderId as Record<string, unknown>).open_id
    : undefined
  const userId = typeof openId === 'string' && openId.length > 0
    ? openId
    : typeof senderRecord.sender_id === 'string'
      ? senderRecord.sender_id
      : undefined
  if (userId === undefined) return undefined
  const chatId = typeof messageRecord.chat_id === 'string' ? messageRecord.chat_id : userId
  const name = typeof senderRecord.sender_id === 'object' && senderRecord.sender_id !== null
    ? userId
    : userId
  return {
    chatId,
    receiveIdType: typeof messageRecord.chat_id === 'string' ? 'chat_id' : 'open_id',
    userId,
    displayName: name,
    text,
  }
}

/**
 * Fetch-backed Feishu Bot client using the official long connection.
 * @param request - injectable fetch.
 * @param webSocket - injectable WebSocket constructor.
 */
export function createFeishuTransport(
  request: typeof fetch = fetch,
  webSocket: typeof WebSocket = WebSocket,
): FeishuTransport {
  return {
    async tenantAccessToken(appId, appSecret, signal) {
      const response = await request(`${FEISHU_OPEN}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        signal,
      })
      if (!response.ok) throw new Error(`feishu tenant token failed: ${String(response.status)}`)
      const body: unknown = await response.json()
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('feishu tenant token returned a non-object')
      }
      const token = (body as Record<string, unknown>).tenant_access_token
      if (typeof token !== 'string' || token.length === 0) {
        throw new Error('feishu tenant token omitted tenant_access_token')
      }
      return token
    },
    async connect(appId, appSecret, onMessage, signal) {
      const token = await this.tenantAccessToken(appId, appSecret, signal)
      const endpoint = await request(`${FEISHU_OPEN}/callback/ws/endpoint`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
        signal,
      })
      if (!endpoint.ok) throw new Error(`feishu ws endpoint failed: ${String(endpoint.status)}`)
      const body: unknown = await endpoint.json()
      const url = feishuWsUrl(body)
      await runFeishuSocket(webSocket, url, onMessage, signal)
    },
    async sendMessage(token, chatId, receiveIdType, text, signal) {
      for (const chunk of splitFeishuText(text)) {
        const response = await request(`${FEISHU_OPEN}/im/v1/messages?receive_id_type=${receiveIdType}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: chunk }),
          }),
          signal,
        })
        if (!response.ok) {
          throw new Error(`feishu sendMessage failed: ${String(response.status)}`)
        }
      }
    },
  }
}

function unwrapFeishuEvent(payload: unknown): Record<string, unknown> | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  if (record.event !== null && typeof record.event === 'object' && !Array.isArray(record.event)) {
    return record.event as Record<string, unknown>
  }
  if (record.payload !== null && typeof record.payload === 'object' && !Array.isArray(record.payload)) {
    return unwrapFeishuEvent(record.payload)
  }
  if (record.message !== undefined) return record
  return undefined
}

function parseFeishuTextContent(content: unknown): string | undefined {
  if (typeof content !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(content)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return content
    const text = (parsed as Record<string, unknown>).text
    return typeof text === 'string' ? text : content
  } catch {
    return content
  }
}

function feishuWsUrl(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('feishu ws endpoint returned a non-object')
  }
  const record = body as Record<string, unknown>
  const data = record.data
  const nested = data !== null && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : record
  const url = nested.URL ?? nested.url
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('feishu ws endpoint omitted URL')
  }
  return url
}

async function runFeishuSocket(
  webSocket: typeof WebSocket,
  url: string,
  onMessage: (message: FeishuTextMessage) => void,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return
  const socket = new webSocket(url)
  const closed = new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      socket.close()
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
    socket.addEventListener('close', () => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) resolve()
      else reject(new Error('feishu gateway closed'))
    })
    socket.addEventListener('error', () => {
      if (!signal.aborted) reject(new Error('feishu gateway error'))
    })
    socket.addEventListener('message', (event) => {
      const text = typeof event.data === 'string' ? event.data : undefined
      if (text === undefined) return
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
      const record = parsed as Record<string, unknown>
      if (record.type === 'ping' || record.cmd === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', cmd: 'pong' }))
        return
      }
      const message = parseFeishuReceiveEvent(parsed)
      if (message !== undefined) onMessage(message)
    })
  })
  await closed
}
