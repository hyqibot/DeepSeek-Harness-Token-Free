import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DINGTALK_COMMUNITY_URL,
  DINGTALK_LICENSE_LABEL,
  DINGTALK_SIDEBAR_LABEL,
  DINGTALK_SIDEBAR_LINK_ID,
  DSH_WORDMARK_CLIP_ID,
  mountSidebarCommunityLink,
} from '../src/client/community.ts'
import {
  applyDingTalkCommunity,
  DINGTALK_COMMUNITY_OBSERVE,
} from '../src/client/community-sidebar.ts'

function fakeWordmarkRoot(options: {
  logoRow?: { insertAdjacentElement: ReturnType<typeof vi.fn>; previous?: unknown }
  existing?: { remove: ReturnType<typeof vi.fn>; previousElementSibling: unknown }
} = {}): ParentNode {
  const logoRow = options.logoRow
  const brand = logoRow === undefined ? null : { parentElement: logoRow }
  const svg = {
    closest: (selector: string) => selector === 'button' ? brand : svg,
    parentElement: brand,
  }
  const clip = {
    closest: (selector: string) => selector === 'svg' ? svg : null,
  }
  return {
    querySelector: (selector: string) => {
      if (selector === `#${DSH_WORDMARK_CLIP_ID}`) return logoRow === undefined ? null : clip
      if (selector === `#${DINGTALK_SIDEBAR_LINK_ID}`) return options.existing ?? null
      return null
    },
  } as unknown as ParentNode
}

describe('dingtalk community link', () => {
  it('keeps the join URL and Chinese labels', () => {
    expect(DINGTALK_COMMUNITY_URL).toContain('dingtalk.com/download?action=joingroup')
    expect(DINGTALK_SIDEBAR_LABEL).toBe('点击进入社区钉群交流')
    expect(DINGTALK_LICENSE_LABEL).toBe('加社区免费获取激活码')
  })

  it('inserts the community link on the line below the wordmark', () => {
    const insertAdjacentElement = vi.fn()
    const created: { href?: string; id?: string; innerHTML?: string; target?: string } = {}
    vi.stubGlobal('document', {
      createElement: () => created,
    })
    try {
      mountSidebarCommunityLink(fakeWordmarkRoot({
        logoRow: { insertAdjacentElement },
      }))
      expect(created.href).toBe(DINGTALK_COMMUNITY_URL)
      expect(created.id).toBe(DINGTALK_SIDEBAR_LINK_ID)
      expect(created.target).toBe('_blank')
      expect(created.innerHTML).toContain(DINGTALK_SIDEBAR_LABEL)
      expect(insertAdjacentElement).toHaveBeenCalledWith('afterend', created)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not duplicate a link already under the wordmark', () => {
    const insertAdjacentElement = vi.fn()
    const existing = { remove: vi.fn(), previousElementSibling: {} }
    const logoRow = { insertAdjacentElement }
    existing.previousElementSibling = logoRow
    mountSidebarCommunityLink(fakeWordmarkRoot({ logoRow, existing }))
    expect(insertAdjacentElement).not.toHaveBeenCalled()
    expect(existing.remove).not.toHaveBeenCalled()
  })

  it('removes the link when the wordmark is gone', () => {
    const existing = { remove: vi.fn(), previousElementSibling: null }
    mountSidebarCommunityLink(fakeWordmarkRoot({ existing }))
    expect(existing.remove).toHaveBeenCalled()
  })

  it('watches the document with childList only', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    const style = {
      dataset: {} as Record<string, string>,
      textContent: '',
      remove: vi.fn(),
    }
    vi.stubGlobal('MutationObserver', class {
      observe = observe
      disconnect = disconnect
    })
    vi.stubGlobal('document', {
      createElement: () => style,
      head: { appendChild: vi.fn() },
      body: { querySelector: () => null },
    })
    try {
      const effect = vi.fn((fn: () => () => void) => fn())
      applyDingTalkCommunity({ effect } as unknown as ClientContext)
      expect(style.textContent).toContain('.dshDingTalkCommunity')
      expect(observe).toHaveBeenCalledWith(expect.anything(), DINGTALK_COMMUNITY_OBSERVE)
      expect(DINGTALK_COMMUNITY_OBSERVE.attributes).toBeUndefined()
      expect(DINGTALK_COMMUNITY_OBSERVE.characterData).toBeUndefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
