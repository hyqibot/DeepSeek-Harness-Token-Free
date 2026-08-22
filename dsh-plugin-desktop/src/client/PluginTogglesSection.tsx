/** Settings page listing Loader rows with enable/disable switches. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

interface PluginToggleRow {
  entryId: string
  moduleName: string
  title: string
  enabled: boolean
  locked: boolean
  lockReason: string | null
}

interface PluginTogglesSnapshot {
  entries: PluginToggleRow[]
  restartRequired?: boolean
}

const ZH = {
  title: '插件开关',
  hint: '更改插件开关会先写入当前 profile 的 cordis.patch.yml，然后弹出重启窗口；确认后才会重启生效。窗口和设置依赖的插件不能关。',
  search: '搜索插件',
  empty: '没有可列出的插件。',
  emptySearch: '没有匹配的插件。',
  on: '开',
  saved: '已保存。请在弹出的窗口中选择是否立即重启。',
  restarting: '正在重启…',
  restartTitle: '需要重启',
  restartBody: '插件开关已保存，重启后才会生效。',
  restartNow: '立即重启',
  restartLater: '稍后',
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/desktop-plugin-toggles${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`)
  }
  return body
}

function matches(row: PluginToggleRow, query: string): boolean {
  if (query.length === 0) return true
  return [row.title, row.entryId, row.moduleName]
    .some(value => value.toLocaleLowerCase().includes(query))
}

/** Settings page matching the Host plugin-toggle loopback API. */
export function PluginTogglesSection({}: SettingsSectionOwnerProps) {
  const copy = ZH
  const [snapshot, setSnapshot] = useState<PluginTogglesSnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [restartOpen, setRestartOpen] = useState(false)

  const refresh = useCallback(async () => {
    setSnapshot(await readJson<PluginTogglesSnapshot>('/status'))
  }, [])

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    })
  }, [refresh])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return snapshot?.entries.filter(row => matches(row, normalized)) ?? []
  }, [query, snapshot])

  const toggle = async (row: PluginToggleRow, enabled: boolean): Promise<void> => {
    if (row.locked || busy) return
    setBusy(true)
    setNotice(null)
    setOk(null)
    try {
      const next = await readJson<PluginTogglesSnapshot>('/enabled', {
        method: 'POST',
        body: JSON.stringify({ entryId: row.entryId, enabled }),
      })
      setSnapshot(next)
      if (next.restartRequired === true) {
        setOk(copy.saved)
        setRestartOpen(true)
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const restartNow = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      await readJson<{ ok: boolean }>('/restart', { method: 'POST', body: '{}' })
      setOk(copy.restarting)
      setRestartOpen(false)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dshPluginTogglesCard">
      <div className="dshPluginTogglesTitle">{copy.title}</div>
      <p className="dshPluginTogglesHint">{copy.hint}</p>
      <input
        className="dshPluginTogglesSearch"
        type="search"
        value={query}
        placeholder={copy.search}
        aria-label={copy.search}
        onChange={event => { setQuery(event.currentTarget.value) }}
      />
      {snapshot && snapshot.entries.length === 0 ? <p className="dshPluginTogglesHint">{copy.empty}</p> : null}
      {snapshot && snapshot.entries.length > 0 && filtered.length === 0
        ? <p className="dshPluginTogglesHint">{copy.emptySearch}</p>
        : null}
      {filtered.length > 0 ? (
        <ul className="dshPluginTogglesList">
          {filtered.map(row => (
            <li key={row.entryId} className="dshPluginTogglesRow" data-plugin-entry={row.entryId}>
              <div className="dshPluginTogglesMeta">
                <span className="dshPluginTogglesName" title={row.moduleName}>{row.title}</span>
                <span className="dshPluginTogglesId">{row.entryId}</span>
                {row.locked && row.lockReason
                  ? <p className="dshPluginTogglesLock">{row.lockReason}</p>
                  : null}
              </div>
              <label className="dshPluginTogglesSwitch" data-locked={row.locked ? 'true' : 'false'}>
                <input
                  type="checkbox"
                  checked={row.enabled}
                  disabled={busy || row.locked}
                  onChange={event => { void toggle(row, event.currentTarget.checked) }}
                />
                {copy.on}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {ok && <p className="dshPluginTogglesOk">{ok}</p>}
      {notice && <p className="dshPluginTogglesError">{notice}</p>}
      {restartOpen ? (
        <div className="dshPluginTogglesBackdrop">
          <div
            className="dshPluginTogglesDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dsh-plugin-toggle-restart-title"
          >
            <div id="dsh-plugin-toggle-restart-title" className="dshPluginTogglesTitle">{copy.restartTitle}</div>
            <p className="dshPluginTogglesHint">{copy.restartBody}</p>
            <div className="dshPluginTogglesDialogActions">
              <button type="button" disabled={busy} onClick={() => { setRestartOpen(false) }}>
                {copy.restartLater}
              </button>
              <button type="button" disabled={busy} onClick={() => { void restartNow() }}>
                {copy.restartNow}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
