import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PUBLIC_REPO = 'hyqibot/DeepSeek-Harness-Token-Free'
const RELEASES_URL = `https://github.com/${PUBLIC_REPO}/releases`

const ZH_BANNER = `> **公开仓说明**：桌面安装包与更新见 [Releases](${RELEASES_URL})。**要使用免 Token（Zero-Token）功能，必须安装 Releases 里的桌面版**（内含预编译网关）；公开源码无法自行构建完整 Zero-Token 网关。

`

const EN_BANNER = `> **Public repository notice**: Download desktop builds from [Releases](${RELEASES_URL}). **Zero-Token (free-token) mode requires the Release installer** — it ships the private gateway; you cannot build the full Zero-Token stack from this public source tree.

`

function buildZhRunFromSource(): string {
  return `## 从源码运行

公开仓可用于本地体验 **桌面端**（\`yarn dev\`）与 **官方 / API Key 模型**。

> **限制**：本仓库不含 Zero-Token 网关完整源码与预编译 sidecar，**无法**通过源码本地使用网页免 Token；请安装 [Releases](${RELEASES_URL}) 桌面版。

**环境要求**

- Node.js 22.19+ 或 24+（含 Corepack）
- [Git](https://git-scm.com/download/win)（Windows 必装）

**1. 克隆与安装**

\`\`\`bash
git clone --recurse-submodules https://github.com/${PUBLIC_REPO}.git
cd DeepSeek-Harness-Token-Free
corepack enable
yarn install
\`\`\`

**2. 启动桌面端**

\`\`\`bash
yarn dev
\`\`\`

在设置中配置官方 API Key 后即可聊天。网页 Zero-Token（无官方 Key）**仅 Releases 安装包可用**。

**说明**

- 公开仓 **不含** \`dsh-plugin-desktop/vendor/copaw-zero-token/python/\`，本地 \`yarn dist:win\` / \`yarn dist:mac\` **不能**产出含完整 Zero-Token 网关的安装包。
`
}

function buildEnRunFromSource(): string {
  return `## Run from source

This public tree can run the **desktop app** (\`yarn dev\`) with **official / API-key models**.

> **Limit**: The Zero-Token gateway sources and sidecars are **not** in this repository. Use the [Release installer](${RELEASES_URL}) for free-token web mode.

**Requirements**

- Node.js 22.19+ or 24+ (with Corepack)
- [Git](https://git-scm.com)

**1. Clone and install**

\`\`\`bash
git clone --recurse-submodules https://github.com/${PUBLIC_REPO}.git
cd DeepSeek-Harness-Token-Free
corepack enable
yarn install
\`\`\`

**2. Start the desktop app**

\`\`\`bash
yarn dev
\`\`\`

Configure an official API key in Settings. Web Zero-Token **only works in the Release installer**.

**Notes**

- This tree does **not** include \`dsh-plugin-desktop/vendor/copaw-zero-token/python/\`. Local \`yarn dist:win\` / \`yarn dist:mac\` will **not** produce a Zero-Token installer.
`
}

function upsertBanner(md: string, marker: string, banner: string, beforeHeading: string): string {
  if (md.includes(marker)) {
    return md.replace(new RegExp(`> \\*\\*${escapeRegExp(marker)}\\*\\*[\\s\\S]*?\\n\\n`), banner)
  }
  const heading = `## ${beforeHeading}`
  const idx = md.indexOf(heading)
  if (idx === -1) return `${banner}${md}`
  return `${md.slice(0, idx)}${banner}${md.slice(idx)}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function upsertSection(md: string, heading: string, body: string): string {
  const re = new RegExp(`## ${escapeRegExp(heading)}[\\s\\S]*?(?=\\n## )`)
  if (re.test(md)) return md.replace(re, `${body}\n`)
  if (md.includes('## License')) {
    return md.replace('## License', `${body}\n## License`)
  }
  return `${md.trimEnd()}\n\n${body}`
}

async function patchZhReadme(readmePath: string): Promise<void> {
  let md = await readFile(readmePath, 'utf8')
  md = upsertBanner(md, '公开仓说明', ZH_BANNER, '主要功能')
  md = upsertSection(md, '从源码运行', buildZhRunFromSource())
  await writeFile(readmePath, md, 'utf8')
}

async function patchEnReadme(enPath: string): Promise<void> {
  let md = await readFile(enPath, 'utf8')
  md = upsertBanner(md, 'Public repository notice', EN_BANNER, 'Features')
  md = upsertSection(md, 'Run from source', buildEnRunFromSource())
  await writeFile(enPath, md, 'utf8')
}

async function patchChannelDocs(exportRoot: string): Promise<void> {
  const zh = join(exportRoot, 'dsh-plugin-desktop/docs/channels.zh.md')
  const en = join(exportRoot, 'dsh-plugin-desktop/docs/channels.md')
  if (existsSync(zh)) {
    let md = await readFile(zh, 'utf8')
    md = md.replace(
      /CoPaw 网页登录走 cc-haha 的 webauth-ts Node runner（`node-runner\.bundle\.mjs`）。Node sidecar 首次启动会自动 `npm install playwright-core`。/,
      `公开仓不含 Zero-Token 网关源码。网页免 Token **必须安装 [Releases](${RELEASES_URL}) 桌面版**；官方 API Key 路径不需要激活码。`,
    )
    md = md.replace(
      /先激活，再拉起 vendored 的 `server\.mjs` \+ Playwright，运行期间轮询 `\/v1\/session`。\*\*一键授权\*\*会先用 webauth-ts `ensure` 拉起 `--remote-debugging-port=9222` 的 Chromium，再执行 Node `node-runner\.bundle\.mjs onboard`。/,
      `网页免 Token 仅 Releases 安装包可用；公开 clone 无法拉起 CoPaw sidecar。`,
    )
    await writeFile(zh, md, 'utf8')
  }
  if (existsSync(en)) {
    let md = await readFile(en, 'utf8')
    md = md.replace(
      /CoPaw web login uses cc-haha's webauth-ts Node runner \(`node-runner\.bundle\.mjs`\)\. The Node sidecar installs `playwright-core` on first start\./,
      `The public tree does not ship the Zero-Token gateway. Web free-token mode **requires the [Release installer](${RELEASES_URL})**. Official API keys do not need an activation code.`,
    )
    md = md.replace(
      /activate once, spawn vendored `server\.mjs` \+ Playwright, poll `\/v1\/session` while it runs\. \*\*一键授权\*\* first starts Chromium on `--remote-debugging-port=9222` \(webauth-ts `ensure`\), then runs Node `node-runner\.bundle\.mjs onboard`\./,
      `web free-token is installer-only; a public clone cannot spawn the CoPaw sidecar.`,
    )
    await writeFile(en, md, 'utf8')
  }
}

/** 同步到公开仓前，对 README / 频道文档做公开向覆盖（私有仓原文不改）。 */
export async function applyPublicReadmeOverlay(exportRoot: string): Promise<void> {
  await patchZhReadme(join(exportRoot, 'README.md'))
  const enPath = join(exportRoot, 'README.en.md')
  if (existsSync(enPath)) await patchEnReadme(enPath)
  await patchChannelDocs(exportRoot)
}
