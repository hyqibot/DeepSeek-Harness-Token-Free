/** Zero Token settings section: same controls as cc-haha 设置 → 服务商. */

import { useCallback, useEffect, useState } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DINGTALK_LICENSE_LABEL } from './community.ts'
import { DingTalkCommunityLink } from './DingTalkCommunityLink.tsx'
import {
  OPENCLAW_ZERO_TOKEN_MIT_LICENSE,
  OPENCLAW_ZERO_TOKEN_NOTICE_SUMMARY,
  OPENCLAW_ZERO_TOKEN_NOTICE_TITLE,
} from './openclaw-zero-token-notice.ts'

const ZERO_TOKEN_HTTP_PREFIX = '/api/desktop-zero-token'
const GATEWAY_LICENSE_PURCHASE_URL = 'https://hyqibot.com/card-shop.html'
const ZERO_TOKEN_WEB_MODELS: ReadonlyArray<{ id: string; labelZh: string; labelEn: string }> = [
  { id: 'deepseek-chat', labelZh: 'DeepSeek 网页', labelEn: 'DeepSeek Web' },
  { id: 'doubao-web', labelZh: '豆包 网页', labelEn: 'Doubao Web' },
  { id: 'claude-web', labelZh: 'Claude 网页', labelEn: 'Claude Web' },
  { id: 'qwen-web', labelZh: 'Qwen 网页', labelEn: 'Qwen Web' },
  { id: 'qwen-cn-web', labelZh: '通义 网页', labelEn: 'Qianwen Web' },
  { id: 'kimi-web', labelZh: 'Kimi 网页', labelEn: 'Kimi Web' },
  { id: 'chatgpt-web', labelZh: 'ChatGPT 网页', labelEn: 'ChatGPT Web' },
  { id: 'gemini-web', labelZh: 'Gemini 网页', labelEn: 'Gemini Web' },
  { id: 'glm-web', labelZh: 'GLM 网页', labelEn: 'GLM Web' },
  { id: 'glm-intl-web', labelZh: 'GLM 国际版 网页', labelEn: 'GLM International Web' },
]

interface ListenStatus {
  listening: boolean
  pid: number | null
  host: string | null
  port: number | null
  raw: string
}

interface LicenseStatus {
  required: boolean
  verified: boolean
  activationCodeMasked: string | null
  endtime: string | null
  lastError: string | null
}

interface StatusPayload {
  status: ListenStatus
  webModels: Array<{ id: string; onboardMode: string }>
  deepseekToolMode: 'xml' | 'dsml'
  insecureTls: boolean
  license: LicenseStatus
  defaultRoute: boolean
}

type StreamEvent =
  | { type: 'phase'; phase: string }
  | { type: 'line'; text: string }
  | { type: 'complete'; result?: { modelId?: string; onboard?: { mode?: string } } }
  | { type: 'error'; message: string }

const ZH = {
  title: '免token 网关',
  noStatus: '暂无状态。',
  running: '运行中',
  stopped: '已停止',
  startHint: '如果网关状态不是「运行中」，请点击「启动网关」。',
  licenseTitle: '网关激活',
  licenseHint: '同一张激活码同时开通免token 网关与聊天模型 HYQi。HYQi 无需激活即可在模型列表中看到；聊天前请先在本页激活，无需填写其它 Key。',
  licenseVerified: (masked: string, endtime: string) => `已激活 ${masked}，到期：${endtime}`,
  licenseNotVerified: '未激活。免token 网页通道需激活码；选 HYQi 聊天会提示先激活。',
  activate: '激活',
  logout: '退出激活',
  purchase: '点击打赏获取激活码（打赏日卡可用1月，月卡可用1年）',
  community: DINGTALK_LICENSE_LABEL,
  start: '启动网关',
  stop: '停止网关',
  authorize: '一键授权',
  default: '默认',
  setDefault: '设为默认',
  toolMode: 'DeepSeek 工具链',
  xml: 'Doubao XML（默认，<tool_call>，与豆包一致）',
  dsml: 'DSML（DeepSeek 网页原生格式，可能被风控）',
  dsmlHint: 'DSML 使用 DeepSeek 专有工具格式，长 prompt 或频繁工具调用可能触发网页风控；一般建议保持 Doubao XML（默认）。',
  tlsTitle: '在 HTTPS 代理下信任证书（DeepSeek 网页）',
  tlsEnabled: '放宽 chat.deepseek.com 的 TLS 校验',
  tlsHint: '若聊天出现「unknown certificate verification error」或 fetch failed，请勾选本项，然后停止并重新启动免token 网关，再新建会话重试。默认开启。',
  waiting: '正在连接服务端…',
  startBlocked: '请先完成激活后再启动网关',
  restartHint: '方案已变更：请先停止再启动免token 网关，并新建会话后生效。',
}

function isZh(): boolean {
  return typeof navigator === 'undefined' || navigator.language.toLowerCase().startsWith('zh')
}

function modelLabel(id: string): string {
  const row = ZERO_TOKEN_WEB_MODELS.find(item => item.id === id)
  if (row === undefined) return id
  return isZh() ? row.labelZh : row.labelEn
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ZERO_TOKEN_HTTP_PREFIX}${path}`, {
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

/** Settings page matching the cc-haha Zero-Token gateway card. */
export function ZeroTokenSection({}: SettingsSectionOwnerProps) {
  const copy = ZH
  const [payload, setPayload] = useState<StatusPayload | null>(null)
  const [activationCode, setActivationCode] = useState('')
  const [modelId, setModelId] = useState('deepseek-chat')
  const [busy, setBusy] = useState(false)
  const [onboarding, setOnboarding] = useState(false)
  const [log, setLog] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = await readJson<StatusPayload>('/status')
    setPayload(next)
    const ids = next.webModels.map(row => row.id)
    setModelId(current => ids.includes(current) ? current : ids[0] ?? 'deepseek-chat')
    return next
  }, [])

  useEffect(() => {
    void refresh().catch(cause => {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    })
  }, [refresh])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const handleAuthorize = async (): Promise<void> => {
    setOnboarding(true)
    setLog('')
    setNotice(null)
    try {
      const response = await fetch(`${ZERO_TOKEN_HTTP_PREFIX}/authorize`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
        },
        body: JSON.stringify({ modelId }),
      })
      if (!response.ok || response.body === null) {
        const body = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${String(response.status)}`)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.length === 0) continue
          const event = JSON.parse(trimmed) as StreamEvent
          if (event.type === 'line') setLog(prev => `${prev}${event.text}\n`)
          if (event.type === 'phase') setLog(prev => `${prev}\n[${event.phase}]\n`)
          if (event.type === 'complete') setLog(prev => `${prev}授权完成。\n`)
          if (event.type === 'error') throw new Error(event.message)
        }
      }
      await refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOnboarding(false)
    }
  }

  const status = payload?.status
  const license = payload?.license
  const listening = status?.listening === true
  const canStart = license === undefined || !license.required || license.verified
  const rows = payload?.webModels.length ? payload.webModels : ZERO_TOKEN_WEB_MODELS

  return (
    <div className="dshZeroTokenCard">
      <div className="dshZeroTokenHeader">
        <div>
          <div className="dshZeroTokenTitle">{copy.title}</div>
          <div className="dshZeroTokenRaw">{status?.raw || copy.noStatus}</div>
        </div>
        <span className={listening ? 'dshZeroTokenBadge dshZeroTokenBadgeOn' : 'dshZeroTokenBadge'}>
          {listening ? copy.running : copy.stopped}
        </span>
      </div>
      {!listening && <p className="dshZeroTokenHint">{copy.startHint}</p>}
      {payload && (
        <div className="dshZeroTokenLicense">
          <div className="dshZeroTokenLicenseTitle">{copy.licenseTitle}</div>
          <p className="dshZeroTokenHint">{copy.licenseHint}</p>
          {license?.verified ? (
            <p className="dshZeroTokenOk">
              {copy.licenseVerified(license.activationCodeMasked ?? '****', license.endtime ?? '—')}
            </p>
          ) : (
            <p className="dshZeroTokenWarn">{copy.licenseNotVerified}</p>
          )}
          {license?.lastError && <p className="dshZeroTokenError">{license.lastError}</p>}
          <div className="dshZeroTokenRow">
            <input
              type="password"
              value={activationCode}
              autoComplete="off"
              placeholder="•••••••••••••••••••••"
              onChange={event => { setActivationCode(event.target.value) }}
            />
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              await readJson('/activate', {
                method: 'POST',
                body: JSON.stringify({ activationCode }),
              })
            })}>
              {copy.activate}
            </button>
            {license?.verified && (
              <button type="button" disabled={busy} onClick={() => void run(async () => {
                await readJson('/logout', { method: 'POST', body: '{}' })
              })}>
                {copy.logout}
              </button>
            )}
          </div>
          <div className="dshZeroTokenPurchase">
            <DingTalkCommunityLink label={copy.community} />
            <button type="button" className="dshZeroTokenLink" onClick={() => { window.open(GATEWAY_LICENSE_PURCHASE_URL, '_blank') }}>
              {copy.purchase}
            </button>
          </div>
        </div>
      )}
      <div className="dshZeroTokenRow">
        <button
          type="button"
          disabled={busy || !canStart}
          onClick={() => void run(async () => {
            if (!canStart) throw new Error(copy.startBlocked)
            await readJson('/start', { method: 'POST', body: '{}' })
          })}
        >
          {copy.start}
        </button>
        <button type="button" disabled={busy} onClick={() => void run(async () => {
          await readJson('/stop', { method: 'POST', body: '{}' })
        })}>
          {copy.stop}
        </button>
        <select value={modelId} onChange={event => { setModelId(event.target.value) }}>
          {rows.map(row => (
            <option key={row.id} value={row.id}>{modelLabel(row.id)}</option>
          ))}
        </select>
        <button type="button" disabled={onboarding} onClick={() => void handleAuthorize()}>
          {copy.authorize}
        </button>
        {payload?.defaultRoute ? (
          <span className="dshZeroTokenBadge dshZeroTokenBadgeDefault">{copy.default}</span>
        ) : (
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            await readJson('/set-default', { method: 'POST', body: '{}' })
          })}>
            {copy.setDefault}
          </button>
        )}
      </div>
      <div className="dshZeroTokenRow">
        <span className="dshZeroTokenHint">{copy.toolMode}</span>
        <select
          value={payload?.deepseekToolMode ?? 'xml'}
          disabled={busy}
          onChange={event => {
            const mode = event.target.value === 'dsml' ? 'dsml' : 'xml'
            void run(async () => {
              const result = await readJson<{ restartRequired: boolean }>('/deepseek-tool-mode', {
                method: 'POST',
                body: JSON.stringify({ mode }),
              })
              if (result.restartRequired) setNotice(copy.restartHint)
            })
          }}
        >
          <option value="xml">{copy.xml}</option>
          <option value="dsml">{copy.dsml}</option>
        </select>
      </div>
      {payload?.deepseekToolMode === 'dsml' && <p className="dshZeroTokenWarn">{copy.dsmlHint}</p>}
      <label className="dshZeroTokenCheck">
        <input
          type="checkbox"
          aria-label={copy.tlsEnabled}
          checked={payload?.insecureTls !== false}
          disabled={busy || payload === null}
          onChange={event => {
            const enabled = event.target.checked
            void run(async () => {
              const result = await readJson<{ restartRequired: boolean }>('/insecure-tls', {
                method: 'POST',
                body: JSON.stringify({ insecureTls: enabled }),
              })
              if (result.restartRequired) setNotice(copy.restartHint)
            })
          }}
        />
        <span>
          <span className="dshZeroTokenCheckTitle">{copy.tlsTitle}</span>
          <p className="dshZeroTokenHint">{copy.tlsHint}</p>
        </span>
      </label>
      {(onboarding || log.length > 0) && (
        <pre className="dshZeroTokenLog">{log.trim() || copy.waiting}</pre>
      )}
      {notice && <p className="dshZeroTokenError">{notice}</p>}
      <div data-testid="openclaw-zero-token-notice" className="dshZeroTokenLicense">
        <div className="dshZeroTokenLicenseTitle">{OPENCLAW_ZERO_TOKEN_NOTICE_TITLE}</div>
        <p className="dshZeroTokenHint">{OPENCLAW_ZERO_TOKEN_NOTICE_SUMMARY}</p>
        <details>
          <summary className="dshZeroTokenHint">MIT License (full text)</summary>
          <pre className="dshZeroTokenLog">{OPENCLAW_ZERO_TOKEN_MIT_LICENSE}</pre>
        </details>
      </div>
    </div>
  )
}
