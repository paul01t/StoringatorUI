const TOKEN_KEY = 'storingator_token'
const USERNAME_KEY = 'storingator_username'
const TIME_KEY = 'storingator_time'

const SESSION_DURATION = 30 * 60
const inMemorySession = {
  token: null,
  username: null,
  time: null,
}

function isSecureContext() {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  return window.location.protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function setCookie(name, value, seconds) {
  const secureAttr = isSecureContext() ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${seconds}; SameSite=Strict${secureAttr}`
}

function getCookieValue(name) {
  if (typeof document === 'undefined') return null
  const row = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))

  if (!row) return null

  try {
    return decodeURIComponent(row.slice(name.length + 1))
  } catch {
    return row.slice(name.length + 1)
  }
}

export function setSession(token, username) {
  if (!token || typeof token !== 'string') {
    throw new Error('A valid session token is required.')
  }

  const now = Date.now()
  inMemorySession.token = token
  inMemorySession.username = username
  inMemorySession.time = now

  if (isSecureContext()) {
    setCookie(TOKEN_KEY, token, SESSION_DURATION)
    setCookie(USERNAME_KEY, username, SESSION_DURATION)
    setCookie(TIME_KEY, String(now), SESSION_DURATION)
  }
}

export function getToken() {
  return inMemorySession.token ?? getCookieValue(TOKEN_KEY)
}

export function getUsername() {
  return inMemorySession.username ?? getCookieValue(USERNAME_KEY)
}

export function getSessionTime() {
  return inMemorySession.time ?? getCookieValue(TIME_KEY)
}

export function isSessionValid() {
  const time = getSessionTime()
  if (!time) return false

  const elapsed = (Date.now() - Number.parseInt(time, 10)) / 1000
  return elapsed < SESSION_DURATION
}

export function isLoggedIn() {
  return Boolean(getToken()) && Boolean(getUsername())
}

export function clearSession() {
  inMemorySession.token = null
  inMemorySession.username = null
  inMemorySession.time = null

  const secureAttr = isSecureContext() ? '; Secure' : ''
  document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Strict${secureAttr}`
  document.cookie = `${USERNAME_KEY}=; path=/; max-age=0; SameSite=Strict${secureAttr}`
  document.cookie = `${TIME_KEY}=; path=/; max-age=0; SameSite=Strict${secureAttr}`
}
