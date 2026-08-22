/** LAN address helpers for the mobile remote-control listener. */

import { networkInterfaces } from 'node:os'

/**
 * Return whether a remote socket address is loopback or RFC1918.
 * @param address - Node `socket.remoteAddress`.
 */
export function isPrivateRemoteAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const value = address.startsWith('::ffff:') ? address.slice(7) : address
  if (value === '127.0.0.1' || value === '::1' || value === 'localhost') return true
  const parts = value.split('.').map(part => Number(part))
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  const [a, b] = parts
  if (a === undefined || b === undefined) return false
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

/**
 * List IPv4 addresses on this machine that a phone on the same LAN can reach.
 */
export function lanIPv4Addresses(): readonly string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    if (entries === undefined) continue
    for (const entry of entries) {
      if (entry.internal || entry.family !== 'IPv4') continue
      if (isPrivateRemoteAddress(entry.address)) addresses.push(entry.address)
    }
  }
  return addresses
}

/**
 * Build the phone URL shown in the tray notification.
 * @param host - LAN IPv4 address.
 * @param port - listener port.
 * @param bearer - shared mobile bearer.
 */
export function mobileRemoteUrl(host: string, port: number, bearer: string): string {
  const url = new URL(`http://${host}:${String(port)}/`)
  url.searchParams.set('token', bearer)
  return url.toString()
}
