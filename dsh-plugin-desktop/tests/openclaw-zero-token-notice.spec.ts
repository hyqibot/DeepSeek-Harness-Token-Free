import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OPENCLAW_ZERO_TOKEN_MIT_LICENSE, OPENCLAW_ZERO_TOKEN_SOURCE_URL } from '../src/client/openclaw-zero-token-notice.ts'
import { REQUIRED_UNPACKED_RUNTIME_ENTRIES } from '../scripts/verify-packaged-runtime.ts'

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function readUtf8(...parts: string[]) {
  return readFileSync(join(pluginRoot, ...parts), 'utf8')
}

describe('openclaw-zero-token MIT notice', () => {
  it('keeps Steinberger copyright and MIT full text in vendor LICENSE', () => {
    const license = readUtf8('vendor', 'copaw-zero-token', 'LICENSE-openclaw-zero-token.txt')
    expect(license).toContain('Copyright (c) 2025 Peter Steinberger')
    expect(license).toContain('Permission is hereby granted, free of charge')
    expect(license).toContain('https://github.com/linuxhsj/openclaw-zero-token')
    expect(license).toContain('SHA3_WASM_B64')
  })

  it('embeds the same MIT permission notice in the Zero-Token settings constant', () => {
    expect(OPENCLAW_ZERO_TOKEN_SOURCE_URL).toBe('https://github.com/linuxhsj/openclaw-zero-token')
    expect(OPENCLAW_ZERO_TOKEN_MIT_LICENSE).toContain('Copyright (c) 2025 Peter Steinberger')
    expect(OPENCLAW_ZERO_TOKEN_MIT_LICENSE).toContain('The above copyright notice and this permission notice')
  })

  it('keeps the copyright header on the PoW solver, gateway bundle, and settings card', () => {
    const pow = readUtf8(
      'vendor',
      'copaw-zero-token',
      'python',
      'src',
      'copaw',
      'zero_token',
      'deepseek_pow.js',
    ).slice(0, 1600)
    expect(pow).toContain('Copyright (c) 2025 Peter Steinberger')
    expect(pow).toContain('MIT License')

    const bundle = readUtf8(
      'vendor',
      'copaw-zero-token',
      'gateway-entry',
      'gateway.bundle.mjs',
    ).slice(0, 400)
    expect(bundle).toContain('Copyright (c) 2025 Peter Steinberger')
    expect(bundle).toContain('LICENSE-openclaw-zero-token.txt')

    const section = readUtf8('src', 'client', 'ZeroTokenSection.tsx')
    expect(section).toContain('data-testid="openclaw-zero-token-notice"')
    expect(section).toContain('OPENCLAW_ZERO_TOKEN_MIT_LICENSE')
    expect(section).toContain('OPENCLAW_ZERO_TOKEN_NOTICE_SUMMARY')
    expect(section).not.toContain('OPENCLAW_ZERO_TOKEN_SOURCE_URL')
  })

  it('requires the LICENSE file in packaged app.asar.unpacked', () => {
    expect(REQUIRED_UNPACKED_RUNTIME_ENTRIES).toContain(
      'vendor/copaw-zero-token/LICENSE-openclaw-zero-token.txt',
    )
  })
})
