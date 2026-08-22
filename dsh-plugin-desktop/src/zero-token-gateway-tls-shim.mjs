/**
 * Copied from cc-haha `zeroTokenGatewayTlsShim.mjs` for `node --import`.
 * Load undici lazily (try `node:undici`, then npm `undici`) like vendored
 * `deepseek-web-client.mjs`. Node 24 has no `node:undici`; a static import
 * exits the gateway before it listens.
 *
 * Default scoped TLS: do not patch global fetch; `deepseek-web-client.mjs`
 * relaxes TLS only for chat.deepseek.com. Set `COPAW_DEEPSEEK_SCOPED_TLS=0`
 * for the legacy global fetch patch.
 */

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
]

let dispatcherInstalled = false
let fetchPatched = false

export function shouldInstallInsecureTls() {
  return (
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
    process.env.COPAW_INSECURE_TLS === '1'
  )
}

/** Default true: TLS relax only on chat.deepseek.com via deepseek-web-client. */
export function shouldUseScopedDeepSeekTls() {
  const v = process.env.COPAW_DEEPSEEK_SCOPED_TLS
  if (v === '0' || v === 'false') return false
  return true
}

export function hasForwardProxyEnv() {
  return PROXY_ENV_KEYS.some((k) => Boolean(process.env[k]?.trim()))
}

async function importUndici() {
  try {
    return await import('node:undici')
  } catch {
    return await import('undici')
  }
}

/** @returns {Promise<boolean>} whether dispatcher was installed */
export async function installInsecureTlsDispatcher() {
  if (!shouldInstallInsecureTls()) return false
  if (dispatcherInstalled) return true
  const tlsConnect = { rejectUnauthorized: false }
  try {
    const { Agent, EnvHttpProxyAgent, setGlobalDispatcher } = await importUndici()
    if (hasForwardProxyEnv()) {
      setGlobalDispatcher(
        new EnvHttpProxyAgent({
          requestTls: tlsConnect,
          proxyTls: tlsConnect,
        }),
      )
      console.warn(
        '[copaw-zero-token-shim] TLS verification disabled (EnvHttpProxyAgent; forward proxy env detected)',
      )
    } else {
      setGlobalDispatcher(new Agent({ connect: tlsConnect }))
      console.warn(
        '[copaw-zero-token-shim] TLS verification disabled via undici setGlobalDispatcher',
      )
    }
    dispatcherInstalled = true
    return true
  } catch (err) {
    console.warn(
      '[copaw-zero-token-shim] failed to disable TLS verify:',
      (err && err.message) || err,
    )
    return false
  }
}

/** Patch global fetch so Node native fetch always uses the insecure dispatcher. */
export async function patchGlobalFetchForInsecureTls() {
  if (!shouldInstallInsecureTls() || fetchPatched) return false
  if (!(await installInsecureTlsDispatcher())) return false
  try {
    const { getGlobalDispatcher } = await importUndici()
    const dispatcher = getGlobalDispatcher()
    const originalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = function patchedInsecureFetch(input, init) {
      const next = init ? { ...init } : {}
      if (next.dispatcher === undefined) {
        next.dispatcher = dispatcher
      }
      return originalFetch(input, next)
    }
    fetchPatched = true
    console.warn(
      '[copaw-zero-token-shim] global fetch patched to use insecure TLS dispatcher',
    )
    return true
  } catch (err) {
    console.warn(
      '[copaw-zero-token-shim] failed to patch global fetch:',
      (err && err.message) || err,
    )
    return false
  }
}

if (shouldInstallInsecureTls()) {
  if (shouldUseScopedDeepSeekTls()) {
    console.warn(
      '[copaw-zero-token-shim] scoped DeepSeek TLS enabled (chat.deepseek.com only); global fetch not patched. Set COPAW_DEEPSEEK_SCOPED_TLS=0 for legacy global patch.',
    )
  } else {
    void patchGlobalFetchForInsecureTls()
  }
}
