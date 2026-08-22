/** Proxy / TLS env for the CoPaw Node sidecar (DeepSeek uses Node fetch, Doubao uses Chrome). */

import { execFileSync } from 'node:child_process'

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const

const LOOPBACK_NO_PROXY = ['localhost', '127.0.0.1', '::1'] as const

/** True when a forward-proxy environment variable is set. */
export function hasForwardProxyEnv(env: NodeJS.Dict<string> = process.env): boolean {
  return PROXY_ENV_KEYS.some(key => Boolean(env[key]?.trim()))
}

/**
 * Parse Windows Internet Settings `ProxyServer` into an HTTP proxy URL.
 * @param raw - `127.0.0.1:7890` or `http=127.0.0.1:7890;https=127.0.0.1:7890`.
 */
export function parseWindowsProxyServer(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed || /socks/i.test(trimmed)) return undefined
  const https = trimmed.match(/(?:^|;)\s*https\s*=\s*([^;]+)/i)
  const http = trimmed.match(/(?:^|;)\s*http\s*=\s*([^;]+)/i)
  const hostport = (https?.[1] ?? http?.[1] ?? (!trimmed.includes('=') ? trimmed : '')).trim()
  if (!hostport || /socks/i.test(hostport)) return undefined
  if (/^https?:\/\//i.test(hostport)) return hostport
  return `http://${hostport}`
}

/**
 * Ensure CDP loopback is not sent through a forward proxy.
 * @param existing - current `NO_PROXY` / `no_proxy`.
 */
export function mergeLoopbackNoProxy(existing?: string): string {
  const parts = (existing ?? '').split(',').map(part => part.trim()).filter(Boolean)
  for (const extra of LOOPBACK_NO_PROXY) {
    if (!parts.some(part => part.toLowerCase() === extra.toLowerCase())) parts.push(extra)
  }
  return parts.join(',')
}

/**
 * Sidecar env aligned with cc-haha: loopback `NO_PROXY` plus scoped DeepSeek TLS.
 * Do not inject Windows IE `HTTP_PROXY` — Clash TUN is transparent, and forcing
 * a mixed-port proxy makes undici `EnvHttpProxyAgent` throw `UND_ERR_INVALID_ARG`.
 * @param base - process env plus caller overrides.
 */
export function copawSidecarNetworkEnv(
  base: NodeJS.Dict<string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  const noProxy = mergeLoopbackNoProxy(base.NO_PROXY ?? base.no_proxy)
  out.NO_PROXY = noProxy
  out.no_proxy = noProxy
  if ((base.COPAW_INSECURE_TLS ?? '1').trim() !== '0') out.COPAW_INSECURE_TLS = '1'
  return out
}

/**
 * Read HKCU Internet Settings proxy when enabled. Ignores leftover ProxyServer while disabled.
 */
export function readWindowsInternetProxyUrl(): string | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    const enable = queryInternetSetting('ProxyEnable')
    if (!windowsProxyEnableOn(enable)) return undefined
    const server = queryInternetSetting('ProxyServer')
    return server ? parseWindowsProxyServer(server) : undefined
  } catch {
    return undefined
  }
}

/** True when `ProxyEnable` is a non-zero REG_DWORD. */
export function windowsProxyEnableOn(raw?: string): boolean {
  const trimmed = raw?.trim() ?? ''
  if (!trimmed) return false
  const value = trimmed.toLowerCase().startsWith('0x')
    ? Number.parseInt(trimmed, 16)
    : Number.parseInt(trimmed, 10)
  return Number.isFinite(value) && value !== 0
}

function queryInternetSetting(valueName: string): string | undefined {
  const stdout = execFileSync(
    'reg',
    ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', valueName],
    { encoding: 'utf8', windowsHide: true, timeout: 3_000 },
  )
  const match = stdout.match(new RegExp(`${valueName}\\s+REG_\\w+\\s+(\\S+)`, 'i'))
  return match?.[1]?.trim()
}
