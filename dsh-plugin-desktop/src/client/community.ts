/** Shared DingTalk community join link used by the sidebar and Zero-Token settings. */

/** Official DingTalk group join URL. Electron opens https targets in the system browser. */
export const DINGTALK_COMMUNITY_URL =
  'https://www.dingtalk.com/download?action=joingroup&code=v1,k1,9O3Nk5uBqF+FKGHas0gK4dkuLhC1CkMJ4CgU45rKMf8=&_dt_no_comment=1&origin=11'

/** Copy next to the sidebar wordmark. */
export const DINGTALK_SIDEBAR_LABEL = '点击进入社区钉群交流'

/** Copy to the left of the Zero-Token purchase link. */
export const DINGTALK_LICENSE_LABEL = '加社区免费获取激活码'

/** Marker on the sidebar injection so React remounts do not duplicate it. */
export const DINGTALK_SIDEBAR_LINK_ID = 'dsh-dingtalk-community-sidebar'

/** Harness BrandWordmark clip id — unique in the sidebar logo SVG. */
export const DSH_WORDMARK_CLIP_ID = 'dsh-wordmark-whale-clip'

const COMMUNITY_CLASS = 'dshDingTalkCommunity'

/** Inline DingTalk mark (circle + origami bird). */
export const DINGTALK_ICON_SVG =
  '<svg viewBox="0 0 1024 1024" class="dshDingTalkCommunityIcon" aria-hidden="true">'
  + '<path fill="#0089FF" d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64z"/>'
  + '<path fill="#FFF" d="M733.4 370.5s-22.4-18.6-49.3-11.5l-202.9 43.5-91.5-90.2s-3.8-7-12.2-9c0 0-7-1.3-11.5 4.5 0 0-16.6 15.4-8.3 38.4l46.7 121.6-168.3 150.4s-25 17.3-12.2 36.5c0 0 5.1 8.3 20.5 8.3 10.2 0 192-127.4 192-127.4l229.1 172.2s14.1 8.3 26.2-1.9c0 0 8.3-6.4 4.5-22.4L554.9 480.6l185.6-82.6s27.5-12.8 20.5-34.6c-1.3-7-10.9-15.3-27.6-7z"/>'
  + '</svg>'

/** Styles for both the sidebar row and the Zero-Token purchase row. */
export const DINGTALK_COMMUNITY_CSS = `
.dshDingTalkCommunity { display: inline-flex; align-items: flex-start; gap: 6px; max-width: 100%; text-decoration: none; color: var(--dsw-alias-text-brand, #0089FF); font-size: 11px; line-height: 1.35; font-weight: 600; -webkit-app-region: no-drag; }
.dshDingTalkCommunity:hover { text-decoration: underline; }
.dshDingTalkCommunityIcon { width: 16px; height: 16px; flex: none; margin-top: 1px; display: block; }
#${DINGTALK_SIDEBAR_LINK_ID} { margin: 0 4px 8px; padding: 0; }
`

/**
 * Place the community link on the line below the DeepSeek Harness wordmark.
 * Remove it while the sidebar is collapsed (wordmark unmounts).
 * @param root - document or a test stand-in.
 */
export function mountSidebarCommunityLink(root: ParentNode): void {
  const existing = queryById(root, DINGTALK_SIDEBAR_LINK_ID)
  const logoRow = findWordmarkLogoRow(root)
  if (logoRow == null) {
    existing?.remove()
    return
  }
  if (existing !== null && existing.previousElementSibling === logoRow) return
  existing?.remove()
  logoRow.insertAdjacentElement('afterend', createCommunityAnchor(DINGTALK_SIDEBAR_LABEL, DINGTALK_SIDEBAR_LINK_ID))
}

/**
 * Locate the sidebar logo row that hosts the BrandWordmark SVG.
 * @param root - document or a test stand-in.
 */
export function findWordmarkLogoRow(root: ParentNode): Element | null {
  const clip = queryById(root, DSH_WORDMARK_CLIP_ID)
  if (clip == null || typeof clip.closest !== 'function') return null
  const svg = clip.closest('svg')
  if (svg == null) return null
  const brand = typeof svg.closest === 'function' ? svg.closest('button') : null
  const host = brand ?? svg.parentElement
  return host?.parentElement ?? null
}

function queryById(root: ParentNode, id: string): HTMLElement | null {
  if (typeof root.querySelector !== 'function') return null
  return root.querySelector(`#${id}`)
}

function createCommunityAnchor(label: string, id?: string): HTMLAnchorElement {
  const link = document.createElement('a')
  link.className = COMMUNITY_CLASS
  if (id !== undefined) link.id = id
  link.href = DINGTALK_COMMUNITY_URL
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.innerHTML = `${DINGTALK_ICON_SVG}<span>${label}</span>`
  return link
}
