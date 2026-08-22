import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { applyChannelSettings } from '../src/client/channel-settings.ts'
import { applyDesktopToolsSettings } from '../src/client/desktop-tools-settings.ts'
import { applyPluginToggleSettings } from '../src/client/plugin-toggle-settings.ts'

function registerSection(apply: (ctx: ClientContext) => void): {
  id: string
  label: string
  css: string
} {
  const style = {
    dataset: {} as Record<string, string>,
    textContent: '',
    remove: vi.fn(),
  }
  vi.stubGlobal('document', {
    createElement: () => style,
    head: { appendChild: vi.fn() },
  })
  vi.stubGlobal('navigator', { language: 'zh-CN' })
  const register = vi.fn<(
    options: { name: string; id: string; order: number; label: () => string },
    component: unknown,
  ) => () => void>(() => () => {})
  const inject = vi.fn((_name: string, factory: () => unknown) => {
    factory()
    return () => {}
  })
  const effect = vi.fn((fn: () => () => void) => fn())
  apply({
    slots: { inject, register },
    effect,
  } as unknown as ClientContext)
  const options = register.mock.calls[0]?.[0]
  if (options === undefined) throw new Error('settings.section was not registered')
  return {
    id: options.id,
    label: options.label(),
    css: style.textContent,
  }
}

describe('desktop settings sections', () => {
  it('registers Channels with an in-page QR surface', () => {
    try {
      const section = registerSection(applyChannelSettings)
      expect(section.id).toBe('channels')
      expect(section.label).toBe('远程控制')
      expect(section.css).toContain('.dshChannelsQr')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('registers Desktop tools for former tray commands', () => {
    try {
      const section = registerSection(applyDesktopToolsSettings)
      expect(section.id).toBe('desktop-tools')
      expect(section.label).toBe('桌面')
      expect(section.css).toContain('.dshDesktopToolsCard')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('registers plugin toggles for Settings enable/disable switches', () => {
    try {
      const section = registerSection(applyPluginToggleSettings)
      expect(section.id).toBe('plugin-toggles')
      expect(section.label).toBe('插件开关')
      expect(section.css).toContain('.dshPluginTogglesCard')
      expect(section.css).toContain('.dshPluginTogglesDialog')
      const page = readFileSync(fileURLToPath(new URL('../src/client/PluginTogglesSection.tsx', import.meta.url)), 'utf8')
      expect(page).toContain('role="dialog"')
      expect(page).toContain("'/restart'")
      expect(page).toContain('setRestartOpen(true)')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
