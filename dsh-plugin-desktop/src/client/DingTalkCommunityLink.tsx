/** Clickable DingTalk community join control. */

import { DINGTALK_COMMUNITY_URL } from './community.ts'

/** Blue circular DingTalk mark used next to community copy. */
export function DingTalkIcon() {
  return (
    <svg viewBox="0 0 1024 1024" className="dshDingTalkCommunityIcon" aria-hidden="true">
      <path fill="#0089FF" d="M512 64C264.6 64 64 264.6 64 512s200.6 448 448 448 448-200.6 448-448S759.4 64 512 64z" />
      <path fill="#FFF" d="M733.4 370.5s-22.4-18.6-49.3-11.5l-202.9 43.5-91.5-90.2s-3.8-7-12.2-9c0 0-7-1.3-11.5 4.5 0 0-16.6 15.4-8.3 38.4l46.7 121.6-168.3 150.4s-25 17.3-12.2 36.5c0 0 5.1 8.3 20.5 8.3 10.2 0 192-127.4 192-127.4l229.1 172.2s14.1 8.3 26.2-1.9c0 0 8.3-6.4 4.5-22.4L554.9 480.6l185.6-82.6s27.5-12.8 20.5-34.6c-1.3-7-10.9-15.3-27.6-7z" />
    </svg>
  )
}

/**
 * Open the community DingTalk group in the system browser.
 * @param props.label - visible text beside the icon.
 */
export function DingTalkCommunityLink({ label }: { label: string }) {
  return (
    <a
      className="dshDingTalkCommunity"
      href={DINGTALK_COMMUNITY_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      <DingTalkIcon />
      <span>{label}</span>
    </a>
  )
}
