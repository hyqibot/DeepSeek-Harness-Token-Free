import { EventEmitter } from 'node:events'
import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildCopawSpawnPlan,
  buildPythonEnsureChromeDebugPlan,
  buildPythonOnboardPlan,
  copawGatewayDir,
  copawGatewayTlsShimPath,
  copawPythonCli,
  copawVendorRoot,
  parseEnsureChromeDebugJsonOutput,
  decodePythonStdout,
  resolveCopawGatewayEntry,
  resolvePythonCommand,
  startCopawSidecar,
} from '../src/zero-token-copaw.ts'

describe('zero-token CoPaw sidecar', () => {
  it('resolves the vendored Python CLI, Playwright gateway, and PoW helper', async () => {
    const vendor = copawVendorRoot()
    const entry = await resolveCopawGatewayEntry(vendor)
    expect(entry.replaceAll('\\', '/')).toContain('zero_token_gateway/server.mjs')
    accessSync(entry, constants.F_OK)
    accessSync(copawPythonCli(vendor), constants.F_OK)
    accessSync(join(vendor, 'python', 'src', 'copaw', 'zero_token', 'deepseek_pow.js'), constants.F_OK)
    expect(copawGatewayDir(vendor).replaceAll('\\', '/')).toMatch(/zero_token_gateway$/)
  })

  it('spawns the Node sidecar with cc-haha TLS shim and loopback NO_PROXY', async () => {
    const entry = await resolveCopawGatewayEntry()
    const plan = buildCopawSpawnPlan({
      listenUrl: 'http://127.0.0.1:3002',
      entryPath: entry,
      extraEnv: { CC_HAHA_REQUIRE_GATEWAY_LICENSE: '1' },
      nodeBin: 'node',
    })
    expect(plan.command).toBe('node')
    expect(plan.args[0]).toBe('--import')
    expect(plan.args[1]).toContain('zero-token-gateway-tls-shim.mjs')
    expect(plan.args[2]).toBe(entry)
    accessSync(copawGatewayTlsShimPath(), constants.F_OK)
    expect(plan.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(plan.env.COPAW_ZERO_TOKEN_PORT).toBe('3002')
    expect(plan.env.CC_HAHA_REQUIRE_GATEWAY_LICENSE).toBe('1')
    expect(plan.env.NO_PROXY).toMatch(/127\.0\.0\.1/)
    expect(plan.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0')
    expect(plan.env.HTTP_PROXY ?? '').not.toMatch(/789/)
    expect(plan.env.NODE_USE_ENV_PROXY).toBeUndefined()
  })

  it('forwards Host ensure-chrome-debug callback env into the sidecar', async () => {
    const entry = await resolveCopawGatewayEntry()
    const plan = buildCopawSpawnPlan({
      listenUrl: 'http://127.0.0.1:3002',
      entryPath: entry,
      extraEnv: {
        COPAW_API_BASE_URL: 'http://127.0.0.1:4173',
        COPAW_APP_URL: 'http://127.0.0.1:4173',
        COPAW_ZERO_TOKEN_ENSURE_PATH: '/api/desktop-zero-token/ensure-chrome-debug',
      },
      nodeBin: 'node',
    })
    expect(plan.env.COPAW_API_BASE_URL).toBe('http://127.0.0.1:4173')
    expect(plan.env.COPAW_ZERO_TOKEN_ENSURE_PATH).toBe('/api/desktop-zero-token/ensure-chrome-debug')
  })

  it('builds the Python Playwright onboard command without executing it', () => {
    const plan = buildPythonOnboardPlan('webauth')
    expect(plan.command).toBe(resolvePythonCommand())
    expect(plan.args.slice(0, 2)).toEqual(['-X', 'utf8'])
    expect(plan.args.slice(-2)).toEqual(['onboard', 'webauth'])
    expect(plan.env.PYTHONPATH?.replaceAll('\\', '/')).toMatch(/python\/src$/)
    expect(plan.env.PYTHONIOENCODING).toBe('utf-8')
    expect(plan.env.PYTHONUTF8).toBe('1')
  })

  it('builds ensure_chrome_debug before onboard and parses mixed progress JSON', () => {
    const plan = buildPythonEnsureChromeDebugPlan(['https://chat.deepseek.com/'])
    expect(plan.args.slice(0, 3)).toEqual(['-X', 'utf8', '-c'])
    expect(plan.env.COPAW_ENSURE_URLS_JSON).toBe('["https://chat.deepseek.com/"]')
    expect(parseEnsureChromeDebugJsonOutput(
      '检查浏览器调试端口(CDP)…\n{"ok":true,"result":{"started":true}}\n',
    )).toEqual({ ok: true, result: { started: true } })
  })

  it('decodes UTF-8 Python stdout and recovers GBK Chinese', () => {
    expect(decodePythonStdout(Buffer.from('连接浏览器(CDP)…', 'utf8'))).toBe('连接浏览器(CDP)…')
    expect(decodePythonStdout(Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]))).toBe('中文')
  })

  it('loads the TLS shim under PATH Node without a static node:undici import', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(copawGatewayTlsShimPath()).href, '-e', 'console.log("ok")'],
      {
        encoding: 'utf8',
        env: { ...process.env, COPAW_INSECURE_TLS: '1' },
      },
    )
    expect(result.status).toBe(0)
    expect(result.stderr ?? '').toMatch(/scoped DeepSeek TLS/)
    expect(result.stdout ?? '').toContain('ok')
  })

  it('fails fast when the Node sidecar exits before /health', async () => {
    const spawn = ((_command: string, _args: readonly string[], _options?: SpawnOptions) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        pid: number
        exitCode: number | null
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.pid = 4242
      child.exitCode = null
      queueMicrotask(() => {
        child.stderr.emit('data', Buffer.from('No such built-in module: node:undici\n'))
        child.exitCode = 1
        child.emit('exit', 1)
      })
      return child as unknown as ChildProcess
    }) as typeof import('node:child_process').spawn
    await expect(startCopawSidecar({
      listenUrl: 'http://127.0.0.1:39991',
      spawn,
      waitMs: 2_000,
    })).rejects.toThrow(/exited 1[\s\S]*node:undici/)
  })
})
