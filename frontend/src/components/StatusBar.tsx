import { useTranslation } from 'react-i18next'
import { useFileStore } from '../store'
import { formatSize } from '../utils'

export default function StatusBar() {
  const { t } = useTranslation()
  const { entries, selectedPaths, uploads } = useFileStore()

  const dirs = entries.filter((e) => e.is_dir).length
  const fileEntries = entries.filter((e) => !e.is_dir)
  const totalSize = fileEntries.reduce((s, e) => s + e.size, 0)

  const activeUploads = uploads.filter((u) => u.status === 'uploading')

  return (
    <footer className="flex-shrink-0 flex items-center justify-between px-4 py-1.5 border-t border-border bg-surface text-xs text-text-muted">
      <div className="flex items-center gap-3">
        <span>
          {dirs > 0 && t('common.folder', { count: dirs })}
          {dirs > 0 && fileEntries.length > 0 && ', '}
          {fileEntries.length > 0 && t('common.file', { count: fileEntries.length })}
          {entries.length === 0 && t('statusBar.emptyFolder')}
        </span>
        {totalSize > 0 && (
          <span className="text-text-muted/60">· {formatSize(totalSize)}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {activeUploads.length > 0 && (
          <span className="text-accent animate-pulse">
            {t('statusBar.uploading', { count: activeUploads.length })}
          </span>
        )}
        {selectedPaths.size > 0 && (
          <span className="text-text-secondary">
            {t('statusBar.selected', { count: selectedPaths.size })}
          </span>
        )}
      </div>
    </footer>
  )
}
