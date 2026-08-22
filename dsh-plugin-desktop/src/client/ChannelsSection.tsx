/** Channels settings section: pairing, WeChat QR on the page, and LAN mobile URL. */

import { useCallback, useEffect, useState } from 'react'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

const CHANNELS_HTTP_PREFIX = '/api/desktop-channels'
const MOBILE_HTTP_PREFIX = '/api/desktop-mobile'

interface WechatQrState {
  phase: 'idle' | 'starting' | 'waiting' | 'bound' | 'expired' | 'failed'
  qrDataUrl: string | null
  hint: string
}

interface ChannelStatusPayload {
  telegram: string
  discord: string
  feishu: string
  wechat: string
  wechatBound: boolean
  pairing: { code: string; expiresAt: number } | null
  wechatQr: WechatQrState
  credentials: {
    telegramConfigured: boolean
    discordConfigured: boolean
    feishuConfigured: boolean
    wechatConfigured: boolean
  }
}

interface MobileStatusPayload {
  enabled: boolean
  status: string
  url: string | null
  qrDataUrl: string | null
  port: number | null
}

const ZH = {
  title: '远程控制',
  hint: '配对后，可在微信、飞书、Telegram、Discord 或局域网手机页面向本机 Agent 发指令。钉钉群只是社区群，不是遥控通道。',
  pairing: '配对码',
  pairingHint: '在对应 App 里发送这 6 位码完成绑定，一小时内有效，一次性使用。',
  generate: '生成配对码',
  none: '尚未生成',
  wechat: '绑定微信',
  wechatHint: '点击后在本页显示二维码，用微信扫码即可，不必复制链接到浏览器。',
  wechatBind: '生成微信绑定二维码',
  wechatUnbind: '解除微信绑定',
  wechatBound: '微信已绑定',
  scan: '请用微信扫描二维码',
  mobile: '局域网手机',
  mobileHint: '用手机扫描下方二维码，或在同一 Wi-Fi 打开链接，再发送配对码。',
  mobileOn: '启用局域网监听',
  showMobile: '显示手机地址和配对码',
  copy: '复制链接',
  copied: '已复制',
  status: '通道状态',
  telegram: 'Telegram Bot Token',
  discord: 'Discord Bot Token',
  feishuId: '飞书 App ID',
  feishuSecret: '飞书 App Secret',
  wechatToken: '微信 Bot Token（可选）',
  save: '保存凭据',
}

async function readJson<T>(prefix: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${prefix}${path}`, {
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

/** Settings page that owns pairing, in-page WeChat QR, and the LAN phone URL. */
export function ChannelsSection({}: SettingsSectionOwnerProps) {
  const copy = ZH
  const [payload, setPayload] = useState<ChannelStatusPayload | null>(null)
  const [mobile, setMobile] = useState<MobileStatusPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [discordBotToken, setDiscordBotToken] = useState('')
  const [feishuAppId, setFeishuAppId] = useState('')
  const [feishuAppSecret, setFeishuAppSecret] = useState('')
  const [wechatBotToken, setWechatBotToken] = useState('')

  const refresh = useCallback(async () => {
    const [next, nextMobile] = await Promise.all([
      readJson<ChannelStatusPayload>(CHANNELS_HTTP_PREFIX, '/status'),
      readJson<MobileStatusPayload>(MOBILE_HTTP_PREFIX, '/status').catch(() => null),
    ])
    setPayload(next)
    setMobile(nextMobile)
  }, [])

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    })
  }, [refresh])

  useEffect(() => {
    const phase = payload?.wechatQr.phase
    if (phase !== 'starting' && phase !== 'waiting') return
    const timer = window.setInterval(() => { void refresh().catch(() => {}) }, 2000)
    return () => { window.clearInterval(timer) }
  }, [payload?.wechatQr.phase, refresh])

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

  const qr = payload?.wechatQr
  const pairing = payload?.pairing

  return (
    <div className="dshChannelsCard">
      <div className="dshChannelsTitle">{copy.title}</div>
      <p className="dshChannelsHint">{copy.hint}</p>

      <div className="dshChannelsBlock">
        <div className="dshChannelsTitle">{copy.pairing}</div>
        <p className="dshChannelsHint">{copy.pairingHint}</p>
        <div className="dshChannelsCode">{pairing?.code ?? copy.none}</div>
        <div className="dshChannelsRow">
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            await readJson(CHANNELS_HTTP_PREFIX, '/pairing', { method: 'POST', body: '{}' })
          })}>
            {copy.generate}
          </button>
        </div>
      </div>

      <div className="dshChannelsBlock">
        <div className="dshChannelsTitle">{copy.wechat}</div>
        <p className="dshChannelsHint">{copy.wechatHint}</p>
        {payload?.wechatBound && <p className="dshChannelsOk">{copy.wechatBound}</p>}
        <p className="dshChannelsStatus">{payload?.wechat ?? ''}</p>
        {qr?.qrDataUrl && (
          <img className="dshChannelsQr" alt={copy.scan} src={qr.qrDataUrl} />
        )}
        {qr?.hint && qr.phase !== 'idle' && (
          <p className={qr.phase === 'failed' || qr.phase === 'expired' ? 'dshChannelsWarn' : 'dshChannelsHint'}>
            {qr.phase === 'waiting' ? copy.scan : qr.hint}
          </p>
        )}
        <div className="dshChannelsRow">
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            await readJson(CHANNELS_HTTP_PREFIX, '/wechat-qr', { method: 'POST', body: '{}' })
          })}>
            {copy.wechatBind}
          </button>
          {payload?.wechatBound && (
            <button type="button" disabled={busy} onClick={() => void run(async () => {
              await readJson(CHANNELS_HTTP_PREFIX, '/wechat-unbind', { method: 'POST', body: '{}' })
            })}>
              {copy.wechatUnbind}
            </button>
          )}
        </div>
      </div>

      <div className="dshChannelsBlock">
        <div className="dshChannelsTitle">{copy.mobile}</div>
        <p className="dshChannelsHint">{copy.mobileHint}</p>
        <p className="dshChannelsStatus">{mobile?.status ?? ''}</p>
        <label className="dshChannelsCheck">
          <input
            type="checkbox"
            checked={mobile?.enabled !== false}
            disabled={busy || mobile === null}
            onChange={event => {
              const enabled = event.target.checked
              void run(async () => {
                await readJson(MOBILE_HTTP_PREFIX, '/enabled', {
                  method: 'POST',
                  body: JSON.stringify({ enabled }),
                })
              })
            }}
          />
          <span>{copy.mobileOn}</span>
        </label>
        {mobile?.qrDataUrl && (
          <img className="dshChannelsQr" alt={copy.mobile} src={mobile.qrDataUrl} />
        )}
        {mobile?.url && <p className="dshChannelsUrl">{mobile.url}</p>}
        <div className="dshChannelsRow">
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            await readJson(MOBILE_HTTP_PREFIX, '/url', { method: 'POST', body: '{}' })
          })}>
            {copy.showMobile}
          </button>
          {mobile?.url && (
            <button type="button" disabled={busy} onClick={() => {
              void navigator.clipboard.writeText(mobile.url ?? '').then(() => {
                setCopied(true)
                window.setTimeout(() => { setCopied(false) }, 1500)
              })
            }}>
              {copied ? copy.copied : copy.copy}
            </button>
          )}
        </div>
      </div>

      <div className="dshChannelsBlock">
        <div className="dshChannelsTitle">{copy.status}</div>
        <p className="dshChannelsStatus">{payload?.telegram}</p>
        <p className="dshChannelsStatus">{payload?.discord}</p>
        <p className="dshChannelsStatus">{payload?.feishu}</p>
        <div className="dshChannelsRow">
          <input type="password" autoComplete="off" placeholder={copy.telegram} value={telegramBotToken} onChange={event => { setTelegramBotToken(event.target.value) }} />
          <input type="password" autoComplete="off" placeholder={copy.discord} value={discordBotToken} onChange={event => { setDiscordBotToken(event.target.value) }} />
        </div>
        <div className="dshChannelsRow">
          <input autoComplete="off" placeholder={copy.feishuId} value={feishuAppId} onChange={event => { setFeishuAppId(event.target.value) }} />
          <input type="password" autoComplete="off" placeholder={copy.feishuSecret} value={feishuAppSecret} onChange={event => { setFeishuAppSecret(event.target.value) }} />
        </div>
        <div className="dshChannelsRow">
          <input type="password" autoComplete="off" placeholder={copy.wechatToken} value={wechatBotToken} onChange={event => { setWechatBotToken(event.target.value) }} />
          <button type="button" disabled={busy} onClick={() => void run(async () => {
            await readJson(CHANNELS_HTTP_PREFIX, '/credentials', {
              method: 'POST',
              body: JSON.stringify({
                telegramBotToken,
                discordBotToken,
                feishuAppId,
                feishuAppSecret,
                wechatBotToken,
              }),
            })
          })}>
            {copy.save}
          </button>
        </div>
      </div>

      {notice && <p className="dshChannelsError">{notice}</p>}
    </div>
  )
}
