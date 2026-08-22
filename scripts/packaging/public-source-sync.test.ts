import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const packagingDir = join(import.meta.dir)
const repoRoot = join(packagingDir, '../..')

describe('public source sync', () => {
  test('excludes license-server, vendor gateway tree, workflows, and harness working tree', () => {
    const cfg = JSON.parse(
      readFileSync(join(packagingDir, 'public-source-excludes.json'), 'utf8'),
    ) as { excludeDirectories: string[]; excludeFiles: string[]; excludeDocPaths: string[] }

    expect(cfg.excludeDirectories).toContain('.github/workflows')
    expect(cfg.excludeDirectories).toContain('dsh-plugin-desktop/vendor/copaw-zero-token')
    expect(cfg.excludeDirectories).toContain('vendor/copaw-zero-token')
    expect(cfg.excludeDirectories).toContain('deepseek-harness')
    expect(cfg.excludeDirectories).toContain('license-server')
    expect(cfg.excludeFiles).toContain('.github/workflows/sync-public-source.yml')
    expect(cfg.excludeFiles).toContain('.github/workflows/release-desktop.yml')
    expect(cfg.excludeFiles).toContain('.github/workflows/ci.yml.disabled')
    expect(cfg.excludeFiles).toContain('scripts/run-license-server.ts')
    expect(cfg.excludeFiles).toContain('scripts/packaging/user-distribution-policy.json')
    expect(cfg.excludeFiles).toContain('tmp-auth.json')
    expect(cfg.excludeDocPaths).toContain('docs/reference/public-repo-sync-bootstrap.md')
    expect(cfg.excludeDocPaths).toContain('docs/reference/desktop-release-and-updater.md')
  })

  test('docs publish policy lists developer reference docs as excluded', () => {
    const policy = JSON.parse(
      readFileSync(join(packagingDir, 'docs-publish-policy.json'), 'utf8'),
    ) as { developerReferenceDocs: string[]; userReferenceDocs: string[] }
    const cfg = JSON.parse(
      readFileSync(join(packagingDir, 'public-source-excludes.json'), 'utf8'),
    ) as { excludeDocPaths: string[] }

    expect(policy.userReferenceDocs).toEqual([])
    expect([...policy.developerReferenceDocs].sort()).toEqual([...cfg.excludeDocPaths].sort())
  })

  test('sync workflow targets public releases repo via script', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/sync-public-source.yml'), 'utf8')
    expect(workflow).toContain('sync-public-source.ts')
    expect(workflow).toContain('PUBLIC_SOURCE_SYNC_TOKEN')
    expect(workflow).toContain("tags: ['v*.*.*']")
    expect(workflow).toContain('branches: [master]')
    expect(workflow).toContain('scripts/packaging/bunfig.toml')
    expect(workflow).not.toContain('branches: [main]')
  })

  test('github-repos.json defines public releases target', () => {
    const repos = JSON.parse(readFileSync(join(repoRoot, 'github-repos.json'), 'utf8')) as {
      source: { owner: string; repo: string }
      releases: { owner: string; repo: string; updaterLatestJson: string }
    }
    expect(repos.source.owner).toBe('hyqibot')
    expect(repos.source.repo).toBe('deepseek-harness-private')
    expect(repos.releases.owner).toBe('hyqibot')
    expect(repos.releases.repo).toBe('DeepSeek-Harness-Token-Free')
    expect(repos.releases.updaterLatestJson).toBe(
      'https://github.com/hyqibot/DeepSeek-Harness-Token-Free/releases/latest/download/latest.json',
    )
  })

  test('desktop updater and release workflow target the same public latest.json', () => {
    const repos = JSON.parse(readFileSync(join(repoRoot, 'github-repos.json'), 'utf8')) as {
      releases: { updaterLatestJson: string }
    }
    const checker = readFileSync(join(repoRoot, 'dsh-plugin-desktop/src/update-checker.ts'), 'utf8')
    const downloader = readFileSync(join(repoRoot, 'dsh-plugin-desktop/src/update-download.ts'), 'utf8')
    const workflow = readFileSync(join(repoRoot, '.github/workflows/release-desktop.yml'), 'utf8')

    expect(repos.releases.updaterLatestJson).toContain('/releases/latest/download/latest.json')
    expect(checker).toContain("PUBLIC_RELEASES_REPO = 'hyqibot/DeepSeek-Harness-Token-Free'")
    expect(checker).toContain('/releases/latest/download/latest.json')
    expect(checker).toContain("redirect: 'follow'")
    expect(checker).not.toContain('dshdesktop.cn')
    expect(downloader).toContain('/releases/download/v${version}')
    expect(downloader).not.toContain('dshdesktop.cn')
    expect(workflow).toContain('PUBLIC_RELEASE_REPO: DeepSeek-Harness-Token-Free')
    expect(workflow).toContain('dist:win')
    expect(workflow).toContain('dist:mac:ci')
    expect(workflow).not.toContain('yarn dist:mac\n')
    expect(workflow).toContain('publish-latest-json')
    expect(workflow).toContain('needs: [ensure-public-release-tag, build]')
    expect(workflow).not.toContain('dshdesktop.cn')
  })

  test('public vendor dir keeps MIT license plus placeholder readme', () => {
    const vendorReadme = readFileSync(join(packagingDir, 'public-source-vendor-readme.md'), 'utf8')
    const script = readFileSync(join(packagingDir, 'sync-public-source.ts'), 'utf8')
    expect(vendorReadme).toContain('不包含')
    expect(vendorReadme).toContain('Releases')
    expect(vendorReadme).toContain('DeepSeek-Harness-Token-Free')
    expect(vendorReadme).toContain('LICENSE-openclaw-zero-token.txt')
    expect(script).toContain("PUBLIC_VENDOR_LICENSE = 'LICENSE-openclaw-zero-token.txt'")
    expect(script).toContain('await cp(licenseSrc, join(vendorDir, PUBLIC_VENDOR_LICENSE))')
  })

  test('sync script fetches remote main before force-with-lease push and pins submodule gitlink', () => {
    const script = readFileSync(join(packagingDir, 'sync-public-source.ts'), 'utf8')
    expect(script).toContain("['fetch', 'origin', 'main'")
    expect(script).toContain('--force-with-lease')
    expect(script).toContain('160000,')
    expect(script).toContain('dsh-plugin-desktop/vendor/copaw-zero-token')
    expect(script).toContain('hyqibot/deepseek-harness-private')
  })
})
