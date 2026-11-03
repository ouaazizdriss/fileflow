import { useState } from 'react'
import { Check, Copy, Download, ExternalLink, KeyRound, Link2, Loader2, RefreshCw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { shares as api } from '../api'
import type { FileEntry, ShareLink } from '../types'
import { copyToClipboard, getFileIcon } from '../utils'
import clsx from 'clsx'

interface Props {
  file: FileEntry
  onClose: () => void
}

const PWD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function clampDownloads(raw: string): number {
  return Math.max(1, parseInt(raw, 10) || 1)
}

function generatePassword(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => PWD_CHARS[b % PWD_CHARS.length]).join('')
}

export default function ShareDialog({ file, onClose }: Props) {
  const { t } = useTranslation()
  const { Icon, color } = getFileIcon(file)

  const PRESETS = [
    { label: t('shareDialog.duration_1h'),  secs: 3600 },
    { label: t('shareDialog.duration_24h'), secs: 86400 },
    { label: t('shareDialog.duration_7d'),  secs: 7 * 86400 },
    { label: t('shareDialog.duration_30d'), secs: 30 * 86400 },
    { label: t('shareDialog.duration_1y'),  secs: 365 * 86400 },
  ]

  const [selectedSecs, setSelectedSecs] = useState(PRESETS[2].secs)
  const [usePassword, setUsePassword]   = useState(false)
  const [password, setPassword]         = useState(generatePassword)
  const [limitDownloads, setLimitDownloads] = useState(false)
  // Kept as the raw input text so the field can be cleared and retyped;
  // clamped to >= 1 on blur and when the link is created.
  const [maxDownloads, setMaxDownloads]     = useState('1')

  const [link, setLink]       = useState<ShareLink | null>(null)
  const [creating, setCreating] = useState(false)

  const [copiedUrl, setCopiedUrl] = useState(false)
  const [copiedPwd, setCopiedPwd] = useState(false)

  async function handleCreate() {
    setCreating(true)
    try {
      const created = await api.create(
        file.path,
        selectedSecs,
        usePassword ? password : undefined,
        limitDownloads ? clampDownloads(maxDownloads) : null,
      )
      setLink(created)
    } catch (e) {
      toast.error((e as Error).message || 'Failed to create share link')
    } finally {
      setCreating(false)
    }
  }

  async function handleCopyUrl() {
    if (!link) return
    try {
      await copyToClipboard(api.publicUrl(link.token))
      setCopiedUrl(true)
      toast.success('Link copied')
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  async function handleCopyPwd() {
    try {
      await copyToClipboard(password)
      setCopiedPwd(true)
      toast.success('Password copied')
      setTimeout(() => setCopiedPwd(false), 2000)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const publicUrl  = link ? api.publicUrl(link.token) : ''
  const expiresAt  = link ? new Date(link.expires_at) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl flex flex-col animate-scale-in overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <Link2 className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="text-sm font-semibold text-text-primary flex-1">{t('shareDialog.title')}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-elevated text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">

          {/* File info */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-elevated rounded-xl">
            <Icon className={clsx('w-5 h-5 flex-shrink-0', color)} />
            <span className="text-sm text-text-primary font-medium truncate">{file.name}</span>
          </div>

          {/* Options — only before link is created */}
          {!link && (
            <>
              {/* Expiry */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('shareDialog.expiresIn')}</p>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.secs}
                      onClick={() => setSelectedSecs(p.secs)}
                      className={clsx(
                        'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                        selectedSecs === p.secs
                          ? 'bg-accent text-white'
                          : 'bg-elevated text-text-secondary hover:bg-overlay hover:text-text-primary',
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Password toggle */}
              <div className="space-y-3">
                <button
                  onClick={() => setUsePassword((v) => !v)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left',
                    usePassword
                      ? 'bg-accent/10 border-accent/40 text-accent'
                      : 'bg-elevated border-border text-text-secondary hover:text-text-primary hover:bg-overlay',
                  )}
                >
                  <KeyRound className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-medium flex-1">{t('shareDialog.passwordProtect')}</span>
                  <div className={clsx(
                    'w-9 h-5 rounded-full transition-colors flex items-center px-0.5',
                    usePassword ? 'bg-accent' : 'bg-border',
                  )}>
                    <div className={clsx(
                      'w-4 h-4 bg-white rounded-full shadow transition-transform',
                      usePassword ? 'translate-x-4' : 'translate-x-0',
                    )} />
                  </div>
                </button>

                {usePassword && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('shareDialog.generatedPassword')}</p>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-elevated rounded-xl border border-border">
                      <span className="flex-1 font-mono text-sm text-text-primary tracking-wide select-all">
                        {password}
                      </span>
                      <button
                        onClick={() => setPassword(generatePassword())}
                        title={t('shareDialog.regenerate')}
                        className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-overlay transition-colors flex-shrink-0"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={handleCopyPwd}
                        title={t('shareDialog.copyPassword')}
                        className={clsx(
                          'p-1.5 rounded-lg transition-colors flex-shrink-0',
                          copiedPwd ? 'text-green-400 bg-green-400/10' : 'text-text-muted hover:text-text-primary hover:bg-overlay',
                        )}
                      >
                        {copiedPwd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-xs text-text-muted">
                      {t('shareDialog.passwordWarning')}
                    </p>
                  </div>
                )}
              </div>

              {/* Download limit */}
              <div className="space-y-3">
                <button
                  onClick={() => setLimitDownloads((v) => !v)}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left',
                    limitDownloads
                      ? 'bg-accent/10 border-accent/40 text-accent'
                      : 'bg-elevated border-border text-text-secondary hover:text-text-primary hover:bg-overlay',
                  )}
                >
                  <Download className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-medium flex-1">{t('shareDialog.limitDownloads')}</span>
                  <div className={clsx(
                    'w-9 h-5 rounded-full transition-colors flex items-center px-0.5',
                    limitDownloads ? 'bg-accent' : 'bg-border',
                  )}>
                    <div className={clsx(
                      'w-4 h-4 bg-white rounded-full shadow transition-transform',
                      limitDownloads ? 'translate-x-4' : 'translate-x-0',
                    )} />
                  </div>
                </button>

                {limitDownloads && (
                  <div className="flex items-center gap-2 px-1">
                    <label className="text-sm text-text-secondary flex-1">{t('shareDialog.maxDownloads')}</label>
                    <input
                      type="number"
                      min={1}
                      value={maxDownloads}
                      onChange={(e) => setMaxDownloads(e.target.value)}
                      onBlur={() => setMaxDownloads(String(clampDownloads(maxDownloads)))}
                      className="w-20 px-2.5 py-1.5 bg-elevated border border-border rounded-lg text-sm text-text-primary text-center outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {/* Created link */}
          {link && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('shareDialog.shareUrl')}</p>
                <div className="flex items-center gap-2 px-3 py-2.5 bg-elevated rounded-xl border border-border">
                  <input
                    readOnly
                    value={publicUrl}
                    className="flex-1 bg-transparent text-xs text-text-secondary font-mono outline-none min-w-0"
                    onFocus={(e) => e.target.select()}
                  />
                  <button onClick={handleCopyUrl} title={t('shareDialog.copyLink')}
                    className={clsx('flex-shrink-0 p-1.5 rounded-lg transition-colors',
                      copiedUrl ? 'text-green-400 bg-green-400/10' : 'text-text-muted hover:text-text-primary hover:bg-overlay')}>
                    {copiedUrl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer" title={t('shareDialog.openNewTab')}
                    className="flex-shrink-0 p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-overlay transition-colors">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </div>

              {link.has_password && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <KeyRound className="w-3 h-3" /> {t('shareDialog.passwordLabel')}
                  </p>
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-elevated rounded-xl border border-accent/30">
                    <span className="flex-1 font-mono text-sm text-text-primary tracking-wide select-all">
                      {password}
                    </span>
                    <button onClick={handleCopyPwd} title={t('shareDialog.copyPassword')}
                      className={clsx('flex-shrink-0 p-1.5 rounded-lg transition-colors',
                        copiedPwd ? 'text-green-400 bg-green-400/10' : 'text-text-muted hover:text-text-primary hover:bg-overlay')}>
                      {copiedPwd ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              <p className="text-xs text-text-muted text-center">
                {t('shareDialog.expiresLabel')}{' '}
                <span className="text-text-secondary font-medium">
                  {expiresAt?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                {link.has_password
                  ? t('shareDialog.notePasswordSeparate')
                  : t('shareDialog.notePublic')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          {!link ? (
            <>
              <button onClick={onClose}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-elevated rounded-lg transition-colors">
                {t('shareDialog.cancel')}
              </button>
              <button onClick={handleCreate} disabled={creating}
                className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {t('shareDialog.createLink')}
              </button>
            </>
          ) : (
            <>
              <button onClick={handleCopyUrl}
                className="flex items-center gap-2 px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-elevated rounded-lg transition-colors">
                {copiedUrl ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedUrl ? t('common.copied') : t('shareDialog.copyLinkAction')}
              </button>
              <button onClick={onClose}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">
                {t('shareDialog.done')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
