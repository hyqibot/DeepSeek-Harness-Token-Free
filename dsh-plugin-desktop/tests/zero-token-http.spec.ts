import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { dispatchZeroTokenHttp, type ZeroTokenHttpController } from '../src/zero-token-http.ts'
import {
  ZERO_TOKEN_ENSURE_CHROME_DEBUG_PATH,
  ZERO_TOKEN_HTTP_PREFIX,
  copawSidecarHostCallbackEnv,
  ensureUrlsForCanonicalModelId,
  ensureUrlsForOnboardMode,
  onboardModeForCanonicalModelId,
  parseEnsureChromeDebugRequest,
} from '../src/zero-token-models.ts'
import { formatZeroTokenStatusRaw, zeroTokenListenStatus } from '../src/zero-token-status.ts'

function sampleStatus() {
  return {
    status: zeroTokenListenStatus('http://127.0.0.1:3002', false, 7804),
    webModels: [{ id: 'deepseek-chat', onboardMode: 'webauth' }],
    deepseekToolMode: 'xml' as const,
    insecureTls: true,
    license: {
      required: true,
      verified: true,
      activationCodeMasked: '********9787',
      activationCode: null,
      endtime: '2026-09-28 20:29:07',
      remark: null,
      lastError: null,
    },
    defaultRoute: true,
  }
}

function controller(overrides: Partial<ZeroTokenHttpController> = {}): ZeroTokenHttpController {
  return {
    snapshot: () => sampleStatus(),
    start: async () => sampleStatus().status,
    stop: async () => zeroTokenListenStatus('http://127.0.0.1:3002', false, null),
    stopKeepalive: async () => undefined,
    activate: async () => sampleStatus().license,
    logout: async () => ({ ...sampleStatus().license, verified: false, activationCodeMasked: null, endtime: null }),
    setDeepseekToolMode: async mode => ({ deepseekToolMode: mode, restartRequired: true }),
    setInsecureTls: async enabled => ({ insecureTls: enabled, restartRequired: true }),
    setDefault: async () => ({ defaultRoute: true }),
    authorize: async (_modelId, onEvent) => {
      onEvent({ type: 'phase', phase: 'ensure' })
      onEvent({ type: 'phase', phase: 'onboard' })
      onEvent({ type: 'phase', phase: 'keepalive' })
      onEvent({ type: 'complete', result: { modelId: 'deepseek-chat' } })
    },
    ensureChromeDebug: async urls => ({ urls, output: 'ok', result: { started: true } }),
    ...overrides,
  }
}

async function listen(handler: ZeroTokenHttpController): Promise<{ origin: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void dispatchZeroTokenHttp(req, res, handler)
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
    }),
  }
}

describe('zero-token status line', () => {
  it('matches the cc-haha raw listen format', () => {
    expect(formatZeroTokenStatusRaw({
      listening: false,
      pid: 7804,
      host: '127.0.0.1',
      port: 3002,
    })).toBe('direct: listening=false pid=7804 127.0.0.1:3002')
  })

  it('maps DeepSeek web authorize onto CoPaw webauth', () => {
    expect(onboardModeForCanonicalModelId('deepseek-chat')).toBe('webauth')
    expect(ensureUrlsForCanonicalModelId('deepseek-chat')).toEqual(['https://chat.deepseek.com/'])
    expect(onboardModeForCanonicalModelId('unknown')).toBeNull()
    expect(ensureUrlsForCanonicalModelId('unknown')).toBeNull()
    expect(ensureUrlsForOnboardMode('webauth')).toEqual(['https://chat.deepseek.com/'])
    expect(ensureUrlsForOnboardMode('doubao')).toEqual(['https://www.doubao.com/chat/'])
    expect(ensureUrlsForOnboardMode('nope')).toEqual([])
  })

  it('parses ensure-chrome-debug bodies and points the sidecar at this Host', () => {
    expect(parseEnsureChromeDebugRequest({ urls: ['https://chatgpt.com/'] })).toEqual(['https://chatgpt.com/'])
    expect(parseEnsureChromeDebugRequest({ modelId: 'doubao-web' })).toEqual(['https://www.doubao.com/chat/'])
    expect(parseEnsureChromeDebugRequest({ modelId: 'deepseek-chat' })).toEqual(['https://chat.deepseek.com/'])
    expect(parseEnsureChromeDebugRequest({ urls: [] })).toBeNull()
    expect(parseEnsureChromeDebugRequest({})).toBeNull()
    expect(copawSidecarHostCallbackEnv(4173)).toEqual({
      COPAW_API_BASE_URL: 'http://127.0.0.1:4173',
      COPAW_APP_URL: 'http://127.0.0.1:4173',
      COPAW_ZERO_TOKEN_ENSURE_PATH: ZERO_TOKEN_ENSURE_CHROME_DEBUG_PATH,
    })
    expect(ZERO_TOKEN_ENSURE_CHROME_DEBUG_PATH).toBe(`${ZERO_TOKEN_HTTP_PREFIX}/ensure-chrome-debug`)
  })
})

describe('zero-token settings HTTP', () => {
  it(`owns the ${ZERO_TOKEN_HTTP_PREFIX} loopback prefix`, async () => {
    const server = await listen(controller())
    try {
      const response = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/status`)
      expect(response.ok).toBe(true)
      const body = await response.json() as { status: { raw: string; listening: boolean }; license: { verified: boolean } }
      expect(body.status.raw).toBe('direct: listening=false pid=7804 127.0.0.1:3002')
      expect(body.status.listening).toBe(false)
      expect(body.license.verified).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('starts, stops, and changes the DeepSeek tool mode', async () => {
    const start = vi.fn(async () => zeroTokenListenStatus('http://127.0.0.1:3002', true, 12))
    const stop = vi.fn(async () => zeroTokenListenStatus('http://127.0.0.1:3002', false, null))
    const setDeepseekToolMode = vi.fn(async () => ({ deepseekToolMode: 'dsml' as const, restartRequired: true }))
    const server = await listen(controller({ start, stop, setDeepseekToolMode }))
    try {
      const started = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/start`, { method: 'POST', body: '{}' })
      expect(started.ok).toBe(true)
      expect(((await started.json()) as { status: { listening: boolean } }).status.listening).toBe(true)
      const stopped = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/stop`, { method: 'POST', body: '{}' })
      expect(((await stopped.json()) as { status: { listening: boolean } }).status.listening).toBe(false)
      const mode = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/deepseek-tool-mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'dsml' }),
      })
      expect(await mode.json()).toEqual({ deepseekToolMode: 'dsml', restartRequired: true })
      expect(start).toHaveBeenCalledOnce()
      expect(stop).toHaveBeenCalledOnce()
    } finally {
      await server.close()
    }
  })

  it('toggles scoped DeepSeek TLS relaxation on the Zero-Token page', async () => {
    const setInsecureTls = vi.fn(async (enabled: boolean) => ({ insecureTls: enabled, restartRequired: true }))
    const server = await listen(controller({ setInsecureTls }))
    try {
      const response = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/insecure-tls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ insecureTls: false }),
      })
      expect(response.ok).toBe(true)
      expect(await response.json()).toEqual({ insecureTls: false, restartRequired: true })
      expect(setInsecureTls).toHaveBeenCalledWith(false)
      const rejected = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/insecure-tls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(rejected.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('streams authorize NDJSON', async () => {
    const server = await listen(controller())
    try {
      const response = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
        body: JSON.stringify({ modelId: 'deepseek-chat' }),
      })
      expect(response.ok).toBe(true)
      const text = await response.text()
      expect(text).toContain('"phase":"ensure"')
      expect(text).toContain('"phase":"onboard"')
      expect(text).toContain('"phase":"keepalive"')
      expect(text).toContain('"type":"complete"')
    } finally {
      await server.close()
    }
  })

  it('returns the sidecar start error instead of a silent 200', async () => {
    const start = vi.fn(async () => {
      throw new Error('CoPaw Zero Token sidecar exited 1: No such built-in module: node:undici')
    })
    const server = await listen(controller({ start }))
    try {
      const response = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/start`, {
        method: 'POST',
        body: '{}',
      })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        error: 'CoPaw Zero Token sidecar exited 1: No such built-in module: node:undici',
      })
    } finally {
      await server.close()
    }
  })

  it('stops Chrome CDP keepalive without stopping the gateway', async () => {
    const stopKeepalive = vi.fn(async () => undefined)
    const server = await listen(controller({ stopKeepalive }))
    try {
      const response = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/stop-keepalive`, {
        method: 'POST',
        body: '{}',
      })
      expect(response.ok).toBe(true)
      expect(await response.json()).toEqual({ ok: true })
      expect(stopKeepalive).toHaveBeenCalledOnce()
    } finally {
      await server.close()
    }
  })

  it('rejects unknown authorize models', async () => {
    const server = await listen(controller())
    try {
      const response = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'not-a-model' }),
      })
      expect(response.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('relaunches Chrome debug from urls[] or a CDP model id', async () => {
    const ensureChromeDebug = vi.fn(async (urls: string[]) => ({
      urls,
      output: 'started',
      result: { started: true },
    }))
    const server = await listen(controller({ ensureChromeDebug }))
    try {
      const byUrls = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/ensure-chrome-debug`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: ['https://www.doubao.com/chat/'] }),
      })
      expect(byUrls.ok).toBe(true)
      expect(await byUrls.json()).toEqual({
        urls: ['https://www.doubao.com/chat/'],
        output: 'started',
        result: { started: true },
      })
      const byModel = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/ensure-chrome-debug`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: 'chatgpt-web' }),
      })
      expect(await byModel.json()).toEqual({
        urls: ['https://chatgpt.com/'],
        output: 'started',
        result: { started: true },
      })
      expect(ensureChromeDebug).toHaveBeenNthCalledWith(1, ['https://www.doubao.com/chat/'])
      expect(ensureChromeDebug).toHaveBeenNthCalledWith(2, ['https://chatgpt.com/'])
      const missing = await fetch(`${server.origin}${ZERO_TOKEN_HTTP_PREFIX}/ensure-chrome-debug`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(missing.status).toBe(400)
    } finally {
      await server.close()
    }
  })
})
