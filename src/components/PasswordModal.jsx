// Popup shown when a vault box is clicked.
// Asks for the passphrase, copies the decrypted password to clipboard,
// and offers delete / close actions.
export default function PasswordModal({
  item,
  passphrase,
  setPassphrase,
  decryptedPassword,
  setDecryptedPassword,
  onDecrypt,
  onDelete,
  onClose,
  copied,
  setCopied,
}) {
  // Copies the decrypted password, then removes it from component state.
  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(decryptedPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      // Clear the decrypted password immediately after copying
      if (setDecryptedPassword) setDecryptedPassword('')
    } catch {
      // fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = decryptedPassword
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      if (setDecryptedPassword) setDecryptedPassword('')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>{item.platform}</h3>

        {item.username && (
          <div className="form-group">
            <label><i className="ph ph-user"></i> Username</label>
            <input type="text" value={item.username} readOnly />
          </div>
        )}
        {item.email && (
          <div className="form-group">
            <label><i className="ph ph-envelope"></i> Email</label>
            <input type="text" value={item.email} readOnly />
          </div>
        )}

        {decryptedPassword ? (
          <div className="password-row">
            <span className="password-value">{decryptedPassword}</span>
            <button
              className={`copy-btn ${copied ? 'copied' : ''}`}
              onClick={copyToClipboard}
              title="Copy to clipboard"
            >
              {copied ? '✓ Copied' : <><i className="ph ph-copy"></i> Copy</>}
            </button>
          </div>
        ) : (
          <div className="form-group">
            <label><i className="ph ph-lock"></i> Passphrase</label>
            <input
              type="password"
              placeholder="Enter passphrase to decrypt"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              autoFocus
              autoComplete="new-password"
            />
          </div>
        )}

        <div className="modal-actions">
          {!decryptedPassword && (
            <button className="btn-primary" onClick={onDecrypt}>
              <i className="ph ph-key"></i> Decrypt
            </button>
          )}
          <button className="btn-danger" onClick={onDelete}>
            <i className="ph ph-trash"></i> Delete
          </button>
          <button className="btn-secondary" onClick={onClose}>
            <i className="ph ph-x"></i> Close
          </button>
        </div>
      </div>
    </div>
  )
}