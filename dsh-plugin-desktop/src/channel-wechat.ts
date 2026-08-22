/** WeChat iLink Bot long-poll client (Tencent iLink AI channel). */

export const WECHAT_DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const CHANNEL_VERSION = '2.1.7'
const ILINK_APP_ID = 'bot'
const ILINK_APP_CLIENT_VERSION = ((2 & 0xff) << 16) | ((1 & 0xff) << 8) | (7 & 0xff)

/** One inbound WeChat text message. */
export interface WechatTextMessage {
  readonly userId: string
  readonly displayName: string
  readonly text: string
  readonly contextToken?: string
}

/** QR login start result. */
export interface WechatQrStart {
  readonly sessionKey: string
  readonly qrcode: string
  readonly qrcodeUrl: string
}

/** QR login poll result. */
export interface WechatQrPoll {
  readonly status: string
  readonly connected: boolean
  readonly botToken?: string
  readonly accountId?: string
  readonly baseUrl?: string
}

/** Injectable WeChat iLink surface. */
export interface WechatTransport {
  startQr(signal: AbortSignal): Promise<WechatQrStart>
  pollQr(qrcode: string, baseUrl: string, signal: AbortSignal): Promise<WechatQrPoll>
  getUpdates(
    token: string,
    baseUrl: string,
    cursor: string,
    signal: AbortSignal,
  ): Promise<{ readonly messages: readonly WechatTextMessage[]; readonly cursor: string }>
  sendMessage(token: string, baseUrl: string, to: string, text: string, signal: AbortSignal): Promise<void>
}

/**
 * Extract plain text from an iLink message item list.
 * @param items - message.item_list payload.
 */
export function extractWechatText(items: unknown): string {
  if (!Array.isArray(items)) return ''
  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (record.type === 1 && record.text_item !== null && typeof record.text_item === 'object') {
      const text = (record.text_item as Record<string, unknown>).text
      if (typeof text === 'string' && text.trim() !== '') return text
    }
    if (record.type === 3 && record.voice_item !== null && typeof record.voice_item === 'object') {
      const text = (record.voice_item as Record<string, unknown>).text
      if (typeof text === 'string' && text.trim() !== '') return text
    }
  }
  return ''
}

/**
 * Fetch-backed WeChat iLink client.
 * @param request - injectable fetch.
 */
export function createWechatTransport(request: typeof fetch = fetch): WechatTransport {
  return {
    async startQr(signal) {
      const raw = await ilinkGet(request, WECHAT_DEFAULT_BASE_URL, 'ilink/bot/get_bot_qrcode?bot_type=3', signal)
      const body: unknown = JSON.parse(raw)
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('wechat QR response was not an object')
      }
      const record = body as Record<string, unknown>
      if (typeof record.qrcode !== 'string' || typeof record.qrcode_img_content !== 'string') {
        throw new Error('wechat QR response omitted qrcode')
      }
      return {
        sessionKey: record.qrcode,
        qrcode: record.qrcode,
        qrcodeUrl: record.qrcode_img_content,
      }
    },
    async pollQr(qrcode, baseUrl, signal) {
      const raw = await ilinkGet(
        request,
        baseUrl,
        `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
        signal,
      )
      const body: unknown = JSON.parse(raw)
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return { status: 'wait', connected: false }
      }
      const record = body as Record<string, unknown>
      const status = typeof record.status === 'string' ? record.status : 'wait'
      if (status !== 'confirmed') {
        const redirect = typeof record.redirect_host === 'string' ? record.redirect_host : undefined
        if (redirect !== undefined) {
          return { status, connected: false, baseUrl: `https://${redirect}` }
        }
        return { status, connected: false }
      }
      if (typeof record.bot_token !== 'string' || typeof record.ilink_bot_id !== 'string') {
        return { status, connected: false }
      }
      return {
        status,
        connected: true,
        botToken: record.bot_token,
        accountId: record.ilink_bot_id,
        baseUrl: typeof record.baseurl === 'string' ? record.baseurl : baseUrl,
      }
    },
    async getUpdates(token, baseUrl, cursor, signal) {
      const body = JSON.stringify({
        get_updates_buf: cursor,
        base_info: { channel_version: CHANNEL_VERSION },
      })
      const raw = await ilinkPost(request, baseUrl, 'ilink/bot/getupdates', token, body, signal)
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { messages: [], cursor }
      }
      const record = parsed as Record<string, unknown>
      const nextCursor = typeof record.get_updates_buf === 'string' ? record.get_updates_buf : cursor
      const messages: WechatTextMessage[] = []
      if (Array.isArray(record.msgs)) {
        for (const msg of record.msgs) {
          const extracted = parseWechatMessage(msg)
          if (extracted !== undefined) messages.push(extracted)
        }
      }
      return { messages, cursor: nextCursor }
    },
    async sendMessage(token, baseUrl, to, text, signal) {
      const body = JSON.stringify({
        msg: {
          from_user_id: '',
          to_user_id: to,
          client_id: `dsh-desktop-wechat-${Date.now()}`,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text } }],
        },
        base_info: { channel_version: CHANNEL_VERSION },
      })
      await ilinkPost(request, baseUrl, 'ilink/bot/sendmessage', token, body, signal)
    },
  }
}

function parseWechatMessage(msg: unknown): WechatTextMessage | undefined {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return undefined
  const record = msg as Record<string, unknown>
  const text = extractWechatText(record.item_list)
  if (text.trim() === '') return undefined
  const userId = typeof record.from_user_id === 'string' && record.from_user_id.length > 0
    ? record.from_user_id
    : typeof record.session_id === 'string'
      ? record.session_id
      : undefined
  if (userId === undefined) return undefined
  const message: WechatTextMessage = {
    userId,
    displayName: userId,
    text,
  }
  if (typeof record.context_token === 'string') {
    return { ...message, contextToken: record.context_token }
  }
  return message
}

async function ilinkGet(
  request: typeof fetch,
  baseUrl: string,
  endpoint: string,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const response = await request(url, {
    headers: {
      'iLink-App-Id': ILINK_APP_ID,
      'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
    },
    signal,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`wechat GET ${endpoint} failed: ${String(response.status)}`)
  return text
}

async function ilinkPost(
  request: typeof fetch,
  baseUrl: string,
  endpoint: string,
  token: string,
  body: string,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL(endpoint, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  const response = await request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      Authorization: `Bearer ${token}`,
      'iLink-App-Id': ILINK_APP_ID,
      'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
    },
    body,
    signal,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`wechat POST ${endpoint} failed: ${String(response.status)}`)
  return text
}
