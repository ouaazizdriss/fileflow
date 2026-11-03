import { useEffect, useState } from 'react'
import { Check, Clock, Copy, Download, KeyRound, Link2, Loader2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { shares as api } from '../api'
import type { ShareLink } from '../types'
import { copyToClipboard } from '../utils'

interface Props {
  isAdmin: boolean
}

function timeLeft(expiresAt: string): { label: string; expired: boolean } {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return { label: 'Expired', expired: true }
  const s = Math.floor(diff / 1000)
  if (s < 3600) return { label: `${Math.floor(s / 60)}m left`, expired: false }
  if (s < 86400) return { label: `${Math.floor(s / 3600)}h left`, expired: false }
  return { label: `${Math.floor(s / 86400)}d left`, expired: false }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SharesManager({ isAdmin }: Props) {
  const { t } = useTranslation()
  const [links, setLinks] = useState<ShareLink[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    api.list()
      .then(setLinks)
      .catch((e) => toast.error(e.message || 'Failed to load shares'))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(token: string) {
    setDeleting(token)
    try {
      await api.delete(token)
      setLinks((prev) => prev.filter((l) => l.token !== token))
      toast.success('Share link revoked')
    } catch (e) {
      toast.error((e as Error).message || 'Failed to revoke link')
    } finally {
      setDeleting(null)
    }
  }

  async function handleCopy(token: string) {
    try {
      await copyToClipboard(api.publicUrl(token))
      setCopied(token)
      toast.success('Link copied')
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
          <Link2 className="w-5 h-5 text-accent" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text-primary leading-tight">
            {t('sharesManager.title')}{!loading && ` (${links.length})`}
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">
            {isAdmin ? t('sharesManager.showingAll') : t('sharesManager.showingOwn')}
          </p>
        </div>
      </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-2 text-text-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('sharesManager.loading')}
            </div>
          ) : links.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-text-muted">
              <Link2 className="w-10 h-10 opacity-20" />
              <p className="text-sm">{t('sharesManager.noLinks')}</p>
              <p className="text-xs text-text-muted">{t('sharesManager.noLinksHint')}</p>
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-surface border-b border-border">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">
                    {t('sharesManager.colFile')}
                  </th>
                  {isAdmin && (
                    <th className="text-left px-3 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">
                      {t('sharesManager.colCreatedBy')}
                    </th>
                  )}
                  <th className="text-left px-3 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">
                    {t('sharesManager.colCreated')}
                  </th>
                  <th className="text-left px-3 py-3 text-xs font-semibold text-text-muted uppercase tracking-wider">
                    {t('sharesManager.colExpires')}
                  </th>
                  <th className="px-3 py-3 w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {links.map((link) => {
                  const { label, expired } = timeLeft(link.expires_at)
                  const isCopied = copied === link.token
                  const isDeleting = deleting === link.token
                  return (
                    <tr key={link.token} className={clsx('group transition-colors', expired ? 'opacity-50' : 'hover:bg-elevated/40')}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-text-primary truncate max-w-[200px]" title={link.filename}>
                            {link.filename}
                          </p>
                          {link.has_password && (
                            <span title="Password protected">
                              <KeyRound className="w-3 h-3 text-accent flex-shrink-0" />
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-muted font-mono truncate max-w-[200px]" title={link.file_path}>
                          {link.file_path}
                        </p>
                        <p className="text-[11px] text-text-muted mt-0.5 flex items-center gap-1">
                          <Download className="w-2.5 h-2.5" />
                          {link.max_downloads != null
                            ? `${link.download_count} / ${link.max_downloads}`
                            : link.download_count}
                        </p>
                      </td>
                      {isAdmin && (
                        <td className="px-3 py-3 text-text-secondary">{link.created_by}</td>
                      )}
                      <td className="px-3 py-3 text-text-muted text-xs whitespace-nowrap">
                        {formatDate(link.created_at)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={clsx(
                          'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                          expired
                            ? 'bg-danger/10 text-danger'
                            : 'bg-green-400/10 text-green-400',
                        )}>
                          <Clock className="w-3 h-3" />
                          {label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!expired && (
                            <button
                              onClick={() => handleCopy(link.token)}
                              title={t('shareDialog.copyLink')}
                              className={clsx(
                                'p-1.5 rounded-lg transition-colors',
                                isCopied
                                  ? 'text-green-400 bg-green-400/10'
                                  : 'text-text-muted hover:text-text-primary hover:bg-overlay',
                              )}
                            >
                              {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(link.token)}
                            disabled={isDeleting}
                            title="Revoke"
                            className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                          >
                            {isDeleting
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Trash2 className="w-3.5 h-3.5" />
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

    </div>
  )
}
