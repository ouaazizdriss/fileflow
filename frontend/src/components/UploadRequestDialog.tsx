import { useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { uploadRequests as api } from '../api'
import type { FileEntry, UploadRequestView } from '../types'
import { formatDate } from '../utils'

interface Props {
  folder: FileEntry
  onClose: () => void
}

export default function UploadRequestDialog({ folder, onClose }: Props) {
  const { t } = useTranslation()

  const EXPIRY_PRESETS = [
    { label: '1 day', secs: 86400 },
    { label: '7 days', secs: 7 * 86400 },
    { label: '30 days', secs: 30 * 86400 },
    { label: t('uploadRequestDialog.never'), secs: null },
  ]

  const [name, setName] = useState(`Upload to ${folder.name}`)
  const [expirySecs, setExpirySecs] = useState<number | null>(7 * 86400)
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<UploadRequestView | null>(null)
  const [copied, setCopied] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const ur = await api.create(
        name.trim(),
        folder.path,
        expirySecs ?? undefined,
        password || undefined,
      )
      setCreated(ur)
    } catch (err) {
      toast.error((err as Error).message || 'Failed to create upload request')
    } finally {
      setSaving(false)
    }
  }

  function copyLink() {
    if (!created) return
    const url = api.publicUrl(created.token)
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">{t('uploadRequestDialog.title')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-overlay text-text-secondary hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {!created ? (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary">
                {t('uploadRequestDialog.description')} <span className="font-mono text-text-primary">{folder.path}</span>.
              </p>

              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">{t('uploadRequestDialog.label')}</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-overlay border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">{t('uploadRequestDialog.expires')}</label>
                <div className="flex gap-1.5 flex-wrap">
                  {EXPIRY_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => setExpirySecs(p.secs)}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${expirySecs === p.secs ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-overlay text-text-secondary hover:bg-border border border-transparent'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">{t('uploadRequestDialog.passwordOptional')}</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('uploadRequestDialog.passwordHint')}
                  className="w-full bg-overlay border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={onClose} className="flex-1 px-3 py-2 text-sm text-text-secondary hover:bg-overlay rounded-lg transition-colors">{t('common.cancel')}</button>
                <button
                  onClick={submit}
                  disabled={!name.trim() || saving}
                  className="flex-1 px-3 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
                >
                  {saving ? t('uploadRequestDialog.creating') : t('uploadRequestDialog.createLink')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-green-400">
                <Check className="w-4 h-4" />
                {t('uploadRequestDialog.created')}
              </div>

              <div className="bg-overlay rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-muted">{t('uploadRequestDialog.shareLink')}</p>
                <p className="text-sm text-text-primary font-mono break-all">{api.publicUrl(created.token)}</p>
              </div>

              <div className="flex items-center gap-3 text-xs text-text-muted">
                {created.expires_at && <span>{t('uploadRequestDialog.expiresAt', { date: formatDate(created.expires_at) })}</span>}
                {created.has_password && <span>• {t('uploadRequestDialog.passwordProtected')}</span>}
              </div>

              <div className="flex gap-2 pt-2">
                <button onClick={onClose} className="flex-1 px-3 py-2 text-sm text-text-secondary hover:bg-overlay rounded-lg transition-colors">{t('common.close')}</button>
                <button
                  onClick={copyLink}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm bg-accent/10 hover:bg-accent/20 text-accent rounded-lg transition-colors"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? t('common.copied') : t('uploadRequestDialog.copyLink')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
