import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HYQI_BASE_URL,
  hasHyqiProvider,
  hyqiBaseUrlFromLicenseServer,
  hyqiProviderProfile,
  HYQI_IMAGE_MODEL_ID,
  HYQI_MODEL_ID,
  HYQI_PICKER_MODELS,
  HYQI_PROVIDER_ID,
  HYQI_ROUTE_API_KEY_ENV,
  HYQI_SETTINGS_TAG,
  HYQI_UNACTIVATED_HINT,
  HYQI_VIDEO_MODEL_ID,
  mergeHyqiProvider,
  pinHyqiFirst,
  removeHyqiProvider,
} from '../src/channel-hyqi.ts'

describe('hyqi pi-ai route', () => {
  it('points OpenAI Completions at the public license HYQi prefix', () => {
    expect(DEFAULT_HYQI_BASE_URL).toBe('https://license.hyqibot.com/hyqi/v1')
    expect(hyqiBaseUrlFromLicenseServer('https://license.hyqibot.com/')).toBe(
      'https://license.hyqibot.com/hyqi/v1',
    )
    const profile = hyqiProviderProfile('https://license.hyqibot.com', 'DEVICEA12XYZ')
    expect(profile.displayName).toBe('HYQi')
    expect(profile.api).toBe('openai-completions')
    expect(profile.baseURL).toBe('https://license.hyqibot.com/hyqi/v1')
    expect(profile.apiKeyEnv).toBe(HYQI_ROUTE_API_KEY_ENV)
    expect(profile.headers).toEqual({ 'X-Device-Id': 'DEVICEA12XYZ' })
    expect(profile.models.map(model => model.id)).toEqual([
      HYQI_MODEL_ID,
      HYQI_IMAGE_MODEL_ID,
      HYQI_VIDEO_MODEL_ID,
    ])
    expect(HYQI_MODEL_ID).toBe('HYQi-1.0-flash')
    expect(HYQI_PICKER_MODELS.map(model => model.id)).not.toContain('HYQi-1.0-pro')
    expect(HYQI_PICKER_MODELS.find(model => model.id === HYQI_IMAGE_MODEL_ID)?.input)
      .toEqual(['text', 'image'])
  })

  it('merges HYQi ahead of other providers and can still remove it', () => {
    const profile = hyqiProviderProfile('https://license.hyqibot.com', 'DEVICEA12XYZ')
    const merged = mergeHyqiProvider({ openai: { api: 'openai-completions' } }, profile)
    expect(Object.keys(merged)[0]).toBe(HYQI_PROVIDER_ID)
    expect(hasHyqiProvider(merged)).toBe(true)
    expect(merged[HYQI_PROVIDER_ID]).toEqual(profile)
    expect(merged.openai).toEqual({ api: 'openai-completions' })
    const removed = removeHyqiProvider(merged)
    expect(hasHyqiProvider(removed)).toBe(false)
    expect(removed.openai).toEqual({ api: 'openai-completions' })
  })

  it('pins HYQi in front of DeepSeek in picker and settings lists', () => {
    expect(pinHyqiFirst(
      [{ id: 'deepseek-official' }, { id: 'hyqi' }, { id: 'openai' }],
      row => row.id,
    ).map(row => row.id)).toEqual(['hyqi', 'deepseek-official', 'openai'])
    expect(pinHyqiFirst(
      [{ provider: 'deepseek-official' }, { provider: 'hyqi' }],
      row => row.provider,
    ).map(row => row.provider)).toEqual(['hyqi', 'deepseek-official'])
  })

  it('sends traffic only to the license proxy origin', () => {
    const profile = hyqiProviderProfile('https://license.hyqibot.com', 'DEVICEA12XYZ')
    expect(profile.baseURL).toBe('https://license.hyqibot.com/hyqi/v1')
    expect(profile.apiKeyEnv).toBe(HYQI_ROUTE_API_KEY_ENV)
    expect(JSON.stringify(profile)).not.toMatch(/sk-/)
  })

  it('keeps the unactivated chat hint and settings tag copy stable', () => {
    expect(HYQI_UNACTIVATED_HINT).toBe('需在设置页免token网关激活')
    expect(HYQI_SETTINGS_TAG).toBe('免token+工具链强化+非网页+无需Api')
  })
})
