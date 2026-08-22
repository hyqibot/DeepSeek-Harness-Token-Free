/** Shared JSON helpers for loopback settings HTTP. */

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Read one JSON object body. Empty bodies become `{}`.
 * @param req - incoming loopback request.
 */
export async function readLoopbackJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object')
  }
  return parsed as Record<string, unknown>
}

/**
 * Write a JSON response and close the socket.
 * @param res - response owned by this handler.
 * @param status - HTTP status.
 * @param body - JSON-serializable payload.
 */
export function writeLoopbackJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * Return the path after a registered loopback prefix.
 * @param reqUrl - incoming `req.url`.
 * @param prefix - registered prefix such as `/api/desktop-channels`.
 */
export function loopbackRestPath(reqUrl: string | undefined, prefix: string): string {
  const url = new URL(reqUrl ?? '/', 'http://127.0.0.1')
  return url.pathname.slice(prefix.length).replace(/\/+$/u, '') || '/'
}
