import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error vendored CoPaw gateway ESM has no types
import * as deepseekGuard from '../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-guard.mjs'
// @ts-expect-error vendored CoPaw gateway ESM has no types
import * as deepseekConvStore from '../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-conv-store.mjs'
// @ts-expect-error vendored CoPaw gateway ESM has no types
import * as deepseekWebClient from '../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-web-client.mjs'

const {
  clearDeepSeekCookieBan,
  hydrateDeepSeekCookieBans,
  markDeepSeekCookieBanned,
  assertDeepSeekCookieAllowed,
  withDeepSeekCookieLock,
  isDeepSeekBanOrRiskText,
} = deepseekGuard
const { loadDeepSeekWebState, saveDeepSeekWebState } = deepseekConvStore
const { deepSeekFetch } = deepseekWebClient

const BAN_BODY = '{"code":40301,"msg":"账号已被禁言，违反用户使用规范"}'

afterEach(() => {
  hydrateDeepSeekCookieBans({})
})

describe('DeepSeek conv persist', () => {
  it('round-trips sid, parent, dsml seed, and cookie ban', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ds-conv-'))
    const file = join(dir, 'deepseek_web_state.json')
    saveDeepSeekWebState(
      {
        convs: {
          'ck:txt:abc': { sid: 'sess-1', parentId: 'msg-9', dsmlSeeded: true },
        },
        fullSent: ['ck:txt:abc'],
        banned: { cookiehash: { at: 1, reason: '禁言' } },
      },
      file,
    )
    const loaded = loadDeepSeekWebState(file)
    expect(loaded.convs['ck:txt:abc']).toEqual({
      sid: 'sess-1',
      parentId: 'msg-9',
      dsmlSeeded: true,
    })
    expect(loaded.fullSent).toContain('ck:txt:abc')
    expect(loaded.banned.cookiehash.reason).toBe('禁言')
    expect(readFileSync(file, 'utf8')).toContain('sess-1')
  })

  it('returns empty state when the file is missing', () => {
    const loaded = loadDeepSeekWebState(join(tmpdir(), 'no-such-dsh-ds-state.json'))
    expect(loaded.convs).toEqual({})
    expect(loaded.fullSent).toEqual([])
    expect(loaded.banned).toEqual({})
  })
})

describe('DeepSeek cookie lock and ban fuse', () => {
  it('runs one cookie exclusive so overlapping work is serial', async () => {
    const order: number[] = []
    await Promise.all([
      withDeepSeekCookieLock('ck', async () => {
        order.push(1)
        await new Promise(r => setTimeout(r, 40))
        order.push(2)
      }),
      withDeepSeekCookieLock('ck', async () => {
        order.push(3)
        order.push(4)
      }),
    ])
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('refuses further sends after a cookie is marked banned', () => {
    markDeepSeekCookieBanned('ck-ban', '违反用户使用规范')
    expect(() => assertDeepSeekCookieAllowed('ck-ban')).toThrow(/账号受限或风控/)
    expect(() => assertDeepSeekCookieAllowed('other')).not.toThrow()
    clearDeepSeekCookieBan('ck-ban')
    expect(() => assertDeepSeekCookieAllowed('ck-ban')).not.toThrow()
  })

  it('detects official mute copy as ban/risk text', () => {
    expect(isDeepSeekBanOrRiskText(BAN_BODY)).toBe(true)
    expect(isDeepSeekBanOrRiskText('too many requests')).toBe(false)
  })
})

describe('DeepSeek 429 ban does not retry', () => {
  it('stops after one 429 whose body is a mute, instead of backing off 6 times', async () => {
    let hits = 0
    const server = createServer((_req, res) => {
      hits += 1
      res.statusCode = 429
      res.end(BAN_BODY)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    try {
      await expect(deepSeekFetch(`http://127.0.0.1:${port}/`, {}, { maxAttempts: 6 })).rejects.toThrow(
        /账号受限或风控/,
      )
      expect(hits).toBe(1)
    } finally {
      server.close()
    }
  }, 15_000)
})
