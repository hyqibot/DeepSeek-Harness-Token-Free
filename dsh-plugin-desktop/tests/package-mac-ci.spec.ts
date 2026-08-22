import { describe, expect, it } from 'vitest'
import {
  packageMacCiInstallers,
  type MacCiPackageOptions,
} from '../scripts/package-mac-ci.ts'

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function options(calls: CommandCall[], logs: string[] = []): MacCiPackageOptions {
  return {
    env: {
      PATH: '/usr/bin',
      SAFE_VALUE: 'kept',
      CSC_LINK: 'private-generic-certificate',
      CSC_KEY_PASSWORD: 'private-generic-password',
      MAC_CERT_P12_BASE64: 'private-p12',
      MACOS_SIGN_IDENTITY: 'Developer ID Application: Example',
      APPLE_ID: 'private-apple-id',
      APPLE_APP_SPECIFIC_PASSWORD: 'private-app-password',
      APPLE_TEAM_ID: 'TEAMID',
    },
    platform: 'darwin',
    workspaceRoot: '/repo',
    desktopRoot: '/repo/dsh-plugin-desktop',
    builderCli: '/repo/node_modules/electron-builder/cli.js',
    nodeExecutable: '/usr/local/bin/node',
    run: (command, args, cwd, env) => {
      calls.push({ command, args: [...args], cwd, env: { ...env } })
    },
    log: message => logs.push(message),
  }
}

describe('unsigned macOS CI installer packaging', () => {
  it('checks without credentials, then builds unsigned arm64 and x64 DMGs', () => {
    const calls: CommandCall[] = []
    const logs: string[] = []

    packageMacCiInstallers(options(calls, logs))

    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({
      command: 'corepack',
      args: ['yarn', 'workspace', 'dsh-plugin-desktop', 'check:mac-package'],
      cwd: '/repo',
      env: { PATH: '/usr/bin', SAFE_VALUE: 'kept' },
    })
    expect(calls[1]).toEqual({
      command: '/usr/local/bin/node',
      args: [
        '/repo/node_modules/electron-builder/cli.js',
        '--mac',
        'dmg',
        '--arm64',
        '--x64',
        '--publish',
        'never',
        '--config.mac.identity=null',
        '--config.mac.notarize=false',
        '--config.mac.hardenedRuntime=false',
        '--config.npmRebuild=false',
      ],
      cwd: '/repo/dsh-plugin-desktop',
      env: {
        PATH: '/usr/bin',
        SAFE_VALUE: 'kept',
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      },
    })
    expect(logs).toEqual([
      'Building unsigned macOS arm64 and x64 DMGs; Apple notarization is a separate release step.',
    ])
  })

  it('rejects a non-macOS host before running commands', () => {
    const calls: CommandCall[] = []
    expect(() => packageMacCiInstallers({ ...options(calls), platform: 'win32' })).toThrow(
      'native macOS host',
    )
    expect(calls).toEqual([])
  })

  it('stops before packaging when the headless check fails', () => {
    const calls: CommandCall[] = []
    const value: MacCiPackageOptions = {
      ...options(calls),
      run: (command, args, cwd, env) => {
        calls.push({ command, args: [...args], cwd, env: { ...env } })
        throw new Error('headless check failed')
      },
    }

    expect(() => packageMacCiInstallers(value)).toThrow('headless check failed')
    expect(calls).toHaveLength(1)
  })
})
