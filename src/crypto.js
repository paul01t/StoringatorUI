// Client-side password encryption using the browser's built-in Web Crypto API.
//
// The password is encrypted with AES-GCM, a key is derived from the user's
// passphrase with PBKDF2-HMAC-SHA256 and a per-record random salt, and a random
// IV is generated for every record. Nothing is sent to the API: the stored
// record contains only the ciphertext, salt, and IV.
//
// This runs entirely in the browser — no external dependencies are required.
// (The Web Crypto API is built into all modern browsers and is not a script
// source, so it does not conflict with the strict Content-Security-Policy.)
import { validatePassphrase } from './passphrase'

const PBKDF2_ITERATIONS = 600000
const SALT_LENGTH = 16
const IV_LENGTH = 12
const AES_KEY_LENGTH = 256
const GCM_TAG_LENGTH = 128
const BACKUP_FORMAT = 'storingator-backup'
const BACKUP_VERSION = 1

// -- base64 helpers ------------------------------------------------------

function _arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return globalThis.btoa(binary)
}

function _base64ToArrayBuffer(base64) {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// -- key derivation ------------------------------------------------------

// Matches Crypt.deriveKeyFromPassphrase in the Java API.
async function _deriveKey(passphrase, salt) {
  const subtle = globalThis.crypto.subtle
  const passwordBuffer = new TextEncoder().encode(passphrase)
  const keyMaterial = await subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptBackupData(data, passphrase) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Web Crypto API is not supported in this browser.')
  }
  const passphraseError = validatePassphrase(passphrase)
  if (passphraseError !== true) {
    throw new Error(passphraseError)
  }

  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await _deriveKey(passphrase, salt)
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: GCM_TAG_LENGTH },
    key,
    new TextEncoder().encode(JSON.stringify(data)),
  )

  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: _arrayBufferToBase64(salt),
    iv: _arrayBufferToBase64(iv),
    ciphertext: _arrayBufferToBase64(ciphertext),
  })
}

export async function decryptBackupData(serializedBackup, passphrase) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Web Crypto API is not supported in this browser.')
  }
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('A backup passphrase is required.')
  }

  let envelope
  try {
    envelope = JSON.parse(serializedBackup)
  } catch {
    throw new Error('This file is not a valid Storingator backup.')
  }

  if (
    !envelope ||
    envelope.format !== BACKUP_FORMAT ||
    envelope.version !== BACKUP_VERSION ||
    envelope.algorithm !== 'AES-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA-256' ||
    envelope.iterations !== PBKDF2_ITERATIONS ||
    typeof envelope.salt !== 'string' ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('This backup format is unsupported or invalid.')
  }

  let salt
  let iv
  let ciphertext
  try {
    salt = new Uint8Array(_base64ToArrayBuffer(envelope.salt))
    iv = new Uint8Array(_base64ToArrayBuffer(envelope.iv))
    ciphertext = _base64ToArrayBuffer(envelope.ciphertext)
  } catch {
    throw new Error('The backup file is damaged or invalid.')
  }
  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || ciphertext.byteLength < 16) {
    throw new Error('The backup file is damaged or invalid.')
  }

  try {
    const key = await _deriveKey(passphrase, salt)
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: GCM_TAG_LENGTH },
      key,
      ciphertext,
    )
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))
  } catch {
    throw new Error('Could not open the backup. Check the passphrase and file.')
  }
}

/**
 * Encrypts UTF-8 plaintext with the same PBKDF2/AES-GCM parameters as Java
 * Crypt. Returns `{ alg, ciphertext, salt, iv }` — byte fields are base64,
 * and ciphertext includes the 16-byte GCM tag. The passphrase is never sent
 * to the API.
 */
export async function encryptPassword(plaintext, passphrase) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Web Crypto API is not supported in this browser.')
  }
  const passphraseError = validatePassphrase(passphrase)
  if (passphraseError !== true) {
    throw new Error(passphraseError)
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  const key = await _deriveKey(passphrase, salt)

  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: GCM_TAG_LENGTH },
    key,
    new TextEncoder().encode(plaintext),
  )

  return {
    alg: 'AES-GCM',
    ciphertext: _arrayBufferToBase64(ciphertext),
    salt: _arrayBufferToBase64(salt),
    iv: _arrayBufferToBase64(iv),
  }
}

/**
 * Decrypts a stored device-encrypted blob with `passphrase` and returns the
 * plaintext password.
 */
export async function decryptPasswordLocally(passphrase, blob) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Web Crypto API is not supported in this browser.')
  }
  if (!blob || blob.alg !== 'AES-GCM') {
    throw new Error('Unsupported encryption data.')
  }
  const salt = _base64ToArrayBuffer(blob.salt)
  const iv = _base64ToArrayBuffer(blob.iv)
  const ciphertext = _base64ToArrayBuffer(blob.ciphertext)
  if (salt.byteLength !== SALT_LENGTH || iv.byteLength !== IV_LENGTH || ciphertext.byteLength < GCM_TAG_LENGTH / 8) {
    throw new Error('Invalid encryption data.')
  }

  const key = await _deriveKey(passphrase, salt)

  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: GCM_TAG_LENGTH },
    key,
    ciphertext,
  )

  return new TextDecoder().decode(plaintext)
}

// -- serialization ----------------------------------------------------------

/**
 * Serializes an encryption blob to a base64-encoded JSON string.
 *
 * The API's password field is a String (see TempLoginData in the backend).
 * The blob must be serialized to a String before it is sent, and parsed back
 * when it is decrypted.
 */
export function serializeBlob(blob) {
  return globalThis.btoa(JSON.stringify(blob))
}

/**
 * Deserializes a base64-encoded JSON string back to an encryption blob.
 */
export function deserializeBlob(str) {
  return JSON.parse(globalThis.atob(str))
}
