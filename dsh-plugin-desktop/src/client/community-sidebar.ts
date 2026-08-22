/** Inject the DingTalk community row under the sidebar DeepSeek Harness wordmark. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { DINGTALK_COMMUNITY_CSS, mountSidebarCommunityLink } from './community.ts'

/** MutationObserver options: childList only, never attributes (avoids a freeze loop). */
export const DINGTALK_COMMUNITY_OBSERVE: MutationObserverInit = {
  childList: true,
  subtree: true,
}

/**
 * Watch the sidebar brand row and keep the community join link under the wordmark.
 * @param ctx - browser Cordis context.
 */
export function applyDingTalkCommunity(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-plugin-desktop/dingtalk-community'
    style.textContent = DINGTALK_COMMUNITY_CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'desktop: dingtalk community styles')

  ctx.effect(() => {
    let applying = false
    const observer = new MutationObserver(() => {
      if (applying) return
      applying = true
      observer.disconnect()
      try {
        mountSidebarCommunityLink(document.body)
      } finally {
        applying = false
        observer.observe(document.body, DINGTALK_COMMUNITY_OBSERVE)
      }
    })
    observer.observe(document.body, DINGTALK_COMMUNITY_OBSERVE)
    mountSidebarCommunityLink(document.body)
    return () => { observer.disconnect() }
  }, 'desktop: dingtalk community sidebar')
}
