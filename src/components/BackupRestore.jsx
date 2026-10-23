import { useEffect, useRef, useState } from 'react'
import { clearSession, getToken } from '../auth'
import {
  getClearPassword,
  getLoginData,
  getNote,
  getNotes,
  isAuthenticationError,
  restoreLoginData,
  restoreNote,
} from '../api'
import { decryptBackupData, encryptBackupData } from '../crypto'
import {
  MAX_PASSPHRASE_LENGTH,
  MIN_PASSPHRASE_LENGTH,
  validatePassphrase,
} from '../passphrase'

const MAX_BACKUP_SIZE = 25 * 1024 * 1024
const MAX_BACKUP_ITEMS = 10000

function validateBackup(data) {
  if (
    !data ||
    data.app !== 'Storingator' ||
    data.version !== 1 ||
    !Array.isArray(data.loginData) ||
    !Array.isArray(data.notes) ||
    data.loginData.length + data.notes.length > MAX_BACKUP_ITEMS
  ) {
    throw new Error('The backup contents are invalid or unsupported.')
  }

  const loginData = data.loginData.map((item) => {
    if (
      !item ||
      typeof item.platform !== 'string' ||
      item.platform.length > 128 ||
      typeof item.password !== 'string' ||
      item.password.length > 4096 ||
      typeof item.encryptOnDevice !== 'boolean' ||
      (item.encryptOnDevice === true && item.password.length === 0) ||
      (item.username != null && (typeof item.username !== 'string' || item.username.length > 256)) ||
      (item.email != null && (typeof item.email !== 'string' || item.email.length > 128)) ||
      (item.extrainfo != null && (typeof item.extrainfo !== 'string' || item.extrainfo.length > 4096))
    ) {
      throw new Error('The backup contains an invalid vault record.')
    }

    return {
      platform: item.platform,
      password: item.password,
      encryptOnDevice: item.encryptOnDevice === true,
      ...(item.username ? { username: item.username } : {}),
      ...(item.email ? { email: item.email } : {}),
      ...(item.extrainfo ? { extrainfo: item.extrainfo } : {}),
    }
  })

  const notes = data.notes.map((item) => {
    if (
      !item ||
      typeof item.title !== 'string' ||
      item.title.length > 255 ||
      typeof item.content !== 'string' ||
      item.content.length > 4096 ||
      typeof item.encryptOnDevice !== 'boolean' ||
      (item.encryptOnDevice === true && item.content.length === 0)
    ) {
      throw new Error('The backup contains an invalid note.')
    }

    return {
      title: item.title,
      content: item.content,
      encryptOnDevice: item.encryptOnDevice === true,
    }
  })

  return { loginData, notes }
}

function itemLabel(item) {
  return item.platform || 'Untitled record'
}

export default function BackupRestore({ onRestored, setLoggedInUser }) {
  const fileInput = useRef(null)
  const isMounted = useRef(true)
  const [mode, setMode] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null)
  const [serverItems, setServerItems] = useState([])
  const [unlockIndex, setUnlockIndex] = useState(0)
  const [sourcePassphrase, setSourcePassphrase] = useState('')
  const [archivePassphrase, setArchivePassphrase] = useState('')
  const [archivePassphraseConfirm, setArchivePassphraseConfirm] = useState('')
  const [archiveText, setArchiveText] = useState('')
  const [archiveFileName, setArchiveFileName] = useState('')
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [restorePassphraseConfirm, setRestorePassphraseConfirm] = useState('')
  const [restoreResult, setRestoreResult] = useState(null)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  function clearSensitiveState() {
    setDraft(null)
    setArchiveText('')
    setSourcePassphrase('')
    setArchivePassphrase('')
    setArchivePassphraseConfirm('')
    setRestorePassphrase('')
    setRestorePassphraseConfirm('')
  }

  function reportError(err, fallback) {
    if (isAuthenticationError(err)) {
      clearSession()
      setLoggedInUser(null)
      setError('Your session expired. Please sign in again.')
      return
    }
    setError(err.message || fallback)
  }

  function close() {
    if (busy) return
    clearSensitiveState()
    setServerItems([])
    setUnlockIndex(0)
    setArchiveFileName('')
    setRestoreResult(null)
    setError('')
    setMode(null)
  }

  async function startExport() {
    setMode('loading-export')
    setBusy(true)
    setError('')
    try {
      const token = getToken()
      if (!token) throw new Error('Session expired — please sign in again.')
      const [loginData, notes] = await Promise.all([getLoginData(token), getNotes(token)])
      if (!Array.isArray(loginData) || !Array.isArray(notes)) {
        throw new Error('The API returned an invalid backup data list.')
      }
      if (loginData.length + notes.length > MAX_BACKUP_ITEMS) {
        throw new Error('There are too many items for one backup file.')
      }

      const backup = {
        app: 'Storingator',
        version: 1,
        exportedAt: new Date().toISOString(),
        loginData: [],
        notes: [],
      }
      const unlockItems = []

      loginData.forEach((item, index) => {
        if (!item || typeof item.platform !== 'string') {
          throw new Error(`Vault record ${index + 1} is invalid and cannot be exported.`)
        }
        if (!item.encryptOnDevice && typeof item.seq !== 'string') {
          throw new Error(`Vault record "${itemLabel(item)}" is missing its identifier.`)
        }
        const record = {
          platform: item.platform,
          username: item.username || '',
          email: item.email || '',
          extrainfo: item.extrainfo || '',
          password: item.encryptOnDevice ? item.password : '',
          encryptOnDevice: item.encryptOnDevice === true,
        }
        if (record.encryptOnDevice && typeof record.password !== 'string') {
          throw new Error(`Device-encrypted record "${itemLabel(item)}" has no ciphertext.`)
        }
        backup.loginData.push(record)
        if (!record.encryptOnDevice) {
          unlockItems.push({
            kind: 'record',
            index,
            label: itemLabel(item),
            seq: item.seq,
          })
        }
      })

      notes.forEach((item, index) => {
        if (!item || typeof item.title !== 'string') {
          throw new Error(`Note ${index + 1} is invalid and cannot be exported.`)
        }
        if (!item.encryptOnDevice && typeof item.seq !== 'string') {
          throw new Error(`Note "${item.title || 'Untitled'}" is missing its identifier.`)
        }
        const note = {
          title: item.title,
          content: item.encryptOnDevice ? item.content : '',
          encryptOnDevice: item.encryptOnDevice === true,
        }
        if (note.encryptOnDevice && typeof note.content !== 'string') {
          throw new Error(`Device-encrypted note "${item.title || 'Untitled'}" has no ciphertext.`)
        }
        backup.notes.push(note)
        if (!note.encryptOnDevice) {
          unlockItems.push({
            kind: 'note',
            index,
            label: item.title || 'Untitled note',
            seq: item.seq,
          })
        }
      })

      setDraft(backup)
      setServerItems(unlockItems)
      setUnlockIndex(0)
      setMode(unlockItems.length ? 'unlock-item' : 'archive-password')
    } catch (err) {
      reportError(err, 'Could not prepare the backup.')
      setMode('export-error')
    } finally {
      setBusy(false)
    }
  }

  async function unlockCurrentItem(event) {
    event.preventDefault()
    if (!sourcePassphrase) {
      setError('Enter the passphrase used for this item.')
      return
    }
    const item = serverItems[unlockIndex]
    const token = getToken()
    if (!token) {
      setError('Session expired — please sign in again.')
      return
    }

    setBusy(true)
    setError('')
    try {
      let content
      if (item.kind === 'record') {
        const data = await getClearPassword(token, { seq: item.seq }, sourcePassphrase)
        content = typeof data === 'string' ? data : data?.password
      } else {
        const data = await getNote(token, item.seq, sourcePassphrase)
        content = typeof data === 'string' ? data : data?.content
      }
      if (typeof content !== 'string') {
        throw new Error('The API did not return the decrypted item.')
      }

      setDraft((current) => {
        const next = { ...current, loginData: [...current.loginData], notes: [...current.notes] }
        if (item.kind === 'record') next.loginData[item.index] = { ...next.loginData[item.index], password: content }
        else next.notes[item.index] = { ...next.notes[item.index], content }
        return next
      })
      setSourcePassphrase('')
      setUnlockIndex((current) => current + 1)
      if (unlockIndex + 1 >= serverItems.length) setMode('archive-password')
    } catch (err) {
      reportError(err, 'Could not unlock this item. Check its passphrase.')
    } finally {
      setBusy(false)
    }
  }

  async function downloadBackup(event) {
    event.preventDefault()
    const passphraseError = validatePassphrase(archivePassphrase)
    if (passphraseError !== true) {
      setError(passphraseError)
      return
    }
    if (archivePassphrase !== archivePassphraseConfirm) {
      setError('Enter and confirm the same backup passphrase.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const serialized = await encryptBackupData(draft, archivePassphrase)
      const blob = new Blob([serialized], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `storingator-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      clearSensitiveState()
      setMode('export-complete')
    } catch (err) {
      setError(err.message || 'Could not encrypt or download the backup.')
    } finally {
      setBusy(false)
    }
  }

  async function selectBackup(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_BACKUP_SIZE) {
      setError('Backup file is too large (maximum 25 MB).')
      setMode('import-error')
      return
    }
    setBusy(true)
    setError('')
    try {
      setArchiveText(await file.text())
      setArchiveFileName(file.name)
      setMode('import-password')
    } catch {
      setError('Could not read this backup file.')
      setMode('import-error')
    } finally {
      setBusy(false)
    }
  }

  async function openBackup(event) {
    event.preventDefault()
    if (!archivePassphrase) {
      setError('Enter the backup passphrase.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const decrypted = await decryptBackupData(archiveText, archivePassphrase)
      setDraft(validateBackup(decrypted))
      setArchivePassphrase('')
      setArchivePassphraseConfirm('')
      setMode('restore-confirm')
    } catch (err) {
      setError(err.message || 'Could not open this backup.')
    } finally {
      setBusy(false)
    }
  }

  async function restoreBackup(event) {
    event.preventDefault()
    const serverItemCount = draft.loginData.filter(item => !item.encryptOnDevice).length
      + draft.notes.filter(item => !item.encryptOnDevice).length
    if (serverItemCount) {
      const passphraseError = validatePassphrase(restorePassphrase)
      if (passphraseError !== true) {
        setError(passphraseError)
        return
      }
      if (restorePassphrase !== restorePassphraseConfirm) {
        setError('Enter and confirm the passphrase for restored server-encrypted items.')
        return
      }
    }

    const token = getToken()
    if (!token) {
      setError('Session expired — please sign in again.')
      return
    }

    setBusy(true)
    setError('')
    let restored = 0
    const failures = []
    const items = [
      ...draft.loginData.map((data) => ({ kind: 'record', data, label: itemLabel(data) })),
      ...draft.notes.map((data) => ({ kind: 'note', data, label: data.title || 'Untitled note' })),
    ]

    for (const item of items) {
      if (!isMounted.current) return
      try {
        if (item.kind === 'record') {
          await restoreLoginData(token, item.data, item.data.encryptOnDevice ? undefined : restorePassphrase)
        } else {
          await restoreNote(token, item.data, item.data.encryptOnDevice ? undefined : restorePassphrase)
        }
        restored += 1
      } catch (err) {
        failures.push(`${item.label}: ${err.message || 'restore failed'}`)
        if (isAuthenticationError(err)) {
          clearSession()
          setLoggedInUser(null)
          break
        }
      }
    }

    if (!isMounted.current) return
    if (restored > 0) await onRestored?.()
    const attempted = restored + failures.length
    setRestoreResult({ restored, failures, remaining: items.length - attempted })
    setBusy(false)
    setRestorePassphrase('')
    setRestorePassphraseConfirm('')
    setDraft(null)
    setArchiveText('')
    setMode('restore-complete')
  }

  const currentItem = serverItems[unlockIndex]
  const serverItemCount = draft
    ? draft.loginData.filter(item => !item.encryptOnDevice).length
      + draft.notes.filter(item => !item.encryptOnDevice).length
    : 0

  return (
    <>
      <div className="backup-actions">
        <button className="add-btn" onClick={startExport} disabled={busy}>
          <i className="ph ph-download-simple"></i> Export Backup
        </button>
        <button className="add-btn" onClick={() => { setError(''); setMode('choose-import'); fileInput.current?.click() }} disabled={busy}>
          <i className="ph ph-upload-simple"></i> Import Backup
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={selectBackup}
        />
      </div>

      {mode && (
        <div className="modal-overlay backup-overlay">
          <section className="modal-card backup-modal" role="dialog" aria-modal="true" aria-labelledby="backup-title">
            <div className="backup-modal-header">
              <h2 id="backup-title">
                {mode.startsWith('export') || mode === 'loading-export' ? 'Export backup' : 'Import backup'}
              </h2>
              {!busy && <button className="logout-btn" onClick={close} aria-label="Close backup dialog"><i className="ph ph-x"></i></button>}
            </div>

            {error && <p className="error">{error}</p>}

            {mode === 'loading-export' && <p>Preparing your backup...</p>}

            {mode === 'unlock-item' && currentItem && (
              <form className="backup-form" onSubmit={unlockCurrentItem}>
                <p>
                  Enter the original passphrase for <strong>{currentItem.label}</strong>
                  {' '}({currentItem.kind === 'record' ? 'vault record' : 'note'} {unlockIndex + 1} of {serverItems.length}).
                </p>
                <p className="backup-help">This is needed because the server encrypts this item separately. It is not saved in the backup.</p>
                <label className="form-group">
                  Original item passphrase
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={sourcePassphrase}
                    onChange={event => setSourcePassphrase(event.target.value)}
                    autoFocus
                  />
                </label>
                <div className="backup-buttons">
                  <button className="login-btn" type="submit" disabled={busy}>{busy ? 'Unlocking...' : 'Continue'}</button>
                  <button className="logout-btn" type="button" onClick={close} disabled={busy}>Cancel</button>
                </div>
              </form>
            )}

            {mode === 'archive-password' && (
              <form className="backup-form" onSubmit={downloadBackup}>
                <p>The backup file is encrypted on this device. You’ll need this backup passphrase to import it later.</p>
                <p className="backup-help">Use a unique passphrase with {MIN_PASSPHRASE_LENGTH}-{MAX_PASSPHRASE_LENGTH} characters and at least one uppercase letter. Symbols and numbers are optional. This is separate from the passphrases used to unlock individual items. If you forget it, the backup cannot be recovered.</p>
                <label className="form-group">
                  Backup passphrase
                  <input type="password" autoComplete="new-password" value={archivePassphrase} onChange={event => setArchivePassphrase(event.target.value)} autoFocus />
                </label>
                <label className="form-group">
                  Confirm backup passphrase
                  <input type="password" autoComplete="new-password" value={archivePassphraseConfirm} onChange={event => setArchivePassphraseConfirm(event.target.value)} />
                </label>
                <div className="backup-buttons">
                  <button className="login-btn" type="submit" disabled={busy}>{busy ? 'Encrypting...' : 'Download encrypted backup'}</button>
                  <button className="logout-btn" type="button" onClick={close} disabled={busy}>Cancel</button>
                </div>
              </form>
            )}

            {mode === 'choose-import' && (
              <div className="backup-form">
                <p>Select a Storingator encrypted backup file to continue.</p>
                <button className="logout-btn" onClick={close}>Cancel</button>
              </div>
            )}

            {mode === 'import-password' && (
              <form className="backup-form" onSubmit={openBackup}>
                <p>Opening <strong>{archiveFileName}</strong></p>
                <label className="form-group">
                  Backup passphrase
                  <input type="password" autoComplete="current-password" value={archivePassphrase} onChange={event => setArchivePassphrase(event.target.value)} autoFocus />
                </label>
                <div className="backup-buttons">
                  <button className="login-btn" type="submit" disabled={busy}>{busy ? 'Decrypting...' : 'Open backup'}</button>
                  <button className="logout-btn" type="button" onClick={close} disabled={busy}>Cancel</button>
                </div>
              </form>
            )}

            {mode === 'restore-confirm' && draft && (
              <form className="backup-form" onSubmit={restoreBackup}>
                <p>
                  This will add {draft.loginData.length} vault record(s) and {draft.notes.length} note(s) to your account.
                  Existing items will not be overwritten; importing the same file again creates duplicates.
                </p>
                {serverItemCount > 0 && (
                  <>
                    <p className="backup-help">
                      Server-encrypted items will be encrypted under this new passphrase. Device-encrypted items keep their original ciphertext and passphrases.
                    </p>
                    <label className="form-group">
                      Passphrase for restored server-encrypted items
                      <input type="password" autoComplete="new-password" value={restorePassphrase} onChange={event => setRestorePassphrase(event.target.value)} autoFocus />
                    </label>
                    <label className="form-group">
                      Confirm new passphrase
                      <input type="password" autoComplete="new-password" value={restorePassphraseConfirm} onChange={event => setRestorePassphraseConfirm(event.target.value)} />
                    </label>
                    <p className="backup-help">Use a unique passphrase with {MIN_PASSPHRASE_LENGTH}-{MAX_PASSPHRASE_LENGTH} characters and at least one uppercase letter. Symbols and numbers are optional. Keep it safe: it will be needed to reveal all restored server-encrypted items.</p>
                  </>
                )}
                <div className="backup-buttons">
                  <button className="login-btn" type="submit" disabled={busy}>{busy ? 'Restoring...' : 'Restore items'}</button>
                  <button className="logout-btn" type="button" onClick={close} disabled={busy}>Cancel</button>
                </div>
              </form>
            )}

            {mode === 'export-complete' && (
              <div className="backup-form">
                <p>Your encrypted backup was downloaded. Store the file and its backup passphrase somewhere safe.</p>
                <button className="login-btn" onClick={close}>Done</button>
              </div>
            )}

            {mode === 'restore-complete' && restoreResult && (
              <div className="backup-form">
                <p>Restored {restoreResult.restored} item(s).</p>
                {restoreResult.failures.length > 0 && (
                  <>
                    <p className="error">Some items could not be restored:</p>
                    <ul className="backup-failures">
                      {restoreResult.failures.slice(0, 10).map((failure, index) => <li key={index}>{failure}</li>)}
                    </ul>
                    {restoreResult.remaining > 0 && <p>{restoreResult.remaining} additional item(s) were not attempted.</p>}
                  </>
                )}
                <p className="backup-help">Refresh the vault and notes lists to see restored items.</p>
                <button className="login-btn" onClick={close}>Done</button>
              </div>
            )}

            {(mode === 'export-error' || mode === 'import-error') && (
              <div className="backup-form">
                <button className="logout-btn" onClick={close}>Close</button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}
