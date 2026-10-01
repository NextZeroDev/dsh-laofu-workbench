/**
 * Redaction primitives shared by the execution detail projection and the DSH
 * trace projection. Both surfaces publish host-side text to the browser, so
 * they must agree on what a credential looks like; a second copy of these
 * rules would drift.
 *
 * This is not a general-purpose sanitizer: it removes the credential forms
 * that reach these two surfaces and the base64 transport blocks they exclude,
 * and leaves ordinary error prose intact.
 */

export const SECRET_FIELD = /^(?:authorization|cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|credential)$/iu

const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu
const API_KEY = /\bsk-[A-Za-z0-9_-]{12,}/gu
const ASSIGNED_SECRET = /(["']?(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|authorization)["']?\s*[:=]\s*["']?)[^"'\s,}]+/giu
const TRANSPORT_BLOCKS = ['audio_base64', 'image_base64']

/** Display content is opt-in; credentials and transport blobs are never display fields. */
export function displayValue(value) {
  if (typeof value === 'string') {
    if (/^\s*[{[]/u.test(value)) {
      try { return JSON.stringify(displayValue(JSON.parse(value)), null, 2) } catch { /* A streaming fragment need not be complete JSON. */ }
    }
    return value
      .replace(BEARER, 'Bearer [已隐藏]')
      .replace(API_KEY, '[已隐藏]')
      .replace(ASSIGNED_SECRET, '$1[已隐藏]')
  }
  if (Array.isArray(value)) return value.map(displayValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !TRANSPORT_BLOCKS.includes(key))
    .map(([key, item]) => [key, SECRET_FIELD.test(key) ? '[已隐藏]' : displayValue(item)]))
}

/**
 * One redacted, bounded machine-readable detail line for an operator-facing
 * audit record. Structural noise (newlines, runs of whitespace) is collapsed
 * so the value stays a single readable line inside a JSON field.
 * @param value - candidate text, usually a provider or harness failure message.
 * @param maximum - hard character ceiling for the returned line.
 * @returns the redacted single-line text, or null when nothing remains.
 */
export function redactedDetail(value, maximum = 240) {
  if (value === undefined || value === null) return null
  const text = displayValue(typeof value === 'string' ? value : String(value))
  if (typeof text !== 'string') return null
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  if (!collapsed) return null
  return collapsed.length > maximum ? `${collapsed.slice(0, maximum - 1)}…` : collapsed
}