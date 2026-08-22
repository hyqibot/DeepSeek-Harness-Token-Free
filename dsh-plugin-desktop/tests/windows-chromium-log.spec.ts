import { describe, expect, it } from 'vitest'
import { decodeChromiumConsoleChunk, rewriteChromiumConsoleText } from '../src/windows-chromium-log.ts'

describe('windows chromium console log', () => {
  it('restores the crashpad file-not-found sentence from GBK mojibake', () => {
    const line = '[0818/231924.671:ERROR:third_party\\crashpad\\crashpad\\util\\win\\registration_protocol_win.cc:108] CreateFile: 绯荤粺鎵句笉鍒版寚瀹氱殑鏂囦欢銆?(0x2)\n'
    expect(rewriteChromiumConsoleText(line)).toContain('CreateFile: 系统找不到指定的文件。(0x2)')
    expect(rewriteChromiumConsoleText(line)).not.toContain('绯荤')
  })

  it('leaves ordinary UTF-8 Electron logs unchanged', () => {
    const line = 'Could not parse message into JSON: {"id":"a"}\n'
    expect(rewriteChromiumConsoleText(line)).toBe(line)
  })

  it('decodes a GB18030 crashpad chunk when UTF-8 is invalid', () => {
    const gbk = Buffer.from('cfb5cdb3d5d2b2bbb5bdd6b8b6a8b5c4cec4bcfea1a3', 'hex')
    expect(decodeChromiumConsoleChunk(gbk)).toBe('系统找不到指定的文件。')
  })
})
