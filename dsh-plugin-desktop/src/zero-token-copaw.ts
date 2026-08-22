/** Spawn the vendored CoPaw Python/Playwright Zero Token sidecar. */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, constants as fsConstants } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeZeroTokenGatewayUrl } from './channel-zero-token.ts'
import { copawSidecarNetworkEnv } from './zero-token-copaw-network.ts'
import { zeroTokenListenPort } from './zero-token-gateway.ts'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const START_WAIT_MS = 30_000
const START_POLL_MS = 200

/** Running CoPaw Node gateway. */
export interface CopawSidecar {
  readonly origin: string
  readonly pid: number | undefined
  close(): Promise<void>
}

/** Spawn plan for `server.mjs`. */
export interface CopawSpawnPlan {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

/**
 * Resolve the vendored CoPaw snapshot shipped with this package.
 * @param fromUrl - module URL, defaults to this file.
 */
export function copawVendorRoot(fromUrl = import.meta.url): string {
  return join(dirname(fileURLToPath(fromUrl)), '..', 'vendor', 'copaw-zero-token')
}

/**
 * Node gateway working directory (`server.mjs` + `playwright-core`).
 * @param vendorRoot - snapshot root.
 */
export function copawGatewayDir(vendorRoot = copawVendorRoot()): string {
  return join(vendorRoot, 'python', 'src', 'copaw', 'zero_token_gateway')
}

/**
 * cc-haha TLS shim loaded with `node --import` when insecure TLS is on.
 * @param fromUrl - module URL, defaults to this file.
 */
export function copawGatewayTlsShimPath(fromUrl = import.meta.url): string {
  const beside = join(dirname(fileURLToPath(fromUrl)), 'zero-token-gateway-tls-shim.mjs')
  if (existsSync(beside)) return beside
  return join(dirname(fileURLToPath(fromUrl)), '..', 'src', 'zero-token-gateway-tls-shim.mjs')
}

/**
 * Prefer a real Node binary (cc-haha webauth/gateway), not Electron.
 * Packaged apps fall back to `process.execPath` + `ELECTRON_RUN_AS_NODE`.
 */
export function resolveCopawNodeBinary(): string {
  const explicit = process.env.CC_HAHA_WEBAUTH_NODE?.trim() || process.env.DSH_ZERO_TOKEN_NODE?.trim()
  if (explicit) return explicit
  const name = process.platform === 'win32' ? 'node.exe' : 'node'
  const pathEnv = process.env.PATH ?? process.env.Path ?? ''
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir.trim()) continue
    const candidate = join(dir, name)
    if (!existsSync(candidate)) continue
    if (/electron/i.test(candidate)) continue
    return candidate
  }
  return process.execPath
}

/** True when the spawn binary is Electron (needs `ELECTRON_RUN_AS_NODE`). */
export function isElectronBinary(command: string): boolean {
  return /electron/i.test(command) || (command === process.execPath && Boolean(process.versions.electron))
}

function copawInsecureTlsEnabled(env: NodeJS.Dict<string>): boolean {
  return (env.COPAW_INSECURE_TLS ?? '1').trim() !== '0'
}

/**
 * Preferred Node entry, then the prebuilt bundle.
 * @param vendorRoot - snapshot root.
 */
export async function resolveCopawGatewayEntry(vendorRoot = copawVendorRoot()): Promise<string> {
  const server = join(copawGatewayDir(vendorRoot), 'server.mjs')
  if (await pathExists(server)) return server
  const bundle = join(vendorRoot, 'gateway-entry', 'gateway.bundle.mjs')
  if (await pathExists(bundle)) return bundle
  throw new Error('dsh-plugin-desktop: vendored CoPaw gateway entry is missing')
}

/**
 * Python CLI used for Playwright web login.
 * @param vendorRoot - snapshot root.
 */
export function copawPythonCli(vendorRoot = copawVendorRoot()): string {
  return join(vendorRoot, 'python', 'copaw_zt_cli.py')
}

/**
 * Marker that `npm install` already placed playwright-core.
 * @param gatewayDir - Node gateway working directory.
 */
export function playwrightCoreMarker(gatewayDir: string): string {
  return join(gatewayDir, 'node_modules', 'playwright-core')
}

/**
 * Lazy-install playwright-core next to `server.mjs` when missing.
 * @param gatewayDir - Node gateway working directory.
 * @param spawnFn - injectable spawn used by tests.
 */
export async function ensureCopawNpmDeps(
  gatewayDir = copawGatewayDir(),
  spawnFn: typeof spawn = spawn,
): Promise<void> {
  if (await pathExists(playwrightCoreMarker(gatewayDir))) return
  const child = spawnFn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel', 'error'],
    { cwd: gatewayDir, stdio: 'ignore', windowsHide: true, shell: process.platform === 'win32' },
  )
  const exitCode = await new Promise<number>(resolve => {
    child.once('error', () => resolve(127))
    child.once('exit', code => resolve(code ?? 1))
  })
  if (exitCode !== 0 || !(await pathExists(playwrightCoreMarker(gatewayDir)))) {
    throw new Error(`npm install playwright-core failed in ${gatewayDir} (exit ${String(exitCode)})`)
  }
}

/**
 * Build the Node spawn argv for the CoPaw sidecar.
 * Matches cc-haha: real Node when available, `--import` TLS shim, loopback NO_PROXY.
 * Packaged Electron falls back to the same executable with `ELECTRON_RUN_AS_NODE=1`.
 * @param options - listen URL, extra env, and optional node binary.
 */
export function buildCopawSpawnPlan(options: {
  listenUrl: string
  entryPath: string
  extraEnv?: Readonly<Record<string, string>>
  nodeBin?: string
}): CopawSpawnPlan {
  const origin = new URL(normalizeZeroTokenGatewayUrl(options.listenUrl))
  const port = zeroTokenListenPort(options.listenUrl)
  const command = options.nodeBin ?? resolveCopawNodeBinary()
  const extraEnv = options.extraEnv ?? {}
  const networkEnv = copawSidecarNetworkEnv({
    ...process.env as Record<string, string>,
    ...extraEnv,
  })
  const mergedEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    COPAW_ZERO_TOKEN_HOST: origin.hostname,
    COPAW_ZERO_TOKEN_PORT: String(port),
    ICLAW_ZERO_TOKEN_HOST: origin.hostname,
    ICLAW_ZERO_TOKEN_PORT: String(port),
    ...networkEnv,
    ...extraEnv,
  }
  if (isElectronBinary(command)) mergedEnv[RUN_AS_NODE] = '1'
  else delete mergedEnv[RUN_AS_NODE]
  const insecureTls = copawInsecureTlsEnabled(mergedEnv)
  if (insecureTls) {
    mergedEnv.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    mergedEnv.COPAW_INSECURE_TLS = '1'
  } else {
    delete mergedEnv.NODE_TLS_REJECT_UNAUTHORIZED
  }
  const args = [options.entryPath]
  if (insecureTls) {
    const shimPath = copawGatewayTlsShimPath()
    if (existsSync(shimPath)) args.unshift('--import', pathToFileURL(shimPath).href)
  }
  return {
    command,
    args,
    cwd: dirname(options.entryPath),
    env: mergedEnv,
  }
}

const ENSURE_CHROME_DEBUG_SCRIPT = `import json,os,sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
try:
    from copaw.zero_token.webauth import ensure_chrome_debug
    raw=os.environ.get("COPAW_ENSURE_URLS_JSON","[]")
    urls=json.loads(raw)
    r=ensure_chrome_debug(urls=urls, progress=lambda m: print(m, flush=True))
    print(json.dumps({"ok":True,"result":r}, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"ok":False,"error":str(e)}, ensure_ascii=False))
    sys.exit(1)
`

/**
 * Interpreter for vendored CoPaw Python onboard.
 * Prefers `COPAW_ZERO_TOKEN_PYTHON`, then the active conda env, then PATH.
 */
export function resolvePythonCommand(): string {
  const explicit = process.env.COPAW_ZERO_TOKEN_PYTHON?.trim()
  if (explicit) return explicit
  const conda = process.env.CONDA_PREFIX?.trim()
  if (conda) {
    const candidate = process.platform === 'win32'
      ? join(conda, 'python.exe')
      : join(conda, 'bin', 'python3')
    if (existsSync(candidate)) return candidate
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

function pythonUtf8Args(rest: readonly string[]): string[] {
  return ['-X', 'utf8', ...rest]
}

/**
 * Decode Python child stdout. Prefer UTF-8; recover GBK/GB18030 if Windows leaked it.
 * @param chunk - pipe bytes or already-decoded text.
 * @returns Unicode text for the settings log.
 */
export function decodePythonStdout(chunk: Buffer | string): string {
  if (typeof chunk === 'string') return chunk
  const utf8 = chunk.toString('utf8')
  const utf8Bad = replacementCount(utf8)
  if (utf8Bad === 0) return utf8
  try {
    const gbk = new TextDecoder('gb18030').decode(chunk)
    return replacementCount(gbk) < utf8Bad ? gbk : utf8
  } catch {
    return utf8
  }
}

function replacementCount(text: string): number {
  let count = 0
  for (const ch of text) {
    if (ch === '\uFFFD') count += 1
  }
  return count
}

/**
 * Environment for vendored CoPaw Python (`PYTHONPATH` + UTF-8 stdio).
 * @param vendorRoot - snapshot root.
 * @param extra - extra variables such as `COPAW_ENSURE_URLS_JSON`.
 */
export function pythonProcessEnv(
  vendorRoot = copawVendorRoot(),
  extra?: Readonly<Record<string, string>>,
): Record<string, string> {
  const src = join(vendorRoot, 'python', 'src')
  const prev = (process.env.PYTHONPATH ?? '').trim()
  const sep = process.platform === 'win32' ? ';' : ':'
  return {
    ...process.env as Record<string, string>,
    PYTHONPATH: prev.length > 0 ? `${src}${sep}${prev}` : src,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONLEGACYWINDOWSSTDIO: '0',
    ...(extra ?? {}),
  }
}

/**
 * Python onboard argv. Requires `python` plus Playwright Chromium on PATH.
 * @param mode - CoPaw onboard mode such as `webauth`.
 * @param vendorRoot - snapshot root.
 */
export function buildPythonOnboardPlan(mode = 'webauth', vendorRoot = copawVendorRoot()): CopawSpawnPlan {
  const pythonRoot = join(vendorRoot, 'python')
  return {
    command: resolvePythonCommand(),
    args: pythonUtf8Args([copawPythonCli(vendorRoot), 'onboard', mode]),
    cwd: pythonRoot,
    env: pythonProcessEnv(vendorRoot),
  }
}

/**
 * `python -c ensure_chrome_debug` argv used before onboard.
 * @param urls - site tabs to open in debug Chromium.
 * @param vendorRoot - snapshot root.
 */
export function buildPythonEnsureChromeDebugPlan(
  urls: readonly string[],
  vendorRoot = copawVendorRoot(),
): CopawSpawnPlan {
  return {
    command: resolvePythonCommand(),
    args: pythonUtf8Args(['-c', ENSURE_CHROME_DEBUG_SCRIPT]),
    cwd: join(vendorRoot, 'python'),
    env: pythonProcessEnv(vendorRoot, { COPAW_ENSURE_URLS_JSON: JSON.stringify(urls) }),
  }
}

/**
 * Read the last JSON object from mixed ensure_chrome_debug stdout.
 * @param output - combined stdout/stderr.
 */
export function parseEnsureChromeDebugJsonOutput(output: string): {
  ok: boolean
  result?: unknown
  error?: string
} {
  const trimmed = output.trim()
  for (const line of trimmed.split(/\r?\n/).reverse()) {
    const row = line.trim()
    if (row.startsWith('{') && row.endsWith('}')) {
      try {
        return JSON.parse(row) as { ok: boolean; result?: unknown; error?: string }
      } catch {
        // keep scanning earlier lines
      }
    }
  }
  const end = trimmed.lastIndexOf('}')
  const start = trimmed.lastIndexOf('{', end)
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as { ok: boolean; result?: unknown; error?: string }
    } catch {
      // fall through
    }
  }
  throw new Error('ensure_chrome_debug: no JSON in subprocess output')
}

/**
 * Spawn `server.mjs` and wait until `/health` answers.
 * @param options - listen URL, spawn env, and injectable spawn/fetch.
 */
export async function startCopawSidecar(options: {
  listenUrl: string
  extraEnv?: Readonly<Record<string, string>>
  spawn?: typeof spawn
  request?: typeof fetch
  vendorRoot?: string
  nodeBin?: string
  waitMs?: number
}): Promise<CopawSidecar> {
  const vendorRoot = options.vendorRoot ?? copawVendorRoot()
  const entryPath = await resolveCopawGatewayEntry(vendorRoot)
  const plan = buildCopawSpawnPlan({
    listenUrl: options.listenUrl,
    entryPath,
    ...(options.extraEnv ? { extraEnv: options.extraEnv } : {}),
    ...(options.nodeBin ? { nodeBin: options.nodeBin } : {}),
  })
  const spawnFn = options.spawn ?? spawn
  const child = spawnFn(plan.command, [...plan.args], spawnOptions(plan, ['ignore', 'pipe', 'pipe']))
  const origin = normalizeZeroTokenGatewayUrl(options.listenUrl)
  const logs: string[] = []
  const pushLog = (chunk: Buffer | string): void => {
    logs.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
  }
  child.stdout?.on('data', pushLog)
  child.stderr?.on('data', pushLog)
  try {
    await waitUntilSidecarReady(child, origin, options.request ?? fetch, options.waitMs ?? START_WAIT_MS, logs)
  } catch (cause) {
    await killChild(child)
    throw cause
  }
  return {
    origin,
    pid: child.pid,
    close: () => killChild(child),
  }
}

/**
 * Run Python Playwright onboard and return the exit code.
 * @param options - onboard mode and injectable spawn.
 */
export async function runPythonOnboard(options: {
  mode?: string
  vendorRoot?: string
  spawn?: typeof spawn
}): Promise<{ exitCode: number }> {
  const result = await runPythonOnboardStream(options)
  return { exitCode: result.exitCode }
}

/**
 * Run Python Playwright onboard, piping stdout/stderr for the settings UI.
 * @param options - onboard mode, spawn, and optional line callback.
 */
export async function runPythonOnboardStream(options: {
  mode?: string
  vendorRoot?: string
  spawn?: typeof spawn
  onLine?: (text: string) => void
}): Promise<{ exitCode: number; output: string }> {
  return spawnPythonPlan(
    buildPythonOnboardPlan(options.mode ?? 'webauth', options.vendorRoot),
    options.spawn,
    options.onLine,
  )
}

/**
 * Detect/start Chromium on the CDP port and open the model site tab.
 * @param options - site URLs, vendor root, spawn, and optional line callback.
 */
export async function runPythonEnsureChromeDebugStream(options: {
  urls: readonly string[]
  vendorRoot?: string
  spawn?: typeof spawn
  onLine?: (text: string) => void
}): Promise<{ exitCode: number; output: string; result?: unknown }> {
  const streamed = await spawnPythonPlan(
    buildPythonEnsureChromeDebugPlan(options.urls, options.vendorRoot),
    options.spawn,
    options.onLine,
  )
  if (streamed.exitCode !== 0) {
    let message = streamed.output.trim() || 'ensure_chrome_debug failed'
    try {
      const parsed = parseEnsureChromeDebugJsonOutput(streamed.output)
      if (parsed.error) message = parsed.error
    } catch {
      // keep combined output
    }
    return { ...streamed, output: message }
  }
  try {
    const parsed = parseEnsureChromeDebugJsonOutput(streamed.output)
    if (!parsed.ok) {
      return { exitCode: 1, output: parsed.error || streamed.output, result: parsed.result }
    }
    const warning = chromeDebugWarningOf(parsed.result)
    if (warning) return { exitCode: 1, output: warning, result: parsed.result }
    return { exitCode: 0, output: streamed.output, result: parsed.result }
  } catch (cause) {
    return {
      exitCode: 1,
      output: cause instanceof Error ? cause.message : streamed.output,
    }
  }
}

function chromeDebugWarningOf(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('warning' in result)) return undefined
  const warning = String((result as { warning?: unknown }).warning ?? '').trim()
  return warning.length > 0 ? warning : undefined
}

async function spawnPythonPlan(
  plan: CopawSpawnPlan,
  spawnFn: typeof spawn | undefined,
  onLine?: (text: string) => void,
): Promise<{ exitCode: number; output: string }> {
  const child = (spawnFn ?? spawn)(plan.command, [...plan.args], spawnOptions(plan, 'pipe', false))
  const chunks: string[] = []
  const push = (chunk: Buffer | string): void => {
    const text = decodePythonStdout(chunk)
    chunks.push(text)
    onLine?.(text)
  }
  child.stdout?.on('data', push)
  child.stderr?.on('data', push)
  const exitCode = await new Promise<number>(resolve => {
    child.once('error', () => resolve(127))
    child.once('exit', code => resolve(code ?? 1))
  })
  return { exitCode, output: chunks.join('') }
}

function spawnOptions(
  plan: CopawSpawnPlan,
  stdio: SpawnOptions['stdio'] = 'ignore',
  windowsHide = true,
): SpawnOptions {
  return {
    cwd: plan.cwd,
    env: { ...plan.env },
    stdio,
    windowsHide,
  }
}

async function waitUntilSidecarReady(
  child: ChildProcess,
  origin: string,
  request: typeof fetch,
  waitMs: number,
  logs: string[],
): Promise<void> {
  let exitCode: number | null = child.exitCode
  let spawnError: Error | undefined
  const onExit = (code: number | null): void => {
    exitCode = code
  }
  const onError = (error: Error): void => {
    spawnError = error
  }
  child.once('exit', onExit)
  child.once('error', onError)
  try {
    const deadline = Date.now() + waitMs
    const url = new URL(origin)
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (exitCode !== null) {
        const detail = logs.join('').trim()
        throw new Error(
          `CoPaw Zero Token sidecar exited ${String(exitCode)}${detail ? `: ${detail}` : ''}`,
        )
      }
      if (await isPortOpen(url.hostname, Number(url.port || '80'))) {
        try {
          const res = await request(`${origin}/health`, { signal: AbortSignal.timeout(2_000) })
          if (res.ok) return
        } catch {
          // keep polling until the HTTP surface is ready
        }
      }
      await sleep(START_POLL_MS)
    }
    const detail = logs.join('').trim()
    throw new Error(
      `CoPaw Zero Token sidecar did not become ready at ${origin}${detail ? `: ${detail}` : ''}`,
    )
  } finally {
    child.off('exit', onExit)
    child.off('error', onError)
  }
}

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port })
    const done = (value: boolean) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(400)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

function killChild(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    child.once('exit', () => resolve())
    child.kill()
    setTimeout(() => {
      if (child.exitCode === null && child.pid) {
        try { process.kill(child.pid) } catch { /* already gone */ }
      }
      resolve()
    }, 2_000).unref?.()
  })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
