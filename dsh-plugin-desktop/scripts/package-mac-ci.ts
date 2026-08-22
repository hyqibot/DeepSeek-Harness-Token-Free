/** Build unsigned macOS DMGs on a native macOS host without Apple notarization. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withoutMacReleaseSecrets } from './release-preflight.ts'

/** Injectable native macOS packaging boundary used by focused tests. */
export interface MacCiPackageOptions {
  /** Environment inherited by the packaging command. */
  readonly env: NodeJS.ProcessEnv
  /** Platform executing the package build. */
  readonly platform: NodeJS.Platform
  /** Repository root containing the Yarn workspace. */
  readonly workspaceRoot: string
  /** Desktop package root containing electron-builder configuration. */
  readonly desktopRoot: string
  /** Absolute electron-builder CLI module. */
  readonly builderCli: string
  /** Node executable used to run package-local scripts. */
  readonly nodeExecutable: string
  /** Execute one packaging command. */
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
  /** Report non-secret packaging progress. */
  readonly log: (message: string) => void
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function defaultOptions(): MacCiPackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  return {
    env: process.env,
    platform: process.platform,
    workspaceRoot,
    desktopRoot,
    builderCli: require.resolve('electron-builder/cli.js'),
    nodeExecutable: process.execPath,
    run,
    log: message => console.log(message),
  }
}

/**
 * Run the headless macOS package gates and emit unsigned arm64 and x64 DMGs.
 * @param options - Injectable process and command boundaries.
 */
export function packageMacCiInstallers(
  options: MacCiPackageOptions = defaultOptions(),
): void {
  if (options.platform !== 'darwin') {
    throw new Error('macOS CI installers must be built on a native macOS host')
  }

  const cleanEnvironment = withoutMacReleaseSecrets(options.env)
  options.log('Building unsigned macOS arm64 and x64 DMGs; Apple notarization is a separate release step.')
  options.run(
    'corepack',
    ['yarn', 'workspace', 'dsh-plugin-desktop', 'check:mac-package'],
    options.workspaceRoot,
    cleanEnvironment,
  )
  options.run(
    options.nodeExecutable,
    [
      options.builderCli,
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
    options.desktopRoot,
    {
      ...cleanEnvironment,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
  )
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageMacCiInstallers()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
