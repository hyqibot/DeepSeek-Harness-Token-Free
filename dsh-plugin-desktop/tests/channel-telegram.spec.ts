import { describe, expect, it, vi } from 'vitest'
import { createTelegramTransport, splitTelegramText } from '../src/channel-telegram.ts'

describe('telegram transport', () => {
  it('splits long replies on newline boundaries', () => {
    const block = 'x'.repeat(3_000)
    const text = `${block}\n${block}\nshort`
    const chunks = splitTelegramText(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(chunk => chunk.length <= 4000)).toBe(true)
    expect(chunks.join('\n')).toBe(text)
  })

  it('parses text updates and ignores non-text payloads', async () => {
    const request = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/botTOKEN/getUpdates')
      return Response.json({
        ok: true,
        result: [
          { update_id: 8, message: { chat: { id: 1 }, from: { id: 7, first_name: 'Ada' }, text: 'hi' } },
          { update_id: 9, message: { chat: { id: 1 }, from: { id: 7 }, photo: [] } },
        ],
      })
    })
    const transport = createTelegramTransport(request)
    await expect(transport.getUpdates('TOKEN', 0, new AbortController().signal)).resolves.toEqual([
      { updateId: 8, chatId: 1, userId: '7', displayName: 'Ada', text: 'hi' },
    ])
  })
})
