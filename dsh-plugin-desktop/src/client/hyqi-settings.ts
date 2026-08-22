/** Polish the HYQi row on the Models settings page. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings-page tag shown after the HYQi provider name. */
export const HYQI_SETTINGS_TAG = '免token+工具链强化+非网页+无需Api'

/** API-key placeholder on the HYQi editor (replaces the harness stored-key hint). */
export const HYQI_KEY_STORED_PLACEHOLDER = '已配置免token密钥，无需设置'

const GENERIC_TAGS = new Set(['自定义', 'Custom', HYQI_SETTINGS_TAG])

const HARNESS_KEY_STORED_PLACEHOLDERS = new Set([
  '已配置——输入新值可替换',
  'Configured — enter a new value to replace',
])

const patchedKeyInputs = new WeakSet<object>()

/**
 * Harness `providerCopy` uses `HYQi (hyqi)` when displayName ≠ provider id.
 * Match the row control and the confirmation action, not Edit.
 */
const HYQI_REMOVE_LABEL = /^(删除|Delete|Remove)\s+HYQi(\s*\(\s*hyqi\s*\))?$/i

/**
 * Rewrite the Models-page tag next to the HYQi row name, and hide its delete
 * button. The harness treats hand-declared routes as removable customs; HYQi
 * is shipped with the desktop, so it should match DeepSeek (edit only).
 */
export function retagHyqiRows(root: ParentNode): void {
  const names = root.querySelectorAll('span')
  for (const name of names) {
    if (name.textContent?.trim() !== 'HYQi') continue
    const sibling = name.nextElementSibling
    if (sibling == null) continue
    const text = sibling.textContent?.trim() ?? ''
    if (!GENERIC_TAGS.has(text)) continue
    if (sibling.textContent !== HYQI_SETTINGS_TAG) sibling.textContent = HYQI_SETTINGS_TAG
  }
  hideHyqiDeleteButtons(root)
  rewriteHyqiKeyPlaceholder(root)
}

/**
 * Whether an accessible name is the HYQi row (or confirm) delete control.
 * @param label - `aria-label` or button text.
 */
export function isHyqiRemoveLabel(label: string): boolean {
  return HYQI_REMOVE_LABEL.test(label.trim())
}

/**
 * Hide the HYQi row delete button. Prefer the harness aria-label
 * (`删除 HYQi (hyqi)`); fall back to the `删除`/`Remove` control on that row.
 */
export function hideHyqiDeleteButtons(root: ParentNode): void {
  const buttons = root.querySelectorAll('button')
  for (const button of buttons) {
    if (!isHyqiRemoveButton(button)) continue
    hideControl(button as HTMLElement)
  }
}

function isHyqiRemoveButton(button: Element): boolean {
  const label = typeof button.getAttribute === 'function'
    ? button.getAttribute('aria-label')?.trim() ?? ''
    : ''
  if (isHyqiRemoveLabel(label)) return true
  const text = button.textContent?.trim() ?? ''
  if (text !== '删除' && text !== 'Remove') return false
  const closest = typeof button.closest === 'function' ? button.closest('li') : null
  if (closest == null) return false
  const spans = closest.querySelectorAll('span')
  for (const span of spans) {
    if (span.textContent?.trim() === 'HYQi') return true
  }
  return false
}

function hideControl(host: HTMLElement): void {
  if (host.hidden !== true) host.hidden = true
  if (host.style.display !== 'none') host.style.display = 'none'
}

/**
 * Whether copy is the harness "key already stored" placeholder, including dash variants.
 * @param value - input placeholder text.
 */
export function isHarnessKeyStoredPlaceholder(value: string): boolean {
  const text = value.trim()
  if (text.length === 0 || text === HYQI_KEY_STORED_PLACEHOLDER) return false
  if (HARNESS_KEY_STORED_PLACEHOLDERS.has(text)) return true
  return /已配置.*输入新值可替换/.test(text)
    || /configured.*enter a new value to replace/i.test(text)
}

/**
 * Replace the harness stored-key placeholder on the HYQi editor only.
 * Other providers keep `已配置——输入新值可替换`.
 *
 * The editor first paints the empty-key hint; `credentials.describe` then
 * assigns the stored-key copy as a property (not a childList mutation), and
 * later React commits write that copy back. Patch the field so those writes
 * keep our text.
 */
export function rewriteHyqiKeyPlaceholder(root: ParentNode): void {
  const inputs = root.querySelectorAll('input')
  for (const input of inputs) {
    const host = input as HTMLInputElement
    if (!isHyqiApiKeyInput(host)) continue
    interceptHyqiKeyPlaceholder(host)
    const current = currentPlaceholder(host)
    if (current === HYQI_KEY_STORED_PLACEHOLDER) continue
    if (!isHarnessKeyStoredPlaceholder(current)) continue
    setPlaceholder(host, HYQI_KEY_STORED_PLACEHOLDER)
  }
}

function isHyqiApiKeyInput(host: HTMLInputElement): boolean {
  if (!isPasswordInput(host) || !isApiKeyLabel(host)) return false
  return isInsideHyqiEditor(host)
}

function isPasswordInput(host: HTMLInputElement): boolean {
  const attr = typeof host.getAttribute === 'function'
    ? host.getAttribute('type')?.trim() ?? ''
    : ''
  if (attr === 'password') return true
  return host.type === 'password'
}

function isApiKeyLabel(host: HTMLInputElement): boolean {
  const label = typeof host.getAttribute === 'function'
    ? host.getAttribute('aria-label')?.trim() ?? ''
    : ''
  return label === 'API 密钥' || label === 'API key'
}

function interceptHyqiKeyPlaceholder(host: HTMLInputElement): void {
  if (patchedKeyInputs.has(host)) return
  patchedKeyInputs.add(host)
  const existing = Object.getOwnPropertyDescriptor(host, 'placeholder')
    ?? (typeof HTMLInputElement === 'undefined'
      ? undefined
      : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'placeholder'))
  Object.defineProperty(host, 'placeholder', {
    configurable: true,
    enumerable: true,
    get() {
      if (existing?.get !== undefined) return existing.get.call(this)
      return typeof host.getAttribute === 'function'
        ? host.getAttribute('placeholder') ?? ''
        : ''
    },
    set(next: string) {
      const value = rewriteStoredPlaceholder(String(next))
      if (existing?.set !== undefined) existing.set.call(this, value)
      else if (typeof host.setAttribute === 'function') host.setAttribute('placeholder', value)
    },
  })
  const originalSetAttribute = host.setAttribute.bind(host)
  host.setAttribute = (name: string, value: string) => {
    originalSetAttribute.call(
      host,
      name,
      name === 'placeholder' ? rewriteStoredPlaceholder(value) : value,
    )
  }
}

function rewriteStoredPlaceholder(value: string): string {
  return isHarnessKeyStoredPlaceholder(value) ? HYQI_KEY_STORED_PLACEHOLDER : value
}

function currentPlaceholder(host: HTMLInputElement): string {
  const fromAttr = typeof host.getAttribute === 'function'
    ? host.getAttribute('placeholder')?.trim() ?? ''
    : ''
  if (fromAttr.length > 0) return fromAttr
  return typeof host.placeholder === 'string' ? host.placeholder.trim() : ''
}

function setPlaceholder(host: HTMLInputElement, value: string): void {
  if (typeof host.setAttribute === 'function') host.setAttribute('placeholder', value)
  if (host.placeholder !== value) host.placeholder = value
}

function isInsideHyqiEditor(input: Element): boolean {
  const closest = typeof input.closest === 'function' ? input.closest('li') : null
  const host = closest ?? (typeof input.parentElement === 'object' ? input.parentElement : null)
  if (host == null || typeof host.querySelectorAll !== 'function') return false
  const spans = host.querySelectorAll('span')
  for (const span of spans) {
    if (span.textContent?.trim() === 'HYQi') return true
  }
  return false
}

/** MutationObserver options: childList only, never attributes (avoids a freeze loop). */
export const HYQI_SETTINGS_OBSERVE: MutationObserverInit = {
  childList: true,
  subtree: true,
}

/**
 * Watch the settings Models list and keep the HYQi tag, delete-button, and
 * API-key placeholder treatment in place.
 * @param ctx - browser Cordis context.
 */
export function applyHyqiSettingsTag(ctx: ClientContext): void {
  ctx.effect(() => {
    let applying = false
    const observer = new MutationObserver(() => {
      if (applying) return
      applying = true
      observer.disconnect()
      try {
        retagHyqiRows(document.body)
      } finally {
        applying = false
        observer.observe(document.body, HYQI_SETTINGS_OBSERVE)
      }
    })
    observer.observe(document.body, HYQI_SETTINGS_OBSERVE)
    retagHyqiRows(document.body)
    return () => { observer.disconnect() }
  }, 'desktop: hyqi settings tag')
}
