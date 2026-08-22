/** Curated DSH plugin catalog installed through `desktopPnpm.runPlugin`. */

/** One installable catalog entry. */
export interface MarketplacePlugin {
  readonly id: string
  readonly name: string
  readonly spec: string
  readonly description: string
  readonly homepage: string
}

/** Bundled catalog used when no remote index is configured. */
export const BUNDLED_MARKETPLACE_CATALOG: readonly MarketplacePlugin[] = [
  {
    id: 'dsh-web-ui',
    name: 'dsh-web-ui',
    spec: 'dsh-web-ui',
    description: 'DeepSeek Harness Web UI plugins and skins.',
    homepage: 'https://github.com/zhu1090093659/dsh-web-ui',
  },
  {
    id: 'dsh-tui',
    name: 'dsh-TUI',
    spec: 'dsh-tui',
    description: 'Full-screen interactive terminal UI for DeepSeek Harness.',
    homepage: 'https://github.com/ccch1mneyyy/dsh-TUI',
  },
  {
    id: 'dsh-better-sidebar',
    name: 'DSH-better-sidebar',
    spec: 'dsh-better-sidebar',
    description: 'Sidebar workbench with files, terminal, Git, and subagents.',
    homepage: 'https://github.com/omdsh-dev/DSH-better-sidebar',
  },
]

/**
 * Parse a remote or bundled catalog document.
 * @param value - parsed JSON.
 */
export function parseMarketplaceCatalog(value: unknown): readonly MarketplacePlugin[] {
  const list = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).plugins)
      ? (value as { plugins: unknown[] }).plugins
      : null
  if (list === null) throw new Error('marketplace catalog must be an array or { plugins: [] }')
  return list.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`marketplace catalog[${String(index)}] must be an object`)
    }
    const record = entry as Record<string, unknown>
    for (const key of ['id', 'name', 'spec', 'description', 'homepage'] as const) {
      if (typeof record[key] !== 'string' || record[key].length === 0) {
        throw new Error(`marketplace catalog[${String(index)}].${key} must be a non-empty string`)
      }
    }
    return {
      id: record.id as string,
      name: record.name as string,
      spec: record.spec as string,
      description: record.description as string,
      homepage: record.homepage as string,
    }
  })
}

/**
 * Reject specs that cannot be forwarded to `dsh plugin add`.
 * @param spec - npm package name, versioned name, or file/link URL.
 */
export function assertMarketplaceSpec(spec: string): string {
  const trimmed = spec.trim()
  if (trimmed.length === 0 || trimmed.includes('\0') || /\s/u.test(trimmed)) {
    throw new Error('marketplace spec must be a non-empty pnpm-compatible package name')
  }
  if (trimmed === 'dshmarket' || trimmed.startsWith('dshmarket@')) {
    throw new Error('dshmarket is not redistributed by DSH Desktop; install plugins through desktopPnpm instead')
  }
  return trimmed
}
