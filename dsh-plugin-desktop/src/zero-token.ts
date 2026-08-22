/** Cordis Host plugin: in-process Zero Token Anthropic Messages gateway. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  DEFAULT_ZERO_TOKEN_GATEWAY_URL,
  DEFAULT_ZERO_TOKEN_MODEL,
  hasZeroTokenProvider,
  ZERO_TOKEN_LOCAL_API_KEY,
  ZERO_TOKEN_PROVIDER_ID,
  ZERO_TOKEN_ROUTE_API_KEY_ENV,
  zeroTokenProviderProfile,
} from './channel-zero-token.ts'
import {
  llmPiAiProviderPatchNeeded,
  patchLlmPiAiProvider,
} from './llm-pi-ai-provider-patch.ts'
import {
  activateLicense,
  buildLicenseSpawnEnv,
  DEFAULT_LICENSE_HEARTBEAT_MS,
  DEFAULT_LICENSE_SERVER_URL,
  ensureLicenseForCopaw,
  licenseCheckFromRemote,
  licenseRequiredForAccess,
  readLicenseSession,
  remoteLogout,
  remoteSessionStatus,
  resolveLicenseApiSecret,
  resolveZeroTokenAccessMode,
  startLicenseHeartbeat,
  writeLicenseSession,
} from './zero-token-license.ts'
import {
  ensureCopawNpmDeps,
  startCopawSidecar,
  type CopawSidecar,
} from './zero-token-copaw.ts'
import {
  killPreviousKeepalive,
  runTsEnsureChromeDebugStream,
  runTsOnboard,
  runTsOnboardStream,
  spawnKeepaliveDetached,
} from './zero-token-webauth.ts'
import {
  startZeroTokenGateway,
  type ZeroTokenGateway,
  type ZeroTokenUpstream,
} from './zero-token-gateway.ts'
import { dispatchZeroTokenHttp, type ZeroTokenHttpController } from './zero-token-http.ts'
import {
  GATEWAY_LICENSE_PURCHASE_URL,
  ZERO_TOKEN_HTTP_PREFIX,
  copawSidecarHostCallbackEnv,
  ensureUrlsForCanonicalModelId,
  ensureUrlsForOnboardMode,
  onboardModeForCanonicalModelId,
  type DeepseekToolMode,
} from './zero-token-models.ts'
import {
  zeroTokenListenStatus,
  zeroTokenWebModelList,
  type GatewayLicenseStatus,
  type ZeroTokenListenStatus,
  type ZeroTokenStatusPayload,
} from './zero-token-status.ts'
import type {} from './profile-service.ts'
import type {} from './runtime.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-zero-token'

/** Settings, native tray, profile directory, and the loopback Web carrier. */
export const inject = ['desktopRuntime', 'desktopProfiles', 'settings', 'webServer', 'credentials']

/** Settings namespace for the in-process gateway. */
export const ZERO_TOKEN_SETTINGS_NAMESPACE = settingsNamespace('dsh-desktop-zero-token')

const LLM_PI_AI_NAMESPACE = settingsNamespace('llm-pi-ai')
const API_KEY_ENV = 'DSH_ZERO_TOKEN_API_KEY'
const LICENSE_CODE_ENV = 'DSH_ZERO_TOKEN_ACTIVATION_CODE'
const LICENSE_SECRET_ENV = 'DSH_LICENSE_API_SECRET'

/** User-editable Zero Token settings. */
export interface ZeroTokenSettings {
  /** Start the localhost gateway and install the pi-ai route. */
  enabled: boolean
  /** Local gateway origin advertised to pi-ai. */
  gatewayUrl: string
  /** Model id advertised by the gateway. */
  model: string
  /** Official API key; empty uses licensed CoPaw or a Chrome tab. */
  apiKey: string
  /** Upstream selected when an API key is present, or `copaw` / `chrome`. */
  upstream: ZeroTokenUpstream
  /** Chrome remote-debugging origin. */
  chromeDebugUrl: string
  /** Optional license origin for CoPaw web Zero Token. */
  licenseServerUrl: string
  /**
   * Bearer secret for `POST /v1/activate`.
   * Must match the license server; users do not fill this in the UI.
   */
  licenseApiSecret: string
  /** Purchased activation code; unused for official API keys. */
  activationCode: string
  /** `/v1/session` poll interval while CoPaw is running. */
  heartbeatMs: number
  /** CoPaw webauth-ts onboard mode (`webauth`, `claude`, …). */
  onboardMode: string
  /** DeepSeek tool-call encoding forwarded to the CoPaw sidecar. */
  deepseekToolMode: DeepseekToolMode
  /**
   * Relax TLS for `chat.deepseek.com` when Clash TUN / HTTPS MITM is in front of Node fetch.
   * Scoped by the vendored DeepSeek web client; default on to match sidecar network env.
   */
  insecureTls: boolean
}

/** Schema registered with the standard settings service. */
export const ZeroTokenSettingsSchema: z<ZeroTokenSettings> = z.object({
  enabled: z.boolean().default(false),
  gatewayUrl: z.string().default(DEFAULT_ZERO_TOKEN_GATEWAY_URL),
  model: z.string().default(DEFAULT_ZERO_TOKEN_MODEL),
  apiKey: z.string().default(''),
  upstream: z.union(['anthropic', 'deepseek', 'chrome', 'copaw'] as const).default('anthropic'),
  chromeDebugUrl: z.string().default('http://127.0.0.1:9222'),
  licenseServerUrl: z.string().default(DEFAULT_LICENSE_SERVER_URL),
  licenseApiSecret: z.string().default(''),
  activationCode: z.string().default(''),
  heartbeatMs: z.number().default(DEFAULT_LICENSE_HEARTBEAT_MS),
  onboardMode: z.string().default('webauth'),
  deepseekToolMode: z.union(['xml', 'dsml'] as const).default('xml'),
  insecureTls: z.boolean().default(true),
})

export { GATEWAY_LICENSE_PURCHASE_URL, ZERO_TOKEN_HTTP_PREFIX }

/**
 * Start the localhost gateway, merge the pi-ai route, and expose tray + settings HTTP.
 * Official API keys skip the license server. CoPaw web Zero Token requires an activation code.
 * @param ctx - Host context carrying settings, profile dir, tray, and the Web carrier.
 */
export function apply(ctx: Context): void {
  const settings = ctx.settings.register(ZERO_TOKEN_SETTINGS_NAMESPACE, ZeroTokenSettingsSchema)

  ctx.effect(() => {
    let gateway: ZeroTokenGateway | undefined
    let copaw: CopawSidecar | undefined
    let heartbeat: { stop(): void } | undefined
    let status = 'Zero Token: off'
    let refreshTray = (): void => {}
    let licenseLastError: string | null = null
    let gate: Promise<void> = Promise.resolve()

    const enqueue = (fn: () => Promise<void>): Promise<void> => {
      const next = gate.then(fn, fn)
      gate = next.then(() => undefined, () => undefined)
      return next
    }

    const apiKeyOf = (): string => {
      try {
        const env = launchEnvironmentOf(ctx).get(API_KEY_ENV)?.value?.trim() ?? ''
        if (env.length > 0) return env
      } catch {
        // Launch environment is optional in tests and headless smokes.
      }
      return settings.get().apiKey.trim()
    }

    const activationCodeOf = (): string => {
      try {
        const env = launchEnvironmentOf(ctx).get(LICENSE_CODE_ENV)?.value?.trim() ?? ''
        if (env.length > 0) return env
      } catch {
        // optional
      }
      return settings.get().activationCode.trim()
    }

    const licenseClientOf = () => {
      let envSecret = ''
      try {
        envSecret = launchEnvironmentOf(ctx).get(LICENSE_SECRET_ENV)?.value?.trim() ?? ''
      } catch {
        // optional
      }
      const current = settings.get()
      return {
        serverUrl: current.licenseServerUrl,
        apiSecret: resolveLicenseApiSecret(current.licenseApiSecret, envSecret),
      }
    }

    const ensureLocalRouteCredential = async (): Promise<void> => {
      const ref = credentialRef(ZERO_TOKEN_ROUTE_API_KEY_ENV)
      try {
        const existing = await ctx.credentials.resolve(ref)
        if (existing?.value === ZERO_TOKEN_LOCAL_API_KEY) return
        await ctx.credentials.set(ref, ZERO_TOKEN_LOCAL_API_KEY)
      } catch (cause) {
        ctx.logger.warn('dsh-plugin-desktop: Zero Token local route key was not stored')
        ctx.logger.warn(cause)
      }
    }

    const installRoute = async (): Promise<void> => {
      await ensureLocalRouteCredential()
      const current = settings.get()
      const llm = ctx.settings.get(LLM_PI_AI_NAMESPACE) as
        | { providers?: Record<string, unknown> }
        | undefined
      if (llm === undefined) {
        ctx.logger.warn('dsh-plugin-desktop: llm-pi-ai settings are unavailable; Zero Token route was not installed')
        return
      }
      let profile
      try {
        profile = zeroTokenProviderProfile(current.gatewayUrl, current.model)
      } catch (cause) {
        ctx.logger.error('dsh-plugin-desktop: Zero Token gateway URL was rejected')
        ctx.logger.error(cause)
        return
      }
      const providers = llm.providers ?? {}
      if (!llmPiAiProviderPatchNeeded(providers, ZERO_TOKEN_PROVIDER_ID, profile)) return
      await ctx.settings.update(
        LLM_PI_AI_NAMESPACE,
        patchLlmPiAiProvider(ZERO_TOKEN_PROVIDER_ID, profile),
      )
    }

    const stopHeartbeat = (): void => {
      heartbeat?.stop()
      heartbeat = undefined
    }

    const stopGateway = async (): Promise<void> => {
      stopHeartbeat()
      const activeGateway = gateway
      const activeCopaw = copaw
      gateway = undefined
      copaw = undefined
      if (activeGateway !== undefined) await activeGateway.close().catch(() => {})
      if (activeCopaw !== undefined) await activeCopaw.close().catch(() => {})
    }

    const startCopawPath = async (current: ZeroTokenSettings): Promise<void> => {
      const profileDir = ctx.desktopProfiles.current.dir
      const session = await ensureLicenseForCopaw(
        licenseClientOf(),
        profileDir,
        activationCodeOf(),
      )
      licenseLastError = null
      await ensureCopawNpmDeps()
      copaw = await startCopawSidecar({
        listenUrl: current.gatewayUrl,
        extraEnv: {
          ...buildLicenseSpawnEnv(profileDir, session.sessionToken),
          ...copawSidecarHostCallbackEnv(ctx.webServer.port),
          COPAW_ZT_DEEPSEEK_TOOL_MODE: current.deepseekToolMode,
          COPAW_INSECURE_TLS: current.insecureTls ? '1' : '0',
        },
      })
      heartbeat = startLicenseHeartbeat({
        intervalMs: current.heartbeatMs,
        check: async () => licenseCheckFromRemote(
          await remoteSessionStatus(licenseClientOf(), session.sessionToken),
        ),
        onInvalid: async () => {
          ctx.logger.warn('dsh-plugin-desktop: license heartbeat rejected the CoPaw session')
          writeLicenseSession(profileDir, null)
          await stopGateway()
          status = 'Zero Token: license expired'
          refreshTray()
        },
      })
      await installRoute()
      status = `Zero Token: CoPaw ${copaw.origin}`
    }

    const startGateway = async (): Promise<void> => {
      await stopGateway()
      const current = settings.get()
      if (!current.enabled) {
        status = 'Zero Token: off'
        refreshTray()
        return
      }
      const mode = resolveZeroTokenAccessMode(apiKeyOf(), current.upstream)
      try {
        if (licenseRequiredForAccess(mode)) {
          await startCopawPath(current)
        } else {
          gateway = await startZeroTokenGateway({
            listenUrl: current.gatewayUrl,
            model: current.model,
            apiKey: apiKeyOf(),
            upstream: current.upstream,
            chromeDebugUrl: current.chromeDebugUrl,
          })
          await installRoute()
          status = `Zero Token: ${gateway.origin}`
        }
      } catch (cause) {
        ctx.logger.error('dsh-plugin-desktop: Zero Token gateway failed to listen')
        ctx.logger.error(cause)
        const message = cause instanceof Error ? cause.message : String(cause)
        licenseLastError = message
        status = /activation code|license/i.test(message)
          ? 'Zero Token: license required'
          : 'Zero Token: listen failed'
        throw cause
      }
      refreshTray()
    }

    const activateFromSettings = async (code?: string): Promise<GatewayLicenseStatus> => {
      const trimmed = (code ?? activationCodeOf()).trim()
      try {
        if (trimmed.length > 0) {
          await settings.update({ activationCode: trimmed })
          await activateLicense(
            licenseClientOf(),
            ctx.desktopProfiles.current.dir,
            trimmed,
          )
        } else {
          await ensureLicenseForCopaw(
            licenseClientOf(),
            ctx.desktopProfiles.current.dir,
            activationCodeOf(),
          )
        }
        licenseLastError = null
        status = 'Zero Token: license active'
      } catch (cause) {
        ctx.logger.error(cause)
        licenseLastError = cause instanceof Error ? cause.message : String(cause)
        status = 'Zero Token: license required'
      }
      refreshTray()
      if (settings.get().enabled) await enqueue(startGateway)
      return licenseStatusOf()
    }

    const logoutLicense = async (): Promise<GatewayLicenseStatus> => {
      const profileDir = ctx.desktopProfiles.current.dir
      const saved = readLicenseSession(profileDir)
      if (saved) {
        await remoteLogout(licenseClientOf(), saved.sessionToken)
      }
      writeLicenseSession(profileDir, null)
      licenseLastError = null
      await stopGateway()
      status = settings.get().enabled ? 'Zero Token: license required' : 'Zero Token: off'
      refreshTray()
      return licenseStatusOf()
    }

    const licenseStatusOf = (): GatewayLicenseStatus => {
      const current = settings.get()
      const mode = resolveZeroTokenAccessMode(apiKeyOf(), current.upstream)
      const saved = readLicenseSession(ctx.desktopProfiles.current.dir)
      return {
        required: licenseRequiredForAccess(mode),
        verified: saved !== null,
        activationCodeMasked: saved?.activationCodeMasked ?? null,
        activationCode: saved?.activationCode ?? null,
        endtime: saved?.endtime ?? null,
        remark: saved?.remark ?? null,
        lastError: licenseLastError,
      }
    }

    const listenStatusOf = (): ZeroTokenListenStatus => {
      const current = settings.get()
      const pid = copaw?.pid ?? gateway?.pid ?? null
      const listening = copaw !== undefined || gateway !== undefined
      return zeroTokenListenStatus(current.gatewayUrl, listening, pid ?? null)
    }

    const snapshot = (): ZeroTokenStatusPayload => {
      const llm = ctx.settings.get(LLM_PI_AI_NAMESPACE) as
        | { providers?: Record<string, unknown> }
        | undefined
      return {
        status: listenStatusOf(),
        webModels: [...zeroTokenWebModelList()],
        deepseekToolMode: settings.get().deepseekToolMode,
        insecureTls: settings.get().insecureTls,
        license: licenseStatusOf(),
        defaultRoute: hasZeroTokenProvider(llm?.providers),
      }
    }

    const controller: ZeroTokenHttpController = {
      snapshot,
      async start() {
        const license = licenseStatusOf()
        if (license.required && !license.verified) {
          throw new Error('请先完成激活后再启动网关')
        }
        if (!settings.get().enabled) await settings.update({ enabled: true })
        await enqueue(startGateway)
        return listenStatusOf()
      },
      async stop() {
        await killPreviousKeepalive()
        if (settings.get().enabled) await settings.update({ enabled: false })
        await enqueue(startGateway)
        return listenStatusOf()
      },
      async stopKeepalive() {
        await killPreviousKeepalive()
      },
      activate: code => activateFromSettings(code),
      logout: () => logoutLicense(),
      async setDeepseekToolMode(mode) {
        const current = settings.get().deepseekToolMode
        const listening = copaw !== undefined || gateway !== undefined
        if (current !== mode) await settings.update({ deepseekToolMode: mode })
        return { deepseekToolMode: mode, restartRequired: listening && current !== mode }
      },
      async setInsecureTls(enabled) {
        const current = settings.get().insecureTls
        const listening = copaw !== undefined || gateway !== undefined
        if (current !== enabled) await settings.update({ insecureTls: enabled })
        return { insecureTls: enabled, restartRequired: listening && current !== enabled }
      },
      async setDefault() {
        await installRoute()
        return { defaultRoute: true }
      },
      async authorize(modelId, onEvent) {
        const mode = onboardModeForCanonicalModelId(modelId) ?? 'webauth'
        const urls = ensureUrlsForCanonicalModelId(modelId) ?? ['https://chat.deepseek.com/']
        await settings.update({ onboardMode: mode })
        await killPreviousKeepalive()
        onEvent({ type: 'phase', phase: 'ensure' })
        const ensure = await runTsEnsureChromeDebugStream({
          urls,
          onLine: text => { onEvent({ type: 'line', text }) },
        })
        if (ensure.exitCode !== 0) {
          const message = ensure.output.trim()
            || '无法启动 Chrome 调试端口 9222。请确认 playwright-core 已安装（网关首次启动会自动 npm install）。'
          onEvent({ type: 'error', message })
          status = 'Zero Token: onboard failed'
          refreshTray()
          return
        }
        onEvent({ type: 'phase', phase: 'onboard' })
        const result = await runTsOnboardStream({
          mode,
          onLine: text => { onEvent({ type: 'line', text }) },
        })
        if (result.exitCode !== 0) {
          const message = result.output.trim() || 'webauth-ts onboard failed.'
          onEvent({ type: 'error', message })
          status = 'Zero Token: onboard failed'
          refreshTray()
          return
        }
        onEvent({ type: 'phase', phase: 'keepalive' })
        onEvent({ type: 'line', text: '正在启动 Chrome CDP 后台保活…' })
        const cdpUrl = settings.get().chromeDebugUrl.trim()
        const extraEnv = cdpUrl.length > 0
          ? { COPAW_CHATGPT_CDP_URL: cdpUrl, ICLAW_CHATGPT_CDP_URL: cdpUrl }
          : undefined
        try {
          const keepaliveOutcome = await spawnKeepaliveDetached({
            urls,
            ...(extraEnv === undefined ? {} : { extraEnv }),
          })
          if (keepaliveOutcome === 'started') {
            onEvent({ type: 'line', text: '后台保活进程已启动（与 CoPaw 控制台行为一致）。' })
          } else if (process.env.COPAW_ZERO_TOKEN_KEEPALIVE === '0') {
            onEvent({ type: 'line', text: '已跳过后台保活（环境变量 COPAW_ZERO_TOKEN_KEEPALIVE=0）。' })
          } else {
            onEvent({ type: 'line', text: '已跳过后台保活（无可用 URL）。' })
          }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          onEvent({ type: 'error', message })
          status = 'Zero Token: keepalive failed'
          refreshTray()
          return
        }
        status = 'Zero Token: web session captured'
        refreshTray()
        await installRoute()
        onEvent({
          type: 'complete',
          result: {
            modelId,
            onboard: { mode, output: result.output },
          },
        })
      },
      async ensureChromeDebug(urls) {
        const ensure = await runTsEnsureChromeDebugStream({ urls })
        if (ensure.exitCode !== 0) {
          throw new Error(ensure.output.trim() || 'ensure_chrome_debug failed')
        }
        return { urls, output: ensure.output, result: ensure.result }
      },
    }

    const tray = ctx.desktopRuntime.registerTrayItem({
      group: 'tools',
      order: 21,
      label: () => status,
      invoke: async () => {
        if (!settings.get().enabled) await settings.update({ enabled: true })
        await enqueue(startGateway)
      },
      submenu: () => [
        {
          label: () => settings.get().enabled ? 'Restart Zero Token gateway' : 'Start Zero Token gateway',
          invoke: async () => {
            if (!settings.get().enabled) await settings.update({ enabled: true })
            await enqueue(startGateway)
          },
        },
        {
          label: () => 'Activate CoPaw license',
          invoke: async () => { await activateFromSettings() },
        },
        {
          label: () => 'Onboard web session (webauth-ts)',
          invoke: async () => {
            const result = await runTsOnboard({ mode: settings.get().onboardMode })
            if (result.exitCode === 0) {
              const urls = ensureUrlsForOnboardMode(settings.get().onboardMode)
              try {
                await spawnKeepaliveDetached({
                  urls: urls.length > 0 ? urls : ['https://chat.deepseek.com/'],
                })
              } catch (cause) {
                ctx.logger.warn('dsh-plugin-desktop: Zero Token keepalive failed after tray onboard')
                ctx.logger.warn(cause)
              }
            }
            status = result.exitCode === 0
              ? 'Zero Token: web session captured'
              : 'Zero Token: onboard failed'
            refreshTray()
            ctx.desktopRuntime.updates.notify({
              title: 'Zero Token onboard',
              body: result.exitCode === 0
                ? 'webauth-ts captured the web session.'
                : 'webauth-ts onboard failed.',
            })
          },
        },
        {
          label: () => 'Logout CoPaw license',
          invoke: async () => { await logoutLicense() },
        },
      ],
    })
    refreshTray = () => { tray.refresh() }

    const unregisterHttp = ctx.webServer.register({
      kind: 'prefix',
      path: ZERO_TOKEN_HTTP_PREFIX,
      handler: (req, res) => {
        void dispatchZeroTokenHttp(req, res, controller)
      },
    })

    const restartKeys = (value: ZeroTokenSettings): string => JSON.stringify({
      enabled: value.enabled,
      gatewayUrl: value.gatewayUrl,
      upstream: value.upstream,
      apiKey: value.apiKey,
      model: value.model,
      chromeDebugUrl: value.chromeDebugUrl,
      licenseServerUrl: value.licenseServerUrl,
      heartbeatMs: value.heartbeatMs,
      activationCode: value.activationCode,
    })

    const stopWatching = settings.watch((next, prev) => {
      if (restartKeys(next) === restartKeys(prev)) return
      void enqueue(startGateway)
    })

    void enqueue(startGateway)

    return () => {
      stopWatching()
      unregisterHttp()
      tray.dispose()
      void killPreviousKeepalive()
      void stopGateway()
    }
  }, 'dsh-plugin-desktop: Zero Token gateway')
}
