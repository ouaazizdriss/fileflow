import { useEffect, useState } from 'react'
import { Check, Copy, Link2, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { uploadRequests as api } from '../api'
import type { UploadRequestView } from '../types'
import { formatDate } from '../utils'

interface Props {
  onNew?: () => void
}

export default function UploadRequestsManager({ onNew }: Props) {
  const { t } = useTranslation()
  const [items, setItems] = useState<UploadRequestView[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  useEffect(() => {
    api.list()
      .then(setItems)
      .catch(() => toast.error('Failed to load upload requests'))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(token: string) {
    if (!confirm('Revoke this upload link? People with the link will no longer be able to upload.')) return
    await api.delete(token).catch(() => { toast.error('Delete failed'); return })
    setItems((prev) => prev.filter((i) => i.token !== token))
    toast.success('Upload link revoked')
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(api.publicUrl(token)).then(() => {
      setCopiedToken(token)
      setTimeout(() => setCopiedToken(null), 2000)
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
          <Link2 className="w-5 h-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-text-primary leading-tight">{t('uploadRequestsManager.title')}</h1>
          <p className="text-xs text-text-secondary mt-0.5">{t('uploadRequestsManager.footer')}</p>
        </div>
        {onNew && (
          <button onClick={onNew} className="flex items-center gap-1.5 px-3 py-1.5 text-sm btn-brand rounded-lg flex-shrink-0">
            <Plus className="w-4 h-4" /> {t('uploadRequestsManager.new')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-overlay rounded-lg animate-pulse" />)}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-text-muted gap-2 text-sm">
              <Link2 className="w-8 h-8 opacity-40" />
              <p>{t('uploadRequestsManager.noLinks')}</p>
              <p className="text-xs">{t('uploadRequestsManager.noLinksHint')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((item) => (
                <div key={item.token} className={`px-6 py-4 flex items-start gap-4 ${item.is_expired ? 'opacity-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">{item.name}</span>
                      {item.is_expired && (
                        <span className="text-xs bg-danger/10 text-danger px-2 py-0.5 rounded-full flex-shrink-0">{t('uploadRequestsManager.expired')}</span>
                      )}
                      {item.has_password && (
                        <span className="text-xs bg-overlay text-text-muted px-2 py-0.5 rounded-full flex-shrink-0">{t('uploadRequestsManager.password')}</span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted font-mono mt-0.5 truncate">{item.folder_path}</p>
                    <div className="flex items-center gap-3 text-xs text-text-muted mt-1">
                      <span>Created {formatDate(item.created_at)}</span>
                      {item.expires_at && <span>• Expires {formatDate(item.expires_at)}</span>}
                      {!item.expires_at && <span>• {t('common.never')} expires</span>}
                      <span>• by {item.created_by}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => copyLink(item.token)}
                      title="Copy link"
                      className="p-1.5 rounded-md hover:bg-overlay text-text-secondary hover:text-accent transition-colors"
                    >
                      {copiedToken === item.token ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(item.token)}
                      title="Revoke link"
                      className="p-1.5 rounded-md hover:bg-danger/10 text-text-secondary hover:text-danger transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  )
}
