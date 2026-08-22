/** Optional activation-code license for the CoPaw web Zero Token path. */

import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ZeroTokenUpstream } from './zero-token-gateway.ts'

const execFileAsync = promisify(execFile)

/** Public license origin used when settings omit a custom server. */
export const DEFAULT_LICENSE_SERVER_URL = 'https://license.hyqibot.com'

/** Session poll interval while the CoPaw sidecar is running. */
export const DEFAULT_LICENSE_HEARTBEAT_MS = 5 * 60 * 1000

const SEAL_TTL_MS = 24 * 60 * 60 * 1000

/** How the gateway should reach a model. */
export type ZeroTokenAccessMode = 'official-api' | 'chrome' | 'copaw'

/** Remote activate payload. */
export type LicenseActivateResponse = {
  sessionToken: string
  endtime: string
  activationCodeMasked: string
  remark: string | null
}

/** Remote session poll payload. */
export type LicenseSessionResponse = {
  valid: boolean
  activationCodeMasked: string | null
  endtime: string | null
  remark: string | null
  networkError?: boolean
}

/** Persisted client session stored under the DSH profile. */
export type LicenseSession = {
  sessionToken: string
  endtime: string
  activationCodeMasked: string
  activationCode?: string
  remark: string | null
  verifiedAt: number
}

/** License client configuration. */
export type LicenseClientConfig = {
  readonly serverUrl: string
  readonly apiSecret?: string
  readonly request?: typeof fetch
}

/**
 * Resolve the activate Bearer token: env `DSH_LICENSE_API_SECRET`, then settings.yaml.
 * There is no compiled-in default; the issuer secret lives in private local config.
 * @param explicit - settings `licenseApiSecret`.
 * @param env - optional `DSH_LICENSE_API_SECRET`.
 */
export function resolveLicenseApiSecret(explicit?: string, env?: string): string {
  const fromEnv = env?.trim() ?? ''
  if (fromEnv.length > 0) return fromEnv
  return explicit?.trim() ?? ''
}

/**
 * Build the remote client used by activate / heartbeat / logout.
 * @param serverUrl - license origin.
 * @param apiSecret - activate Bearer token.
 * @param request - optional fetch override for tests.
 */
export function licenseClientConfig(
  serverUrl: string,
  apiSecret?: string,
  request?: typeof fetch,
): LicenseClientConfig {
  return {
    serverUrl,
    apiSecret: resolveLicenseApiSecret(apiSecret),
    ...(request ? { request } : {}),
  }
}

/** Result of one start-time or heartbeat check. */
export type LicenseCheckResult = 'ok' | 'missing' | 'invalid' | 'unreachable'

/**
 * Official API keys never need an activation code.
 * CoPaw web Zero Token does. Chrome CDP stays a no-license fallback.
 * @param apiKey - official Anthropic or DeepSeek key.
 * @param upstream - selected Zero Token upstream.
 */
export function resolveZeroTokenAccessMode(
  apiKey: string,
  upstream: ZeroTokenUpstream,
): ZeroTokenAccessMode {
  if (upstream === 'copaw') return 'copaw'
  if (upstream === 'chrome') return 'chrome'
  if (apiKey.trim().length > 0) return 'official-api'
  return 'copaw'
}

/**
 * Whether the selected access mode must present a live license session.
 * @param mode - resolved access mode.
 */
export function licenseRequiredForAccess(mode: ZeroTokenAccessMode): boolean {
  return mode === 'copaw'
}

/**
 * Strip trailing slashes from a license origin.
 * @param serverUrl - user or default license origin.
 */
export function normalizeLicenseServerUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim()
  if (trimmed.length === 0) {
    throw new Error('dsh-plugin-desktop: license server URL must be non-empty')
  }
  const url = new URL(trimmed)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('dsh-plugin-desktop: license server URL must be http or https')
  }
  url.hash = ''
  url.search = ''
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url.origin + (url.pathname === '/' ? '' : url.pathname)
}

/**
 * Profile-private session file.
 * @param profileDir - absolute DSH profile directory.
 */
export function licenseSessionPath(profileDir: string): string {
  return join(profileDir, 'desktop-zero-token-license.json')
}

/**
 * Profile-private spawn seal consumed by the vendored gateway guard.
 * @param profileDir - absolute DSH profile directory.
 */
export function licenseSealPath(profileDir: string): string {
  return join(profileDir, 'desktop-zero-token-license-seal.json')
}

/**
 * Device fingerprint used by `/v1/activate`.
 * @param cpuMd5Hex - md5 hex of a stable machine identifier.
 */
export function formatDeviceFingerprint(cpuMd5Hex: string): string {
  if (cpuMd5Hex.length < 16) return cpuMd5Hex.toUpperCase().slice(0, 12)
  return (
    cpuMd5Hex.slice(11, 14)
    + cpuMd5Hex.slice(7, 10)
    + cpuMd5Hex.slice(3, 6)
    + cpuMd5Hex.slice(cpuMd5Hex.length - 3)
  ).toUpperCase()
}

/**
 * Resolve a stable device id for license activation.
 */
export async function getLicenseDeviceId(): Promise<string> {
  const override = process.env.DSH_DEVICE_ID?.trim() || process.env.CC_HAHA_DEVICE_ID?.trim()
  if (override) return override.toUpperCase()

  let cpuMd5 = ''
  if (process.platform === 'win32') {
    const processorId = await readWindowsProcessorId()
    if (processorId) cpuMd5 = createHash('md5').update(processorId, 'utf8').digest('hex')
    if (!cpuMd5) {
      const guid = await readWindowsMachineGuid()
      if (guid) cpuMd5 = createHash('md5').update(guid, 'utf8').digest('hex')
    }
  }
  if (!cpuMd5) {
    cpuMd5 = createHash('md5').update(`${process.platform}-${process.arch}`, 'utf8').digest('hex')
  }
  return formatDeviceFingerprint(cpuMd5)
}

/**
 * POST `/v1/activate` and return the session.
 * @param cfg - license origin and optional API secret.
 * @param activationCode - purchased activation code.
 * @param deviceId - fingerprint from `getLicenseDeviceId`.
 */
export async function remoteActivate(
  cfg: LicenseClientConfig,
  activationCode: string,
  deviceId: string,
): Promise<LicenseActivateResponse> {
  const request = cfg.request ?? fetch
  const res = await request(`${normalizeLicenseServerUrl(cfg.serverUrl)}/v1/activate`, {
    method: 'POST',
    headers: licenseHeaders(cfg),
    body: JSON.stringify({ activationCode, deviceId }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(await licenseError(res))
  return (await res.json()) as LicenseActivateResponse
}

const EMPTY_SESSION_STATUS: LicenseSessionResponse = {
  valid: false,
  activationCodeMasked: null,
  endtime: null,
  remark: null,
}

/**
 * Map a `/v1/session` HTTP response onto the heartbeat enum.
 * 401/403 mean the token is gone. 5xx, HTML 504, and non-JSON bodies are outages.
 * @param status - HTTP status from the license origin or EdgeOne.
 * @param body - parsed JSON, or null when the body was not JSON.
 */
export function sessionStatusFromHttp(status: number, body: unknown): LicenseSessionResponse {
  if (status === 401 || status === 403) return { ...EMPTY_SESSION_STATUS }
  if (status < 200 || status >= 300) return { ...EMPTY_SESSION_STATUS, networkError: true }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ...EMPTY_SESSION_STATUS, networkError: true }
  }
  const row = body as Record<string, unknown>
  if (typeof row.valid !== 'boolean') return { ...EMPTY_SESSION_STATUS, networkError: true }
  return {
    valid: row.valid,
    activationCodeMasked: typeof row.activationCodeMasked === 'string' ? row.activationCodeMasked : null,
    endtime: typeof row.endtime === 'string' ? row.endtime : null,
    remark: typeof row.remark === 'string' ? row.remark : null,
  }
}

/**
 * GET `/v1/session` — the license heartbeat.
 * @param cfg - license origin.
 * @param sessionToken - token from activate.
 */
export async function remoteSessionStatus(
  cfg: LicenseClientConfig,
  sessionToken: string,
): Promise<LicenseSessionResponse> {
  const request = cfg.request ?? fetch
  try {
    const res = await request(`${normalizeLicenseServerUrl(cfg.serverUrl)}/v1/session`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return sessionStatusFromHttp(res.status, body)
  } catch {
    return { ...EMPTY_SESSION_STATUS, networkError: true }
  }
}

/**
 * POST `/v1/logout`.
 * @param cfg - license origin.
 * @param sessionToken - active token.
 */
export async function remoteLogout(cfg: LicenseClientConfig, sessionToken: string): Promise<void> {
  const request = cfg.request ?? fetch
  await request(`${normalizeLicenseServerUrl(cfg.serverUrl)}/v1/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {})
}

/**
 * Load a persisted session or null.
 * @param profileDir - absolute DSH profile directory.
 */
export function readLicenseSession(profileDir: string): LicenseSession | null {
  try {
    const parsed = JSON.parse(readFileSync(licenseSessionPath(profileDir), 'utf8')) as LicenseSession
    if (!parsed.sessionToken) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Persist or clear a license session.
 * @param profileDir - absolute DSH profile directory.
 * @param session - session to write, or null to delete.
 */
export function writeLicenseSession(profileDir: string, session: LicenseSession | null): void {
  const path = licenseSessionPath(profileDir)
  if (session === null) {
    try { unlinkSync(path) } catch { /* ignore */ }
    clearLicenseSeal(profileDir)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

/**
 * Write the spawn seal the vendored CoPaw guard expects.
 * @param profileDir - absolute DSH profile directory.
 * @param sessionToken - live session token.
 */
export function writeLicenseSeal(profileDir: string, sessionToken: string): string {
  const path = licenseSealPath(profileDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({
    seal: randomBytes(32).toString('hex'),
    expiresAt: Date.now() + SEAL_TTL_MS,
    sessionToken,
  }), 'utf8')
  return path
}

/**
 * Delete the spawn seal.
 * @param profileDir - absolute DSH profile directory.
 */
export function clearLicenseSeal(profileDir: string): void {
  try { unlinkSync(licenseSealPath(profileDir)) } catch { /* ignore */ }
}

/**
 * Environment consumed by `gateway-license-guard.mjs`.
 * @param profileDir - absolute DSH profile directory.
 * @param sessionToken - live session token.
 */
export function buildLicenseSpawnEnv(
  profileDir: string,
  sessionToken: string,
): Record<string, string> {
  return {
    CC_HAHA_REQUIRE_GATEWAY_LICENSE: '1',
    CC_HAHA_GATEWAY_LICENSE_SEAL_FILE: writeLicenseSeal(profileDir, sessionToken),
  }
}

/**
 * Activate, persist, and return the session.
 * @param cfg - license origin.
 * @param profileDir - absolute DSH profile directory.
 * @param activationCode - purchased code.
 * @param deviceId - optional override used by tests.
 */
export async function activateLicense(
  cfg: LicenseClientConfig,
  profileDir: string,
  activationCode: string,
  deviceId?: string,
): Promise<LicenseSession> {
  const trimmed = activationCode.trim()
  if (trimmed.length === 0) throw new Error('activation code must be non-empty')
  if (resolveLicenseApiSecret(cfg.apiSecret).length === 0) {
    throw new Error(
      'licenseApiSecret is not set. Add dsh-desktop-zero-token.licenseApiSecret to $DSH_HOME/settings.yaml (same role as cc-haha license.apiSecret).',
    )
  }
  const result = await remoteActivate(cfg, trimmed, deviceId ?? await getLicenseDeviceId())
  const session: LicenseSession = {
    sessionToken: result.sessionToken,
    endtime: result.endtime,
    activationCodeMasked: result.activationCodeMasked,
    activationCode: trimmed,
    remark: result.remark,
    verifiedAt: Date.now(),
  }
  writeLicenseSession(profileDir, session)
  return session
}

/**
 * Ensure a live remote session before starting CoPaw.
 * @param cfg - license origin.
 * @param profileDir - absolute DSH profile directory.
 * @param activationCode - optional code used to activate or reactivate.
 */
export async function ensureLicenseForCopaw(
  cfg: LicenseClientConfig,
  profileDir: string,
  activationCode = '',
): Promise<LicenseSession> {
  const saved = readLicenseSession(profileDir)
  if (saved) {
    const remote = await remoteSessionStatus(cfg, saved.sessionToken)
    if (remote.valid) return saved
    if (remote.networkError) {
      throw new Error('unable to reach the license server; CoPaw Zero Token was not started')
    }
    const code = activationCode.trim() || saved.activationCode?.trim() || ''
    if (code.length > 0) return activateLicense(cfg, profileDir, code)
    writeLicenseSession(profileDir, null)
    throw new Error('CoPaw Zero Token needs a valid activation code')
  }
  const code = activationCode.trim()
  if (code.length === 0) throw new Error('CoPaw Zero Token needs an activation code')
  return activateLicense(cfg, profileDir, code)
}

/**
 * Poll `/v1/session` while CoPaw is running. Invalid sessions invoke `onInvalid`.
 * Unreachable polls are ignored so a wifi drop does not kill an otherwise valid sidecar.
 * @param options - check function, interval, and invalid handler.
 */
export function startLicenseHeartbeat(options: {
  check: () => Promise<LicenseCheckResult>
  intervalMs: number
  onInvalid: () => void | Promise<void>
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}): { stop(): void } {
  const interval = options.intervalMs > 0 ? options.intervalMs : DEFAULT_LICENSE_HEARTBEAT_MS
  const setInt = options.setIntervalFn ?? setInterval
  const clearInt = options.clearIntervalFn ?? clearInterval
  const timer = setInt(() => {
    void options.check().then(result => {
      if (result === 'invalid' || result === 'missing') return options.onInvalid()
    })
  }, interval)
  return {
    stop() {
      clearInt(timer)
    },
  }
}

/**
 * Map a remote session poll onto the heartbeat result enum.
 * @param remote - `/v1/session` body.
 */
export function licenseCheckFromRemote(remote: LicenseSessionResponse): LicenseCheckResult {
  if (remote.networkError) return 'unreachable'
  return remote.valid ? 'ok' : 'invalid'
}

function licenseHeaders(cfg: LicenseClientConfig, sessionToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const secret = cfg.apiSecret?.trim() ?? ''
  if (secret.length > 0) headers.Authorization = `Bearer ${secret}`
  if (sessionToken) headers['X-Session-Token'] = sessionToken
  return headers
}

async function licenseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string }
    return body.message || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

async function readWindowsProcessorId(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', '(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty ProcessorId)'],
      { timeout: 15_000, windowsHide: true },
    )
    return stdout.trim()
  } catch {
    return ''
  }
}

async function readWindowsMachineGuid(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', "(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography' -Name MachineGuid).MachineGuid"],
      { timeout: 15_000, windowsHide: true },
    )
    return stdout.trim()
  } catch {
    return ''
  }
}
