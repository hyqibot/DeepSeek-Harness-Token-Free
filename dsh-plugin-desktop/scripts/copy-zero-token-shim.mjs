import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'lib'), { recursive: true })
copyFileSync(
  join(root, 'src', 'zero-token-gateway-tls-shim.mjs'),
  join(root, 'lib', 'zero-token-gateway-tls-shim.mjs'),
)
