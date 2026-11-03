import { FormEvent, useState } from 'react'
import { HardDrive, Lock, LogIn, User, ShieldCheck, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { auth, twoFactor } from '../api'
import type { UserInfo } from '../types'

interface Props {
  onLogin: (user: UserInfo) => void
}

type LoginStep = 'credentials' | '2fa-totp' | '2fa-recovery'

export default function LoginPage({ onLogin }: Props) {
  const { t } = useTranslation()
  const [step, setStep] = useState<LoginStep>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault()
    if (!username || !password) return

    setLoading(true)
    try {
      const response = await auth.login(username, password)

      // Check if 2FA is required
      if ('requires_2fa' in response && response.requires_2fa) {
        setStep('2fa-totp')
        setCode('')
      } else {
        // Normal login without 2FA
        onLogin(response as UserInfo)
      }
    } catch (err) {
      toast.error((err as Error).message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  async function handleTotpSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.length !== 6) return

    setLoading(true)
    try {
      const user = await twoFactor.verify(code)
      onLogin(user)
    } catch {
      toast.error('Invalid code')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleRecoverySubmit(e: FormEvent) {
    e.preventDefault()
    if (!recoveryCode) return

    setLoading(true)
    try {
      const user = await twoFactor.verifyRecovery(recoveryCode)
      onLogin(user)
    } catch {
      toast.error('Invalid recovery code')
      setRecoveryCode('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-base relative overflow-hidden">
      {/* Ambient brand glow — Sunset Flow hues */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-32 w-96 h-96 rounded-full blur-3xl opacity-25" style={{ background: 'var(--brand-orange)' }} />
        <div className="absolute top-1/4 -right-32 w-96 h-96 rounded-full blur-3xl opacity-20" style={{ background: 'var(--brand-pink)' }} />
        <div className="absolute -bottom-40 left-1/4 w-[28rem] h-[28rem] rounded-full blur-3xl opacity-20" style={{ background: 'var(--brand-purple)' }} />
      </div>

      <div className="relative w-full max-w-sm mx-4 animate-scale-in">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-11 h-11 rounded-2xl bg-gradient-sunset flex items-center justify-center" style={{ boxShadow: '0 8px 24px -6px rgb(255 45 149 / 0.5)' }}>
            <HardDrive className="w-5 h-5 text-white" />
          </div>
          <span className="text-2xl font-bold text-gradient-brand tracking-tight">{t('login.title')}</span>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-2xl p-8 shadow-2xl">
          {step === 'credentials' && (
            <>
              <h1 className="text-xl font-semibold text-text-primary mb-1">{t('login.subtitle')}</h1>
              <p className="text-sm text-text-secondary mb-6">{t('login.description')}</p>

              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {t('login.username')}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t('login.placeholder_username')}
                      autoComplete="username"
                      autoFocus
                      className="w-full bg-elevated border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    {t('login.password')}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t('login.placeholder_password')}
                      autoComplete="current-password"
                      className="w-full bg-elevated border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !username || !password}
                  className="w-full flex items-center justify-center gap-2 btn-brand font-medium text-sm py-2.5 rounded-lg mt-2"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  {loading ? t('login.submitting') : t('login.submit')}
                </button>
              </form>
            </>
          )}

          {step === '2fa-totp' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-accent" />
                </div>
                <h2 className="text-lg font-semibold text-text-primary">Verification required</h2>
              </div>
              <p className="text-sm text-text-secondary mb-6">
                Enter the 6-digit code from your authenticator app
              </p>

              <form onSubmit={handleTotpSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Authenticator code
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    className="w-full bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm text-text-primary text-center font-mono placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full flex items-center justify-center gap-2 btn-brand font-medium text-sm py-2.5 rounded-lg"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  Verify
                </button>
              </form>

              <div className="mt-4 space-y-2 text-sm">
                <button
                  type="button"
                  onClick={() => { setStep('2fa-recovery'); setRecoveryCode('') }}
                  className="w-full text-accent hover:text-accent-hover text-center py-2"
                >
                  Use recovery code instead
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setCode('') }}
                  className="w-full text-text-muted hover:text-text-primary text-center py-2 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to login
                </button>
              </div>
            </>
          )}

          {step === '2fa-recovery' && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-accent" />
                </div>
                <h2 className="text-lg font-semibold text-text-primary">Use recovery code</h2>
              </div>
              <p className="text-sm text-text-secondary mb-6">
                Enter one of your recovery codes (format: XXXXXX-XXXXXX)
              </p>

              <form onSubmit={handleRecoverySubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    Recovery code
                  </label>
                  <input
                    type="text"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
                    placeholder="XXXXXX-XXXXXX"
                    autoFocus
                    className="w-full bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !recoveryCode}
                  className="w-full flex items-center justify-center gap-2 btn-brand font-medium text-sm py-2.5 rounded-lg"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <LogIn className="w-4 h-4" />
                  )}
                  Use recovery code
                </button>
              </form>

              <div className="mt-4 space-y-2 text-sm">
                <button
                  type="button"
                  onClick={() => { setStep('2fa-totp'); setRecoveryCode('') }}
                  className="w-full text-accent hover:text-accent-hover text-center py-2"
                >
                  Use authenticator instead
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setRecoveryCode('') }}
                  className="w-full text-text-muted hover:text-text-primary text-center py-2 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to login
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-text-muted mt-4">
          {t('login.tagline')}
        </p>
      </div>
    </div>
  )
}
