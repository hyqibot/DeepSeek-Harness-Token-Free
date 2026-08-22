/** Shared Zero Token status payload shown in Settings. */

import { zeroTokenListenPort } from './zero-token-gateway.ts'
import { normalizeZeroTokenGatewayUrl } from './channel-zero-token.ts'
import type { DeepseekToolMode } from './zero-token-models.ts'
import { ZERO_TOKEN_WEB_MODELS } from './zero-token-models.ts'

/** cc-haha-compatible gateway listen snapshot. */
export interface ZeroTokenListenStatus {
  readonly listening: boolean
  readonly pid: number | null
  readonly host: string
  readonly port: number
  readonly raw: string
}

/** Activation-code panel payload. */
export interface GatewayLicenseStatus {
  readonly required: boolean
  readonly verified: boolean
  readonly activationCodeMasked: string | null
  readonly activationCode: string | null
  readonly endtime: string | null
  readonly remark: string | null
  readonly lastError: string | null
}

/** GET /status body. */
export interface ZeroTokenStatusPayload {
  readonly status: ZeroTokenListenStatus
  readonly webModels: ReadonlyArray<{ id: string; onboardMode: string }>
  readonly deepseekToolMode: DeepseekToolMode
  readonly insecureTls: boolean
  readonly license: GatewayLicenseStatus
  readonly defaultRoute: boolean
}

/**
 * Format the status line shown under “Zero-Token 网关”.
 * @param options - listen facts.
 */
export function formatZeroTokenStatusRaw(options: {
  readonly listening: boolean
  readonly pid: number | null
  readonly host: string
  readonly port: number
}): string {
  return `direct: listening=${String(options.listening)} pid=${options.pid ?? 'unknown'} ${options.host}:${options.port}`
}

/**
 * Build the listen snapshot from the configured origin and live process.
 * @param gatewayUrl - settings origin.
 * @param listening - whether the sidecar or in-process server is up.
 * @param pid - child or Electron pid.
 */
export function zeroTokenListenStatus(
  gatewayUrl: string,
  listening: boolean,
  pid: number | null,
): ZeroTokenListenStatus {
  const origin = new URL(normalizeZeroTokenGatewayUrl(gatewayUrl))
  const host = origin.hostname
  const port = zeroTokenListenPort(gatewayUrl)
  return {
    listening,
    pid,
    host,
    port,
    raw: formatZeroTokenStatusRaw({ listening, pid, host, port }),
  }
}

/** Public web-model list for the settings dropdown. */
export function zeroTokenWebModelList(): ReadonlyArray<{ id: string; onboardMode: string }> {
  return ZERO_TOKEN_WEB_MODELS.map(row => ({ id: row.id, onboardMode: row.onboardMode }))
}
