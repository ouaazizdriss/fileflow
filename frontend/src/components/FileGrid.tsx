import { MouseEvent, useState } from 'react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '../store'
import type { FileEntry } from '../types'
import { formatSize, getFileIcon } from '../utils'

interface Props {
  onContextMenu: (e: MouseEvent, entry: FileEntry) => void
  onOpen: (entry: FileEntry) => void
  onDropInto?: (folderPath: string, files: File[]) => void
}

export default function FileGrid({ onContextMenu, onOpen, onDropInto }: Props) {
  const { t } = useTranslation()
  const { entries, selectedPaths, isLoading, select, toggleSelect, rangeSelect } = useFileStore()
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="p-4 grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
        {[...Array(16)].map((_, i) => (
          <div key={i} className="h-[140px] bg-surface rounded-xl animate-pulse" />
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
        <p className="text-sm">{t('fileGrid.emptyFolder')}</p>
      </div>
    )
  }

  function handleClick(e: MouseEvent, entry: FileEntry) {
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(entry.path)
    } else if (e.shiftKey) {
      rangeSelect(entry.path)
    } else {
      select(entry.path)
    }
  }

  function handleDoubleClick(e: MouseEvent, entry: FileEntry) {
    e.stopPropagation()
    onOpen(entry)
  }

  return (
    <div
      className="p-4 grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2.5 content-start"
      onClick={() => useFileStore.getState().clearSelection()}
    >
      {entries.map((entry) => {
        const { Icon, color } = getFileIcon(entry)
        const selected = selectedPaths.has(entry.path)
        const isDropTarget = dragOverPath === entry.path

        return (
          <div
            key={entry.path}
            className={clsx(
              'group relative flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer select-none transition-all duration-100',
              selected
                ? 'bg-accent/15 ring-1 ring-accent/40'
                : isDropTarget
                  ? 'bg-accent/10 ring-2 ring-accent scale-105'
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
            {/* Selection indicator */}
            {selected && (
              <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}

            {/* Drop-into indicator */}
            {isDropTarget && (
              <div className="absolute inset-0 rounded-xl border-2 border-dashed border-accent pointer-events-none" />
            )}

            {/* Icon */}
            <div className={clsx(
              'w-14 h-14 rounded-xl flex items-center justify-center transition-transform duration-100',
              entry.is_dir ? 'bg-yellow-400/10' : 'bg-elevated',
              'group-hover:scale-105',
            )}>
              <Icon className={clsx('w-7 h-7', color)} />
            </div>

            {/* Name */}
            <span className="text-xs text-text-primary text-center line-clamp-2 leading-tight w-full break-all">
              {entry.name}
            </span>

            {/* Meta */}
            <span className="text-[10px] text-text-muted">
              {entry.is_dir ? '—' : formatSize(entry.size)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
