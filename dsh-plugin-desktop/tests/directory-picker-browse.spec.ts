import { describe, expect, it } from 'vitest'
import type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker'
import {
  isWindowsDriveRoot,
  listWindowsDriveRoots,
  mergeDriveEntries,
  shouldInjectWindowsDrives,
  withWindowsDriveRoots,
} from '../src/directory-picker-browse.ts'

function listing(path: string, home: string, entries: DirectoryEntry[] = []): DirectoryListing {
  return {
    path,
    home,
    crumbs: [{ name: path, path, hidden: false }],
    entries,
    truncated: false,
  }
}

const desktop: DirectoryEntry = {
  name: 'Desktop',
  path: 'C:\\Users\\hahay\\Desktop',
  hidden: false,
}

const drives: DirectoryEntry[] = [
  { name: 'C:\\', path: 'C:\\', hidden: false },
  { name: 'D:\\', path: 'D:\\', hidden: false },
]

describe('Windows browse drive roots', () => {
  it('recognizes drive roots without treating home as one', () => {
    expect(isWindowsDriveRoot('C:\\')).toBe(true)
    expect(isWindowsDriveRoot('D:/')).toBe(true)
    expect(isWindowsDriveRoot('C:\\Users\\hahay')).toBe(false)
  })

  it('injects drives at Home and at a drive root, not at nested folders', () => {
    expect(shouldInjectWindowsDrives(listing('C:\\Users\\hahay', 'C:\\Users\\hahay'))).toBe(true)
    expect(shouldInjectWindowsDrives(listing('C:\\', 'C:\\Users\\hahay'))).toBe(true)
    expect(shouldInjectWindowsDrives(listing('C:\\Users', 'C:\\Users\\hahay'))).toBe(false)
    expect(shouldInjectWindowsDrives(listing('D:\\code', 'C:\\Users\\hahay'))).toBe(false)
  })

  it('prepends other drives and skips the listed directory', () => {
    const home = mergeDriveEntries(listing('C:\\Users\\hahay', 'C:\\Users\\hahay', [desktop]), drives)
    expect(home.entries.map(entry => entry.path)).toEqual(['C:\\', 'D:\\', 'C:\\Users\\hahay\\Desktop'])
    const cRoot = mergeDriveEntries(listing('C:\\', 'C:\\Users\\hahay'), drives)
    expect(cRoot.entries.map(entry => entry.path)).toEqual(['D:\\'])
  })

  it('keeps non-Windows listings unchanged', async () => {
    const source = listing('/home/user', '/home/user', [{ name: 'src', path: '/home/user/src', hidden: false }])
    await expect(withWindowsDriveRoots(source, {
      platform: 'linux',
      listDrives: async () => drives,
    })).resolves.toBe(source)
  })

  it('adds D:\\ when listing Windows Home', async () => {
    const source = listing('C:\\Users\\hahay', 'C:\\Users\\hahay', [desktop])
    const next = await withWindowsDriveRoots(source, {
      platform: 'win32',
      listDrives: async () => drives,
    })
    expect(next.entries[0]?.path).toBe('C:\\')
    expect(next.entries[1]?.path).toBe('D:\\')
  })

  it('enumerates only drive letters the probe accepts', async () => {
    const roots = await listWindowsDriveRoots(async path => path === 'D:\\' || path === 'C:\\')
    expect(roots.map(entry => entry.path)).toEqual(['C:\\', 'D:\\'])
  })
})
