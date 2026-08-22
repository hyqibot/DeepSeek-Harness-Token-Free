/** Localhost Anthropic Messages gateway owned by DSH Desktop. */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import {
  anthropicMessagesResponse,
  anthropicRequestPrompt,
  anthropicResponseText,
  chatCompletionText,
  parseAnthropicMessagesRequest,
  toChatCompletionsBody,
  type AnthropicMessagesRequest,
} from './zero-token-protocol.ts'
import { completeViaChrome } from './zero-token-cdp.ts'
import { normalizeZeroTokenGatewayUrl } from './channel-zero-token.ts'

/** Upstream used when an official key is configured, or CoPaw web Zero Token. */
export type ZeroTokenUpstream = 'anthropic' | 'deepseek' | 'chrome' | 'copaw'

/** Runtime options for one gateway generation. */
export interface ZeroTokenGatewayOptions {
  readonly listenUrl: string
  readonly model: string
  readonly apiKey: string
  readonly upstream: ZeroTokenUpstream
  readonly chromeDebugUrl: string
  readonly request?: typeof fetch
  readonly webSocket?: typeof WebSocket
}

/** Running localhost gateway. */
export interface ZeroTokenGateway {
  readonly origin: string
  readonly pid: number
  close(): Promise<void>
}

/**
 * Parse the listen port from a localhost gateway URL.
 * @param listenUrl - origin such as `http://127.0.0.1:3002`.
 */
export function zeroTokenListenPort(listenUrl: string): number {
  const origin = new URL(normalizeZeroTokenGatewayUrl(listenUrl))
  if (origin.port.length > 0) return Number(origin.port)
  return origin.protocol === 'https:' ? 443 : 80
}

/**
 * Start an Anthropic Messages server bound to 127.0.0.1.
 * @param options - listen URL, model, and upstream credentials.
 */
export async function startZeroTokenGateway(options: ZeroTokenGatewayOptions): Promise<ZeroTokenGateway> {
  const origin = normalizeZeroTokenGatewayUrl(options.listenUrl)
  const port = zeroTokenListenPort(origin)
  const request = options.request ?? fetch
  const webSocket = options.webSocket ?? WebSocket
  const server = createServer((req, res) => {
    void handleGatewayRequest(req, res, options, request, webSocket)
  })
  await listenLoopback(server, port)
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  return {
    origin: `http://127.0.0.1:${String(bound)}`,
    pid: process.pid,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
    }),
  }
}

function listenLoopback(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function handleGatewayRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ZeroTokenGatewayOptions,
  request: typeof fetch,
  webSocket: typeof WebSocket,
): Promise<void> {
  try {
    if (req.socket.remoteAddress !== undefined && !isLoopbackAddress(req.socket.remoteAddress)) {
      json(res, 403, { error: { type: 'forbidden', message: 'zero-token gateway is localhost only' } })
      return
    }
    const path = req.url === undefined ? '/' : new URL(req.url, 'http://127.0.0.1').pathname
    if (req.method === 'GET' && (path === '/health' || path === '/v1/models')) {
      json(res, 200, {
        object: 'list',
        data: [{ id: options.model, object: 'model' }],
      })
      return
    }
    if (req.method !== 'POST' || (path !== '/v1/messages' && path !== '/messages')) {
      json(res, 404, { error: { type: 'not_found', message: 'use POST /v1/messages' } })
      return
    }
    const body = parseAnthropicMessagesRequest(JSON.parse(await readBody(req)))
    const text = await completePrompt(body, options, request, webSocket)
    json(res, 200, anthropicMessagesResponse(`msg_${randomUUID()}`, body.model ?? options.model, text))
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    json(res, 503, { error: { type: 'api_error', message } })
  }
}

async function completePrompt(
  body: AnthropicMessagesRequest,
  options: ZeroTokenGatewayOptions,
  request: typeof fetch,
  webSocket: typeof WebSocket,
): Promise<string> {
  const model = body.model?.trim() || options.model
  if (options.apiKey.length > 0 && options.upstream !== 'chrome') {
    return completeViaOfficialApi(body, model, options, request)
  }
  const prompt = anthropicRequestPrompt(body)
  if (prompt.trim() === '') throw new Error('zero-token gateway received an empty prompt')
  return completeViaChrome(options.chromeDebugUrl, prompt, request, webSocket, AbortSignal.timeout(120_000))
}

async function completeViaOfficialApi(
  body: AnthropicMessagesRequest,
  model: string,
  options: ZeroTokenGatewayOptions,
  request: typeof fetch,
): Promise<string> {
  if (options.upstream === 'deepseek') {
    const response = await request('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(toChatCompletionsBody(body, model)),
    })
    const payload: unknown = await response.json()
    if (!response.ok) throw new Error(`deepseek API failed: ${String(response.status)}`)
    return chatCompletionText(payload)
  }
  const response = await request('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: body.max_tokens ?? 4096,
      system: body.system,
      messages: body.messages ?? [],
      stream: false,
    }),
  })
  const payload: unknown = await response.json()
  if (!response.ok) throw new Error(`anthropic API failed: ${String(response.status)}`)
  return anthropicResponseText(payload)
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === ':ffff:127.0.0.1'
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': payload.length,
  })
  res.end(payload)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8') || '{}') })
    req.on('error', reject)
  })
}
