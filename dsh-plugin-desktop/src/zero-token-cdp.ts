/** Chrome DevTools Protocol helper for the local Zero Token gateway. */

/** One Chrome page listed by `/json`. */
export interface ChromeTarget {
  readonly url: string
  readonly webSocketDebuggerUrl: string
}

const DEEPSEEK_CHAT = 'chat.deepseek.com'
const CLAUDE_CHAT = 'claude.ai'

/**
 * Select a logged-in chat tab the gateway can reuse.
 * @param targets - Chrome `/json` list.
 */
export function selectChromeChatTarget(targets: readonly ChromeTarget[]): ChromeTarget | undefined {
  return targets.find(target => target.url.includes(DEEPSEEK_CHAT))
    ?? targets.find(target => target.url.includes(CLAUDE_CHAT))
}

/**
 * Parse Chrome's `/json` listing.
 * @param value - parsed JSON.
 */
export function parseChromeTargets(value: unknown): readonly ChromeTarget[] {
  if (!Array.isArray(value)) throw new Error('chrome /json did not return an array')
  const targets: ChromeTarget[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    if (typeof record.url !== 'string' || typeof record.webSocketDebuggerUrl !== 'string') continue
    if (record.type !== undefined && record.type !== 'page') continue
    targets.push({ url: record.url, webSocketDebuggerUrl: record.webSocketDebuggerUrl })
  }
  return targets
}

/**
 * Ask a logged-in Chrome tab to complete a prompt using the page's own session.
 * @param debugOrigin - Chrome remote-debugging origin, for example `http://127.0.0.1:9222`.
 * @param prompt - flattened user prompt.
 * @param request - injectable fetch.
 * @param webSocket - injectable WebSocket constructor.
 * @param signal - cancellation.
 */
export async function completeViaChrome(
  debugOrigin: string,
  prompt: string,
  request: typeof fetch,
  webSocket: typeof WebSocket,
  signal: AbortSignal,
): Promise<string> {
  const origin = new URL(debugOrigin)
  if (origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost') {
    throw new Error('zero-token Chrome debug URL must be localhost')
  }
  const listing = await request(new URL('/json', origin), { signal })
  if (!listing.ok) throw new Error(`chrome /json failed: ${String(listing.status)}`)
  const target = selectChromeChatTarget(parseChromeTargets(await listing.json()))
  if (target === undefined) {
    throw new Error('open chat.deepseek.com or claude.ai in Chrome with remote debugging, then retry')
  }
  return evaluateInChrome(webSocket, target.webSocketDebuggerUrl, prompt, signal)
}

function evaluateInChrome(
  webSocket: typeof WebSocket,
  url: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const expression = chromeCompletionExpression(prompt)
  return new Promise((resolve, reject) => {
    const socket = new webSocket(url)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('chrome DevTools evaluate timed out'))
    }, 120_000)
    const onAbort = () => {
      clearTimeout(timer)
      socket.close()
      reject(new Error('chrome DevTools evaluate aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('chrome DevTools socket error'))
    })
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
      }))
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
      if (record.id !== 1) return
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      socket.close()
      const result = record.result
      if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
        const inner = (result as Record<string, unknown>).result
        if (inner !== null && typeof inner === 'object' && !Array.isArray(inner)) {
          const value = (inner as Record<string, unknown>).value
          if (typeof value === 'string' && value.length > 0) {
            resolve(value)
            return
          }
        }
        const exception = (result as Record<string, unknown>).exceptionDetails
        if (exception !== undefined) {
          reject(new Error(`chrome evaluate failed: ${JSON.stringify(exception)}`))
          return
        }
      }
      reject(new Error('chrome evaluate returned no text'))
    })
  })
}

function chromeCompletionExpression(prompt: string): string {
  const encoded = JSON.stringify(prompt)
  return `(async () => {
    const prompt = ${encoded};
    const origin = location.origin;
    if (origin.includes('chat.deepseek.com')) {
      const response = await fetch('/api/v0/chat/completion', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          ref_file_ids: [],
          thinking_enabled: false,
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error('deepseek web completion failed: ' + text.slice(0, 300));
      return text;
    }
    if (origin.includes('claude.ai')) {
      throw new Error('claude.ai page session is present; use an official API key in DSH Desktop Zero Token settings for tool-capable requests');
    }
    throw new Error('unsupported Chrome tab: ' + origin);
  })()`
}
