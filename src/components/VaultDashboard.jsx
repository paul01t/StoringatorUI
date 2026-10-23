import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { getLoginData, createLoginData, deleteLoginData, getClearPassword, logout, isAuthenticationError } from '../api'
import { getToken, clearSession } from '../auth'
import PasswordModal from './PasswordModal.jsx'
import PasswordGenerator from './PasswordGenerator.jsx'
import BackupRestore from './BackupRestore.jsx'
import { decryptPasswordLocally, deserializeBlob } from '../crypto.js'
import { ENCRYPT_ON_DEVICE } from '../config.js'
import { validatePassphrase } from '../passphrase.js'
import { getPasswordGeneratorConfig } from '../runtimeConfig.js'

// Renders the authenticated vault and manages record and password workflows.
export default function VaultDashboard({ loggedInUser, setLoggedInUser, error, setError }) {
  const [vaultData, setVaultData] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [modalPassphrase, setModalPassphrase] = useState('')
  const [decryptedPassword, setDecryptedPassword] = useState('')
  const [copied, setCopied] = useState(false)

  const { register, handleSubmit: handleNewSubmit, reset: resetNewForm, setValue, formState: { errors: formErrors, isSubmitting } } = useForm()
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const filteredVaultData = normalizedSearch
    ? vaultData.filter(item => [item.platform, item.username, item.email, item.extrainfo]
      .some(value => String(value || '').toLocaleLowerCase().includes(normalizedSearch)))
    : vaultData

  // Clear error messages after five seconds.
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 5000)
      return () => clearTimeout(timer)
    }
  }, [error, setError])

  // Clear decrypted passwords and copy state after thirty seconds.
  useEffect(() => {
    if (decryptedPassword) {
      const timer = setTimeout(() => {
        setDecryptedPassword('')
        setCopied(false)
      }, 30000)
      return () => clearTimeout(timer)
    }
  }, [decryptedPassword])

  // Fetches the user's records and ends the session only if the token is rejected.
  const loadVaultData = useCallback(async () => {
    const token = getToken()
    if (!token) return
    try {
      const data = await getLoginData(token)
      setVaultData(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isAuthenticationError(err)) {
        clearSession()
        setLoggedInUser(null)
        return
      }
      setError(err.message || 'Failed to load vault data.')
    }
  }, [setError, setLoggedInUser])

  // Loads the vault whenever an authenticated user is available.
  useEffect(() => {
    if (loggedInUser) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadVaultData()
    }
  }, [loggedInUser, loadVaultData])

  // Validates and saves a new record, then refreshes the vault list.
  async function onCreateRecord(data) {
    const token = getToken()
    if (!token) {
      setError('Session expired — please sign in again')
      return
    }
    setError('')
    try {
      // Omit empty optional fields: the server validates email format,
      // so sending email: '' would fail with 400
      const tmpLoginData = {
        platform: data.platform.trim(),
        password: data.password,
        encryptOnDevice: ENCRYPT_ON_DEVICE,
      }
      const username = (data.username || '').trim()
      const email = (data.email || '').trim()
      const extrainfo = (data.extrainfo || '').trim()
      if (username) tmpLoginData.username = username
      if (email) tmpLoginData.email = email
      if (extrainfo) tmpLoginData.extrainfo = extrainfo
      await createLoginData(token, tmpLoginData, (data.passphrase || '').trim())
      setShowNewForm(false)
      resetNewForm()
      await loadVaultData()
    } catch (err) {
      console.error('Save record failed:', err)
      setError(err.message || 'Failed to save record')
    }
  }

  // Confirms and deletes the selected record from the vault.
  async function handleDelete() {
    if (!selectedItem) return
    const token = getToken()
    if (!token) return
    setError('')
    if (!window.confirm(`Delete record for "${selectedItem.platform}"?`)) return
    try {
      await deleteLoginData(token, selectedItem.seq)
      setVaultData(vaultData.filter(item => item.seq !== selectedItem.seq))
      closeModal()
    } catch (err) {
      setError(err.message || 'Failed to delete record')
    }
  }

  // Decrypts the selected record using the passphrase entered in the modal.
  async function handleDecrypt() {
    if (!selectedItem) return
    const token = getToken()
    if (!token) return
    setError('')
    try {
      if (selectedItem.encryptOnDevice) {
        let blob = selectedItem.password
        if (typeof blob === 'string') blob = deserializeBlob(blob)
        setDecryptedPassword(await decryptPasswordLocally(modalPassphrase, blob))
      } else {
        const data = await getClearPassword(token, { seq: selectedItem.seq }, modalPassphrase)
        setDecryptedPassword(data.password || data)
      }
      setModalPassphrase('') // clear passphrase from state immediately
      setCopied(false)
    } catch {
      setError('Could not decrypt — wrong passphrase or session expired')
      setModalPassphrase('')
    }
  }

  // Opens the password modal for the selected vault record.
  function openModal(item) {
    setSelectedItem(item)
    setModalPassphrase('')
    setDecryptedPassword('')
    setError('')
  }

  // Closes the password modal and clears its sensitive form state.
  function closeModal() {
    setSelectedItem(null)
    setModalPassphrase('')
    setDecryptedPassword('')
  }

  // Toggles the new-record form and clears any current error.
  function toggleNewForm() {
    setShowNewForm(!showNewForm)
    setError('')
  }

  function useGeneratedPassword(password) {
    setShowNewForm(true)
    setValue('password', password, { shouldDirty: true, shouldValidate: true })
  }

  // Ends the server and local sessions, even if the request fails.
  async function handleLogout() {
    const token = getToken()
    try {
      await logout(token)
    } catch {
      // ignore logout errors, still log out locally
    } finally {
      clearSession()
      setLoggedInUser(null)
    }
  }

  return (
    <section id="center">
      <div className="login-container align-top">
        <div className="dashboard-card">
          <div className="dashboard-topbar">
            <div className="dashboard-header">
              <h1>Welcome, {loggedInUser}</h1>
              <button className="logout-btn" onClick={handleLogout}><i className="ph ph-sign-out"></i> Logout</button>
            </div>

            <div className="vault-header">
              <h2>Your Vault</h2>
              <div className="dashboard-actions">
                <BackupRestore onRestored={loadVaultData} setLoggedInUser={setLoggedInUser} />
                <PasswordGenerator settings={getPasswordGeneratorConfig()} onUse={useGeneratedPassword} />
                <button className="add-btn" onClick={toggleNewForm}>
                  {showNewForm ? <><i className="ph ph-x"></i> Cancel</> : <><i className="ph ph-plus"></i> Add Record</>}
                </button>
              </div>
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          {showNewForm && (
            <form onSubmit={handleNewSubmit(onCreateRecord)} className="new-record-form" autoComplete="off">
              <h3><i className="ph ph-plus-circle"></i> New Record</h3>
              <div className="form-group">
                <label><i className="ph ph-globe"></i> Platform</label>
                <input
                  type="text"
                  placeholder="e.g. github"
                  autoComplete="off"
                  {...register('platform', { required: 'Platform is required' })}
                />
                {formErrors.platform && <p className="error">{formErrors.platform.message}</p>}
              </div>
              <div className="form-group">
                <label><i className="ph ph-user"></i> Username</label>
                <input
                  type="text"
                  placeholder="Account username"
                  autoComplete="off"
                  {...register('username')}
                />
              </div>
              <div className="form-group">
                <label><i className="ph ph-envelope"></i> Email</label>
                <input
                  type="email"
                  placeholder="Account email"
                  autoComplete="off"
                  {...register('email')}
                />
              </div>
              <div className="form-group">
                <label><i className="ph ph-lock"></i> Password</label>
                <input
                  type="password"
                  placeholder="Password"
                  autoComplete="new-password"
                  {...register('password', { required: 'Password is required' })}
                />
                {formErrors.password && <p className="error">{formErrors.password.message}</p>}
              </div>
              <div className="form-group">
                <label><i className="ph ph-key"></i> Passphrase</label>
                <input
                  type="password"
                  placeholder={ENCRYPT_ON_DEVICE
                    ? 'Passphrase to encrypt this password on this device'
                    : 'Passphrase to encrypt this password on the server'}
                  autoComplete="new-password"
                  {...register('passphrase', { validate: validatePassphrase })}
                />
                {formErrors.passphrase && <p className="error">{formErrors.passphrase.message}</p>}
                <small className="encryption-mode-hint">
                  {ENCRYPT_ON_DEVICE
                    ? 'Use a unique passphrase with 16-128 characters and at least one uppercase letter. Symbols and numbers are optional. It is never sent to the server, and cannot be recovered if lost.'
                    : 'Use a unique passphrase with 16-128 characters and at least one uppercase letter. Symbols and numbers are optional. It is sent over HTTPS and is needed to reveal the password.'}
                </small>
              </div>
              <div className="form-group">
                <label><i className="ph ph-note"></i> Extra Info</label>
                <input
                  type="text"
                  placeholder="Any extra notes"
                  autoComplete="off"
                  {...register('extrainfo')}
                />
              </div>
              <button className="login-btn" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Record'}
              </button>
            </form>
          )}

          <input
            className="list-search"
            type="search"
            aria-label="Search vault by platform, username, email, or extra info"
            placeholder="Search vault..."
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
          />

          <div className="vault-list">
            {vaultData.length === 0 ? (
              <p className="empty-state"><i className="ph ph-inbox"></i> No records yet. Click &quot;Add Record&quot; to get started.</p>
            ) : filteredVaultData.length === 0 ? (
              <p className="empty-state">No vault records match “{searchQuery}”.</p>
            ) : (
              filteredVaultData.map(item => (
                <div key={item.seq} className="vault-item" onClick={() => openModal(item)}>
                  <span className="vault-item-name">{item.platform}</span>
                  <div className="vault-item-meta">
                    {item.username && <span><i className="ph ph-user"></i> {item.username}</span>}
                    {item.email && <span><i className="ph ph-envelope"></i> {item.email}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {selectedItem && (
        <PasswordModal
          item={selectedItem}
          passphrase={modalPassphrase}
          setPassphrase={setModalPassphrase}
          decryptedPassword={decryptedPassword}
          setDecryptedPassword={setDecryptedPassword}
          onDecrypt={handleDecrypt}
          onDelete={handleDelete}
          onClose={closeModal}
          copied={copied}
          setCopied={setCopied}
        />
      )}
    </section>
  )
}
