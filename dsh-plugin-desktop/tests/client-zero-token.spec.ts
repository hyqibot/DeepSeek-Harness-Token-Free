import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { applyZeroTokenSettings } from '../src/client/zero-token-settings.ts'

describe('zero-token settings section', () => {
  it('registers a settings.section page in both shell modes', () => {
    const style = {
      dataset: {} as Record<string, string>,
      textContent: '',
      remove: vi.fn(),
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => style,
      head: { appendChild },
    })
    vi.stubGlobal('navigator', { language: 'zh-CN' })

    try {
      const register = vi.fn<(
        options: { name: string; id: string; order: number; label: () => string },
        component: unknown,
      ) => () => void>(() => () => {})
      const inject = vi.fn((_name: string, factory: () => unknown) => {
        factory()
        return () => {}
      })
      const effect = vi.fn((fn: () => () => void) => fn())
      applyZeroTokenSettings({
        slots: { inject, register },
        effect,
      } as unknown as ClientContext)

      expect(inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'settings.section',
          id: 'zero-token',
          order: 15,
        }),
        expect.any(Function),
      )
      const options = register.mock.calls[0]?.[0]
      expect(options?.label()).toBe('免token 网关')
      expect(style.textContent).toContain('.dshZeroTokenCard')
      expect(style.textContent).toContain('.dshZeroTokenCheck')
      expect(style.textContent).toContain('.dshZeroTokenPurchase { display: flex; justify-content: flex-end; align-items: center; gap: 16px;')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
