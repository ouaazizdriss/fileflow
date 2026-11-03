import { useState } from 'react'
import { Loader2, UserPlus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { internalShares as api } from '../api'
import type { FileEntry } from '../types'
import { getFileIcon } from '../utils'
import clsx from 'clsx'

interface Props {
  file: FileEntry
  onClose: () => void
}

export default function InternalShareDialog({ file, onClose }: Props) {
  const { t } = useTranslation()
  const { Icon, color } = getFileIcon(file)

  const [recipient, setRecipient] = useState('')
  const [canWrite, setCanWrite] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleShare() {
    const user = recipient.trim()
    if (!user) return
    setSubmitting(true)
    try {
      await api.create(file.path, user, canWrite)
      toast.success(t('internalShare.shared', { user }))
      onClose()
    } catch (e) {
      toast.error((e as Error).message || 'Failed to share')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl flex flex-col animate-scale-in overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
          <UserPlus className="w-4 h-4 text-accent flex-shrink-0" />
          <span className="text-sm font-semibold text-text-primary flex-1">{t('internalShare.dialogTitle')}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-elevated text-text-muted hover:text-text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Target info */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-elevated rounded-xl">
            <Icon className={clsx('w-5 h-5 flex-shrink-0', color)} />
            <span className="text-sm text-text-primary font-medium truncate">{file.name}</span>
          </div>

          {/* Recipient */}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('internalShare.recipientLabel')}</p>
            <input
              autoFocus
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && recipient.trim() && !submitting) handleShare() }}
              placeholder={t('internalShare.recipientPlaceholder')}
              className="w-full px-3 py-2.5 bg-elevated border border-border rounded-xl text-sm text-text-primary outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Write toggle */}
          <div className="space-y-2">
            <button
              onClick={() => setCanWrite((v) => !v)}
              className={clsx(
                'w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left',
                canWrite
                  ? 'bg-accent/10 border-accent/40 text-accent'
                  : 'bg-elevated border-border text-text-secondary hover:text-text-primary hover:bg-overlay',
              )}
            >
              <span className="text-sm font-medium flex-1">{t('internalShare.allowEditing')}</span>
              <div className={clsx(
                'w-9 h-5 rounded-full transition-colors flex items-center px-0.5',
                canWrite ? 'bg-accent' : 'bg-border',
              )}>
                <div className={clsx(
                  'w-4 h-4 bg-white rounded-full shadow transition-transform',
                  canWrite ? 'translate-x-4' : 'translate-x-0',
                )} />
              </div>
            </button>
            <p className="text-xs text-text-muted">{t('internalShare.allowEditingHint')}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-elevated rounded-lg transition-colors">
            {t('shareDialog.cancel')}
          </button>
          <button onClick={handleShare} disabled={submitting || !recipient.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {t('internalShare.shareButton')}
          </button>
        </div>
      </div>
    </div>
  )
}
