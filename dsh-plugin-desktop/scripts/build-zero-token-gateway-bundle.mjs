import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entry = path.join(
  pluginRoot,
  'vendor',
  'copaw-zero-token',
  'python',
  'src',
  'copaw',
  'zero_token_gateway',
  'server.mjs',
)
const outDir = path.join(pluginRoot, 'vendor', 'copaw-zero-token', 'gateway-entry')
const outfile = path.join(outDir, 'gateway.bundle.mjs')

/** Build gateway bundle via Bun.build API (avoids subprocess bun build reloading bunfig preload). */
export async function buildZeroTokenGatewayBundle() {
  await mkdir(outDir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    format: 'esm',
    external: ['playwright-core'],
    minify: true,
  })

  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join('\n')
    throw new Error(`[build-zero-token-gateway-bundle] failed:\n${logs}`)
  }

  const artifact = result.outputs[0]
  if (!artifact) {
    throw new Error('[build-zero-token-gateway-bundle] no output artifact')
  }

  const banner = `/**
 * Copyright (c) 2025 Peter Steinberger
 * Substantial portion of the DeepSeek PoW solver from openclaw-zero-token.
 * MIT License. See LICENSE-openclaw-zero-token.txt beside this file.
 */
`
  await Bun.write(outfile, banner + await artifact.text())
  console.log(`[build-zero-token-gateway-bundle] -> ${outfile}`)
}

if (import.meta.main) {
  await buildZeroTokenGatewayBundle()
}