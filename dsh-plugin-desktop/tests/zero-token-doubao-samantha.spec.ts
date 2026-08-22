import { describe, expect, it } from 'vitest'
// @ts-expect-error vendored CoPaw gateway ESM has no types
import * as samanthaText from '../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/doubao-samantha-text.mjs'

const {
  createDoubaoSpokenAccumulator,
  createDoubaoStreamTextState,
  extractVisibleTextFromNamedSse,
  extractVisibleTextFromSamanthaEventData,
  isDoubaoQuestionEcho,
  spokenTextFromSamanthaContent,
  takeDoubaoSpokenDelta,
} = samanthaText

function samanthaEvent(contentType: number, payload: Record<string, unknown>) {
  return {
    message: {
      content_type: contentType,
      content: JSON.stringify(payload),
    },
  }
}

function spokenJoin(events: Array<{ content_type: number; payload: Record<string, unknown> }>) {
  const state = createDoubaoStreamTextState()
  return events
    .flatMap((event) => extractVisibleTextFromSamanthaEventData(
      samanthaEvent(event.content_type, event.payload),
      state,
    ))
    .join('')
}

describe('Doubao Samantha spoken text (thinking vs reply)', () => {
  it('does not mash thinking-chain 2008 into the spoken 2001 reply', () => {
    const spoken = spokenJoin([
      { content_type: 2008, payload: { text: '你自我介绍' } },
      { content_type: 2001, payload: { text: '好，我是豆包，' } },
      { content_type: 2008, payload: { think: '询问' } },
      { content_type: 2001, payload: { text: '由字节跳动基于Seed大模型基座独立研发的AI助手，很高兴和你交流' } },
    ])
    expect(spoken).toBe('好，我是豆包，由字节跳动基于Seed大模型基座独立研发的AI助手，很高兴和你交流')
    expect(spoken).not.toContain('你自我介绍')
    expect(spoken).not.toContain('询问')
  })

  it('drops hidden content types and never emits content.think', () => {
    expect(spokenTextFromSamanthaContent(JSON.stringify({ text: '你自我介绍' }), 2008)).toBe('')
    expect(spokenTextFromSamanthaContent(JSON.stringify({ think: '询问' }), 2008)).toBe('')
    expect(spokenTextFromSamanthaContent(JSON.stringify({ text: '相关问题？' }), 2002)).toBe('')
    expect(spokenTextFromSamanthaContent(JSON.stringify({ text: '深度思考中' }), 10040)).toBe('')
    expect(spokenTextFromSamanthaContent(JSON.stringify({ think: '内部草稿', text: '我是豆包' }), 2001)).toBe('我是豆包')
  })

  it('keeps tool_call fragments on 2030 and tts_content', () => {
    const xml = '<tool_call>{"name":"Bash"}</tool_call>'
    expect(spokenTextFromSamanthaContent(xml, 2030)).toBe(xml)
    expect(extractVisibleTextFromSamanthaEventData({
      tts_content: xml,
      message: { content_type: 2001, content: JSON.stringify({ text: 'ok' }) },
    })).toEqual([xml, 'ok'])
  })

  it('keeps think/expert-mode routing 10000 out of the spoken 2001 reply', () => {
    const state = createDoubaoStreamTextState()
    expect(extractVisibleTextFromSamanthaEventData(
      samanthaEvent(10000, { text: '你好，你是谁' }),
      state,
    )).toEqual([])
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', { text: '你自我介绍', content_type: 2008 }, state)).toEqual([])
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', { think: '草稿' }, state)).toEqual([])
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', { text: '可见', content_type: 2001 }, createDoubaoStreamTextState())).toEqual(['可见'])
  })

  it('does not mash a 10000 question-echo onto the spoken 2001 reply', () => {
    const state = createDoubaoStreamTextState()
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', {
      text: '你好，你是谁',
      content_type: 10000,
    }, state)).toEqual([])
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', {
      text: '我是豆包，由字节跳动基于 Seed 大模型基座独立研发的AI助手。',
      content_type: 2001,
    }, state)).toEqual(['我是豆包，由字节跳动基于 Seed 大模型基座独立研发的AI助手。'])
  })

  it('does not mash an untyped user-echo CHUNK_DELTA onto the spoken 2001 reply', () => {
    const state = createDoubaoStreamTextState()
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', { text: '你是谁' }, state)).toEqual([])
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', {
      text: '我，由字节跳动基于 Seed 大模型基座独立研发的AI助手。',
      content_type: 2001,
    }, state)).toEqual(['我，由字节跳动基于 Seed 大模型基座独立研发的AI助手。'])
  })

  it('does not emit untyped Samantha message text before the first spoken 2001', () => {
    const state = createDoubaoStreamTextState()
    expect(extractVisibleTextFromSamanthaEventData({
      message: { content: JSON.stringify({ text: '你是谁' }) },
    }, state)).toEqual([])
    expect(extractVisibleTextFromSamanthaEventData(
      samanthaEvent(2001, { text: '我，由字节跳动基于 Seed 大模型基座独立研发的AI助手。' }),
      state,
    )).toEqual(['我，由字节跳动基于 Seed 大模型基座独立研发的AI助手。'])
  })

  it('does not mash untyped intent chips after the first 2001 into the spoken reply', () => {
    const state = createDoubaoStreamTextState()
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', {
      text: '我是豆包，',
      content_type: 2001,
    }, state)).toEqual(['我是豆包，'])
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', { text: '身份询问：' }, state)).toEqual([])
    expect(extractVisibleTextFromNamedSse('CHUNK_DELTA', { text: '你是谁' }, state)).toEqual([])
    expect(extractVisibleTextFromNamedSse('STREAM_MSG_NOTIFY', {
      content: {
        content_block: [
          { text: '身份询问：你是谁' },
          { content_type: 2001, content: { text_block: { text: '由字节跳动基于 Seed 大模型基座独立研发的AI助手。' } } },
        ],
      },
    }, state)).toEqual(['由字节跳动基于 Seed 大模型基座独立研发的AI助手。'])
  })

  it('coalesces Samantha snapshots instead of concatenating 你+你好', () => {
    const q = '你好，你是谁'
    expect(isDoubaoQuestionEcho('你', q)).toBe(true)
    expect(isDoubaoQuestionEcho('你好', q)).toBe(true)
    expect(isDoubaoQuestionEcho('好，你是谁', q)).toBe(true)
    expect(isDoubaoQuestionEcho('我是豆包', q)).toBe(false)

    const acc = createDoubaoSpokenAccumulator(q)
    expect(takeDoubaoSpokenDelta(acc, '你')).toBe('')
    expect(takeDoubaoSpokenDelta(acc, '你好')).toBe('')
    expect(takeDoubaoSpokenDelta(acc, '我是豆包，')).toBe('我是豆包，')
    expect(takeDoubaoSpokenDelta(acc, '好，你是谁')).toBe('')
    expect(takeDoubaoSpokenDelta(acc, '由字节跳动基于 Seed 大模型基座独立研发的AI助手。')).toBe(
      '由字节跳动基于 Seed 大模型基座独立研发的AI助手。',
    )
    expect(acc.spokenAcc).toBe('我是豆包，由字节跳动基于 Seed 大模型基座独立研发的AI助手。')

    const snap = createDoubaoSpokenAccumulator(q)
    expect(takeDoubaoSpokenDelta(snap, '我')).toBe('我')
    expect(takeDoubaoSpokenDelta(snap, '我是')).toBe('是')
    expect(takeDoubaoSpokenDelta(snap, '我是豆包')).toBe('豆包')
    expect(snap.spokenAcc).toBe('我是豆包')
  })
})
