import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyPublicReadmeOverlay } from './public-readme-overlay.ts'

describe('public readme overlay', () => {
  test('adds free-token installer banner and run-from-source section', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-public-readme-'))
    await writeFile(
      join(dir, 'README.md'),
      `<p align="center">preview</p>

## 主要功能

桌面端。

## License

MIT
`,
      'utf8',
    )
    await writeFile(
      join(dir, 'README.en.md'),
      `<p align="center">preview</p>

## Features

Desktop.

## License

MIT
`,
      'utf8',
    )
    await mkdir(join(dir, 'dsh-plugin-desktop/docs'), { recursive: true })
    await writeFile(
      join(dir, 'dsh-plugin-desktop/docs/channels.md'),
      `- **CoPaw** (\`upstream: copaw\`, or empty \`apiKey\` with a non-Chrome upstream): activate once, spawn vendored \`server.mjs\` + Playwright, poll \`/v1/session\` while it runs. **一键授权** first starts Chromium on \`--remote-debugging-port=9222\` (webauth-ts \`ensure\`), then runs Node \`node-runner.bundle.mjs onboard\`.

CoPaw web login uses cc-haha's webauth-ts Node runner (\`node-runner.bundle.mjs\`). The Node sidecar installs \`playwright-core\` on first start.
`,
      'utf8',
    )
    await writeFile(
      join(dir, 'dsh-plugin-desktop/docs/channels.zh.md'),
      `- **CoPaw**（\`upstream: copaw\`，或空 key 且不是 Chrome）：先激活，再拉起 vendored 的 \`server.mjs\` + Playwright，运行期间轮询 \`/v1/session\`。**一键授权**会先用 webauth-ts \`ensure\` 拉起 \`--remote-debugging-port=9222\` 的 Chromium，再执行 Node \`node-runner.bundle.mjs onboard\`。

CoPaw 网页登录走 cc-haha 的 webauth-ts Node runner（\`node-runner.bundle.mjs\`）。Node sidecar 首次启动会自动 \`npm install playwright-core\`。
`,
      'utf8',
    )

    await applyPublicReadmeOverlay(dir)
    const zh = await readFile(join(dir, 'README.md'), 'utf8')
    const en = await readFile(join(dir, 'README.en.md'), 'utf8')
    const channelsZh = await readFile(join(dir, 'dsh-plugin-desktop/docs/channels.zh.md'), 'utf8')
    const channelsEn = await readFile(join(dir, 'dsh-plugin-desktop/docs/channels.md'), 'utf8')

    expect(zh).toContain('公开仓说明')
    expect(zh).toContain('必须安装 Releases 里的桌面版')
    expect(zh).toContain('## 从源码运行')
    expect(zh).toContain('DeepSeek-Harness-Token-Free/releases')
    expect(en).toContain('Public repository notice')
    expect(en).toContain('## Run from source')
    expect(channelsZh).not.toContain('pip install -r vendor/copaw-zero-token')
    expect(channelsEn).not.toContain('pip install -r vendor/copaw-zero-token')
    expect(channelsZh).toContain('必须安装')
    await rm(dir, { recursive: true, force: true })
  })
})
