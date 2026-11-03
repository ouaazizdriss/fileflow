import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { auth, SESSION_EXPIRED_EVENT } from './api'
import FileManager from './components/FileManager'
import LoginPage from './components/LoginPage'
import type { Permission, Role } from './types'

type AuthState = 'loading' | 'authenticated' | 'unauthenticated'

export default function App() {
  const { t } = useTranslation()
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [totpEnabled, setTotpEnabled] = useState(false)

  useEffect(() => {
    // Check if user recently logged out
    // Store logout timestamp to prevent auto-login within 5 minutes of logout
    const logoutTime = sessionStorage.getItem('logoutTime')
    if (logoutTime) {
      const elapsed = Date.now() - parseInt(logoutTime, 10)
      // If logged out within last 5 minutes, stay logged out
      if (elapsed < 5 * 60 * 1000) {
        setAuthState('unauthenticated')
        return
      }
      // After 5 minutes, clear the logout flag to allow re-login
      sessionStorage.removeItem('logoutTime')
    }

    auth.me()
      .then((u) => {
        // Clear any logout time when successfully authenticated
        sessionStorage.removeItem('logoutTime')
        setUsername(u.username)
        setRole(u.role)
        setPermissions(u.permissions)
        setTotpEnabled(u.totp_enabled)
        setAuthState('authenticated')
      })
      .catch(() => {
        setAuthState('unauthenticated')
      })
  }, [])

  const resetSession = useCallback(() => {
    setAuthState('unauthenticated')
    setUsername('')
    setRole('user')
    setPermissions([])
    setTotpEnabled(false)
  }, [])

  // A 401 from any authenticated call means the session is gone (expired or
  // revoked elsewhere): return to the login screen instead of failing silently.
  useEffect(() => {
    if (authState !== 'authenticated') return
    const onExpired = () => {
      // Fixed id: concurrent failing requests show a single toast.
      toast.error(t('app.sessionExpired'), { id: 'session-expired' })
      resetSession()
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [authState, resetSession, t])

  if (authState === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-base">
        <div className="flex items-center gap-3 text-text-secondary">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span>{t('app.loading')}</span>
        </div>
      </div>
    )
  }

  if (authState === 'unauthenticated') {
    return (
      <LoginPage
        onLogin={(u) => {
          setUsername(u.username)
          setRole(u.role)
          setPermissions(u.permissions)
          setTotpEnabled(u.totp_enabled)
          setAuthState('authenticated')
        }}
      />
    )
  }

  return (
    <FileManager
      username={username}
      role={role}
      permissions={permissions}
      totpEnabled={totpEnabled}
      onLogout={resetSession}
    />
  )
}
