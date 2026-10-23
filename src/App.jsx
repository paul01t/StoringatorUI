import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { signIn, getMe, isAuthenticationError } from './api'
import { setSession, clearSession, isLoggedIn, getToken, getUsername, isSessionValid } from './auth'
import VaultDashboard from './components/VaultDashboard'
import NotesDashboard from './components/NotesDashboard.jsx'
import './App.css'

// Renders the sign-in flow and the authenticated vault view.
function App() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Read the stored username once to initialize the signed-in view.
  const [loggedInUser, setLoggedInUser] = useState(() => getToken() ? getUsername() : null)
  // Which page is shown: "vault" or "notes".
  const [currentPage, setCurrentPage] = useState('vault')
  const { register, handleSubmit, reset } = useForm()
  const attemptState = useRef({ count: 0, lockedUntil: 0 })

  // Revalidates the stored token with the server and clears invalid sessions.
  async function verifySession() {
    const token = getToken()
    if (!token) {
      clearSession()
      setLoggedInUser(null)
      return
    }

    try {
      const data = await getMe(token)
      setSession(token, data.username)
      setLoggedInUser(data.username)
    } catch (err) {
      if (isAuthenticationError(err)) {
        clearSession()
        setLoggedInUser(null)
        return
      }
      setError(err.message || 'Unable to verify the current session.')
    }
  }

  // Recheck any stored login when the app first loads.
  useEffect(() => {
    if (isLoggedIn() && !isSessionValid()) {
      verifySession()
    } else if (!isLoggedIn()) {
      setLoggedInUser(null)
    }
  }, [])

  // Calculates exponential retry backoff, capped at 30 seconds.
  function getRetryDelayMs(failedAttempts) {
    return Math.min(1000 * 2 ** (failedAttempts - 1), 30000)
  }

  // Signs the user in and applies a temporary lock after repeated failures.
  async function onSubmit(data) {
    const now = Date.now()
    if (attemptState.current.lockedUntil > now) {
      const secondsLeft = Math.ceil((attemptState.current.lockedUntil - now) / 1000)
      setError(`Too many failed attempts. Please wait ${secondsLeft} seconds before trying again.`)
      return
    }

    setError('')
    setLoading(true)

    try {
      const signInData = await signIn(data.username, data.password)
      attemptState.current = { count: 0, lockedUntil: 0 }
      setSession(signInData.loginkey, signInData.username)
      setLoggedInUser(signInData.username)
      reset()
    } catch (err) {
      const failedAttempts = attemptState.current.count + 1
      attemptState.current.count = failedAttempts

      if (failedAttempts >= 3) {
        const delayMs = getRetryDelayMs(failedAttempts)
        attemptState.current.lockedUntil = Date.now() + delayMs
        setError(`Too many failed attempts. Please wait ${Math.ceil(delayMs / 1000)} seconds and try again.`)
      } else {
        setError(err.message || 'Login failed')
      }
    } finally {
      setLoading(false)
    }
  }

  if (loggedInUser) {
    return (
      <>
        <div className="page-tabs">
          <button
            className={`tab ${currentPage === 'vault' ? 'active' : ''}`}
            onClick={() => setCurrentPage('vault')}
          >
            <i className="ph ph-lock" /> Vault
          </button>
          <button
            className={`tab ${currentPage === 'notes' ? 'active' : ''}`}
            onClick={() => setCurrentPage('notes')}
          >
            <i className="ph ph-note" /> Notes
          </button>
        </div>
        {currentPage === 'vault' ? (
          <VaultDashboard
            loggedInUser={loggedInUser}
            setLoggedInUser={setLoggedInUser}
            error={error}
            setError={setError}
          />
        ) : (
          <NotesDashboard
            loggedInUser={loggedInUser}
            setLoggedInUser={setLoggedInUser}
            error={error}
            setError={setError}
          />
        )}
      </>
    )
  }

  return (
    <section id="center">
      <div className="login-container">
        <div className="login-card">
          <h1>Storingator</h1>
          <p className="subtitle">Sign in to your account</p>
          <form onSubmit={handleSubmit(onSubmit)} className="login-form" autoComplete="off">
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                {...register('username', { required: true })}
                placeholder="Enter your username"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password', { required: true })}
                placeholder="Enter your password"
              />
            </div>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </section>
  )
}

export default App
