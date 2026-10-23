export const MIN_PASSPHRASE_LENGTH = 16
export const MAX_PASSPHRASE_LENGTH = 128

export function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.trim().length === 0) {
    return 'Passphrase cannot be blank.'
  }

  const length = Array.from(passphrase.trim()).length
  if (length < MIN_PASSPHRASE_LENGTH) {
    return `Use a passphrase with at least ${MIN_PASSPHRASE_LENGTH} characters.`
  }
  if (!/[A-Z]/.test(passphrase)) {
    return 'Include at least one uppercase letter.'
  }
  if (Array.from(passphrase).length > MAX_PASSPHRASE_LENGTH) {
    return `Use a passphrase with no more than ${MAX_PASSPHRASE_LENGTH} characters.`
  }

  return true
}
