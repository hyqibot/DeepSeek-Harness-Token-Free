import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopRuntime, DesktopTrayItem } from '../src/runtime.ts'
import {
  apply,
  CHANNEL_SETTINGS_NAMESPACE,
  ChannelSettingsSchema,
  inject,
  name,
  resolveTelegramBotToken,
  type ChannelSettings,
} from '../src/channels.ts'

const homes: string[] = []

afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('desktop channels Host plugin', () => {
  it('owns the settings namespace and an effect-scoped tray command', () => {
    expect(name).toBe('desktop-channels')
    expect(inject).toEqual(['desktopRuntime', 'desktopProfiles', 'settings', 'webServer'])
    expect(String(CHANNEL_SETTINGS_NAMESPACE)).toBe('dsh-desktop-channels')
    expect(ChannelSettingsSchema({} as ChannelSettings)).toEqual({
      telegramBotToken: '',
      discordBotToken: '',
      feishuAppId: '',
      feishuAppSecret: '',
      wechatBotToken: '',
      wechatBaseUrl: 'https://ilinkai.weixin.qq.com',
    })
    expect(resolveTelegramBotToken(
      ChannelSettingsSchema({} as ChannelSettings),
      '  env-token  ',
    )).toBe('env-token')
  })

  it('notifies a pairing code from the tray without starting Telegram', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-channels-plugin-'))
    homes.push(dir)
    let trayItem: DesktopTrayItem | undefined
    const notify = vi.fn()
    const runtime = {
      platform: 'win32',
      updates: { notify },
      show: vi.fn(),
      registerTrayItem: (item: DesktopTrayItem) => {
        trayItem = item
        return { refresh: vi.fn(), dispose: vi.fn() }
      },
    } as unknown as DesktopRuntime
    const current: ChannelSettings = ChannelSettingsSchema({} as ChannelSettings)
    const ctx = new Context()
    ctx.provide('desktopRuntime', runtime)
    ctx.provide('desktopProfiles', { current: { name: 'desktop', dir } })
    ctx.provide('settings', {
      register: () => ({
        get: () => current,
        watch: () => () => {},
        update: vi.fn(async () => {}),
      }),
      get: () => undefined,
      update: vi.fn(async () => {}),
    })
    ctx.provide('webServer', {
      register: () => () => {},
    })
    const fiber = ctx.plugin({ name, inject, apply })
    await fiber
    await Promise.resolve()
    await trayItem?.invoke()

    expect(trayItem).toMatchObject({ group: 'tools', order: 20 })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      title: 'DSH Desktop pairing code',
      body: expect.stringMatching(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/u),
    }))
    await fiber.dispose()
  })
})
