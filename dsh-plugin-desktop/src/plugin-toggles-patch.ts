/** Persist `disabled` overlays into the profile user layer. */

import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { isMap, isSeq, parseDocument, type ParsedNode, type YAMLSeq } from 'yaml'

/** Legacy user-layer ids written as `include:<entryId>` instead of the Loader row id. */
export const PLUGIN_TOGGLE_LEGACY_ID_PREFIX = 'include:'

/**
 * Normalize a Loader or user-layer patch id to the canonical Cordis entry id.
 * @param entryId - Loader id or legacy `include:` alias.
 */
export function normalizePatchEntryId(entryId: string): string {
  return entryId.startsWith(PLUGIN_TOGGLE_LEGACY_ID_PREFIX)
    ? entryId.slice(PLUGIN_TOGGLE_LEGACY_ID_PREFIX.length)
    : entryId
}

/** Patch layers loaded from profile or home overlays before composition. */
export function normalizePatchLayerIds<T extends PatchOptions>(patches: readonly T[]): T[] {
  return patches.map(patch => normalizePatchEntry(patch))
}

function normalizePatchEntry<T extends PatchOptions>(patch: T): T {
  const next = { ...patch } as T & PatchOptions
  if (typeof next.id === 'string') {
    next.id = normalizePatchEntryId(next.id)
  }
  if (Array.isArray(next.insert)) {
    next.insert = normalizePatchLayerIds(next.insert)
  }
  return next
}

function entryIdsMatch(stored: unknown, entryId: string): boolean {
  if (typeof stored !== 'string') return false
  return stored === entryId || stored === `${PLUGIN_TOGGLE_LEGACY_ID_PREFIX}${entryId}`
}

/**
 * Write or update `disabled` for one Loader id in a `cordis.patch.yml` document.
 * @param text - existing YAML, possibly empty.
 * @param entryId - stable Loader entry id.
 * @param disabled - true unmounts the row without removing it.
 */
export function applyPluginDisabledPatch(text: string, entryId: string, disabled: boolean): string {
  const canonicalId = normalizePatchEntryId(entryId)
  const parsed = parseDocument(text.trim() === '' ? '[]\n' : text)
  if (parsed.errors.length > 0) {
    throw new Error(`invalid cordis.patch.yml: ${parsed.errors.map(error => error.message).join('; ')}`)
  }
  if (!isSeq(parsed.contents)) {
    throw new Error('invalid cordis.patch.yml: root must be a sequence')
  }
  const root = parsed.contents
  if (!visitSeq(root, canonicalId, disabled)) {
    const payload = disabled ? { id: canonicalId, disabled: true } : { id: canonicalId }
    root.add(parsed.createNode(payload) as ParsedNode)
  }
  return String(parsed)
}

function visitSeq(seq: YAMLSeq, entryId: string, disabled: boolean): boolean {
  for (const item of seq.items) {
    if (!isMap(item)) continue
    if (entryIdsMatch(item.get('id'), entryId)) {
      item.set('id', entryId)
      if (disabled) item.set('disabled', true)
      else item.delete('disabled')
      return true
    }
    const insert = item.get('insert')
    if (isSeq(insert) && visitSeq(insert, entryId, disabled)) return true
  }
  return false
}
