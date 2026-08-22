/** Desktop tools settings section: profile, terminal, updates, marketplace, mode. */

import { useCallback, useEffect, useState } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

interface ProfileRow {
  name: string
  label: string
  selectable: boolean
  current: boolean
}

interface ProfilesStatusPayload {
  current: string
  profiles: ProfileRow[]
}

interface TerminalStatusPayload {
  supported: boolean
}

interface UpdatesStatusPayload {
  currentVersion: string
  checking: boolean
  availableVersion: string | null
  downloadingVersion: string | null
  canDownload: boolean
  isPackaged: boolean
  label: string
  lastResult: 'idle' | 'up-to-date' | 'available' | 'unavailable'
}

interface MarketplacePlugin {
  id: string
  name: string
  spec: string
  description: string
}

interface MarketplaceStatusPayload {
  status: string
  catalog: MarketplacePlugin[]
}

interface ShellStatusPayload {
  mode: 'compatibility' | 'advanced'
  platform: string
  advancedSupported: boolean
}

const ZH = {
  title: '桌面',
  hint: '原先在系统托盘里的功能都在这里。托盘仍可作快捷方式，打开窗口 / 退出仍在托盘。',
  profile: 'Profile',
  terminal: '终端',
  openTerminal: '打开 DSH 终端',
  terminalUnsupported: '当前系统不支持打包终端。',
  updates: '更新',
  checkUpdates: '检查更新',
  download: '下载并安装',
  marketplace: '插件市场',
  refresh: '刷新目录',
  install: '安装',
  mode: '界面模式',
  compatibility: '兼容模式',
  advanced: '高级模式',
  modeHint: '切换模式会重启应用。Linux 仅支持兼容模式。',
}

async function readJson<T>(prefix: string, path: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(`${prefix}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (response.status === 404) return null
  const body = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`)
  }
  return body
}

/** Settings page matching the former native tray tools. */
export function DesktopToolsSection({}: SettingsSectionOwnerProps) {
  const copy = ZH
  const [profiles, setProfiles] = useState<ProfilesStatusPayload | null>(null)
  const [terminal, setTerminal] = useState<TerminalStatusPayload | null>(null)
  const [updates, setUpdates] = useState<UpdatesStatusPayload | null>(null)
  const [marketplace, setMarketplace] = useState<MarketplaceStatusPayload | null>(null)
  const [shell, setShell] = useState<ShellStatusPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [nextProfiles, nextTerminal, nextUpdates, nextMarketplace, nextShell] = await Promise.all([
      readJson<ProfilesStatusPayload>('/api/desktop-profiles', '/status'),
      readJson<TerminalStatusPayload>('/api/desktop-terminal', '/status'),
      readJson<UpdatesStatusPayload>('/api/desktop-updates', '/status'),
      readJson<MarketplaceStatusPayload>('/api/desktop-marketplace', '/status'),
      readJson<ShellStatusPayload>('/api/desktop-shell', '/status'),
    ])
    setProfiles(nextProfiles)
    setTerminal(nextTerminal)
    setUpdates(nextUpdates)
    setMarketplace(nextMarketplace)
    setShell(nextShell)
  }, [])

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    })
  }, [refresh])

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      await work()
      await refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dshDesktopToolsCard">
      <div className="dshDesktopToolsTitle">{copy.title}</div>
      <p className="dshDesktopToolsHint">{copy.hint}</p>

      {profiles && (
        <div className="dshDesktopToolsBlock">
          <div className="dshDesktopToolsTitle">{copy.profile}</div>
          <ul className="dshDesktopToolsList">
            {profiles.profiles.map(profile => (
              <li key={profile.name}>
                <label>
                  <input
                    type="radio"
                    name="dsh-desktop-profile"
                    checked={profile.current}
                    disabled={busy || !profile.selectable}
                    onChange={() => {
                      if (!profile.selectable || profile.current) return
                      void run(async () => {
                        await readJson('/api/desktop-profiles', '/select', {
                          method: 'POST',
                          body: JSON.stringify({ name: profile.name }),
                        })
                      })
                    }}
                  />
                  <span>{profile.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="dshDesktopToolsBlock">
        <div className="dshDesktopToolsTitle">{copy.terminal}</div>
        {terminal?.supported === false || terminal === null ? (
          <p className="dshDesktopToolsHint">{copy.terminalUnsupported}</p>
        ) : (
          <div className="dshDesktopToolsRow">
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              await readJson('/api/desktop-terminal', '/open', { method: 'POST', body: '{}' })
            })}>
              {copy.openTerminal}
            </button>
          </div>
        )}
      </div>

      {updates && (
        <div className="dshDesktopToolsBlock">
          <div className="dshDesktopToolsTitle">{copy.updates}</div>
          <p className="dshDesktopToolsStatus">{updates.label} · {updates.currentVersion}</p>
          <div className="dshDesktopToolsRow">
            <button type="button" disabled={busy || updates.checking} onClick={() => void run(async () => {
              await readJson('/api/desktop-updates', '/check', { method: 'POST', body: '{}' })
            })}>
              {copy.checkUpdates}
            </button>
            {updates.availableVersion && updates.canDownload && (
              <button type="button" disabled={busy || updates.downloadingVersion !== null} onClick={() => void run(async () => {
                await readJson('/api/desktop-updates', '/download', { method: 'POST', body: '{}' })
              })}>
                {copy.download}
              </button>
            )}
          </div>
        </div>
      )}

      {marketplace && (
        <div className="dshDesktopToolsBlock">
          <div className="dshDesktopToolsTitle">{copy.marketplace}</div>
          <p className="dshDesktopToolsStatus">{marketplace.status}</p>
          <div className="dshDesktopToolsRow">
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              await readJson('/api/desktop-marketplace', '/refresh', { method: 'POST', body: '{}' })
            })}>
              {copy.refresh}
            </button>
          </div>
          <ul className="dshDesktopToolsList">
            {marketplace.catalog.map(plugin => (
              <li key={plugin.id} className="dshDesktopToolsPlugin">
                <span>{plugin.name}</span>
                <button type="button" disabled={busy} onClick={() => void run(async () => {
                  await readJson('/api/desktop-marketplace', '/install', {
                    method: 'POST',
                    body: JSON.stringify({ spec: plugin.spec }),
                  })
                })}>
                  {copy.install}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {shell && (
        <div className="dshDesktopToolsBlock">
          <div className="dshDesktopToolsTitle">{copy.mode}</div>
          <p className="dshDesktopToolsHint">{copy.modeHint}</p>
          <div className="dshDesktopToolsRow">
            <button
              type="button"
              disabled={busy || shell.mode === 'compatibility'}
              onClick={() => void run(async () => {
                await readJson('/api/desktop-shell', '/mode', {
                  method: 'POST',
                  body: JSON.stringify({ mode: 'compatibility' }),
                })
              })}
            >
              {copy.compatibility}
            </button>
            <button
              type="button"
              disabled={busy || !shell.advancedSupported || shell.mode === 'advanced'}
              onClick={() => void run(async () => {
                await readJson('/api/desktop-shell', '/mode', {
                  method: 'POST',
                  body: JSON.stringify({ mode: 'advanced' }),
                })
              })}
            >
              {copy.advanced}
            </button>
          </div>
        </div>
      )}

      {notice && <p className="dshDesktopToolsError">{notice}</p>}
    </div>
  )
}
