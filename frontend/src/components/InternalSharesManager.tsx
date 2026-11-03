import { useEffect, useState } from 'react'
import { Download, FolderOpen, Loader2, Pencil, Share2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { internalShares as api, files as filesApi } from '../api'
import type { InternalShare } from '../types'
import { useFileStore } from '../store'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function InternalSharesManager() {
  const { t } = useTranslation()
  const navigate = useFileStore((s) => s.navigate)
  const [owned, setOwned] = useState<InternalShare[]>([])
  const [received, setReceived] = useState<InternalShare[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    api.list()
      .then((r) => { setOwned(r.owned); setReceived(r.received) })
      .catch((e) => toast.error(e.message || 'Failed to load shares'))
      .finally(() => setLoading(false))
  }, [])

  async function handleRemove(id: string) {
    setRemoving(id)
    try {
      await api.delete(id)
      setOwned((p) => p.filter((s) => s.id !== id))
      setReceived((p) => p.filter((s) => s.id !== id))
      toast.success(t('internalShare.revoked'))
    } catch (e) {
      toast.error((e as Error).message || 'Failed to remove share')
    } finally {
      setRemoving(null)
    }
  }

  function openShare(share: InternalShare) {
    if (share.is_dir) {
      navigate(share.path) // navigate() switches the main pane back to the file browser
    } else {
      const a = document.createElement('a')
      a.href = filesApi.downloadUrl(share.path)
      a.download = share.name
      a.click()
    }
  }

  // A render helper, not a component: a component declared here would be a new
  // type on every render and remount each row each time.
  function renderShareRow(share: InternalShare, side: 'received' | 'owned') {
    const counterparty = side === 'received' ? share.owner : share.recipient
    const counterLabel = side === 'received'
      ? t('internalShare.from', { user: counterparty })
      : t('internalShare.to', { user: counterparty })
    return (
      <div key={share.id} className="flex items-center gap-3 px-5 py-3 hover:bg-elevated/50 transition-colors">
        {share.is_dir
          ? <FolderOpen className="w-5 h-5 text-accent flex-shrink-0" />
          : <Share2 className="w-5 h-5 text-text-muted flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-primary font-medium truncate">{share.name}</span>
            <span className={clsx(
              'text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center gap-1',
              share.can_write ? 'bg-accent/15 text-accent' : 'bg-overlay text-text-muted',
            )}>
              {share.can_write
                ? <><Pencil className="w-2.5 h-2.5" /> {t('internalShare.canEdit')}</>
                : t('internalShare.readOnly')}
            </span>
          </div>
          <p className="text-xs text-text-muted truncate">
            {counterLabel} · {formatDate(share.created_at)}
          </p>
        </div>
        <button
          onClick={() => openShare(share)}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-overlay transition-colors flex-shrink-0"
          title={share.is_dir ? t('internalShare.open') : t('internalShare.download')}
        >
          {share.is_dir ? <FolderOpen className="w-4 h-4" /> : <Download className="w-4 h-4" />}
        </button>
        <button
          onClick={() => handleRemove(share.id)}
          disabled={removing === share.id}
          className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0"
          title={side === 'received' ? t('internalShare.remove') : t('internalShare.revoke')}
        >
          {removing === share.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
          <Share2 className="w-5 h-5 text-accent" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text-primary leading-tight">{t('internalShare.managerTitle')}</h1>
          <p className="text-xs text-text-secondary mt-0.5">{t('internalShare.managerSubtitle')}</p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-2 text-text-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <>
              {/* Shared with me */}
              <div className="px-5 py-2.5 bg-elevated/40 border-b border-border">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {t('internalShare.sharedWithMe')} ({received.length})
                </span>
              </div>
              {received.length === 0 ? (
                <p className="px-5 py-6 text-sm text-text-muted">{t('internalShare.emptyReceived')}</p>
              ) : (
                <div className="divide-y divide-border">
                  {received.map((s) => renderShareRow(s, 'received'))}
                </div>
              )}

              {/* Shared by me */}
              <div className="px-5 py-2.5 bg-elevated/40 border-y border-border">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  {t('internalShare.sharedByMe')} ({owned.length})
                </span>
              </div>
              {owned.length === 0 ? (
                <p className="px-5 py-6 text-sm text-text-muted">{t('internalShare.emptyOwned')}</p>
              ) : (
                <div className="divide-y divide-border">
                  {owned.map((s) => renderShareRow(s, 'owned'))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
  )
}
