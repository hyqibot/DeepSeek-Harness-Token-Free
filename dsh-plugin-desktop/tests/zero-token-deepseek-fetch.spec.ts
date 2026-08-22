import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { copawGatewayDir } from '../src/zero-token-copaw.ts'

const CLIENT = 'deepseek-web-client.mjs'

describe('DeepSeek Node fetch dispatcher', () => {
  it('uses the same undici.fetch as the Agent, not Node built-in fetch', () => {
    const source = readFileSync(join(copawGatewayDir(), CLIENT), 'utf8')
    expect(source).toContain('_deepSeekFetch')
    expect(source).toContain('undici.fetch')
    expect(source).toMatch(/r = await _deepSeekFetch\(url, next\)/)
    expect(source).not.toMatch(/r = await fetch\(url, next\)/)
    expect(source).toContain('isDeepSeekBanOrRiskText')
    expect(source).toContain('DEEPSEEK_BAN_ERROR_PREFIX')
  })

  it('Node built-in fetch rejects a npm undici Agent; undici.fetch accepts it', () => {
    const script = `
import { createServer } from 'node:http';

const importUndici = async () => {
  try { return await import('node:undici'); }
  catch { return await import('undici'); }
};

const undici = await importUndici();
const server = createServer((_req, res) => { res.statusCode = 200; res.end('ok'); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = 'http://127.0.0.1:' + port + '/';
const agent = new undici.Agent();
let nativeCode = 'ok';
try {
  await fetch(url, { dispatcher: agent });
} catch (err) {
  nativeCode = err?.cause?.code || err?.code || String(err?.message || err);
}
const matched = await undici.fetch(url, { dispatcher: agent });
console.log(JSON.stringify({
  nativeCode,
  matchedStatus: matched.status,
  hasFetch: typeof undici.fetch === 'function',
}));
await agent.close();
server.close();
`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: copawGatewayDir(),
      encoding: 'utf8',
      env: { ...process.env },
      windowsHide: true,
      timeout: 8_000,
    })
    expect(result.status, result.stderr).toBe(0)
    const payload = JSON.parse((result.stdout ?? '').trim().split('\n').at(-1) ?? '{}') as {
      nativeCode?: string
      matchedStatus?: number
      hasFetch?: boolean
    }
    expect(payload.hasFetch).toBe(true)
    expect(payload.matchedStatus).toBe(200)
    if (payload.nativeCode !== 'ok') {
      expect(payload.nativeCode).toBe('UND_ERR_INVALID_ARG')
    }
  }, 15_000)
})
