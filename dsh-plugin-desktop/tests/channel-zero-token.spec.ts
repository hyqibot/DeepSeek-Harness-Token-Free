import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ZERO_TOKEN_GATEWAY_URL,
  DEFAULT_ZERO_TOKEN_MODEL,
  hasZeroTokenProvider,
  mergeZeroTokenProvider,
  normalizeZeroTokenGatewayUrl,
  ZERO_TOKEN_PROVIDER_ID,
  zeroTokenProviderProfile,
} from '../src/channel-zero-token.ts'
import { ZERO_TOKEN_WEB_MODELS } from '../src/zero-token-models.ts'

describe('zero-token pi-ai route', () => {
  it('keeps the gateway on localhost and strips a /v1/messages suffix', () => {
    expect(normalizeZeroTokenGatewayUrl('http://127.0.0.1:3002/v1/messages/'))
      .toBe('http://127.0.0.1:3002')
    expect(() => normalizeZeroTokenGatewayUrl('https://example.com')).toThrow('localhost')
  })

  it('merges the ten built-in web models into existing providers', () => {
    expect(DEFAULT_ZERO_TOKEN_MODEL).toBe('deepseek-chat')
    const profile = zeroTokenProviderProfile(DEFAULT_ZERO_TOKEN_GATEWAY_URL)
    expect(profile.models.map(row => row.id)).toEqual(ZERO_TOKEN_WEB_MODELS.map(row => row.id))
    expect(profile.models[0]).toEqual({
      id: 'deepseek-chat',
      name: 'DeepSeek 网页',
      contextWindow: 1_000_000,
      maxTokens: 16_384,
    })
    const providers = mergeZeroTokenProvider({ openai: { api: 'openai-completions' } }, profile)
    expect(hasZeroTokenProvider(providers)).toBe(true)
    expect(providers[ZERO_TOKEN_PROVIDER_ID]).toEqual({
      displayName: '免token',
      api: 'anthropic-messages',
      baseURL: 'http://127.0.0.1:3002',
      apiKeyEnv: 'DSH_ZERO_TOKEN_ROUTE_KEY',
      headers: {
        Authorization: 'Bearer zero-token-local',
        'x-api-key': 'zero-token-local',
      },
      models: profile.models,
    })
  })

  it('appends an official-key model that is not already in the web catalog', () => {
    const profile = zeroTokenProviderProfile(DEFAULT_ZERO_TOKEN_GATEWAY_URL, 'claude-sonnet-4-5')
    expect(profile.models.map(row => row.id)).toEqual([
      ...ZERO_TOKEN_WEB_MODELS.map(row => row.id),
      'claude-sonnet-4-5',
    ])
  })

  it('does not duplicate a web model that is already in the catalog', () => {
    const profile = zeroTokenProviderProfile(DEFAULT_ZERO_TOKEN_GATEWAY_URL, 'claude-web')
    expect(profile.models.filter(row => row.id === 'claude-web')).toHaveLength(1)
    expect(profile.models).toHaveLength(ZERO_TOKEN_WEB_MODELS.length)
  })
})
