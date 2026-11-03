import { FormEvent, useState, useEffect } from 'react'
import { ShieldCheck, Copy, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { twoFactor } from '../api'

interface Props {
  totpEnabled: boolean
  onClose: () => void
}

type SetupStep = 'intro' | 'qr' | 'verify' | 'backup'
type ManageStep = 'view' | 'regenerate-pw' | 'disable-pw'

export default function TwoFactorModal({ totpEnabled, onClose }: Props) {
  const { t } = useTranslation()

  // Setup wizard state
  const [setupStep, setSetupStep] = useState<SetupStep>('intro')
  const [qrUri, setQrUri] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [verifyCode, setVerifyCode] = useState('')

  // Management state
  const [manageStep, setManageStep] = useState<ManageStep>('view')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newCodes, setNewCodes] = useState<string[]>([])

  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Setup wizard: fetch setup data when entering QR step
  useEffect(() => {
    if (setupStep === 'qr' && !qrUri) {
      setLoading(true)
      twoFactor.setup()
        .then(async (response) => {
          const qrUri = response.qr_code_png_b64
          setQrUri(qrUri)
          // Recovery codes are issued only after /confirm succeeds (below), so we
          // never display codes here that the server hasn't actually stored.
          // Generate QR code data URL from otpauth:// URI
          const dataUrl = await QRCode.toDataURL(qrUri)
          setQrDataUrl(dataUrl)
        })
        .catch((err) => {
          toast.error((err as Error).message)
          setSetupStep('intro')
        })
        .finally(() => setLoading(false))
    }
  }, [setupStep, qrUri])

  async function handleVerifySetup(e: FormEvent) {
    e.preventDefault()
    if (verifyCode.length !== 6) return

    setLoading(true)
    try {
      const response = await twoFactor.confirm(verifyCode)
      setBackupCodes(response.backup_codes)
      setSetupStep('backup')
    } catch (err) {
      toast.error((err as Error).message)
      setVerifyCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault()
    if (!password || !code) return

    setLoading(true)
    try {
      await twoFactor.disable(password, code)
      toast.success(t('twoFactor.disableSuccess'))
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
      setPassword('')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerateCodes(e: FormEvent) {
    e.preventDefault()
    if (!password || !code) return

    setLoading(true)
    try {
      const codes = await twoFactor.regenerateCodes(password, code)
      setNewCodes(codes)
      setManageStep('view')
      setPassword('')
      setCode('')
      toast.success(t('twoFactor.regenerateSuccess'))
    } catch (err) {
      toast.error((err as Error).message)
      setPassword('')
      setCode('')
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function copyAllCodes(codes: string[]) {
    const text = codes.join('\n')
    copyToClipboard(text)
  }

  if (totpEnabled) {
    // Management view
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      >
        <div
          className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-success/15 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-success" />
              </div>
              <h2 className="text-base font-semibold text-text-primary">{t('twoFactor.title')}</h2>
            </div>

            {manageStep === 'view' && (
              <>
                <div className="mb-6 p-4 bg-success/10 border border-success/20 rounded-lg">
                  <p className="text-sm text-success font-medium">{t('twoFactor.activeStatus')}</p>
                  <p className="text-xs text-text-secondary mt-1">{t('twoFactor.activeDescription')}</p>
                </div>

                {newCodes.length > 0 && (
                  <div className="mb-6 p-4 bg-warning/10 border border-warning/20 rounded-lg">
                    <p className="text-sm text-warning font-medium mb-3">{t('twoFactor.newCodesGenerated')}</p>
                    <div className="space-y-2">
                      {newCodes.map((code, i) => (
                        <div key={i} className="font-mono text-xs text-text-primary bg-surface px-2 py-1.5 rounded">
                          {code}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => copyAllCodes(newCodes)}
                      className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 text-xs bg-warning/20 hover:bg-warning/30 text-warning rounded transition-colors"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? t('common.copied') : t('common.copyAll')}
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <button
                    onClick={() => setManageStep('regenerate-pw')}
                    className="w-full px-4 py-2 text-sm bg-overlay hover:bg-overlay/80 text-text-primary rounded-lg transition-colors text-left"
                  >
                    {t('twoFactor.regenerateCodes')}
                  </button>
                  <button
                    onClick={() => setManageStep('disable-pw')}
                    className="w-full px-4 py-2 text-sm bg-danger/10 hover:bg-danger/20 text-danger rounded-lg transition-colors text-left"
                  >
                    {t('twoFactor.disable')}
                  </button>
                </div>

                <div className="flex gap-2 justify-end pt-4">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
                  >
                    {t('common.close')}
                  </button>
                </div>
              </>
            )}

            {manageStep === 'regenerate-pw' && (
              <>
                <p className="text-sm text-text-secondary mb-4">{t('twoFactor.regeneratePrompt')}</p>
                <form onSubmit={handleRegenerateCodes} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      {t('common.password')}
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoFocus
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      {t('twoFactor.currentCode')}
                    </label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.trim())}
                      placeholder="000000"
                      autoComplete="one-time-code"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                    />
                    <p className="text-xs text-text-muted mt-1">{t('twoFactor.currentCodeHint')}</p>
                  </div>

                  <div className="flex gap-2 justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => { setManageStep('view'); setPassword(''); setCode('') }}
                      className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={!password || !code || loading}
                      className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                    >
                      {loading ? t('common.loading') : t('twoFactor.regenerate')}
                    </button>
                  </div>
                </form>
              </>
            )}

            {manageStep === 'disable-pw' && (
              <>
                <p className="text-sm text-text-secondary mb-4">{t('twoFactor.disablePrompt')}</p>
                <form onSubmit={handleDisable} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      {t('common.password')}
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoFocus
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      {t('twoFactor.currentCode')}
                    </label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value.trim())}
                      placeholder="000000"
                      autoComplete="one-time-code"
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                    />
                    <p className="text-xs text-text-muted mt-1">{t('twoFactor.currentCodeHint')}</p>
                  </div>

                  <div className="flex gap-2 justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => { setManageStep('view'); setPassword(''); setCode('') }}
                      className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={!password || !code || loading}
                      className="px-4 py-2 text-sm bg-danger hover:bg-danger/90 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                    >
                      {loading ? t('common.loading') : t('twoFactor.disableConfirm')}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Setup wizard
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">{t('twoFactor.setupTitle')}</h2>
          </div>

          {setupStep === 'intro' && (
            <>
              <p className="text-sm text-text-secondary mb-4">{t('twoFactor.setupDescription')}</p>
              <p className="text-xs text-text-muted mb-6">{t('twoFactor.setupHint')}</p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => setSetupStep('qr')}
                  className="flex-1 px-4 py-2 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                >
                  {t('twoFactor.enable')}
                </button>
              </div>
            </>
          )}

          {setupStep === 'qr' && (
            <>
              <p className="text-sm text-text-secondary mb-4">{t('twoFactor.qrDescription')}</p>

              {qrDataUrl && (
                <div className="flex justify-center mb-4">
                  <img src={qrDataUrl} alt="TOTP QR Code" className="w-48 h-48 bg-white p-2 rounded-lg" />
                </div>
              )}

              {!qrDataUrl && (
                <div className="flex justify-center mb-4">
                  <div className="w-48 h-48 bg-surface rounded-lg flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  </div>
                </div>
              )}

              {qrUri && (
                <>
                  <div className="mb-4 p-3 bg-surface border border-border rounded-lg">
                    <p className="text-xs text-text-muted mb-2">{t('twoFactor.manualKey')}</p>
                    <p className="font-mono text-sm text-text-primary break-all">{qrUri.split('secret=')[1]?.split('&')[0]}</p>
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSetupStep('intro')}
                  className="flex-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
                  disabled={loading}
                >
                  {t('common.back')}
                </button>
                <button
                  type="button"
                  onClick={() => setSetupStep('verify')}
                  className="flex-1 px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  disabled={!qrUri || loading}
                >
                  {t('common.next')}
                </button>
              </div>
            </>
          )}

          {setupStep === 'verify' && (
            <>
              <p className="text-sm text-text-secondary mb-4">{t('twoFactor.verifyDescription')}</p>

              <form onSubmit={handleVerifySetup} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    {t('twoFactor.verifyCode')}
                  </label>
                  <input
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    maxLength={6}
                    inputMode="numeric"
                    autoFocus
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-center font-mono text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setSetupStep('qr'); setVerifyCode('') }}
                    className="flex-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
                    disabled={loading}
                  >
                    {t('common.back')}
                  </button>
                  <button
                    type="submit"
                    disabled={verifyCode.length !== 6 || loading}
                    className="flex-1 px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  >
                    {loading ? t('common.loading') : t('common.verify')}
                  </button>
                </div>
              </form>
            </>
          )}

          {setupStep === 'backup' && (
            <>
              <p className="text-sm text-text-secondary mb-4">{t('twoFactor.backupDescription')}</p>

              <div className="mb-4 p-4 bg-warning/10 border border-warning/20 rounded-lg">
                <p className="text-xs text-warning font-medium mb-3">{t('twoFactor.backupWarning')}</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {backupCodes.map((code, i) => (
                    <div key={i} className="font-mono text-xs text-text-primary bg-surface px-2 py-1 rounded">
                      {code}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => copyAllCodes(backupCodes)}
                className="w-full flex items-center justify-center gap-2 mb-3 px-3 py-2 text-sm bg-accent/10 hover:bg-accent/20 text-accent rounded-lg transition-colors"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? t('common.copied') : t('common.copyAll')}
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
                >
                  {t('common.done')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
