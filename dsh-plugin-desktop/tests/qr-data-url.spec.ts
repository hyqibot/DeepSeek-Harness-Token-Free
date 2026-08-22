import { describe, expect, it } from 'vitest'
import { isQrImageDataUrl, renderQrDataUrl } from '../src/qr-data-url.ts'

describe('QR data URL rendering', () => {
  it('keeps an existing image data URL', async () => {
    const existing = 'data:image/png;base64,abc'
    expect(isQrImageDataUrl(existing)).toBe(true)
    expect(await renderQrDataUrl(existing)).toBe(existing)
  })

  it('encodes a WeChat login URL as a PNG data URL for in-page scanning', async () => {
    const url = 'https://ilinkai.weixin.qq.com/example-qr'
    expect(isQrImageDataUrl(url)).toBe(false)
    const rendered = await renderQrDataUrl(url)
    expect(rendered.startsWith('data:image/png;base64,')).toBe(true)
    expect(rendered.length).toBeGreaterThan(100)
  })
})
