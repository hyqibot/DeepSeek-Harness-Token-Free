/** Windows browse picker that also lists other drive roots from Home. */

import { stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import BrowseDirectoryPicker, { type Config } from '@deepseek-ai/dsh-host-directory-picker-browse'
import type {
  DirectoryEntry,
  DirectoryListing,
  DirectoryPickerCapability,
} from '@deepseek-ai/dsh-host-directory-picker'

const DRIVE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Probe used to decide whether a Windows drive root is enterable. */
export type DrivePresenceProbe = (path: string) => Promise<boolean>

/**
 * True when `path` is a drive root (`C:\`), not a directory under that drive.
 * @param path - host path from a listing.
 */
export function isWindowsDriveRoot(path: string): boolean {
  return /^[A-Za-z]:\\$/u.test(win32.resolve(path))
}

/**
 * True when the in-app browser is at Home or a drive root, where drive jumps are useful.
 * Home crumbs hide `C:\`, so Home must list other drives itself.
 * @param listing - one browse listing.
 */
export function shouldInjectWindowsDrives(listing: DirectoryListing): boolean {
  const path = win32.resolve(listing.path).toLowerCase()
  const home = win32.resolve(listing.home).toLowerCase()
  return path === home || isWindowsDriveRoot(listing.path)
}

/**
 * Prepend missing drive roots, skipping the listed directory itself.
 * @param listing - listing to extend.
 * @param drives - enterable Windows drive roots.
 */
export function mergeDriveEntries(
  listing: DirectoryListing,
  drives: readonly DirectoryEntry[],
): DirectoryListing {
  const current = win32.resolve(listing.path).toLowerCase()
  const existing = new Set(listing.entries.map(entry => win32.resolve(entry.path).toLowerCase()))
  const extra = drives.filter(drive => {
    const path = win32.resolve(drive.path).toLowerCase()
    return path !== current && !existing.has(path)
  })
  if (extra.length === 0) return listing
  return { ...listing, entries: [...extra, ...listing.entries] }
}

/**
 * Enumerate A:\–Z:\ roots that currently exist as directories.
 * @param probe - injectable presence check; defaults to `stat`.
 */
export async function listWindowsDriveRoots(
  probe: DrivePresenceProbe = defaultDriveProbe,
): Promise<DirectoryEntry[]> {
  const found: DirectoryEntry[] = []
  await Promise.all([...DRIVE_LETTERS].map(async letter => {
    const path = `${letter}:\\`
    try {
      if (await probe(path)) found.push({ name: `${letter}:\\`, path, hidden: false })
    } catch {
      // Missing, empty, or inaccessible drive: skip rather than fail the listing.
    }
  }))
  return found.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * Add Windows drive-root rows when the listing is Home or a drive root.
 * @param listing - browse backend listing.
 * @param options - platform and drive-list overrides for tests.
 */
export async function withWindowsDriveRoots(
  listing: DirectoryListing,
  options: {
    platform?: NodeJS.Platform
    listDrives?: () => Promise<readonly DirectoryEntry[]>
  } = {},
): Promise<DirectoryListing> {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32' || !shouldInjectWindowsDrives(listing)) return listing
  const drives = await (options.listDrives ?? listWindowsDriveRoots)()
  return mergeDriveEntries(listing, drives)
}

/** Browse backend used on Windows Desktop instead of the koffi native chooser. */
export default class DesktopBrowseDirectoryPicker extends BrowseDirectoryPicker {
  private readonly desktopCapability: DirectoryPickerCapability

  /**
   * @param ctx - Host Cordis context.
   * @param config - upstream browse listing bound.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, config)
    const inner = super.capability()
    this.desktopCapability = inner.kind !== 'browse'
      ? inner
      : {
        kind: 'browse',
        list: async (path, signal) => withWindowsDriveRoots(await inner.list(path, signal)),
        createDirectory: (parent, name) => inner.createDirectory(parent, name),
      }
  }

  /**
   * Stable browse capability; Windows Home and drive-root listings include other drives.
   * @returns the wrapped browse capability.
   */
  override capability(): DirectoryPickerCapability {
    return this.desktopCapability
  }
}

async function defaultDriveProbe(path: string): Promise<boolean> {
  return (await stat(path)).isDirectory()
}
