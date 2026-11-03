import { useEffect, useState } from 'react'
import { Clock, RotateCcw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'
import type { FileEntry, VersionEntry } from '../types'
import { formatDate, formatSize } from '../utils'
import { useFileStore } from '../store'

interface Props {
  file: FileEntry
  onClose: () => void
}

export default function VersionModal({ file, onClose }: Props) {
  const { t } = useTranslation()
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)
  const refresh = useFileStore((s) => s.refresh)

  useEffect(() => { load() }, [file.path])

  async function load() {
    setLoading(true)
    try {
      setVersions(await api.listVersions(file.path))
    } catch {
      toast.error('Failed to load version history')
    } finally {
      setLoading(false)
    }
  }

  async function restore(versionId: string) {
    if (!confirm('Restore this version? The current file will be archived as a new version.')) return
    setRestoring(versionId)
    try {
      await api.restoreVersion(file.path, versionId)
      toast.success('Version restored')
      await refresh()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRestoring(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-xl mx-4 animate-scale-in flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-text-secondary" />
            <div>
              <h2 className="text-base font-semibold text-text-primary">{t('versionModal.title')}</h2>
              <p className="text-xs text-text-muted truncate max-w-[320px]">{file.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-text-muted text-sm gap-2">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              {t('versionModal.loading')}
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-3">
              <Clock className="w-10 h-10 opacity-20" />
              <p className="text-sm">{t('versionModal.noVersions')}</p>
              <p className="text-xs text-center max-w-[260px]">
                {t('versionModal.versionsHint')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {versions.map((v, i) => (
                <li key={v.version_id} className="flex items-center gap-4 px-6 py-3 hover:bg-overlay transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">{formatDate(v.timestamp)}</span>
                      {i === 0 && (
                        <span className="text-xs bg-accent/15 text-accent px-1.5 py-0.5 rounded">
                          {t('versionModal.latest')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted">{formatSize(v.size)}</p>
                  </div>
                  <button
                    onClick={() => restore(v.version_id)}
                    disabled={restoring !== null}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 text-accent hover:bg-accent/10 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t('versionModal.restore')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border text-xs text-text-muted flex-shrink-0">
          {t('versionModal.restoreHint')}
        </div>
      </div>
    </div>
  )
}
