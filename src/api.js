import { encryptPassword, serializeBlob } from './crypto'
import { ENCRYPT_ON_DEVICE } from './config'
import { getApiUrl } from './runtimeConfig'

// Allows API calls over HTTPS, while permitting plain HTTP for local development.
function isSecureRequestAllowed(endpoint) {
  if (typeof window === 'undefined') return true

  const requestUrl = new URL(getApiUrl(endpoint), window.location.href)
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)
  return requestUrl.protocol === 'https:' || (requestUrl.protocol === 'http:' && isLocalhost)
}

// Prevents authentication and vault endpoints from being called over insecure HTTP.
function ensureSecureAuthRequest(endpoint) {
  const authEndpoints = ['/User/', '/Data/', '/Note/']
  const isAuthRequest = authEndpoints.some((prefix) => endpoint.startsWith(prefix))

  if (isAuthRequest && !isSecureRequestAllowed(endpoint)) {
    throw new Error('HTTPS is required for authenticated requests.')
  }
}

// Adds the bearer token to request headers when a token is available.
function getAuthHeaders(token, headers = {}) {
  if (!token) return headers
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  }
}


// Recursively masks secret-like fields before response data is written to logs.
function redactSensitiveData(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, seen))
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      const normalizedKey = key.toLowerCase()
      const isSensitiveKey = ['password', 'passphrase', 'clearpassword', 'loginkey', 'authorization', 'token', 'secret', 'cookie'].some(
        (sensitiveKey) => normalizedKey.includes(sensitiveKey),
      )

      return [key, isSensitiveKey ? '[REDACTED]' : redactSensitiveData(nestedValue, seen)]
    }),
  )
}

// Sends an API request, parses its response, and throws a useful error for failures.
async function apiRequest(endpoint, options = {}) {
  ensureSecureAuthRequest(endpoint)

  const url = getApiUrl(endpoint)
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...options.headers,
    },
  }

  const response = await fetch(url, config)
  const contentType = response.headers.get('content-type')
  let data
  if (contentType && contentType.includes('application/json')) {
    data = await response.json()
  } else {
    const text = await response.text()
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    const safeData = redactSensitiveData(data)
    console.error('API error:', response.status, safeData)
    const error = new Error(typeof data === 'string' ? data : (data?.message || data?.error || `Request failed with status ${response.status}`))
    error.status = response.status
    throw error
  }

  return data
}

export function isAuthenticationError(error) {
  return error?.status === 401
}

/**
 * Authenticates a user with their username and password.
 * Returns the server's sign-in response, including the session key.
 */
export async function signIn(username, password) {
  ensureSecureAuthRequest('/User/Signin')
  return apiRequest('/User/Signin', {
    method: 'POST',
    body: JSON.stringify({ username, clearPassword: password }),
  })
}

/**
 * Ends the current server-side session using the supplied bearer token.
 * The caller should clear its local session whether or not this request succeeds.
 */
export async function logout(token) {
  return apiRequest('/User/Logout', {
    method: 'POST',
    headers: getAuthHeaders(token),
  })
}

/**
 * Retrieves the current user's profile to verify an existing session.
 */
export async function getMe(token) {
  return apiRequest('/User/Me', {
    headers: getAuthHeaders(token),
  })
}

/**
 * Fetches all vault records belonging to the authenticated user.
 */
export async function getLoginData(token) {
  return apiRequest('/Data/GetLoginData', {
    method: 'POST',
    headers: getAuthHeaders(token),
  })
}

/**
 * Creates a vault record. A passphrase is sent only for server-side encryption;
 * device-encrypted records omit it.
 */
export async function createLoginData(token, tmpLoginData, passphrase) {
  const record = { ...tmpLoginData, encryptOnDevice: ENCRYPT_ON_DEVICE }
  if (record.encryptOnDevice && record.password) {
    const encrypted = await encryptPassword(record.password, passphrase)
    record.password = serializeBlob(encrypted)
  }

  const apiBody = { tmpLoginData: record }
  if (passphrase && !record.encryptOnDevice) {
    apiBody.passphrase = passphrase
  }
  return apiRequest('/Data/New', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(apiBody),
  })
}

/** Restores a backup record without transforming opaque device-encrypted data. */
export async function restoreLoginData(token, tmpLoginData, passphrase) {
  const apiBody = { tmpLoginData: { ...tmpLoginData } }
  if (!tmpLoginData.encryptOnDevice) {
    apiBody.passphrase = passphrase
  }
  return apiRequest('/Data/New', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(apiBody),
  })
}

/**
 * Updates a vault record. A passphrase is sent only for server-side encryption;
 * device-encrypted records omit it.
 */
export async function updateLoginData(token, tmpLoginData, passphrase) {
  const record = { ...tmpLoginData, encryptOnDevice: ENCRYPT_ON_DEVICE }
  if (record.encryptOnDevice && record.password) {
    const encrypted = await encryptPassword(record.password, passphrase)
    record.password = serializeBlob(encrypted)
  }

  const apiBody = { tmpLoginData: record }
  if (passphrase && !record.encryptOnDevice) {
    apiBody.passphrase = passphrase
  }
  return apiRequest('/Data/Update', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(apiBody),
  })
}

/**
 * Deletes the vault record identified by its seq UUID.
 */
export async function deleteLoginData(token, seq) {
  return apiRequest(`/Data/Delete/${seq}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  })
}

/**
 * Requests decryption of a vault record's password using its seq and passphrase.
 */
export async function getClearPassword(token, tmpLoginData, passphrase) {
  const body = { tmpLoginData }
  if (passphrase) body.passphrase = passphrase
  return apiRequest('/Data/GetClearPassword', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(body),
  })
}

/** Lists note metadata and opaque device-encrypted content without decrypting notes. */
export async function getNotes(token) {
  return apiRequest('/Note/GetNotes', {
    method: 'POST',
    headers: getAuthHeaders(token),
  })
}

export async function getNote(token, seq, passphrase) {
  const body = { tmpNote: { seq } }
  if (passphrase) body.passphrase = passphrase
  return apiRequest('/Note/GetNote', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(body),
  })
}

export async function createNote(token, tmpNote, passphrase) {
  const note = { ...tmpNote, encryptOnDevice: ENCRYPT_ON_DEVICE }
  if (note.encryptOnDevice && note.content) {
    const encrypted = await encryptPassword(note.content, passphrase)
    note.content = serializeBlob(encrypted)
  }
  const body = { tmpNote: note }
  if (passphrase && !note.encryptOnDevice) body.passphrase = passphrase
  return apiRequest('/Note/New', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(body),
  })
}

/** Restores a backup note without transforming opaque device-encrypted data. */
export async function restoreNote(token, tmpNote, passphrase) {
  const body = { tmpNote: { ...tmpNote } }
  if (!tmpNote.encryptOnDevice) body.passphrase = passphrase
  return apiRequest('/Note/New', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(body),
  })
}

export async function updateNote(token, tmpNote, passphrase) {
  const note = { ...tmpNote, encryptOnDevice: ENCRYPT_ON_DEVICE }
  if (note.encryptOnDevice && note.content) {
    const encrypted = await encryptPassword(note.content, passphrase)
    note.content = serializeBlob(encrypted)
  }
  const body = { tmpNote: note }
  if (passphrase && !note.encryptOnDevice) body.passphrase = passphrase
  return apiRequest('/Note/Update', {
    method: 'POST',
    headers: getAuthHeaders(token),
    body: JSON.stringify(body),
  })
}

export async function deleteNote(token, seq) {
  return apiRequest(`/Note/Delete/${seq}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  })
}
