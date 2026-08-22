import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  PLUGIN_TOGGLES_HTTP_PREFIX,
  dispatchPluginTogglesHttp,
  type PluginTogglesHttpController,
  type PluginTogglesSnapshot,
} from '../src/plugin-toggles-http.ts'
import { applyPluginDisabledPatch, normalizePatchEntryId, normalizePatchLayerIds } from '../src/plugin-toggles-patch.ts'
import { pluginToggleLockReason } from '../src/plugin-toggles-policy.ts'
import {
  apply,
  inject,
  name,
  persistPluginToggle,
  pluginToggleTitle,
  setPluginToggleEnabled,
  snapshotPluginToggles,
} from '../src/plugin-toggles.ts'

function sampleSnapshot(overrides: Partial<PluginTogglesSnapshot> = {}): PluginTogglesSnapshot {
  return {
    entries: [
      {
        entryId: 'desktop-hyqi',
        moduleName: 'dsh-plugin-desktop/hyqi',
        title: 'plugin-desktop/hyqi',
        enabled: true,
        locked: false,
        lockReason: null,
      },
      {
        entryId: 'desktop-shell',
        moduleName: 'dsh-plugin-desktop',
        title: 'plugin-desktop',
        enabled: true,
        locked: true,
        lockReason: 'keeping this row enabled is required for Desktop Settings',
      },
    ],
    ...overrides,
  }
}

async function listen(handler: PluginTogglesHttpController): Promise<{ origin: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void dispatchPluginTogglesHttp(req, res, handler)
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error))
    }),
  }
}

describe('plugin toggle policy', () => {
  it('locks the desktop shell and settings rows', () => {
    expect(pluginToggleLockReason('desktop-shell', 'dsh-plugin-desktop')).toContain('Desktop Settings')
    expect(pluginToggleLockReason('ui-settings', '@deepseek-ai/dsh-client-ui-settings')).toContain('Desktop Settings')
    expect(pluginToggleLockReason('desktop-hyqi', 'dsh-plugin-desktop/hyqi')).toBeNull()
  })

  it('compacts module specifiers for the Settings list', () => {
    expect(pluginToggleTitle('@deepseek-ai/dsh-client-ui-settings')).toBe('ui-settings')
    expect(pluginToggleTitle('dsh-plugin-desktop/hyqi')).toBe('plugin-desktop/hyqi')
  })
})

describe('plugin toggle patch', () => {
  it('adds a disabled overlay for an unknown Loader id', () => {
    expect(applyPluginDisabledPatch('', 'desktop-hyqi', true)).toContain('id: desktop-hyqi')
    expect(applyPluginDisabledPatch('', 'desktop-hyqi', true)).toContain('disabled: true')
  })

  it('updates an existing id inside an insert group', () => {
    const next = applyPluginDisabledPatch([
      '- insert:',
      '    - id: desktop-hyqi',
      '      name: dsh-plugin-desktop/hyqi',
      '',
    ].join('\n'), 'desktop-hyqi', true)
    expect(next).toMatch(/id: desktop-hyqi[\s\S]*disabled: true/u)
  })

  it('matches and rewrites legacy include-prefixed ids', () => {
    const source = [
      '[',
      '  { id: include:web-search-deepseek, disabled: true },',
      ']',
      '',
    ].join('\n')
    const disabled = applyPluginDisabledPatch(source, 'web-search-deepseek', true)
    expect(disabled).toContain('id: web-search-deepseek')
    expect(disabled).not.toContain('include:web-search-deepseek')
    expect(disabled).toContain('disabled: true')

    const enabled = applyPluginDisabledPatch(disabled, 'web-search-deepseek', false)
    expect(enabled).toContain('id: web-search-deepseek')
    expect(enabled).not.toContain('disabled:')
  })

  it('normalizes legacy ids in loaded patch layers', () => {
    expect(normalizePatchEntryId('include:tool-web')).toBe('tool-web')
    expect(normalizePatchLayerIds([
      { id: 'include:web-search-deepseek', disabled: true },
      { insert: [{ id: 'include:desktop-hyqi', disabled: true }] },
    ] as Parameters<typeof normalizePatchLayerIds>[0])).toEqual([
      { id: 'web-search-deepseek', disabled: true },
      { insert: [{ id: 'desktop-hyqi', disabled: true }] },
    ])
  })
})

describe('plugin toggle persistence', () => {
  it('writes the profile user overlay and creates the file when missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-toggles-'))
    await persistPluginToggle(dir, 'desktop-hyqi', false)
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: desktop-hyqi')
    expect(text).toContain('disabled: true')
  })
})

describe('plugin toggle HTTP', () => {
  it(`owns the ${PLUGIN_TOGGLES_HTTP_PREFIX} loopback prefix`, async () => {
    const server = await listen({
      snapshot: () => sampleSnapshot(),
      setEnabled: async () => sampleSnapshot(),
      requestRestart: async () => {},
    })
    try {
      const response = await fetch(`${server.origin}${PLUGIN_TOGGLES_HTTP_PREFIX}/status`)
      expect(response.ok).toBe(true)
      const body = await response.json() as PluginTogglesSnapshot
      expect(body.entries[0]?.entryId).toBe('desktop-hyqi')
    } finally {
      await server.close()
    }
  })

  it('rejects a locked or unknown toggle with 409', async () => {
    const server = await listen({
      snapshot: () => sampleSnapshot(),
      setEnabled: async () => {
        throw new Error('keeping this row enabled is required for Desktop Settings')
      },
      requestRestart: async () => {},
    })
    try {
      const locked = await fetch(`${server.origin}${PLUGIN_TOGGLES_HTTP_PREFIX}/enabled`, {
        method: 'POST',
        body: JSON.stringify({ entryId: 'desktop-shell', enabled: false }),
      })
      expect(locked.status).toBe(409)
    } finally {
      await server.close()
    }
  })
})

describe('plugin toggle host plugin', () => {
  it('registers the Settings HTTP prefix', () => {
    expect(name).toBe('desktop-plugin-toggles')
    expect(inject).toEqual(['desktopRuntime', 'desktopProfiles', 'webServer'])
  })

  it('projects Loader rows and refuses locked toggles', async () => {
    const requestRestart = vi.fn(async () => {})
    const ctx = {
      loader: {
        entries: () => [
          { id: 'desktop-hyqi', disabled: false, options: { name: 'dsh-plugin-desktop/hyqi' } },
          { id: 'desktop-shell', disabled: false, options: { name: 'dsh-plugin-desktop' } },
        ],
      },
      desktopProfiles: { current: { name: 'desktop', dir: '/tmp/unused' } },
      desktopRuntime: { requestRestart },
      logger: { error: vi.fn() },
    } as unknown as Context
    const snapshot = snapshotPluginToggles(ctx)
    expect(snapshot.entries).toEqual([
      expect.objectContaining({ entryId: 'desktop-hyqi', enabled: true, locked: false }),
      expect.objectContaining({ entryId: 'desktop-shell', locked: true }),
    ])
    await expect(setPluginToggleEnabled(ctx, 'desktop-shell', false))
      .rejects.toThrow('required for Desktop Settings')
    await expect(setPluginToggleEnabled(ctx, 'missing', false))
      .rejects.toThrow('unknown plugin')
    expect(requestRestart).not.toHaveBeenCalled()
  })

  it('writes the overlay and leaves restart to the Settings dialog', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-toggles-'))
    const requestRestart = vi.fn(async () => {})
    const ctx = {
      loader: {
        entries: () => [
          { id: 'desktop-hyqi', disabled: false, options: { name: 'dsh-plugin-desktop/hyqi' } },
        ],
      },
      desktopProfiles: { current: { name: 'desktop', dir } },
      desktopRuntime: { requestRestart },
      logger: { error: vi.fn() },
    } as unknown as Context
    const disabled = await setPluginToggleEnabled(ctx, 'desktop-hyqi', false)
    expect(disabled.restartRequired).toBe(true)
    expect(disabled.entries[0]?.enabled).toBe(false)
    expect(requestRestart).not.toHaveBeenCalled()
    expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('disabled: true')

    const enabled = await setPluginToggleEnabled({
      ...ctx,
      loader: {
        entries: () => [
          { id: 'desktop-hyqi', disabled: true, options: { name: 'dsh-plugin-desktop/hyqi' } },
        ],
      },
    } as unknown as Context, 'desktop-hyqi', true)
    expect(enabled.restartRequired).toBe(true)
    expect(enabled.entries[0]?.enabled).toBe(true)
    expect(requestRestart).not.toHaveBeenCalled()
    const text = await readFile(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('id: desktop-hyqi')
    expect(text).not.toContain('disabled: true')
  })

  it('restarts only after the Settings dialog posts /restart', async () => {
    const requestRestart = vi.fn(async () => {})
    const server = await listen({
      snapshot: () => sampleSnapshot(),
      setEnabled: async () => sampleSnapshot({ restartRequired: true }),
      requestRestart,
    })
    try {
      const saved = await fetch(`${server.origin}${PLUGIN_TOGGLES_HTTP_PREFIX}/enabled`, {
        method: 'POST',
        body: JSON.stringify({ entryId: 'desktop-hyqi', enabled: false }),
      })
      expect(saved.ok).toBe(true)
      expect(await saved.json()).toEqual(expect.objectContaining({ restartRequired: true }))
      expect(requestRestart).not.toHaveBeenCalled()
      const restart = await fetch(`${server.origin}${PLUGIN_TOGGLES_HTTP_PREFIX}/restart`, {
        method: 'POST',
        body: '{}',
      })
      expect(restart.ok).toBe(true)
      expect(requestRestart).toHaveBeenCalledOnce()
    } finally {
      await server.close()
    }
  })

  it('registers the loopback prefix on apply', () => {
    const unregister = vi.fn()
    const register = vi.fn(() => unregister)
    const effect = vi.fn((fn: () => () => void) => fn())
    apply({
      effect,
      webServer: { register },
    } as unknown as Context)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'prefix',
      path: PLUGIN_TOGGLES_HTTP_PREFIX,
    }))
  })
})
