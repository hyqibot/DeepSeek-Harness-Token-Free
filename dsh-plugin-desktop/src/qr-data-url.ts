/** Encode text as a PNG QR data URL for in-app scanning. */

import QRCode from 'qrcode'

/**
 * Return whether `value` is already an `<img src>` PNG/JPEG data URL.
 * @param value - WeChat `qrcode_img_content` or any candidate.
 */
export function isQrImageDataUrl(value: string): boolean {
  return value.startsWith('data:image/')
}

/**
 * Render a scannable QR image. HTTP(S) WeChat payloads are encoded as QR
 * content; they are not opened in a browser.
 * @param value - URL or opaque payload that a phone camera should scan.
 */
export async function renderQrDataUrl(value: string): Promise<string> {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error('QR payload is empty')
  if (isQrImageDataUrl(trimmed)) return trimmed
  return QRCode.toDataURL(trimmed, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    type: 'image/png',
  })
}
