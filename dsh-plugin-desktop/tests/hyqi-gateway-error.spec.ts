import { describe, expect, it } from 'vitest'
import {
  HYQI_GATEWAY_TIMEOUT_HINT,
  agentChatCompletionsUrl,
  hyqiChatCompletionsUrl,
  installHyqiGatewayFetchGuard,
  isHyqiGatewayTimeoutBody,
  rewriteHyqiGatewayFetch,
} from '../src/hyqi-gateway-error.ts'

describe('HYQi gateway timeout rewrite', () => {
  it('matches the public chat completions path', () => {
    expect(hyqiChatCompletionsUrl('https://license.hyqibot.com/hyqi/v1/chat/completions')).toBe(true)
    expect(hyqiChatCompletionsUrl('https://license.hyqibot.com/v1/session')).toBe(false)
    expect(agentChatCompletionsUrl('https://apihub.agnes-ai.cn/v1/chat/completions')).toBe(true)
    expect(agentChatCompletionsUrl('https://api.deepseek.com/chat/completions')).toBe(true)
  })

  it('treats EdgeOne 504 HTML as a gateway timeout', () => {
    expect(isHyqiGatewayTimeoutBody(504, '<html>CLOUD_FUNCTION_INVOCATION_TIMEOUT</html>')).toBe(true)
    expect(isHyqiGatewayTimeoutBody(200, '{"ok":true}')).toBe(false)
  })

  it('rewrites 504 HTML into an assistant SSE hint', async () => {
    const res = await rewriteHyqiGatewayFetch(
      'https://license.hyqibot.com/hyqi/v1/chat/completions',
      new Response('<html>font-weight:400 CLOUD_FUNCTION_INVOCATION_TIMEOUT</html>', { status: 504 }),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain(HYQI_GATEWAY_TIMEOUT_HINT)
    expect(text).toContain('data: [DONE]')
    expect(text).not.toContain('<html>')
  })

  it('short-circuits a local-open chat request so DSH can show the approval prompt', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('upstream must not run for a planned local-open')
    }) as typeof fetch
    const uninstall = installHyqiGatewayFetchGuard()
    try {
      const res = await fetch('https://license.hyqibot.com/hyqi/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'HYQi-1.0-flash',
          stream: true,
          messages: [{ role: 'user', content: '打开桌面上的11.png' }],
          tools: [{
            type: 'function',
            function: {
              name: 'pwsh',
              parameters: {
                type: 'object',
                properties: {
                  command: { type: 'string' },
                  description: { type: 'string' },
                  sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
                  justification: { type: 'string' },
                },
                required: ['command', 'description'],
              },
            },
          }],
        }),
      })
      const text = await res.text()
      expect(text).toContain('danger-full-access')
      expect(text).toContain('11.png')
      expect(text).toContain('"finish_reason":"tool_calls"')
    } finally {
      uninstall()
      globalThis.fetch = original
    }
  })

  it('short-circuits local-open for custom provider chat/completions URLs', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('upstream must not run for a planned local-open')
    }) as typeof fetch
    const uninstall = installHyqiGatewayFetchGuard()
    try {
      const res = await fetch('https://apihub.agnes-ai.cn/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'agnes-2.5-flash',
          stream: true,
          messages: [{ role: 'user', content: '打开桌面上的11.png' }],
          tools: [{
            type: 'function',
            function: {
              name: 'pwsh',
              parameters: {
                type: 'object',
                properties: {
                  command: { type: 'string' },
                  description: { type: 'string' },
                  sandbox_permissions: { type: 'string', enum: ['workspace-write', 'danger-full-access'] },
                  justification: { type: 'string' },
                },
                required: ['command', 'description'],
              },
            },
          }],
        }),
      })
      const text = await res.text()
      expect(text).toContain('danger-full-access')
      expect(text).toContain('11.png')
      expect(text).toContain('"finish_reason":"tool_calls"')
    } finally {
      uninstall()
      globalThis.fetch = original
    }
  })
})
