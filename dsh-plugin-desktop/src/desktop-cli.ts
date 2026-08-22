/** Private RunAsNode bootstrap for the packaged DeepSeek Harness CLI. */

import { fileURLToPath, pathToFileURL } from 'node:url'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
import { assertDesktopProfileName } from './profile-manager.ts'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const DEFAULT_PROFILE = 'DSH_DESKTOP_DEFAULT_PROFILE'
const DSH_ENTRY_URL = pathToFileURL(
  packagedDependencyPath(import.meta.url, '@deepseek-ai/dsh/lib/bin.js'),
).href

/** Remove Electron Node mode before the DSH CLI creates any child process. */
export function clearElectronRunAsNode(environment: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === RUN_AS_NODE) delete environment[key]
  }
}

/**
 * Apply the terminal-owned default without overriding global help or an explicit profile.
 * @param argv - arguments after the executable and bootstrap entry.
 * @param profileName - validated profile selected by the desktop launcher.
 * @returns argv accepted by the upstream DSH command parser.
 */
export function withDefaultDesktopProfile(argv: readonly string[], profileName: string): string[] {
  assertDesktopProfileName(profileName)
  if (argv.some(argument => argument === '--profile' || argument.startsWith('--profile='))) {
    return [...argv]
  }
  const first = argv[0]
  if (first === 'web' || first === '--help' || first === '-h' || first === '--version' || first === '-V') {
    return [...argv]
  }
  if (first === 'plugin') {
    return ['plugin', '--profile', profileName, ...argv.slice(1)]
  }
  return ['--profile', profileName, ...argv]
}

/** Remove and return the case-insensitive terminal default-profile marker. */
function takeDefaultProfile(environment: NodeJS.ProcessEnv): string | undefined {
  let profileName: string | undefined
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() !== DEFAULT_PROFILE) continue
    const value = environment[key]
    if (value !== undefined && profileName !== undefined && value !== profileName) {
      throw new Error('dsh-desktop: conflicting default profile environment values')
    }
    profileName ??= value
    delete environment[key]
  }
  return profileName
}

/**
 * Enter the packaged DSH CLI after removing the Electron-only launch marker.
 * @param environment - process environment inherited from the generated shim.
 * @param load - ESM loader used by the executable and focused tests.
 * @param argv - mutable process arguments presented to the upstream CLI.
 * @returns once the imported CLI entry completes its top-level work.
 */
export async function runDesktopDshCli(
  environment: NodeJS.ProcessEnv = process.env,
  load: (url: string) => Promise<unknown> = url => import(url),
  argv: string[] = process.argv,
): Promise<void> {
  const profileName = takeDefaultProfile(environment)
  clearElectronRunAsNode(environment)
  if (profileName !== undefined) {
    argv.splice(2, argv.length - 2, ...withDefaultDesktopProfile(argv.slice(2), profileName))
  }
  await load(DSH_ENTRY_URL)
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]
  return entry !== undefined && fileURLToPath(import.meta.url) === entry
}

if (isDirectExecution()) {
  void runDesktopDshCli().catch((cause: unknown) => {
    process.stderr.write(`dsh-desktop: failed to start packaged dsh: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
}
