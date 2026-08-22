/** Canonical web models aligned with CoPaw `zero-token onboard <mode>`. */

/** One row in the Zero Token authorize dropdown. */
export interface ZeroTokenWebModelRow {
  readonly id: string
  readonly onboardMode: string
  readonly labelZh: string
  readonly labelEn: string
}

/** DeepSeek tool-call encoding forwarded to the CoPaw sidecar. */
export type DeepseekToolMode = 'xml' | 'dsml'

/** Purchase page for CoPaw web Zero Token activation codes. */
export const GATEWAY_LICENSE_PURCHASE_URL = 'https://hyqibot.com/card-shop.html'

/** Loopback HTTP prefix registered on the desktop Web carrier. */
export const ZERO_TOKEN_HTTP_PREFIX = '/api/desktop-zero-token'

/** Chat-time CDP relaunch endpoint, matching cc-haha `ensure-chrome-debug`. */
export const ZERO_TOKEN_ENSURE_CHROME_DEBUG_PATH = `${ZERO_TOKEN_HTTP_PREFIX}/ensure-chrome-debug`

/** Ten web models that can be onboarded through Playwright. */
export const ZERO_TOKEN_WEB_MODELS: readonly ZeroTokenWebModelRow[] = [
  { id: 'deepseek-chat', onboardMode: 'webauth', labelZh: 'DeepSeek 网页', labelEn: 'DeepSeek Web' },
  { id: 'doubao-web', onboardMode: 'doubao', labelZh: '豆包 网页', labelEn: 'Doubao Web' },
  { id: 'claude-web', onboardMode: 'claude', labelZh: 'Claude 网页', labelEn: 'Claude Web' },
  { id: 'qwen-web', onboardMode: 'qwen', labelZh: 'Qwen 网页', labelEn: 'Qwen Web' },
  { id: 'qwen-cn-web', onboardMode: 'qwen-cn', labelZh: '通义 网页', labelEn: 'Qianwen Web' },
  { id: 'kimi-web', onboardMode: 'kimi', labelZh: 'Kimi 网页', labelEn: 'Kimi Web' },
  { id: 'chatgpt-web', onboardMode: 'chatgpt', labelZh: 'ChatGPT 网页', labelEn: 'ChatGPT Web' },
  { id: 'gemini-web', onboardMode: 'gemini', labelZh: 'Gemini 网页', labelEn: 'Gemini Web' },
  { id: 'glm-web', onboardMode: 'glm', labelZh: 'GLM 网页', labelEn: 'GLM Web' },
  { id: 'glm-intl-web', onboardMode: 'glm-intl', labelZh: 'GLM 国际版 网页', labelEn: 'GLM International Web' },
]

/** Site tabs opened by webauth-ts `ensure` before onboard, matching CoPaw / cc-haha. */
export const ZERO_TOKEN_ENSURE_URLS: Readonly<Record<string, readonly string[]>> = {
  'deepseek-chat': ['https://chat.deepseek.com/'],
  'doubao-web': ['https://www.doubao.com/chat/'],
  'claude-web': ['https://claude.ai/'],
  'qwen-web': ['https://chat.qwen.ai/'],
  'qwen-cn-web': ['https://www.qianwen.com/'],
  'kimi-web': ['https://www.kimi.com/'],
  'chatgpt-web': ['https://chatgpt.com/'],
  'gemini-web': ['https://gemini.google.com/app'],
  'glm-web': ['https://chatglm.cn'],
  'glm-intl-web': ['https://chat.z.ai/'],
}

const BY_ID = new Map(ZERO_TOKEN_WEB_MODELS.map(row => [row.id, row]))

/** Default chat-picker / settings model: first CoPaw web channel. */
export const DEFAULT_ZERO_TOKEN_WEB_MODEL = ZERO_TOKEN_WEB_MODELS[0]!.id

/** Completion cap advertised on every Zero Token picker row. */
export const ZERO_TOKEN_MODEL_MAX_TOKENS = 16_384

/** Fallback context window for web channels without a larger known limit. */
export const ZERO_TOKEN_DEFAULT_CONTEXT_WINDOW = 200_000

/** One pi-ai model row installed into `llm-pi-ai.providers['zero-token'].models`. */
export interface ZeroTokenPickerModel {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  readonly maxTokens: typeof ZERO_TOKEN_MODEL_MAX_TOKENS
}

/**
 * Context window advertised for a Zero Token picker id.
 * @param modelId - canonical web id or an extra official-key model.
 */
export function contextWindowForZeroTokenModel(modelId: string): number {
  if (modelId === 'deepseek-chat' || modelId === 'gemini-web') return 1_000_000
  return ZERO_TOKEN_DEFAULT_CONTEXT_WINDOW
}

/**
 * Built-in chat-picker catalog: all ten CoPaw web models, plus an extra id
 * when the official-key path still names something outside that set.
 * @param extraModel - optional settings.model to keep selectable.
 */
export function zeroTokenPickerModels(extraModel?: string): ZeroTokenPickerModel[] {
  const models: ZeroTokenPickerModel[] = ZERO_TOKEN_WEB_MODELS.map(row => ({
    id: row.id,
    name: row.labelZh,
    contextWindow: contextWindowForZeroTokenModel(row.id),
    maxTokens: ZERO_TOKEN_MODEL_MAX_TOKENS,
  }))
  const extra = extraModel?.trim() ?? ''
  if (extra.length > 0 && !models.some(row => row.id === extra)) {
    models.push({
      id: extra,
      name: extra,
      contextWindow: contextWindowForZeroTokenModel(extra),
      maxTokens: ZERO_TOKEN_MODEL_MAX_TOKENS,
    })
  }
  return models
}

/**
 * Site URLs to open in the debug Chromium before capturing a web session.
 * @param modelId - dropdown value such as `deepseek-chat`.
 */
export function ensureUrlsForCanonicalModelId(modelId: string): string[] | null {
  const urls = ZERO_TOKEN_ENSURE_URLS[modelId]
  if (!urls?.length) return null
  return [...urls]
}

/**
 * Resolve the CoPaw onboard mode for a canonical model id.
 * @param modelId - dropdown value such as `deepseek-chat`.
 */
export function onboardModeForCanonicalModelId(modelId: string): string | null {
  return BY_ID.get(modelId)?.onboardMode ?? null
}

/**
 * Site URLs for a CoPaw onboard mode such as `webauth` or `doubao`.
 * @param mode - `onboardMode` from settings or tray.
 */
export function ensureUrlsForOnboardMode(mode: string): string[] {
  const row = ZERO_TOKEN_WEB_MODELS.find(item => item.onboardMode === mode)
  if (row === undefined) return []
  return ensureUrlsForCanonicalModelId(row.id) ?? []
}

/**
 * Normalize a DeepSeek tool-mode string.
 * @param value - user or settings value.
 */
export function normalizeDeepseekToolMode(value: string | undefined): DeepseekToolMode {
  return value === 'dsml' ? 'dsml' : 'xml'
}

/**
 * Parse `urls[]` or `modelId` from an ensure-chrome-debug JSON body.
 * @param body - POST body from the sidecar or settings page.
 */
export function parseEnsureChromeDebugRequest(body: Record<string, unknown>): string[] | null {
  const rawUrls = body.urls
  if (Array.isArray(rawUrls) && rawUrls.length > 0) {
    const urls = rawUrls.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    return urls.length > 0 ? urls : null
  }
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : ''
  if (modelId.length > 0) return ensureUrlsForCanonicalModelId(modelId)
  return null
}

/**
 * Env so the CoPaw sidecar can POST chat-time CDP relaunch back to this Host.
 * @param webServerPort - desktop Web carrier listen port.
 */
export function copawSidecarHostCallbackEnv(webServerPort: number): Record<string, string> {
  const origin = `http://127.0.0.1:${String(webServerPort)}`
  return {
    COPAW_API_BASE_URL: origin,
    COPAW_APP_URL: origin,
    COPAW_ZERO_TOKEN_ENSURE_PATH: ZERO_TOKEN_ENSURE_CHROME_DEBUG_PATH,
  }
}
