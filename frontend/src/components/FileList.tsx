import { MouseEvent, useState } from 'react'
import clsx from 'clsx'
import { ArrowDownUp, ArrowUp, ArrowDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '../store'
import type { FileEntry, SortField } from '../types'
import { formatSize, formatDate, getFileIcon } from '../utils'

interface Props {
  onContextMenu: (e: MouseEvent, entry: FileEntry) => void
  onOpen: (entry: FileEntry) => void
  onDropInto?: (folderPath: string, files: File[]) => void
}

export default function FileList({ onContextMenu, onOpen, onDropInto }: Props) {
  const { t } = useTranslation()
  const {
    entries,
    selectedPaths,
    isLoading,
    sortField,
    sortOrder,
    select,
    toggleSelect,
    rangeSelect,
    setSort,
  } = useFileStore()
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="divide-y divide-border">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <div className="w-4 h-4 bg-elevated rounded animate-pulse" />
            <div className="w-5 h-5 bg-elevated rounded animate-pulse" />
            <div className="h-3 bg-elevated rounded animate-pulse flex-1" />
            <div className="h-3 bg-elevated rounded animate-pulse w-16" />
            <div className="h-3 bg-elevated rounded animate-pulse w-32" />
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted gap-3 select-none">
        <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center">
          <span className="text-3xl">📂</span>
        </div>
        <p className="text-sm">{t('fileList.emptyFolder')}</p>
      </div>
    )
  }

  // A render helper, not a component: a component declared here would be a new
  // type on every render and remount each time.
  function sortIcon(field: SortField) {
    if (sortField !== field) return <ArrowDownUp className="w-3 h-3 opacity-30" />
    return sortOrder === 'asc'
      ? <ArrowUp className="w-3 h-3 text-accent" />
      : <ArrowDown className="w-3 h-3 text-accent" />
  }

  function handleClick(e: MouseEvent, entry: FileEntry) {
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey) toggleSelect(entry.path)
    else if (e.shiftKey) rangeSelect(entry.path)
    else select(entry.path)
  }

  function handleDoubleClick(e: MouseEvent, entry: FileEntry) {
    e.stopPropagation()
    onOpen(entry)
  }

  return (
    <div
      className="flex flex-col"
      onClick={() => useFileStore.getState().clearSelection()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface/50 sticky top-0">
        <div className="w-4 h-4" />
        <div className="w-5 h-5" />
        <button
          onClick={() => setSort('name')}
          className="flex items-center gap-1.5 flex-1 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          {t('common.name')} {sortIcon('name')}
        </button>
        <button
          onClick={() => setSort('type')}
          className="hidden md:flex items-center gap-1.5 w-20 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          {t('common.type')} {sortIcon('type')}
        </button>
        <button
          onClick={() => setSort('size')}
          className="flex items-center gap-1.5 w-20 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          {t('common.size')} {sortIcon('size')}
        </button>
        <button
          onClick={() => setSort('modified')}
          className="hidden lg:flex items-center gap-1.5 w-36 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          {t('common.modified')} {sortIcon('modified')}
        </button>
      </div>

      {/* Rows */}
      {entries.map((entry) => {
        const { Icon, color } = getFileIcon(entry)
        const selected = selectedPaths.has(entry.path)
        const isDropTarget = dragOverPath === entry.path

        return (
          <div
            key={entry.path}
            className={clsx(
              'relative flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none border-b border-border/40 transition-colors',
              selected
                ? 'bg-accent/10'
                : isDropTarget
                  ? 'bg-accent/10 ring-1 ring-accent'
                  : 'hover:bg-surface',
            )}
            onClick={(e) => handleClick(e, entry)}
            onDoubleClick={(e) => handleDoubleClick(e, entry)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (!selectedPaths.has(entry.path)) select(entry.path)
              onContextMenu(e, entry)
            }}
            onDragOver={(e) => {
              if (!entry.is_dir) return
              e.preventDefault()
              e.stopPropagation()
              setDragOverPath(entry.path)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverPath(null)
              }
            }}
            onDrop={(e) => {
              if (!entry.is_dir) return
              e.preventDefault()
              e.stopPropagation()
              setDragOverPath(null)
              const dropped = Array.from(e.dataTransfer.files)
              if (dropped.length > 0) onDropInto?.(entry.path, dropped)
            }}
          >
            {/* Drop-into indicator */}
            {isDropTarget && (
              <div className="absolute inset-0 border-l-2 border-accent pointer-events-none" />
            )}

            {/* Checkbox */}
            <div
              onClick={(e) => { e.stopPropagation(); toggleSelect(entry.path) }}
              className={clsx(
                'w-4 h-4 rounded flex-shrink-0 border transition-colors flex items-center justify-center',
                selected
                  ? 'bg-accent border-accent'
                  : 'border-border-strong hover:border-accent/50',
              )}
            >
              {selected && (
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>

            {/* Icon */}
            <Icon className={clsx('w-4 h-4 flex-shrink-0', color)} />

            {/* Name */}
            <span className="flex-1 text-sm text-text-primary truncate font-medium">
              {entry.name}
            </span>

            {/* Type */}
            <span className="hidden md:block w-20 text-xs text-text-muted truncate">
              {entry.is_dir ? t('fileList.folder') : (entry.extension?.toUpperCase() ?? '—')}
            </span>

            {/* Size */}
            <span className="w-20 text-xs text-text-muted text-right">
              {entry.is_dir ? '—' : formatSize(entry.size)}
            </span>

            {/* Modified */}
            <span className="hidden lg:block w-36 text-xs text-text-muted text-right">
              {formatDate(entry.modified)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
