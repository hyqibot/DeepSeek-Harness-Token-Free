/** Hand-declared pi-ai route that points DSH at the remote HYQi license proxy. */

import { DEFAULT_LICENSE_SERVER_URL, normalizeLicenseServerUrl } from './zero-token-license.ts'

/** Provider route id installed into the `llm-pi-ai` settings document. */
export const HYQI_PROVIDER_ID = 'hyqi'

/** Public default chat model id shown in the picker. */
export const HYQI_MODEL_ID = 'HYQi-1.0-flash'

/** Public image model id. */
export const HYQI_IMAGE_MODEL_ID = 'HYQi-1.0-image'

/** Public video model id. */
export const HYQI_VIDEO_MODEL_ID = 'HYQi-1.0-video'

/** Credential-ref / env name pi-ai resolves for the HYQi route. */
export const HYQI_ROUTE_API_KEY_ENV = 'DSH_HYQI_SESSION_TOKEN'

/**
 * Placeholder Bearer so the route looks configured before Zero-Token activation.
 * The license server treats it as an invalid session.
 */
export const HYQI_PLACEHOLDER_SESSION_TOKEN = 'dsh-hyqi-unactivated'

/** Chat-time refusal when the Zero-Token license session is missing. */
export const HYQI_UNACTIVATED_HINT = '需在设置页免token网关激活'

/** Settings-page tag that replaces the generic「自定义」label on the HYQi row. */
export const HYQI_SETTINGS_TAG = '免token+工具链强化+非网页+无需Api'

/** Default OpenAI-compatible origin on the existing license domain. */
export const DEFAULT_HYQI_BASE_URL = `${DEFAULT_LICENSE_SERVER_URL}/hyqi/v1`

/** One pi-ai model row installed into `llm-pi-ai.providers.hyqi.models`. */
export interface HyqiPickerModel {
  readonly id: string
  readonly name: string
  readonly contextWindow: 128000
  readonly maxTokens: 8192
  readonly input?: readonly ['text', 'image']
}

/** Built-in picker catalog: default HYQi plus image and video sub-models. */
export const HYQI_PICKER_MODELS: readonly HyqiPickerModel[] = [
  { id: HYQI_MODEL_ID, name: 'HYQi-1.0-flash', contextWindow: 128000, maxTokens: 8192 },
  {
    id: HYQI_IMAGE_MODEL_ID,
    name: 'HYQi-1.0-image',
    contextWindow: 128000,
    maxTokens: 8192,
    input: ['text', 'image'],
  },
  {
    id: HYQI_VIDEO_MODEL_ID,
    name: 'HYQi-1.0-video',
    contextWindow: 128000,
    maxTokens: 8192,
    input: ['text', 'image'],
  },
]

/** pi-ai provider profile for the remote HYQi OpenAI Completions proxy. */
export interface HyqiProviderProfile {
  readonly displayName: 'HYQi'
  readonly api: 'openai-completions'
  readonly baseURL: string
  readonly apiKeyEnv: typeof HYQI_ROUTE_API_KEY_ENV
  readonly headers: {
    readonly 'X-Device-Id': string
  }
  readonly models: readonly HyqiPickerModel[]
}

/**
 * Build `/hyqi/v1` on a license origin.
 * @param licenseServerUrl - `https://license.hyqibot.com` or a test origin.
 */
export function hyqiBaseUrlFromLicenseServer(licenseServerUrl: string): string {
  const origin = normalizeLicenseServerUrl(licenseServerUrl)
  return `${origin}/hyqi/v1`
}

/**
 * Build the pi-ai provider profile for HYQi.
 * @param licenseServerUrl - license origin only.
 * @param deviceId - same fingerprint sent to `/v1/activate`.
 */
export function hyqiProviderProfile(
  licenseServerUrl = DEFAULT_LICENSE_SERVER_URL,
  deviceId: string,
): HyqiProviderProfile {
  if (deviceId.trim().length === 0) {
    throw new Error('dsh-plugin-desktop: HYQi device id must be non-empty')
  }
  return {
    displayName: 'HYQi',
    api: 'openai-completions',
    baseURL: hyqiBaseUrlFromLicenseServer(licenseServerUrl),
    apiKeyEnv: HYQI_ROUTE_API_KEY_ENV,
    headers: {
      'X-Device-Id': deviceId,
    },
    models: HYQI_PICKER_MODELS,
  }
}

/**
 * Merge the HYQi route into an existing pi-ai providers dict, keyed first so
 * settings dumps list it ahead of DeepSeek.
 * @param providers - current `llm-pi-ai.providers` value.
 * @param profile - route to insert or replace.
 */
export function mergeHyqiProvider(
  providers: Readonly<Record<string, unknown>> | undefined,
  profile: HyqiProviderProfile,
): Record<string, unknown> {
  const rest = { ...providers ?? {} }
  delete rest[HYQI_PROVIDER_ID]
  return {
    [HYQI_PROVIDER_ID]: profile,
    ...rest,
  }
}

/**
 * Remove the HYQi route. Kept for tests; the live plugin no longer hides HYQi.
 * @param providers - current `llm-pi-ai.providers` value.
 */
export function removeHyqiProvider(
  providers: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (providers === undefined || providers[HYQI_PROVIDER_ID] === undefined) {
    return { ...providers ?? {} }
  }
  const next = { ...providers }
  delete next[HYQI_PROVIDER_ID]
  return next
}

/**
 * Return whether the providers dict already names the HYQi route.
 * @param providers - current `llm-pi-ai.providers` value.
 */
export function hasHyqiProvider(
  providers: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return providers?.[HYQI_PROVIDER_ID] !== undefined
}

/**
 * Move HYQi entries to the front of a provider list (chat picker / settings).
 * @param items - listed providers in the adapter's native order.
 * @param idOf - read the provider route id from one row.
 */
export function pinHyqiFirst<T>(items: readonly T[], idOf: (item: T) => string): T[] {
  const head: T[] = []
  const rest: T[] = []
  for (const item of items) {
    if (idOf(item) === HYQI_PROVIDER_ID) head.push(item)
    else rest.push(item)
  }
  return [...head, ...rest]
}
