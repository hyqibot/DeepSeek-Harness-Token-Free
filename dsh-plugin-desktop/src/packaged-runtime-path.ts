/** Physical-path helpers for dependencies Electron Builder removes from app.asar. */

import { fileURLToPath } from 'node:url'

/**
 * Map one logical ASAR path to the sibling physical unpacked tree.
 * @param filename - absolute runtime path with native or POSIX separators.
 * @returns the physical unpacked path, or the original path outside a package.
 */
export function unpackedAsarPath(filename: string): string {
  return filename.replace(/([\\/])app\.asar\1/u, '$1app.asar.unpacked$1')
}

/**
 * Resolve one dependency entry beside a built desktop module.
 * @param moduleUrl - URL of a module emitted below the package's `lib` directory.
 * @param dependencyEntry - path below packaged `node_modules`.
 * @returns a physical path suitable for Node execution and profile symlinks.
 */
export function packagedDependencyPath(moduleUrl: string, dependencyEntry: string): string {
  const segments = dependencyEntry.split('/')
  if (dependencyEntry.length === 0
    || dependencyEntry.startsWith('/')
    || dependencyEntry.includes('\\')
    || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('dsh-plugin-desktop: packaged dependency entry must be a relative POSIX path')
  }
  const logicalPath = fileURLToPath(new URL(`../node_modules/${dependencyEntry}`, moduleUrl))
  return unpackedAsarPath(logicalPath)
}
