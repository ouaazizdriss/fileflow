import { useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'
import type { TrashEntry } from '../types'
import { basename, formatDateShort } from '../utils'

export default function TrashModal() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<TrashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [emptying, setEmptying] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      setEntries(await api.listTrash())
    } catch {
      toast.error('Failed to load trash')
    } finally {
      setLoading(false)
    }
  }

  async function restore(id: string) {
    setRestoring(id)
    try {
      await api.restoreTrash(id)
      toast.success('Restored')
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRestoring(null)
    }
  }

  async function emptyTrash() {
    if (!confirm(`Permanently delete all ${entries.length} item${entries.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setEmptying(true)
    try {
      await api.emptyTrash()
      toast.success('Trash emptied')
      setEntries([])
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setEmptying(false)
    }
  }

  function daysLeft(deletedAt: string) {
    const ms = Date.now() - new Date(deletedAt).getTime()
    return Math.max(0, 30 - Math.floor(ms / 86400000))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-elevated flex items-center justify-center flex-shrink-0">
          <Trash2 className="w-5 h-5 text-text-secondary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-text-primary leading-tight flex items-center gap-2">
            {t('trashModal.title')}
            {entries.length > 0 && (
              <span className="text-xs text-text-muted bg-overlay px-2 py-0.5 rounded-full">{entries.length}</span>
            )}
          </h1>
          <p className="text-xs text-text-secondary mt-0.5">{t('trashModal.retention')}</p>
        </div>
        {entries.length > 0 && (
          <button
            onClick={emptyTrash}
            disabled={emptying}
            className="text-xs px-3 py-1.5 text-danger hover:bg-danger/10 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
          >
            {emptying ? t('trashModal.emptying') : t('trashModal.emptyTrash')}
          </button>
        )}
      </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-text-muted text-sm gap-2">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              {t('trashModal.loading')}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-3">
              <Trash2 className="w-10 h-10 opacity-20" />
              <p className="text-sm">{t('trashModal.empty')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-6 py-3 hover:bg-overlay transition-colors">
                  <span className="text-xl flex-shrink-0">📄</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate font-medium">
                      {basename(entry.original_path)}
                    </p>
                    <p className="text-xs text-text-muted truncate">{entry.original_path}</p>
                    <p className="text-xs text-text-muted">
                      {t('trashModal.deletedInfo', {
                        date: formatDateShort(entry.deleted_at),
                        days: daysLeft(entry.deleted_at),
                      })}
                    </p>
                  </div>
                  <button
                    onClick={() => restore(entry.id)}
                    disabled={restoring !== null}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 text-accent hover:bg-accent/10 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t('trashModal.restore')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
  )
}
