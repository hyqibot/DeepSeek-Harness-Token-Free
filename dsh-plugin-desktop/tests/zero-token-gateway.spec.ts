import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  anthropicMessagesResponse,
  anthropicRequestPrompt,
  chatCompletionText,
  toChatCompletionsBody,
} from '../src/zero-token-protocol.ts'
import { parseChromeTargets, selectChromeChatTarget } from '../src/zero-token-cdp.ts'
import { startZeroTokenGateway } from '../src/zero-token-gateway.ts'
import { ZERO_TOKEN_SETTINGS_NAMESPACE, ZeroTokenSettingsSchema, inject, name } from '../src/zero-token.ts'
import type { ZeroTokenSettings } from '../src/zero-token.ts'

describe('zero-token gateway', () => {
  it('owns a dedicated Cordis row and localhost settings', () => {
    expect(name).toBe('desktop-zero-token')
    expect(inject).toEqual(['desktopRuntime', 'desktopProfiles', 'settings', 'webServer', 'credentials'])
    expect(String(ZERO_TOKEN_SETTINGS_NAMESPACE)).toBe('dsh-desktop-zero-token')
    expect(ZeroTokenSettingsSchema({} as ZeroTokenSettings).enabled).toBe(false)
    expect(ZeroTokenSettingsSchema({} as ZeroTokenSettings).upstream).toBe('anthropic')
    expect(ZeroTokenSettingsSchema({} as ZeroTokenSettings).licenseServerUrl).toBe('https://license.hyqibot.com')
    expect(ZeroTokenSettingsSchema({} as ZeroTokenSettings).licenseApiSecret).toBe('')
    expect(ZeroTokenSettingsSchema({} as ZeroTokenSettings).deepseekToolMode).toBe('xml')
    expect(ZeroTokenSettingsSchema({} as ZeroTokenSettings).insecureTls).toBe(true)
  })

  it('flattens Anthropic messages and maps chat completions', () => {
    const body = {
      model: 'deepseek-chat',
      system: 'be brief',
      messages: [{ role: 'user' as const, content: [{ type: 'text', text: 'hi' }] }],
    }
    expect(anthropicRequestPrompt(body)).toContain('hi')
    expect(toChatCompletionsBody(body, 'deepseek-chat').messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hi' },
    ])
    expect(chatCompletionText({
      choices: [{ message: { content: 'ok' } }],
    })).toBe('ok')
    expect(anthropicMessagesResponse('msg_1', 'm', 'ok').content).toEqual([{ type: 'text', text: 'ok' }])
  })

  it('selects a logged-in DeepSeek Chrome tab', () => {
    const targets = parseChromeTargets([
      { type: 'page', url: 'https://example.com/', webSocketDebuggerUrl: 'ws://127.0.0.1/1' },
      { type: 'page', url: 'https://chat.deepseek.com/', webSocketDebuggerUrl: 'ws://127.0.0.1/2' },
    ])
    expect(selectChromeChatTarget(targets)?.webSocketDebuggerUrl).toBe('ws://127.0.0.1/2')
  })

  it('serves /v1/messages through an official API key without cc-haha', async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        content: [{ type: 'text', text: 'from-anthropic' }],
      }))
    })
    await new Promise<void>(resolve => { upstream.listen(0, '127.0.0.1', resolve) })
    const address = upstream.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const request: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.startsWith('https://api.anthropic.com/')) {
        return fetch(`http://127.0.0.1:${String(port)}/v1/messages`, init)
      }
      return fetch(input, init)
    }
    const gateway = await startZeroTokenGateway({
      listenUrl: 'http://127.0.0.1:0',
      model: 'claude-sonnet-4-5',
      apiKey: 'test-key',
      upstream: 'anthropic',
      chromeDebugUrl: 'http://127.0.0.1:9222',
      request,
    })
    try {
      const response = await fetch(`${gateway.origin}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
      expect(response.ok).toBe(true)
      const payload = await response.json() as { content: Array<{ text: string }> }
      expect(payload.content[0]?.text).toBe('from-anthropic')
    } finally {
      await gateway.close()
      await new Promise<void>(resolve => { upstream.close(() => resolve()) })
    }
  })
})
