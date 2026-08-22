/** Spawn cc-haha's vendored webauth-ts Node runner (ensure + onboard + keepalive). */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  copawGatewayDir,
  copawVendorRoot,
  ensureCopawNpmDeps,
  isElectronBinary,
  resolveCopawNodeBinary,
  type CopawSpawnPlan,
} from './zero-token-copaw.ts'
import { copawSidecarNetworkEnv } from './zero-token-copaw-network.ts'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'

type RunnerEvent =
  | { type: 'line'; text: string }
  | { type: 'complete'; result?: unknown; output?: string; mode?: string }
  | { type: 'error'; message: string }

/**
 * Directory of the vendored webauth-ts snapshot.
 * @param vendorRoot - copaw-zero-token root.
 */
export function copawWebauthTsDir(vendorRoot = copawVendorRoot()): string {
  return join(vendorRoot, 'webauth-ts')
}

/**
 * cc-haha `node-runner.bundle.mjs`, or `CC_HAHA_WEBAUTH_RUNNER_BUNDLE`.
 * @param vendorRoot - copaw-zero-token root.
 */
export function resolveWebauthNodeRunnerBundle(vendorRoot = copawVendorRoot()): string {
  const preferred = process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE?.trim()
  if (preferred) return preferred
  return join(copawWebauthTsDir(vendorRoot), 'node-runner.bundle.mjs')
}

/**
 * Plugin package root so playwright-loader's vendor marker resolves.
 * @param vendorRoot - copaw-zero-token root.
 */
export function copawWebauthAppRoot(vendorRoot = copawVendorRoot()): string {
  return dirname(vendorRoot)
}

/**
 * Same argv as cc-haha `buildNodeWebauthSpawnArgs`.
 * @param params - node binary, bundle, cmd, JSON payload.
 */
/** Vendored `node-runner-entry` commands. */
export type WebauthRunnerCmd = 'ensure' | 'onboard' | 'keepalive'

export function buildNodeWebauthSpawnArgs(params: {
  nodeBin: string
  bundlePath: string
  cmd: WebauthRunnerCmd
  payloadJson: string
}): string[] {
  return [params.nodeBin, params.bundlePath, params.cmd, params.payloadJson]
}

/**
 * Electron-as-Node spawn plan for the cc-haha webauth-ts runner.
 * @param options - cmd, payload, optional vendor root and node binary.
 */
export function buildWebauthTsSpawnPlan(options: {
  cmd: WebauthRunnerCmd
  payload: Record<string, unknown>
  vendorRoot?: string
  nodeBin?: string
  extraEnv?: Readonly<Record<string, string>>
}): CopawSpawnPlan {
  const vendorRoot = options.vendorRoot ?? copawVendorRoot()
  const bundlePath = resolveWebauthNodeRunnerBundle(vendorRoot)
  const payloadJson = JSON.stringify(options.payload)
  const nodeBin = options.nodeBin ?? resolveCopawNodeBinary()
  const appRoot = copawWebauthAppRoot(vendorRoot)
  const networkEnv = copawSidecarNetworkEnv(process.env as Record<string, string>)
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CC_HAHA_ROOT: appRoot,
    CLAUDE_APP_ROOT: appRoot,
    ...networkEnv,
    ...(options.extraEnv ?? {}),
  }
  if (isElectronBinary(nodeBin)) env[RUN_AS_NODE] = '1'
  else delete env[RUN_AS_NODE]
  return {
    command: nodeBin,
    args: buildNodeWebauthSpawnArgs({
      nodeBin,
      bundlePath,
      cmd: options.cmd,
      payloadJson,
    }).slice(1),
    cwd: dirname(bundlePath),
    env,
  }
}

function chromeDebugWarningOf(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('warning' in result)) return undefined
  const warning = String((result as { warning?: unknown }).warning ?? '').trim()
  return warning.length > 0 ? warning : undefined
}

/**
 * Parse one stdout line from cc-haha `node-runner-entry`.
 * @param line - raw line.
 * @param onLine - progress callback for `line` events and non-JSON text.
 */
export function handleWebauthRunnerLine(
  line: string,
  onLine?: (text: string) => void,
): Extract<RunnerEvent, { type: 'complete' | 'error' }> | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  let evt: RunnerEvent
  try {
    evt = JSON.parse(trimmed) as RunnerEvent
  } catch {
    onLine?.(trimmed)
    return undefined
  }
  if (evt.type === 'line') {
    onLine?.(evt.text)
    return undefined
  }
  if (evt.type === 'complete' || evt.type === 'error') return evt
  return undefined
}

/** Playwright `browser.close()` after CDP attach often never returns; credentials are already on disk. */
export const DEFAULT_WEBAUTH_CLOSE_GRACE_MS = 2_000

/** True when webauth-ts has persisted cookies/tokens and is only tearing down CDP. */
export function webauthCredentialsWritten(text: string): boolean {
  return text.includes('写入凭证')
}

function killHungWebauthChild(child: ChildProcess): void {
  try { child.kill() } catch { /* already gone */ }
  const pid = child.pid
  if (pid === undefined) return
  setTimeout(() => {
    try { process.kill(pid) } catch { /* already gone */ }
  }, 1_000).unref?.()
}

async function runWebauthTsRunner(options: {
  cmd: 'ensure' | 'onboard'
  payload: Record<string, unknown>
  vendorRoot?: string
  spawn?: typeof spawn
  onLine?: (text: string) => void
  closeGraceMs?: number
}): Promise<{ result?: unknown; output: string; mode?: string }> {
  await ensureCopawNpmDeps(copawGatewayDir(options.vendorRoot ?? copawVendorRoot()), options.spawn ?? spawn)
  const plan = buildWebauthTsSpawnPlan({
    cmd: options.cmd,
    payload: options.payload,
    ...(options.vendorRoot === undefined ? {} : { vendorRoot: options.vendorRoot }),
  })
  const spawnFn = options.spawn ?? spawn
  const child: ChildProcess = spawnFn(plan.command, [...plan.args], {
    cwd: plan.cwd,
    env: { ...plan.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  return await new Promise((resolve, reject) => {
    let stderr = ''
    let buffer = ''
    let settled = false
    let credentialsWritten = false
    let hungTimer: ReturnType<typeof setTimeout> | undefined
    let complete: Extract<RunnerEvent, { type: 'complete' }> | null = null
    const outputLines: string[] = []
    const graceMs = options.closeGraceMs ?? DEFAULT_WEBAUTH_CLOSE_GRACE_MS
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      if (hungTimer !== undefined) clearTimeout(hungTimer)
      reject(err)
    }
    const ok = (value: { result?: unknown; output: string; mode?: string }) => {
      if (settled) return
      settled = true
      if (hungTimer !== undefined) clearTimeout(hungTimer)
      resolve(value)
    }

    const armCloseGrace = (): void => {
      if (options.cmd !== 'onboard' || hungTimer !== undefined || graceMs <= 0) return
      hungTimer = setTimeout(() => {
        options.onLine?.('凭证已保存，正在结束调试连接…')
        killHungWebauthChild(child)
      }, graceMs)
    }

    const handleLine = (raw: string) => {
      const evt = handleWebauthRunnerLine(raw, text => {
        outputLines.push(text)
        options.onLine?.(text)
        if (webauthCredentialsWritten(text)) {
          credentialsWritten = true
          armCloseGrace()
        }
      })
      if (evt?.type === 'complete') {
        complete = evt
        if (hungTimer !== undefined) clearTimeout(hungTimer)
      } else if (evt?.type === 'error') fail(new Error(evt.message))
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const row of parts) handleLine(row)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', err => {
      fail(new Error(`无法启动 webauth Node 子进程 (${plan.command}): ${err.message}`))
    })
    child.once('close', code => {
      if (buffer.trim()) handleLine(buffer)
      if (complete) {
        ok({
          result: complete.result,
          output: complete.output ?? outputLines.join('\n'),
          ...(complete.mode === undefined ? {} : { mode: complete.mode }),
        })
        return
      }
      if (credentialsWritten) {
        const mode = typeof options.payload.mode === 'string' ? options.payload.mode : undefined
        ok({
          output: outputLines.join('\n'),
          ...(mode === undefined ? {} : { mode }),
        })
        return
      }
      const detail = stderr.trim() || outputLines.join('\n')
      fail(
        new Error(
          `webauth ${options.cmd} 失败 (exit ${code ?? '?'}): ${detail || 'no output'}`,
        ),
      )
    })
  })
}

/**
 * cc-haha `ensure` via webauth-ts Node runner.
 * @param options - site URLs, spawn, and optional line callback.
 */
export async function runTsEnsureChromeDebugStream(options: {
  urls: readonly string[]
  vendorRoot?: string
  spawn?: typeof spawn
  onLine?: (text: string) => void
}): Promise<{ exitCode: number; output: string; result?: unknown }> {
  try {
    options.onLine?.('正在检查 Zero-Token 依赖（playwright-core）…')
    const ran = await runWebauthTsRunner({
      cmd: 'ensure',
      payload: { urls: [...options.urls] },
      ...(options.vendorRoot === undefined ? {} : { vendorRoot: options.vendorRoot }),
      ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
      ...(options.onLine === undefined ? {} : { onLine: options.onLine }),
    })
    const warning = chromeDebugWarningOf(ran.result)
    if (warning) return { exitCode: 1, output: warning, result: ran.result }
    return { exitCode: 0, output: ran.output, result: ran.result }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { exitCode: 1, output: message }
  }
}

/**
 * cc-haha `onboard` via webauth-ts Node runner.
 * @param options - onboard mode, spawn, and optional line callback.
 */
export async function runTsOnboardStream(options: {
  mode?: string
  vendorRoot?: string
  spawn?: typeof spawn
  onLine?: (text: string) => void
  closeGraceMs?: number
}): Promise<{ exitCode: number; output: string; mode: string }> {
  const mode = options.mode ?? 'webauth'
  try {
    const ran = await runWebauthTsRunner({
      cmd: 'onboard',
      payload: { mode },
      ...(options.vendorRoot === undefined ? {} : { vendorRoot: options.vendorRoot }),
      ...(options.spawn === undefined ? {} : { spawn: options.spawn }),
      ...(options.onLine === undefined ? {} : { onLine: options.onLine }),
      ...(options.closeGraceMs === undefined ? {} : { closeGraceMs: options.closeGraceMs }),
    })
    return { exitCode: 0, output: ran.output, mode: ran.mode ?? mode.trim().toLowerCase() }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { exitCode: 1, output: message, mode }
  }
}

/**
 * Run TS onboard and return the exit code.
 * @param options - onboard mode and injectable spawn.
 */
export async function runTsOnboard(options: {
  mode?: string
  vendorRoot?: string
  spawn?: typeof spawn
}): Promise<{ exitCode: number }> {
  const result = await runTsOnboardStream(options)
  return { exitCode: result.exitCode }
}

/** Matches cc-haha `start_chrome_debug_keepalive` interval. */
export const DEFAULT_KEEPALIVE_INTERVAL_SEC = 20

/**
 * PID file for the detached Chrome CDP keepalive child.
 * DSH-specific so it does not collide with cc-haha's `~/.claude/cc-haha/` file.
 * @param home - override for tests.
 */
export function keepalivePidFilePath(home = homedir()): string {
  return join(home, '.copaw-zero-state', 'dsh-zero-token-keepalive.pid')
}

/** True unless `COPAW_ZERO_TOKEN_KEEPALIVE=0`. */
export function keepaliveEnabled(env: NodeJS.Dict<string> = process.env): boolean {
  return env.COPAW_ZERO_TOKEN_KEEPALIVE !== '0'
}

/**
 * Read the last keepalive pid, if any.
 * @param pidFile - override for tests.
 */
export async function readKeepalivePid(pidFile = keepalivePidFilePath()): Promise<number | null> {
  try {
    const raw = (await readFile(pidFile, 'utf8')).trim()
    const pid = Number.parseInt(raw, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/**
 * Persist the keepalive child pid.
 * @param pid - spawned process id.
 * @param pidFile - override for tests.
 */
export async function writeKeepalivePid(pid: number, pidFile = keepalivePidFilePath()): Promise<void> {
  await mkdir(dirname(pidFile), { recursive: true })
  await writeFile(pidFile, `${String(pid)}\n`, 'utf8')
}

/**
 * Remove the keepalive pid file.
 * @param pidFile - override for tests.
 */
export async function removeKeepalivePidFile(pidFile = keepalivePidFilePath()): Promise<void> {
  await rm(pidFile, { force: true }).catch(() => undefined)
}

/**
 * Stop the previous keepalive child (cc-haha `killPreviousKeepalive`).
 * @param options - pid file and injectable kill.
 */
export async function killPreviousKeepalive(options: {
  pidFile?: string
  kill?: (pid: number, signal?: NodeJS.Signals) => void
} = {}): Promise<void> {
  const pidFile = options.pidFile ?? keepalivePidFilePath()
  const pid = await readKeepalivePid(pidFile)
  if (pid === null) return
  const killFn = options.kill ?? ((target, signal) => { process.kill(target, signal) })
  try {
    killFn(pid, 'SIGTERM')
  } catch {
    // already gone
  }
  await removeKeepalivePidFile(pidFile)
}

/**
 * Background Chrome CDP keepalive after a successful onboard.
 * Uses vendored `node-runner.bundle.mjs keepalive`, same as cc-haha's TS path.
 * @param options - site URLs, spawn, and optional pid file.
 */
export async function spawnKeepaliveDetached(options: {
  urls: readonly string[]
  vendorRoot?: string
  nodeBin?: string
  spawn?: typeof spawn
  pidFile?: string
  extraEnv?: Readonly<Record<string, string>>
  env?: NodeJS.Dict<string>
  kill?: (pid: number, signal?: NodeJS.Signals) => void
}): Promise<'skipped' | 'started'> {
  const env = options.env ?? process.env
  if (!keepaliveEnabled(env) || options.urls.length === 0) return 'skipped'
  const pidFile = options.pidFile ?? keepalivePidFilePath()
  await killPreviousKeepalive({
    pidFile,
    ...(options.kill === undefined ? {} : { kill: options.kill }),
  })
  await ensureCopawNpmDeps(copawGatewayDir(options.vendorRoot ?? copawVendorRoot()), options.spawn ?? spawn)
  const plan = buildWebauthTsSpawnPlan({
    cmd: 'keepalive',
    payload: {
      urls: [...options.urls],
      intervalSec: DEFAULT_KEEPALIVE_INTERVAL_SEC,
    },
    ...(options.vendorRoot === undefined ? {} : { vendorRoot: options.vendorRoot }),
    ...(options.nodeBin === undefined ? {} : { nodeBin: options.nodeBin }),
    ...(options.extraEnv === undefined ? {} : { extraEnv: options.extraEnv }),
  })
  const spawnFn = options.spawn ?? spawn
  const child = spawnFn(plan.command, [...plan.args], {
    cwd: plan.cwd,
    env: { ...plan.env },
    stdio: 'ignore',
    windowsHide: true,
  })
  const pid = child.pid
  if (pid === undefined) {
    throw new Error('keepalive spawn produced no pid')
  }
  child.once('error', () => {
    void removeKeepalivePidFile(pidFile)
  })
  await writeKeepalivePid(pid, pidFile)
  return 'started'
}

