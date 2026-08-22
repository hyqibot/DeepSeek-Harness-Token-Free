/** Rewrite Windows Chromium/crashpad console lines that arrive as GBK mojibake. */

const FILE_NOT_FOUND_MOJIBAKE = /绯荤粺鎵句笉鍒版寚瀹氱殑鏂囦欢銆.?/g
const FILE_NOT_FOUND = '系统找不到指定的文件。'

/**
 * Restore the usual Win32 ERROR_FILE_NOT_FOUND sentence Chromium logs as
 * UTF-8 bytes then the console rereads as GBK.
 */
export function rewriteChromiumConsoleText(text: string): string {
  return text.replace(FILE_NOT_FOUND_MOJIBAKE, FILE_NOT_FOUND)
}

/**
 * Decode one Electron stderr/stdout chunk for a UTF-8 host terminal.
 * Prefer UTF-8; fall back to GB18030 when the chunk is not valid UTF-8.
 */
export function decodeChromiumConsoleChunk(chunk: Buffer): string {
  const utf8 = chunk.toString('utf8')
  if (utf8.includes('\uFFFD')) {
    try {
      return rewriteChromiumConsoleText(new TextDecoder('gb18030').decode(chunk))
    } catch {
      return rewriteChromiumConsoleText(utf8)
    }
  }
  return rewriteChromiumConsoleText(utf8)
}
