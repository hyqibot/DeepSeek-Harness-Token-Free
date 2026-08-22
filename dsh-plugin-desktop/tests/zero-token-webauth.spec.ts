import { EventEmitter } from 'node:events'
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copawVendorRoot } from '../src/zero-token-copaw.ts'
import {
  buildNodeWebauthSpawnArgs,
  buildWebauthTsSpawnPlan,
  copawWebauthAppRoot,
  handleWebauthRunnerLine,
  killPreviousKeepalive,
  readKeepalivePid,
  resolveWebauthNodeRunnerBundle,
  runTsEnsureChromeDebugStream,
  runTsOnboardStream,
  spawnKeepaliveDetached,
  webauthCredentialsWritten,
  writeKeepalivePid,
} from '../src/zero-token-webauth.ts'

const temporaryDirectories: string[] = []
let previousRunnerBundle: string | undefined

beforeEach(() => {
  previousRunnerBundle = process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE
  delete process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE
})

afterEach(() => {
  if (previousRunnerBundle === undefined) delete process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE
  else process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE = previousRunnerBundle
  while (temporaryDirectories.length > 0) {
    const dir = temporaryDirectories.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function temporaryVendorRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-webauth-vendor-'))
  temporaryDirectories.push(dir)
  const vendor = join(dir, 'copaw-zero-token')
  mkdirSync(join(vendor, 'webauth-ts'), { recursive: true })
  mkdirSync(
    join(vendor, 'python', 'src', 'copaw', 'zero_token_gateway', 'node_modules', 'playwright-core'),
    { recursive: true },
  )
  writeFileSync(join(vendor, 'webauth-ts', 'node-runner.bundle.mjs'), 'export {}\n')
  return vendor
}

function mockChild(stdoutText: string, exitCode = 0): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(stdoutText, 'utf8'))
    child.emit('close', exitCode)
  })
  return child as unknown as ChildProcess
}

describe('zero-token webauth-ts', () => {
  it('ships cc-haha node-runner.bundle.mjs next to the vendored snapshot', () => {
    const bundle = resolveWebauthNodeRunnerBundle()
    accessSync(bundle, constants.F_OK)
    expect(bundle.replaceAll('\\', '/')).toMatch(/webauth-ts\/node-runner\.bundle\.mjs$/)
    expect(copawWebauthAppRoot().replaceAll('\\', '/')).toBe(
      dirname(copawVendorRoot()).replaceAll('\\', '/'),
    )
  })

  it('matches cc-haha Node argv: nodeBin, bundle, cmd, payload', () => {
    expect(
      buildNodeWebauthSpawnArgs({
        nodeBin: 'node',
        bundlePath: 'C:\\dev\\node-runner.bundle.mjs',
        cmd: 'onboard',
        payloadJson: '{"mode":"deepseek-chat"}',
      }),
    ).toEqual([
      'node',
      'C:\\dev\\node-runner.bundle.mjs',
      'onboard',
      '{"mode":"deepseek-chat"}',
    ])
  })

  it('spawns Electron-as-Node with bundle argv, CC_HAHA_ROOT, and loopback NO_PROXY', () => {
    const vendorRoot = temporaryVendorRoot()
    const bundle = join(vendorRoot, 'webauth-ts', 'node-runner.bundle.mjs')
    const payload = { urls: ['https://chat.deepseek.com/'] }
    const plan = buildWebauthTsSpawnPlan({
      cmd: 'ensure',
      payload,
      vendorRoot,
      nodeBin: 'node',
    })
    expect(plan.command).toBe('node')
    expect(plan.args).toEqual([bundle, 'ensure', JSON.stringify(payload)])
    expect(plan.cwd.replaceAll('\\', '/')).toBe(dirname(bundle).replaceAll('\\', '/'))
    expect(plan.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(plan.env.NODE_USE_ENV_PROXY).toBeUndefined()
    expect(plan.env.CC_HAHA_ROOT?.replaceAll('\\', '/')).toBe(dirname(vendorRoot).replaceAll('\\', '/'))
    expect(plan.env.CLAUDE_APP_ROOT?.replaceAll('\\', '/')).toBe(plan.env.CC_HAHA_ROOT?.replaceAll('\\', '/'))
    expect(plan.env.NO_PROXY).toMatch(/127\.0\.0\.1/)
  })

  it('parses node-runner-entry NDJSON line, complete, and error events', () => {
    const lines: string[] = []
    expect(handleWebauthRunnerLine('{"type":"line","text":"检查浏览器"}', text => { lines.push(text) })).toBeUndefined()
    expect(lines).toEqual(['检查浏览器'])
    expect(handleWebauthRunnerLine('plain progress', text => { lines.push(text) })).toBeUndefined()
    expect(handleWebauthRunnerLine(
      '{"type":"complete","result":{"started":true},"output":"done","mode":"webauth"}',
    )).toEqual({
      type: 'complete',
      result: { started: true },
      output: 'done',
      mode: 'webauth',
    })
    expect(handleWebauthRunnerLine('{"type":"error","message":"boom"}')).toEqual({
      type: 'error',
      message: 'boom',
    })
  })

  it('treats ensure complete.warning as failure and forwards line events', async () => {
    const vendorRoot = temporaryVendorRoot()
    const lines: string[] = []
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const spawn = ((command: string, args: readonly string[], _options?: SpawnOptions) => {
      calls.push({ command, args })
      return mockChild(
        '{"type":"line","text":"检查浏览器调试端口(CDP)…"}\n{"type":"complete","result":{"warning":"port busy"}}\n',
      )
    }) as typeof import('node:child_process').spawn
    const result = await runTsEnsureChromeDebugStream({
      urls: ['https://chat.deepseek.com/'],
      vendorRoot,
      spawn,
      onLine: text => { lines.push(text) },
    })
    expect(result.exitCode).toBe(1)
    expect(result.output).toBe('port busy')
    expect(lines).toContain('检查浏览器调试端口(CDP)…')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args[1]).toBe('ensure')
  })

  it('completes onboard from runner NDJSON without calling Python', async () => {
    const vendorRoot = temporaryVendorRoot()
    const spawn = ((_command: string, args: readonly string[]) => {
      expect(args[1]).toBe('onboard')
      expect(JSON.parse(String(args[2]))).toEqual({ mode: 'webauth' })
      return mockChild(
        '{"type":"line","text":"打开登录页"}\n{"type":"complete","output":"captured","mode":"webauth"}\n',
      )
    }) as typeof import('node:child_process').spawn
    const result = await runTsOnboardStream({
      mode: 'webauth',
      vendorRoot,
      spawn,
    })
    expect(result).toEqual({ exitCode: 0, output: 'captured', mode: 'webauth' })
  })

  it('treats 写入凭证 as captured credentials', () => {
    expect(webauthCredentialsWritten('已检测到登录态，写入凭证…')).toBe(true)
    expect(webauthCredentialsWritten('捕获成功，写入凭证…')).toBe(true)
    expect(webauthCredentialsWritten('CDP 连接成功（509ms）。')).toBe(false)
  })

  it('finishes onboard when Playwright close hangs after credentials are written', async () => {
    const vendorRoot = temporaryVendorRoot()
    const lines: string[] = []
    const spawn = ((_command: string, _args: readonly string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        kill: () => boolean
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => {
        queueMicrotask(() => child.emit('close', 1))
        return true
      }
      queueMicrotask(() => {
        child.stdout.emit(
          'data',
          Buffer.from('{"type":"line","text":"已检测到登录态，写入凭证…"}\n', 'utf8'),
        )
      })
      return child as unknown as ChildProcess
    }) as typeof import('node:child_process').spawn
    const result = await runTsOnboardStream({
      mode: 'webauth',
      vendorRoot,
      spawn,
      closeGraceMs: 40,
      onLine: text => { lines.push(text) },
    })
    expect(result.exitCode).toBe(0)
    expect(result.mode).toBe('webauth')
    expect(lines).toContain('已检测到登录态，写入凭证…')
    expect(lines).toContain('凭证已保存，正在结束调试连接…')
  })
})

describe('zero-token Chrome CDP keepalive', () => {
  it('matches cc-haha Node argv for keepalive', () => {
    expect(
      buildNodeWebauthSpawnArgs({
        nodeBin: 'node',
        bundlePath: 'C:\\dev\\node-runner.bundle.mjs',
        cmd: 'keepalive',
        payloadJson: '{"urls":["https://chat.deepseek.com/"],"intervalSec":20}',
      }),
    ).toEqual([
      'node',
      'C:\\dev\\node-runner.bundle.mjs',
      'keepalive',
      '{"urls":["https://chat.deepseek.com/"],"intervalSec":20}',
    ])
  })

  it('skips keepalive when COPAW_ZERO_TOKEN_KEEPALIVE=0 or urls are empty', async () => {
    const spawn = vi.fn() as unknown as typeof import('node:child_process').spawn
    expect(await spawnKeepaliveDetached({
      urls: ['https://chat.deepseek.com/'],
      spawn,
      env: { COPAW_ZERO_TOKEN_KEEPALIVE: '0' },
    })).toBe('skipped')
    expect(await spawnKeepaliveDetached({
      urls: [],
      spawn,
      env: {},
    })).toBe('skipped')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns keepalive, writes pid, and replaces the previous child', async () => {
    const vendorRoot = temporaryVendorRoot()
    const pidFile = join(vendorRoot, 'keepalive.pid')
    const killed: number[] = []
    const kill = (pid: number): void => { killed.push(pid) }
    await writeKeepalivePid(4242, pidFile)
    const spawn = ((_command: string, args: readonly string[], options?: SpawnOptions) => {
      expect(args[1]).toBe('keepalive')
      expect(JSON.parse(String(args[2]))).toEqual({
        urls: ['https://chat.deepseek.com/'],
        intervalSec: 20,
      })
      expect(options?.stdio).toBe('ignore')
      expect((options?.env as Record<string, string> | undefined)?.COPAW_CHATGPT_CDP_URL).toBe(
        'http://127.0.0.1:9222',
      )
      const child = new EventEmitter() as EventEmitter & { pid: number }
      child.pid = 9001
      return child as unknown as ChildProcess
    }) as typeof import('node:child_process').spawn
    const outcome = await spawnKeepaliveDetached({
      urls: ['https://chat.deepseek.com/'],
      vendorRoot,
      spawn,
      pidFile,
      extraEnv: { COPAW_CHATGPT_CDP_URL: 'http://127.0.0.1:9222' },
      kill,
    })
    expect(outcome).toBe('started')
    expect(killed).toEqual([4242])
    expect(await readKeepalivePid(pidFile)).toBe(9001)
    await killPreviousKeepalive({ pidFile, kill })
    expect(killed).toEqual([4242, 9001])
    expect(await readKeepalivePid(pidFile)).toBeNull()
  })
})

