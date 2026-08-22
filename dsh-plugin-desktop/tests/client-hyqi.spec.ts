import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  applyHyqiSettingsTag,
  HYQI_KEY_STORED_PLACEHOLDER,
  HYQI_SETTINGS_OBSERVE,
  HYQI_SETTINGS_TAG,
  retagHyqiRows,
} from '../src/client/hyqi-settings.ts'

function fakeRoot(spans: unknown[], buttons: unknown[], inputs: unknown[] = []): ParentNode {
  return {
    querySelectorAll: (selector: string) => {
      if (selector === 'button') return buttons
      if (selector === 'input') return inputs
      return spans
    },
  } as unknown as ParentNode
}

function fakeKeyInput(options: {
  placeholder: string
  ariaLabel?: string
  title: string
}): { input: HTMLInputElement, placeholderWrites: () => number } {
  const attrs: Record<string, string> = {
    type: 'password',
    'aria-label': options.ariaLabel ?? 'API 密钥',
    placeholder: options.placeholder,
  }
  let placeholderWrites = 0
  const row = {
    querySelectorAll: (selector: string) => selector === 'span'
      ? [{ textContent: options.title }]
      : [],
  }
  const input = {
    get placeholder() { return attrs.placeholder ?? '' },
    set placeholder(value: string) {
      attrs.placeholder = value
      placeholderWrites += 1
    },
    getAttribute: (name: string) => attrs[name] ?? null,
    setAttribute: (name: string, value: string) => {
      attrs[name] = value
      if (name === 'placeholder') placeholderWrites += 1
    },
    closest: (selector: string) => selector === 'li' ? row : null,
  }
  return { input: input as unknown as HTMLInputElement, placeholderWrites: () => placeholderWrites }
}

describe('hyqi settings tag', () => {
  it('replaces the generic custom tag next to the HYQi row name', () => {
    const tag = { textContent: '自定义' }
    const name = { textContent: 'HYQi', nextElementSibling: tag }
    retagHyqiRows(fakeRoot([name], []))
    expect(tag.textContent).toBe(HYQI_SETTINGS_TAG)
  })

  it('hides the HYQi row delete button and leaves edit in place', () => {
    const tag = { textContent: '自定义' }
    const name = { textContent: 'HYQi', nextElementSibling: tag }
    const style = { display: '' }
    const edit = {
      hidden: false,
      style,
      getAttribute: (attr: string) => attr === 'aria-label' ? '编辑 HYQi (hyqi)' : null,
    }
    const remove = {
      hidden: false,
      style: { display: '' },
      getAttribute: (attr: string) => attr === 'aria-label' ? '删除 HYQi (hyqi)' : null,
    }
    const otherRemove = {
      hidden: false,
      style: { display: '' },
      getAttribute: (attr: string) => attr === 'aria-label' ? '删除 OpenAI' : null,
    }
    retagHyqiRows(fakeRoot([name], [edit, remove, otherRemove]))
    expect(edit.hidden).toBe(false)
    expect(remove.hidden).toBe(true)
    expect(remove.style.display).toBe('none')
    expect(otherRemove.hidden).toBe(false)
  })

  it('hides the English HYQi delete control', () => {
    const remove = {
      hidden: false,
      style: { display: '' },
      getAttribute: (attr: string) => attr === 'aria-label' ? 'Remove HYQi (hyqi)' : null,
    }
    retagHyqiRows(fakeRoot([], [remove]))
    expect(remove.hidden).toBe(true)
  })

  it('hides the 删除 control on the HYQi row when aria-label is missing', () => {
    const hyqiName = { textContent: 'HYQi' }
    const row = {
      querySelectorAll: (selector: string) => selector === 'span' ? [hyqiName] : [],
    }
    const remove = {
      hidden: false,
      style: { display: '' },
      textContent: '删除',
      getAttribute: () => null,
      closest: (selector: string) => selector === 'li' ? row : null,
    }
    retagHyqiRows(fakeRoot([], [remove]))
    expect(remove.hidden).toBe(true)
  })

  it('does not rewrite an already-hidden HYQi delete button', () => {
    let displayWrites = 0
    const style = {
      get display() { return 'none' },
      set display(_value: string) { displayWrites += 1 },
    }
    const remove = {
      hidden: true,
      style,
      getAttribute: (attr: string) => attr === 'aria-label' ? '删除 HYQi (hyqi)' : null,
    }
    retagHyqiRows(fakeRoot([], [remove]))
    expect(displayWrites).toBe(0)
  })

  it('rewrites the stored-key placeholder on the HYQi editor', () => {
    const { input } = fakeKeyInput({
      placeholder: '已配置——输入新值可替换',
      title: 'HYQi',
    })
    retagHyqiRows(fakeRoot([], [], [input]))
    expect(input.getAttribute('placeholder')).toBe(HYQI_KEY_STORED_PLACEHOLDER)
  })

  it('rewrites the English stored-key placeholder on the HYQi editor', () => {
    const { input } = fakeKeyInput({
      placeholder: 'Configured — enter a new value to replace',
      ariaLabel: 'API key',
      title: 'HYQi',
    })
    retagHyqiRows(fakeRoot([], [], [input]))
    expect(input.getAttribute('placeholder')).toBe(HYQI_KEY_STORED_PLACEHOLDER)
  })

  it('leaves other providers stored-key placeholders unchanged', () => {
    const { input } = fakeKeyInput({
      placeholder: '已配置——输入新值可替换',
      title: 'DeepSeek',
    })
    retagHyqiRows(fakeRoot([], [], [input]))
    expect(input.getAttribute('placeholder')).toBe('已配置——输入新值可替换')
  })

  it('does not rewrite an already-updated HYQi key placeholder', () => {
    const { input, placeholderWrites } = fakeKeyInput({
      placeholder: HYQI_KEY_STORED_PLACEHOLDER,
      title: 'HYQi',
    })
    retagHyqiRows(fakeRoot([], [], [input]))
    expect(placeholderWrites()).toBe(0)
  })

  it('rewrites when the stored-key copy is assigned after the editor mounts', () => {
    const { input } = fakeKeyInput({
      placeholder: '输入 API 密钥，或留空使用环境认证',
      title: 'HYQi',
    })
    retagHyqiRows(fakeRoot([], [], [input]))
    expect(input.getAttribute('placeholder')).toBe('输入 API 密钥，或留空使用环境认证')
    input.placeholder = '已配置——输入新值可替换'
    expect(input.getAttribute('placeholder')).toBe(HYQI_KEY_STORED_PLACEHOLDER)
  })

  it('watches the document for Models-page renders', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('MutationObserver', class {
      observe = observe
      disconnect = disconnect
    })
    vi.stubGlobal('document', {
      body: { querySelectorAll: () => [] },
    })
    try {
      const effect = vi.fn((fn: () => () => void) => fn())
      applyHyqiSettingsTag({ effect } as unknown as ClientContext)
      expect(observe).toHaveBeenCalledWith(expect.anything(), HYQI_SETTINGS_OBSERVE)
      expect(HYQI_SETTINGS_OBSERVE.attributes).toBeUndefined()
      expect(HYQI_SETTINGS_OBSERVE.characterData).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
