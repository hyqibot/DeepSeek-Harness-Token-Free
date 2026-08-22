/** Hand-declared pi-ai route that points DSH at a local Anthropic Messages gateway. */

import {
  DEFAULT_ZERO_TOKEN_WEB_MODEL,
  zeroTokenPickerModels,
  type ZeroTokenPickerModel,
} from './zero-token-models.ts'

/** Provider route id installed into the `llm-pi-ai` settings document. */
export const ZERO_TOKEN_PROVIDER_ID = 'zero-token'

/** Default local gateway used by cc-haha's Zero-Token sidecar. */
export const DEFAULT_ZERO_TOKEN_GATEWAY_URL = 'http://127.0.0.1:3002'

/** Default model id advertised by the local web gateway (DeepSeek 网页). */
export const DEFAULT_ZERO_TOKEN_MODEL = DEFAULT_ZERO_TOKEN_WEB_MODEL

/**
 * Dummy key matching cc-haha `ANTHROPIC_AUTH_TOKEN=zero-token-local`.
 * The localhost gateway authenticates the web session, not this value.
 */
export const ZERO_TOKEN_LOCAL_API_KEY = 'zero-token-local'

/** Credential-ref / env name pi-ai resolves for the Zero Token route. */
export const ZERO_TOKEN_ROUTE_API_KEY_ENV = 'DSH_ZERO_TOKEN_ROUTE_KEY'

/** pi-ai provider profile for a local Anthropic Messages gateway. */
export interface ZeroTokenProviderProfile {
  readonly displayName: '免token'
  readonly api: 'anthropic-messages'
  readonly baseURL: string
  readonly apiKeyEnv: typeof ZERO_TOKEN_ROUTE_API_KEY_ENV
  readonly headers: {
    readonly Authorization: string
    readonly 'x-api-key': string
  }
  readonly models: readonly ZeroTokenPickerModel[]
}

/**
 * Normalize a user-supplied gateway origin.
 * @param gatewayUrl - host[:port] origin, optionally with a trailing slash.
 */
export function normalizeZeroTokenGatewayUrl(gatewayUrl: string): string {
  const trimmed = gatewayUrl.trim()
  if (trimmed.length === 0) {
    throw new Error('dsh-plugin-desktop: zero-token gateway URL must be non-empty')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('dsh-plugin-desktop: zero-token gateway URL is not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('dsh-plugin-desktop: zero-token gateway URL must be http or https')
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('dsh-plugin-desktop: zero-token gateway must bind to localhost')
  }
  url.hash = ''
  url.search = ''
  const path = url.pathname.replace(/\/+$/u, '')
  url.pathname = path === '/v1' || path === '/v1/messages' ? '' : path
  return url.origin + (url.pathname === '/' ? '' : url.pathname)
}

/**
 * Build the pi-ai provider profile for one local gateway.
 * Always installs the ten CoPaw web models so the chat picker can switch
 * channels without re-authorizing. An extra `model` is appended only when it
 * is not already in that catalog (official Anthropic / DeepSeek key path).
 * @param gatewayUrl - localhost origin of the Anthropic Messages sidecar.
 * @param model - preferred / extra model id from settings.
 */
export function zeroTokenProviderProfile(
  gatewayUrl = DEFAULT_ZERO_TOKEN_GATEWAY_URL,
  model = DEFAULT_ZERO_TOKEN_MODEL,
): ZeroTokenProviderProfile {
  return {
    displayName: '免token',
    api: 'anthropic-messages',
    baseURL: normalizeZeroTokenGatewayUrl(gatewayUrl),
    apiKeyEnv: ZERO_TOKEN_ROUTE_API_KEY_ENV,
    headers: {
      Authorization: `Bearer ${ZERO_TOKEN_LOCAL_API_KEY}`,
      'x-api-key': ZERO_TOKEN_LOCAL_API_KEY,
    },
    models: zeroTokenPickerModels(model),
  }
}

/**
 * Merge the Zero Token route into an existing pi-ai providers dict.
 * @param providers - current `llm-pi-ai.providers` value.
 * @param profile - route to insert or replace.
 */
export function mergeZeroTokenProvider(
  providers: Readonly<Record<string, unknown>> | undefined,
  profile: ZeroTokenProviderProfile,
): Record<string, unknown> {
  return {
    ...providers ?? {},
    [ZERO_TOKEN_PROVIDER_ID]: profile,
  }
}

/**
 * Return whether the providers dict already names the Zero Token route.
 * @param providers - current `llm-pi-ai.providers` value.
 */
export function hasZeroTokenProvider(
  providers: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return providers?.[ZERO_TOKEN_PROVIDER_ID] !== undefined
}
