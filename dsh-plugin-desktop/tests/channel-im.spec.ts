import { describe, expect, it } from 'vitest'
import { parseDiscordMessageCreate, splitDiscordText } from '../src/channel-discord.ts'
import { parseFeishuReceiveEvent, splitFeishuText } from '../src/channel-feishu.ts'
import { extractWechatText } from '../src/channel-wechat.ts'
import { isPrivateRemoteAddress, mobileRemoteUrl } from '../src/channel-lan.ts'

describe('IM channel parsers', () => {
  it('extracts Discord user text and ignores bots', () => {
    expect(parseDiscordMessageCreate({
      content: 'hello',
      channel_id: 'c1',
      author: { id: 'u1', username: 'Ada', bot: false },
    })).toEqual({
      channelId: 'c1',
      userId: 'u1',
      displayName: 'Ada',
      text: 'hello',
    })
    expect(parseDiscordMessageCreate({
      content: 'hello',
      channel_id: 'c1',
      author: { id: 'bot', username: 'Bot', bot: true },
    })).toBeUndefined()
    expect(splitDiscordText('a'.repeat(1901))).toHaveLength(2)
  })

  it('extracts Feishu text events from nested payloads', () => {
    expect(parseFeishuReceiveEvent({
      event: {
        sender: { sender_id: { open_id: 'ou_1' } },
        message: {
          chat_id: 'oc_1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hi' }),
        },
      },
    })).toEqual({
      chatId: 'oc_1',
      receiveIdType: 'chat_id',
      userId: 'ou_1',
      displayName: 'ou_1',
      text: 'hi',
    })
    expect(splitFeishuText('ok')).toEqual(['ok'])
  })

  it('extracts WeChat iLink text items', () => {
    expect(extractWechatText([
      { type: 1, text_item: { text: 'task' } },
    ])).toBe('task')
  })

  it('accepts private LAN addresses for the mobile listener', () => {
    expect(isPrivateRemoteAddress('192.168.1.8')).toBe(true)
    expect(isPrivateRemoteAddress('8.8.8.8')).toBe(false)
    expect(mobileRemoteUrl('192.168.1.8', 8787, 'abc')).toBe('http://192.168.1.8:8787/?token=abc')
  })
})
