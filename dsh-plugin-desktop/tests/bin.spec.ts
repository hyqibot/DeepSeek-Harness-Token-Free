import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { DESKTOP_CLI_HELP, forwardElectronConsole, parseDesktopCli } from '../src/bin.ts'

describe('desktop npm launcher', () => {
  it('launches with no arguments', () => {
    expect(parseDesktopCli([])).toBe('launch')
  })

  it.each([
    ['--help', 'help'],
    ['-h', 'help'],
    ['--version', 'version'],
    ['-V', 'version'],
  ] as const)('parses %s', (argument, action) => {
    expect(parseDesktopCli([argument])).toBe(action)
  })

  it('rejects arguments that belong to the profile app', () => {
    expect(() => parseDesktopCli(['--port', '3000'])).toThrow('unknown arguments')
  })

  it('names the installed product and selected profile behavior', () => {
    expect(DESKTOP_CLI_HELP).toContain('DSH Desktop')
    expect(DESKTOP_CLI_HELP).toContain('selected Web-capable profile')
  })

  it('rewrites piped Chromium crashpad mojibake to UTF-8 Chinese', () => {
    const written: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stderr.write
    try {
      const stderr = new EventEmitter()
      forwardElectronConsole({ stderr, stdout: new EventEmitter() } as unknown as ChildProcess)
      stderr.emit('data', Buffer.from('CreateFile: 绯荤粺鎵句笉鍒版寚瀹氱殑鏂囦欢銆?(0x2)\n', 'utf8'))
      expect(written.join('')).toContain('CreateFile: 系统找不到指定的文件。(0x2)')
    } finally {
      process.stderr.write = originalWrite
    }
  })
})
