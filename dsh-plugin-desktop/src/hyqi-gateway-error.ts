/** Rewrite EdgeOne 504 HTML on HYQi chat into a stream the picker can show. */

import { interceptHyqiLocalOpenBody } from './hyqi-local-open.ts'

export const HYQI_GATEWAY_TIMEOUT_HINT =
  '网关超时，请把刚才的描述再发一次。图片约十几秒；视频请隔约一分钟再发同一段描述。'

/**
 * Return whether this URL is the public HYQi chat completions path.
 * @param url - request URL, absolute or path-only.
 */
export function hyqiChatCompletionsUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://license.hyqibot.com')
    return parsed.pathname.replace(/\/+$/, '').endsWith('/hyqi/v1/chat/completions')
  } catch {
    return /\/hyqi\/v1\/chat\/completions(?:\?|$)/.test(url)
  }
}

/**
 * OpenAI-compatible chat completions used by the agent loop (HYQi, custom providers, etc.).
 * @param url - request URL, absolute or path-only.
 */
export function agentChatCompletionsUrl(url: string): boolean {
  try {
    const parsed = new URL(url, 'https://localhost')
    const path = parsed.pathname.replace(/\/+$/, '')
    return path.endsWith('/chat/completions') || path.endsWith('/v1/chat/completions')
  } catch {
    return /\/(?:v1\/)?chat\/completions(?:\?|$)/.test(url)
  }
}

function chatBodyLooksLikeAgentLoop(body: Record<string, unknown>): boolean {
  return Array.isArray(body.messages) && Array.isArray(body.tools) && body.tools.length > 0
}

/**
 * EdgeOne kills a Pages Function with HTML; pi-ai then maps `font-weight:400` onto INVALID_REQUEST.
 * @param status - HTTP status from the gateway.
 * @param body - response text, which may be an HTML error page.
 */
export function isHyqiGatewayTimeoutBody(status: number, body: string): boolean {
  if (status === 504) return true
  return /CLOUD_FUNCTION_INVOCATION_TIMEOUT/i.test(body)
    || (/<!doctype html>/i.test(body) && /\b504\b/.test(body))
}

/** SSE body the OpenAI Completions client already knows how to read. */
export function hyqiGatewayTimeoutSse(): Response {
  const chunk = {
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: HYQI_GATEWAY_TIMEOUT_HINT }, finish_reason: null }],
  }
  const done = {
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  }
  const body = `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
    },
  })
}

async function readHyqiChatBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Record<string, unknown> | null> {
  const method = (
    init?.method
    ?? (input instanceof Request ? input.method : 'GET')
  ).toUpperCase()
  if (method !== 'POST') return null
  let text = ''
  if (typeof init?.body === 'string') text = init.body
  else if (input instanceof Request) text = await input.clone().text()
  if (text.length === 0) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
}

/**
 * Replace a gateway timeout page with an assistant SSE hint.
 * @param url - request URL.
 * @param res - upstream fetch response.
 */
export async function rewriteHyqiGatewayFetch(url: string, res: Response): Promise<Response> {
  if (!hyqiChatCompletionsUrl(url) || res.ok) return res
  const body = await res.clone().text()
  if (!isHyqiGatewayTimeoutBody(res.status, body)) return res
  return hyqiGatewayTimeoutSse()
}

/**
 * Wrap `globalThis.fetch` so HYQi chat 504 HTML is not shown as INVALID_REQUEST,
 * and local-open turns request host escalation instead of a pretend-open reply.
 * Local-open interception applies to every agent chat/completions provider, not only HYQi.
 * @returns disposer that restores the previous fetch.
 */
export function installHyqiGatewayFetchGuard(): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    if (agentChatCompletionsUrl(url)) {
      const body = await readHyqiChatBody(input, init)
      if (body !== null && chatBodyLooksLikeAgentLoop(body)) {
        const local = interceptHyqiLocalOpenBody(body)
        if (local !== null) return local
      }
    }
    const res = await original(input, init)
    return rewriteHyqiGatewayFetch(url, res)
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}
