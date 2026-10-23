// Notes dashboard: list, create, view, and delete encrypted notes.
// Listing notes only loads metadata and opaque device-encrypted content.
// Content is decrypted locally or by the API only after the user reveals it.
import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import BackupRestore from './BackupRestore.jsx'
import { getToken, clearSession } from '../auth'
import { createNote, getNotes, getNote, updateNote, deleteNote, logout, isAuthenticationError } from '../api'
import { deserializeBlob, decryptPasswordLocally } from '../crypto'
import { ENCRYPT_ON_DEVICE } from '../config'
import { validatePassphrase } from '../passphrase'

export default function NotesDashboard({ loggedInUser, setLoggedInUser, error, setError }) {
  const [notes, setNotes] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [notesLoadError, setNotesLoadError] = useState('')
  const [loadingContent, setLoadingContent] = useState(false)
  const [selectedNote, setSelectedNote] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingNote, setEditingNote] = useState(null)
  const [modalPassphrase, setModalPassphrase] = useState('')
  const [decryptedContent, setDecryptedContent] = useState('')
  const [revealedNoteSeq, setRevealedNoteSeq] = useState(null)
  const [copied, setCopied] = useState(false)

  const { register, handleSubmit: handleNewSubmit, reset: resetNewForm, formState: { errors: formErrors, isSubmitting } } = useForm()
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const filteredNotes = normalizedSearch
    ? notes.filter(note => [note.title, note.timestamp, note.encryptOnDevice ? 'encrypted on device' : 'server encrypted']
      .some(value => String(value || '').toLocaleLowerCase().includes(normalizedSearch)))
    : notes

  // Clear error messages after five seconds.
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 5000)
      return () => clearTimeout(timer)
    }
  }, [error, setError])

  // Clear revealed note content and copy state after thirty seconds.
  useEffect(() => {
    if (revealedNoteSeq !== null) {
      const timer = setTimeout(() => {
        setDecryptedContent('')
        setRevealedNoteSeq(null)
        setCopied(false)
      }, 30000)
      return () => clearTimeout(timer)
    }
  }, [decryptedContent, revealedNoteSeq])

  const handleRequestError = useCallback((err, fallback) => {
    if (isAuthenticationError(err)) {
      clearSession()
      setLoggedInUser(null)
      return
    }
    setError(err.message || fallback)
  }, [setError, setLoggedInUser])

  // Fetches the user's notes and ends the session only if the token is rejected.
  const loadNotes = useCallback(async () => {
    const token = getToken()
    if (!token) return
    setLoadingNotes(true)
    setNotesLoadError('')
    try {
      const data = await getNotes(token)
      if (!Array.isArray(data)) {
        const responseShape = data && typeof data === 'object'
          ? `an object with fields: ${Object.keys(data).join(', ') || '(none)'}`
          : typeof data
        throw new Error(`The notes API returned ${responseShape} instead of a list.`)
      }
      setNotes(data)
    } catch (err) {
      if (!isAuthenticationError(err)) {
        setNotesLoadError(err.message || 'Failed to load notes.')
      }
      handleRequestError(err, 'Failed to load notes.')
    } finally {
      setLoadingNotes(false)
    }
  }, [handleRequestError])

  // Load the vault whenever an authenticated user is available.
  useEffect(() => {
    if (loggedInUser) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadNotes()
    }
  }, [loggedInUser, loadNotes])

  // ---- Notes CRUD ----------------------------------------------------

  async function onCreateRecord(data) {
    const token = getToken()
    if (!token) {
      setError('Session expired — please sign in again')
      return
    }
    setError('')
    try {
      const tmpNote = {
        title: data.title.trim(),
        content: data.content,
        encryptOnDevice: ENCRYPT_ON_DEVICE,
      }
      await createNote(token, tmpNote, (data.passphrase || '').trim())
      setShowForm(false)
      resetNewForm()
      await loadNotes()
    } catch (err) {
      console.error('Save note failed:', err)
      handleRequestError(err, 'Failed to save note.')
    }
  }

  async function onUpdateNote(data) {
    const token = getToken()
    if (!token) {
      setError('Session expired — please sign in again')
      return
    }
    setError('')
    const seq = editingNote.seq
    if (!seq) {
      setError('Cannot update this note because it has no identifier.')
      return
    }
    try {
      const tmpNote = {
        seq: editingNote.seq,
        title: data.title.trim(),
        content: data.content,
        encryptOnDevice: ENCRYPT_ON_DEVICE,
      }
      await updateNote(token, tmpNote, (data.passphrase || '').trim())
      setShowForm(false)
      setEditingNote(null)
      setSelectedNote(null)
      setDecryptedContent('')
      setRevealedNoteSeq(null)
      resetNewForm()
      await loadNotes()
    } catch (err) {
      console.error('Update note failed:', err)
      handleRequestError(err, 'Failed to update note.')
    }
  }

  async function onDeleteNote() {
    const token = getToken()
    if (!token) {
      setError('Session expired — please sign in again')
      return
    }
    if (!selectedNote?.seq) {
      setError('Cannot delete this note because it has no identifier.')
      return
    }
    setError('')
    if (!window.confirm(`Delete note "${selectedNote.title}"?`)) return
    try {
      await deleteNote(token, selectedNote.seq)
      setSelectedNote(null)
      setDecryptedContent('')
      setRevealedNoteSeq(null)
      await loadNotes()
    } catch (err) {
      handleRequestError(err, 'Failed to delete note.')
    }
  }

  // Reveals device-encrypted notes locally and requests server decryption otherwise.
  async function handleDecrypt() {
    if (!selectedNote) return
    if (!modalPassphrase.trim()) {
      setError('Enter the passphrase to reveal this note.')
      return
    }
    const token = getToken()
    if (!token) {
      setError('Session expired — please sign in again')
      return
    }
    setError('')
    setDecryptedContent('')
    setRevealedNoteSeq(null)
    setLoadingContent(true)
    try {
      let content
      if (selectedNote.encryptOnDevice) {
        const blob = typeof selectedNote.content === 'string'
          ? deserializeBlob(selectedNote.content)
          : selectedNote.content
        content = await decryptPasswordLocally(modalPassphrase.trim(), blob)
      } else {
        const data = await getNote(token, selectedNote.seq, modalPassphrase.trim())
        content = typeof data === 'string' ? data : data?.content
        if (typeof content !== 'string') {
          throw new Error('The server did not return note content.')
        }
      }
      setDecryptedContent(content)
      setRevealedNoteSeq(selectedNote.seq)
      setModalPassphrase('')
      setCopied(false)
    } catch (err) {
      handleRequestError(err, 'Could not reveal this note. Check the passphrase and try again.')
      setModalPassphrase('')
    } finally {
      setLoadingContent(false)
    }
  }

  // Open a note for viewing. This also populates the edit form if needed.
  function openNote(item) {
    setSelectedNote(item)
    setModalPassphrase('')
    setDecryptedContent('')
    setRevealedNoteSeq(null)
    setEditingNote(null)
    setShowForm(false)
    setError('')
  }

  function closeNote() {
    setSelectedNote(null)
    setModalPassphrase('')
    setDecryptedContent('')
    setRevealedNoteSeq(null)
    setCopied(false)
  }

  // Select an item for editing in the new-note form.
  function startEdit(item) {
    if (revealedNoteSeq !== item.seq) {
      setError('Reveal this note before editing it.')
      return
    }
    setSelectedNote(item)
    setEditingNote(item)
    setModalPassphrase('')
    resetNewForm({
      title: item.title || '',
      content: decryptedContent,
      passphrase: '',
    })
    setShowForm(true)
    setError('')
  }

  function cancelForm() {
    setShowForm(false)
    setEditingNote(null)
    resetNewForm()
    setError('')
  }

  function toggleNewForm() {
    if (showForm) {
      cancelForm()
      return
    }
    setEditingNote(null)
    resetNewForm({ title: '', content: '', passphrase: '' })
    setShowForm(true)
    setError('')
  }

  // ---- Helpers -----------------------------------------------------

  async function copyContent() {
    if (revealedNoteSeq !== selectedNote?.seq) return
    const copyWithFallback = () => {
      const textarea = document.createElement('textarea')
      textarea.value = decryptedContent
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      try {
        textarea.select()
        return document.execCommand('copy')
      } finally {
        document.body.removeChild(textarea)
      }
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(decryptedContent)
      } else if (!copyWithFallback()) {
        throw new Error('Clipboard access is not available.')
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      try {
        if (copyWithFallback()) {
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
          return
        }
      } catch {
        // Report the clipboard failure below.
      }
      setError('Could not copy this note to the clipboard.')
    }
  }

  async function handleLogout() {
    const token = getToken()
    try {
      await logout(token)
    } catch {
      // Still clear the local session when the server logout request fails.
    } finally {
      clearSession()
      setLoggedInUser(null)
    }
  }

  function renderNoteForm() {
    return (
      <form onSubmit={handleNewSubmit(editingNote ? onUpdateNote : onCreateRecord)} className="new-record-form" autoComplete="off">
        <h3>{editingNote ? <><i className="ph ph-pencil"></i> Edit Note</> : <><i className="ph ph-plus-circle"></i> New Note</>}</h3>
        <div className="form-group">
          <label><i className="ph ph-note"></i> Title</label>
          <input
            type="text"
            placeholder="Note title"
            autoComplete="off"
            {...register('title', {
              required: 'Title is required',
              validate: value => value.trim().length > 0 || 'Title cannot be blank',
            })}
          />
          {formErrors.title && <p className="error">{formErrors.title.message}</p>}
        </div>
        <div className="form-group">
          <label><i className="ph ph-lock"></i> Content</label>
          <textarea {...register('content', { required: 'Content is required' })} className="big-field" rows={6} placeholder="Note body" autoComplete="off" />
          {formErrors.content && <p className="error">{formErrors.content.message}</p>}
        </div>
        <div className="form-group">
          <label><i className="ph ph-key"></i> Passphrase</label>
          <input
            type="password"
            placeholder={ENCRYPT_ON_DEVICE
              ? 'Passphrase to encrypt this note on this device'
              : 'Passphrase to encrypt this note on the server'}
            autoComplete="new-password"
            {...register('passphrase', { validate: validatePassphrase })}
          />
          {formErrors.passphrase && <p className="error">{formErrors.passphrase.message}</p>}
          <small className="encryption-mode-hint">
            {ENCRYPT_ON_DEVICE
              ? 'Use a unique passphrase with 16-128 characters and at least one uppercase letter. Symbols and numbers are optional. It is never sent to the server, and cannot be recovered if lost.'
              : 'Use a unique passphrase with 16-128 characters and at least one uppercase letter. Symbols and numbers are optional. It is sent over HTTPS and is needed to reveal the note.'}
          </small>
        </div>
        <button className="login-btn" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : (editingNote ? 'Save Changes' : 'Save Note')}
        </button>
        <button className="logout-btn" type="button" onClick={cancelForm}>Cancel</button>
      </form>
    )
  }

  useEffect(() => {
    if (!selectedNote) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape') closeNote()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNote])

  // ---- Render ------------------------------------------------------

  return (
    <section id="center">
      <div className="login-container align-top">
        <div className="dashboard-card">
          <div className="dashboard-topbar">
            <div className="dashboard-header">
              <h1>Notes</h1>
              <div className="dashboard-actions">
                <button className="logout-btn" onClick={handleLogout}><i className="ph ph-sign-out"></i> Logout</button>
              </div>
            </div>

            <div className="vault-header">
              <h2>Your Notes</h2>
              <div className="dashboard-actions">
                <BackupRestore onRestored={loadNotes} setLoggedInUser={setLoggedInUser} />
                <button className="add-btn" onClick={toggleNewForm}>
                  {showForm ? <><i className="ph ph-x"></i> Cancel</> : <><i className="ph ph-plus"></i> Add Note</>}
                </button>
              </div>
            </div>
          </div>

          {error && !selectedNote && <p className="error">{error}</p>}

          {showForm && !editingNote && renderNoteForm()}

          <input
            className="list-search"
            type="search"
            aria-label="Search notes by title, date, or encryption type"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
          />

          <div className="vault-list">
            {loadingNotes ? (
              <p className="empty-state">Loading notes...</p>
            ) : notesLoadError ? (
              <div className="empty-state">
                <p className="error">Could not load notes: {notesLoadError}</p>
                <button className="add-btn" onClick={loadNotes}>Retry</button>
              </div>
            ) : notes.length === 0 ? (
              <p className="empty-state"><i className="ph ph-inbox"></i> No notes yet. Click &quot;Add Note&quot; to get started.</p>
            ) : filteredNotes.length === 0 ? (
              <p className="empty-state">No notes match “{searchQuery}”.</p>
            ) : (
              filteredNotes.map(item => (
                <div
                  key={item.seq}
                  className="vault-item"
                  role="button"
                  tabIndex={0}
                  onClick={() => openNote(item)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openNote(item)
                    }
                  }}
                >
                  <span className="vault-item-name">
                    {item.encryptOnDevice && <i className="ph ph-lock"></i>}
                    {item.title || <em>Untitled</em>}
                  </span>
                  <div className="vault-item-meta">
                    <span className="encrypted-hint">
                      {item.encryptOnDevice ? '🔒 Encrypted on device' : 'Server encrypted'}
                    </span>
                    {item.timestamp && <span>{item.timestamp}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {selectedNote && (
        <div
          className="modal-overlay"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeNote()
          }}
        >
          <section className="note-detail note-modal" role="dialog" aria-modal="true" aria-labelledby="note-modal-title">
            {error && <p className="error">{error}</p>}
            {showForm && editingNote ? (
              <>
                <div className="note-detail-header">
                  <h3 id="note-modal-title">Edit {selectedNote.title || 'Untitled'}</h3>
                  <button className="logout-btn" onClick={closeNote} aria-label="Close note"><i className="ph ph-x"></i></button>
                </div>
                {renderNoteForm()}
              </>
            ) : (
              <>
                <div className="note-detail-header">
                  <h3 id="note-modal-title">{selectedNote.title || 'Untitled'}</h3>
                  <div className="note-detail-actions">
                    <button className="add-btn" onClick={() => startEdit(selectedNote)}><i className="ph ph-pencil"></i> Edit</button>
                    <button className="logout-btn" onClick={onDeleteNote}><i className="ph ph-trash"></i> Delete</button>
                    <button className="logout-btn" onClick={closeNote} aria-label="Close note"><i className="ph ph-x"></i></button>
                  </div>
                </div>

                {revealedNoteSeq !== selectedNote.seq && (
                  <div className="form-group">
                    <label><i className="ph ph-key"></i> Passphrase</label>
                    <input
                      type="password"
                      value={modalPassphrase}
                      onChange={e => setModalPassphrase(e.target.value)}
                      placeholder="Enter passphrase to reveal this note"
                      autoComplete="new-password"
                      autoFocus
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          handleDecrypt()
                        }
                      }}
                    />
                    <button className="login-btn" onClick={handleDecrypt} disabled={loadingContent}>
                      <i className="ph ph-eye"></i> {loadingContent ? 'Revealing...' : 'Reveal'}
                    </button>
                  </div>
                )}

                {revealedNoteSeq === selectedNote.seq ? (
                  <div className="note-content">
                    <p>{decryptedContent || <em>This note is empty.</em>}</p>
                    <button className="add-btn" onClick={copyContent}>
                      {copied ? <><i className="ph ph-check"></i> Copied</> : <><i className="ph ph-copy"></i> Copy</>}
                    </button>
                  </div>
                ) : (
                  <div className="note-content">
                    <p><i className="ph ph-lock"></i> Reveal this note with its passphrase to view the content.</p>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
