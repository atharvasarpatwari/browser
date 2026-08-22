/**
 * Shared cryptographic utilities used across the codebase.
 * Extracted here to break circular dependencies between storage and bookmarks.
 */

let _counter = 0;

/**
 * Generate a prefixed secure ID using Web Crypto API with Math.random fallback.
 * @param prefix - prefix for the ID (e.g., "bm", "sess", "tab")
 */
function generateSecureId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  }
  const array = new Uint8Array(12)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(array)
  } else {
    for (let i = 0; i < 12; i++) {
      array[i] = Math.floor(Math.random() * 256)
    }
  }
  // Fallback: append a counter to ensure uniqueness even with Math.random collisions
  _counter++
  return `${prefix}-${Array.from(array, b => b.toString(16).padStart(2, '0')).join('')}-${_counter.toString(36)}`
}

/**
 * Generate a simple random hex string (no prefix).
 */
function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(array)
  } else {
    for (let i = 0; i < bytes; i++) {
      array[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

export { generateSecureId, randomHex }
