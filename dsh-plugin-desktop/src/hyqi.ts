/** Cordis Host plugin: always show HYQi; chat requires a live Zero-Token session. */

import { watch } from 'node:fs'
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from './profile-service.ts'
import type {} from './runtime.ts'
import {
  hyqiProviderProfile,
  HYQI_PLACEHOLDER_SESSION_TOKEN,
  HYQI_PROVIDER_ID,
  HYQI_ROUTE_API_KEY_ENV,
  HYQI_UNACTIVATED_HINT,
  pinHyqiFirst,
  type HyqiProviderProfile,
} from './channel-hyqi.ts'
import {
  llmPiAiProviderPatchNeeded,
  patchLlmPiAiProvider,
} from './llm-pi-ai-provider-patch.ts'
import { installHyqiGatewayFetchGuard } from './hyqi-gateway-error.ts'
import {
  DEFAULT_LICENSE_SERVER_URL,
  getLicenseDeviceId,
  licenseCheckFromRemote,
  licenseSessionPath,
  readLicenseSession,
  remoteSessionStatus,
  writeLicenseSession,
  type LicenseCheckResult,
  type LicenseSession,
} from './zero-token-license.ts'

/** Result of applying a remote `/v1/session` poll onto the local HYQi chat gate. */
export type HyqiRemoteGate = {
  activated: boolean
  token: string
  wipe: boolean
  refreshVerifiedAt: boolean
}

function localDayKey(at: number): string {
  const date = new Date(at)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Local HYQi chat stays open only when the persisted activation was verified
 * on the machine's current calendar day.
 * @param session - persisted Zero-Token session, or null when missing.
 * @param now - clock used for the day boundary.
 */
export function hyqiLocalSessionAllowsChat(
  session: LicenseSession | null,
  now = Date.now(),
): boolean {
  if (session === null) return false
  if (!Number.isFinite(session.verifiedAt)) return false
  return localDayKey(session.verifiedAt) === localDayKey(now)
}

/**
 * Keep chat open while a remote poll is in flight, but only with a same-day
 * local record. An `ok` poll refreshes that day stamp. Unreachable yesterday
 * records do not keep HYQi chat open and are not wiped (CoPaw still uses them).
 * @param session - persisted Zero-Token session, or null when missing.
 * @param check - mapped `/v1/session` result.
 * @param now - clock used for the day boundary.
 */
export function hyqiGateFromRemoteCheck(
  session: LicenseSession | null,
  check: LicenseCheckResult,
  now = Date.now(),
): HyqiRemoteGate {
  if (session === null) {
    return { activated: false, token: HYQI_PLACEHOLDER_SESSION_TOKEN, wipe: false, refreshVerifiedAt: false }
  }
  if (check === 'invalid' || check === 'missing') {
    return { activated: false, token: HYQI_PLACEHOLDER_SESSION_TOKEN, wipe: true, refreshVerifiedAt: false }
  }
  if (check === 'ok') {
    return { activated: true, token: session.sessionToken, wipe: false, refreshVerifiedAt: true }
  }
  const today = hyqiLocalSessionAllowsChat(session, now)
  return {
    activated: today,
    token: today ? session.sessionToken : HYQI_PLACEHOLDER_SESSION_TOKEN,
    wipe: false,
    refreshVerifiedAt: false,
  }
}

/** Stable Cordis plugin name. */
export const name = 'desktop-hyqi'

/** Profile dir, settings, credentials, and the LLM directory we pin HYQi on. */
export const inject = ['desktopProfiles', 'settings', 'credentials', 'llm']

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
const ZERO_TOKEN_SETTINGS_NAMESPACE = settingsNamespace('dsh-desktop-zero-token')
const SYNC_INTERVAL_MS = 15_000

type ZeroTokenLicenseSettings = {
  licenseServerUrl?: string
}

type HyqiGate = {
  activated: boolean
}

function licenseOriginOf(ctx: Context): string {
  try {
    const current = ctx.settings.get(ZERO_TOKEN_SETTINGS_NAMESPACE) as ZeroTokenLicenseSettings | undefined
    const url = current?.licenseServerUrl?.trim() ?? ''
    if (url.length > 0) return url
  } catch {
    // Zero Token settings may be unregistered in tests.
  }
  return DEFAULT_LICENSE_SERVER_URL
}

type WritableLlm = {
  listProviders: Context['llm']['listProviders']
  listConfigurableProviders: Context['llm']['listConfigurableProviders']
  prepareCall: Context['llm']['prepareCall']
  stream: Context['llm']['stream']
}

function wrapHyqiDirectory(ctx: Context, gate: HyqiGate): () => void {
  const llm = ctx.llm as unknown as WritableLlm
  const listProviders = llm.listProviders.bind(ctx.llm)
  const listConfigurableProviders = llm.listConfigurableProviders.bind(ctx.llm)
  const prepareCall = llm.prepareCall.bind(ctx.llm)
  const stream = llm.stream.bind(ctx.llm)

  llm.listProviders = () => pinHyqiFirst(listProviders(), provider => provider.id)
  llm.listConfigurableProviders = () => pinHyqiFirst(
    listConfigurableProviders(),
    entry => entry.provider,
  )
  llm.prepareCall = (config, signal) => {
    if (config.provider === HYQI_PROVIDER_ID && !gate.activated) {
      return Promise.reject(new LlmError(HYQI_UNACTIVATED_HINT, 'UNAUTHORIZED'))
    }
    return prepareCall(config, signal)
  }
  llm.stream = (options) => {
    if (options.provider === HYQI_PROVIDER_ID && !gate.activated) {
      throw new LlmError(HYQI_UNACTIVATED_HINT, 'UNAUTHORIZED')
    }
    return stream(options)
  }

  return () => {
    llm.listProviders = listProviders
    llm.listConfigurableProviders = listConfigurableProviders
    llm.prepareCall = prepareCall
    llm.stream = stream
  }
}

/**
 * Keep the HYQi pi-ai route visible; only a live license session may chat.
 * @param ctx - Host context carrying settings, profile dir, credentials, and llm.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const uninstallFetch = installHyqiGatewayFetchGuard()
    const gate: HyqiGate = {
      activated: hyqiLocalSessionAllowsChat(readLicenseSession(ctx.desktopProfiles.current.dir)),
    }
    let unwrap = (): void => {}
    try {
      unwrap = wrapHyqiDirectory(ctx, gate)
    } catch (cause) {
      ctx.logger.warn('dsh-plugin-desktop: could not pin HYQi in the model directory')
      ctx.logger.warn(cause)
    }
    let queued: Promise<void> = Promise.resolve()
    const enqueue = (fn: () => Promise<void>): Promise<void> => {
      const next = queued.then(fn, fn)
      queued = next.then(() => undefined, () => undefined)
      return next
    }

    const sync = async (): Promise<void> => {
      const llm = ctx.settings.get(LLM_PI_AI_NAMESPACE) as
        | { providers?: Record<string, unknown> }
        | undefined
      if (llm === undefined) {
        ctx.logger.warn('dsh-plugin-desktop: llm-pi-ai settings are unavailable; HYQi route was not installed')
        return
      }

      const profileDir = ctx.desktopProfiles.current.dir
      const session = readLicenseSession(profileDir)
      const providers = llm.providers ?? {}

      const deviceId = await getLicenseDeviceId()
      let profile: HyqiProviderProfile
      try {
        profile = hyqiProviderProfile(licenseOriginOf(ctx), deviceId)
      } catch (cause) {
        ctx.logger.error('dsh-plugin-desktop: HYQi license URL was rejected')
        ctx.logger.error(cause)
        return
      }

      gate.activated = hyqiLocalSessionAllowsChat(session)

      const ref = credentialRef(HYQI_ROUTE_API_KEY_ENV)
      const writeToken = async (value: string): Promise<void> => {
        try {
          const existing = await ctx.credentials.resolve(ref)
          if (existing?.value !== value) {
            await ctx.credentials.set(ref, value)
          }
        } catch (cause) {
          ctx.logger.warn('dsh-plugin-desktop: HYQi session token was not stored')
          ctx.logger.warn(cause)
        }
      }
      await writeToken(session?.sessionToken ?? HYQI_PLACEHOLDER_SESSION_TOKEN)

      if (session !== null) {
        const remote = await remoteSessionStatus(
          { serverUrl: licenseOriginOf(ctx) },
          session.sessionToken,
        )
        const next = hyqiGateFromRemoteCheck(session, licenseCheckFromRemote(remote))
        gate.activated = next.activated
        if (next.wipe) writeLicenseSession(profileDir, null)
        else if (next.refreshVerifiedAt) {
          writeLicenseSession(profileDir, { ...session, verifiedAt: Date.now() })
        }
        await writeToken(next.wipe ? HYQI_PLACEHOLDER_SESSION_TOKEN : session.sessionToken)
      }

      if (!llmPiAiProviderPatchNeeded(providers, HYQI_PROVIDER_ID, profile)) return
      await ctx.settings.update(
        LLM_PI_AI_NAMESPACE,
        patchLlmPiAiProvider(HYQI_PROVIDER_ID, profile),
      )
    }

    const profileDir = ctx.desktopProfiles.current.dir
    const sessionFile = basename(licenseSessionPath(profileDir))
    let watcher: ReturnType<typeof watch> | undefined
    try {
      watcher = watch(profileDir, (_event, filename) => {
        const name = typeof filename === 'string' ? filename : filename == null ? '' : String(filename)
        if (name === sessionFile || name === 'desktop-zero-token-license.json') {
          void enqueue(sync)
        }
      })
    } catch (cause) {
      ctx.logger.warn('dsh-plugin-desktop: HYQi could not watch the license session file')
      ctx.logger.warn(cause)
    }
    const timer = setInterval(() => { void enqueue(sync) }, SYNC_INTERVAL_MS)
    void enqueue(sync)

    return () => {
      uninstallFetch()
      unwrap()
      watcher?.close()
      clearInterval(timer)
    }
  }, 'dsh-plugin-desktop: HYQi remote model')
}
