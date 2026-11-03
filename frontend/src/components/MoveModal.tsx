import { useEffect, useState } from 'react'
import { ChevronRight, Copy, Scissors, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'
import { useFileStore } from '../store'
import type { DirectoryListing } from '../types'
import { basename } from '../utils'

export default function MoveModal() {
  const { t } = useTranslation()
  const { clipboard, closeModal, refresh, currentPath } = useFileStore()
  const [currentDir, setCurrentDir] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [moving, setMoving] = useState(false)
  const [breadcrumb, setBreadcrumb] = useState<string[]>([''])

  const op = clipboard?.operation

  useEffect(() => {
    loadDir(currentPath)
  }, [currentPath])

  async function loadDir(path: string) {
    setLoading(true)
    try {
      setCurrentDir(await api.list(path))
      setBreadcrumb(path === '/' ? [''] : path.split('/').filter(Boolean))
    } catch {
      toast.error('Failed to load directory')
    } finally {
      setLoading(false)
    }
  }

  function getPathAt(index: number): string {
    if (index === 0) return '/'
    return '/' + breadcrumb.slice(0, index).join('/')
  }

  function navigate(path: string) {
    loadDir(path)
  }

  async function handleMove() {
    if (!clipboard) return
    setMoving(true)
    try {
      const dest = currentDir?.path || '/'
      if (clipboard.paths.some(p => p === dest || p.startsWith(dest + '/'))) {
        toast.error('Cannot move item into itself')
        setMoving(false)
        return
      }

      if (op === 'cut') {
        await api.move(clipboard.paths, dest)
      } else {
        // Copy operation would require new API, for now only move is supported
        toast.error('Copy operation not yet supported in move dialog')
        setMoving(false)
        return
      }

      await refresh()
      toast.success(`${clipboard.paths.length} item${clipboard.paths.length !== 1 ? 's' : ''} moved`)
      closeModal()
    } catch (err) {
      toast.error((err as Error).message || 'Failed to move items')
      setMoving(false)
    }
  }

  const folders = currentDir?.entries.filter(e => e.is_dir) ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-md animate-scale-in flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            {op === 'cut' ? (
              <Scissors className="w-5 h-5 text-danger" />
            ) : (
              <Copy className="w-5 h-5 text-accent" />
            )}
            <h2 className="text-base font-semibold text-text-primary">
              {op === 'cut' ? t('moveModal.moveTitle') : t('moveModal.copyTitle')}
            </h2>
          </div>
          <button
            onClick={closeModal}
            className="p-1.5 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Items being moved */}
        <div className="px-6 py-3 border-b border-border bg-overlay/50 flex-shrink-0">
          <p className="text-xs text-text-muted mb-2">
            {clipboard?.paths.length === 1
              ? t('moveModal.movingOneFile')
              : t('moveModal.movingFiles', { count: clipboard?.paths.length })}
          </p>
          <div className="space-y-1 max-h-20 overflow-y-auto">
            {clipboard?.paths.map(path => (
              <p key={path} className="text-xs text-text-secondary truncate">
                📄 {basename(path)}
              </p>
            ))}
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-1.5 flex-shrink-0 overflow-x-auto">
          {breadcrumb.map((segment, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <button
                onClick={() => navigate(getPathAt(i))}
                className={`text-xs px-2 py-1 rounded transition-colors whitespace-nowrap ${
                  i === breadcrumb.length - 1
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-overlay'
                }`}
              >
                {i === 0 ? '/' : segment}
              </button>
              {i < breadcrumb.length - 1 && <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />}
            </div>
          ))}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-muted">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
              {t('moveModal.loading')}
            </div>
          ) : folders.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              {t('moveModal.noFolders')}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {folders.map(folder => (
                <li
                  key={folder.path}
                  onClick={() => navigate(folder.path)}
                  className="flex items-center gap-3 px-6 py-3 hover:bg-overlay cursor-pointer transition-colors"
                >
                  <span className="text-lg">📁</span>
                  <span className="flex-1 text-sm text-text-primary truncate">{folder.name}</span>
                  <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-3 flex gap-2 flex-shrink-0">
          <button
            onClick={closeModal}
            className="flex-1 px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleMove}
            disabled={!clipboard?.paths.length || moving || op === 'copy'}
            className="flex-1 px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {moving ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('moveModal.moving')}
              </>
            ) : op === 'cut' ? (
              t('moveModal.moveHere')
            ) : (
              t('moveModal.copyHere')
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
