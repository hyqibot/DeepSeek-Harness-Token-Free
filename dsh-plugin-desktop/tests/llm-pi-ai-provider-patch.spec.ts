import { describe, expect, it } from 'vitest'
import { HYQI_PROVIDER_ID, hyqiProviderProfile } from '../src/channel-hyqi.ts'
import {
  llmPiAiProviderPatchNeeded,
  patchLlmPiAiProvider,
} from '../src/llm-pi-ai-provider-patch.ts'

describe('llm-pi-ai provider patch', () => {
  it('patches only one route without carrying other providers', () => {
    const profile = hyqiProviderProfile('https://license.hyqibot.com', 'DEVICE123')
    expect(patchLlmPiAiProvider(HYQI_PROVIDER_ID, profile)).toEqual({
      providers: { [HYQI_PROVIDER_ID]: profile },
    })
    expect(Object.keys(patchLlmPiAiProvider(HYQI_PROVIDER_ID, profile).providers)).toEqual([
      HYQI_PROVIDER_ID,
    ])
  })

  it('detects when a route profile changed', () => {
    const profile = hyqiProviderProfile('https://license.hyqibot.com', 'DEVICE123')
    const providers = {
      agnes: { displayName: 'NICE' },
      [HYQI_PROVIDER_ID]: profile,
    }
    expect(llmPiAiProviderPatchNeeded(providers, HYQI_PROVIDER_ID, profile)).toBe(false)
    expect(llmPiAiProviderPatchNeeded(providers, HYQI_PROVIDER_ID, {
      ...profile,
      headers: { 'X-Device-Id': 'OTHER' },
    })).toBe(true)
    expect(llmPiAiProviderPatchNeeded(providers, HYQI_PROVIDER_ID, profile)).toBe(false)
    expect(llmPiAiProviderPatchNeeded(undefined, HYQI_PROVIDER_ID, profile)).toBe(true)
  })
})
