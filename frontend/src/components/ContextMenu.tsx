import { useEffect, useRef } from 'react'
import {
  Clipboard,
  Clock,
  Copy,
  Download,
  Eye,
  FilePen,
  FolderInput,
  Plus,
  Scissors,
  Share2,
  Star,
  StarOff,
  Tag,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'
import { useFileStore } from '../store'
import type { FileEntry } from '../types'
import { copyToClipboard } from '../utils'

interface Props {
  x: number
  y: number
  entry: FileEntry
  onClose: () => void
  onShare?: (entry: FileEntry) => void
  onInternalShare?: (entry: FileEntry) => void
  onCollabFolder?: (entry: FileEntry) => void
  onUploadRequest?: (entry: FileEntry) => void
}

export default function ContextMenu({ x, y, entry, onClose, onShare, onInternalShare, onCollabFolder, onUploadRequest }: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const { selectedPaths, openModal, openViewer, setClipboard, setPreviewFile, isFavorite, toggleFavorite } = useFileStore()
  const starred = isFavorite(entry.path)

  const selectedCount = selectedPaths.size
  const isMulti = selectedCount > 1 && selectedPaths.has(entry.path)

  useEffect(() => {
    function close(e: Event) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    setTimeout(() => {
      document.addEventListener('mousedown', close)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Clamp to viewport
  useEffect(() => {
    if (!ref.current) return
    const menu = ref.current
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (rect.right > vw) menu.style.left = `${x - rect.width}px`
    if (rect.bottom > vh) menu.style.top = `${y - rect.height}px`
  })

  const typeLabel = entry.is_dir ? t('contextMenu.labelFolder') : t('contextMenu.labelFile')
  const multiLabel = t('common.item', { count: selectedCount })

  const items = [
    ...(!isMulti && !entry.is_dir
      ? [{
          Icon: Eye,
          label: t('contextMenu.open'),
          action: () => { openViewer(entry); onClose() },
        }]
      : []),
    ...(!isMulti && !entry.is_dir
      ? [{
          Icon: Download,
          label: t('contextMenu.download'),
          action: () => {
            const a = document.createElement('a')
            a.href = api.downloadUrl(entry.path)
            a.download = entry.name
            a.click()
            onClose()
          },
        }]
      : []),
    ...(!isMulti && !entry.is_dir
      ? [{
          Icon: Share2,
          label: t('contextMenu.share'),
          action: () => { onShare?.(entry); onClose() },
        }]
      : []),
    ...(!isMulti
      ? [{
          Icon: UserPlus,
          label: t('contextMenu.shareWithUser'),
          action: () => { onInternalShare?.(entry); onClose() },
        }]
      : []),
    ...(!isMulti && entry.is_dir
      ? [{
          Icon: Users,
          label: t('contextMenu.sharedFolder'),
          action: () => { onCollabFolder?.(entry); onClose() },
        }]
      : []),
    ...(!isMulti && entry.is_dir
      ? [{
          Icon: Upload,
          label: t('contextMenu.requestUpload'),
          action: () => { onUploadRequest?.(entry); onClose() },
        }]
      : []),
    ...(!isMulti && !entry.is_dir
      ? [{
          Icon: Tag,
          label: t('contextMenu.editTags'),
          action: () => { setPreviewFile(entry); onClose() },
        }]
      : []),
    ...(!isMulti && !entry.is_dir
      ? [{
          Icon: Clock,
          label: t('contextMenu.versionHistory'),
          action: () => { openModal('versions', entry); onClose() },
        }]
      : []),
    ...(!isMulti
      ? [{
          Icon: starred ? StarOff : Star,
          label: starred ? t('contextMenu.removeFavorite') : t('contextMenu.addFavorite'),
          action: () => {
            toggleFavorite(entry).catch((e: Error) => toast.error(e.message || 'Failed'))
            onClose()
          },
        }]
      : []),
    {
      Icon: Clipboard,
      label: t('contextMenu.copyPath'),
      action: () => {
        copyToClipboard(entry.path)
          .then(() => toast.success('Path copied'))
          .catch(() => toast.error('Could not copy'))
        onClose()
      },
    },
    { type: 'sep' as const },
    ...(!isMulti
      ? [{
          Icon: FilePen,
          label: t('contextMenu.rename'),
          action: () => { openModal('rename', entry); onClose() },
        }]
      : []),
    {
      Icon: Copy,
      label: isMulti ? t('contextMenu.copy', { label: multiLabel }) : t('contextMenu.copy', { label: typeLabel }),
      action: () => {
        const paths = isMulti ? Array.from(selectedPaths) : [entry.path]
        setClipboard(paths, 'copy')
        onClose()
      },
    },
    {
      Icon: Scissors,
      label: isMulti ? t('contextMenu.cut', { label: multiLabel }) : t('contextMenu.cut', { label: typeLabel }),
      action: () => {
        const paths = isMulti ? Array.from(selectedPaths) : [entry.path]
        setClipboard(paths, 'cut')
        onClose()
      },
    },
    {
      Icon: FolderInput,
      label: isMulti ? t('contextMenu.move', { label: multiLabel }) : t('contextMenu.move', { label: typeLabel }),
      action: () => { openModal('move'); onClose() },
    },
    ...(isMulti
      ? [{
          Icon: Plus,
          label: t('contextMenu.addTags'),
          action: () => { openModal('bulkTag'); onClose() },
        }]
      : []),
    ...(isMulti
      ? [{
          Icon: Download,
          label: t('contextMenu.downloadBulk'),
          action: () => {
            const a = document.createElement('a')
            a.href = api.downloadBulk(Array.from(selectedPaths))
            a.download = 'files.zip'
            a.click()
            onClose()
          },
        }]
      : []),
    { type: 'sep' as const },
    {
      Icon: Trash2,
      label: isMulti ? t('contextMenu.deleteItem', { label: multiLabel }) : t('contextMenu.deleteItem', { label: typeLabel }),
      danger: true,
      action: () => { openModal('delete'); onClose() },
    },
  ]

  return (
    <div
      ref={ref}
      style={{ top: y, left: x }}
      className="fixed z-50 min-w-[200px] bg-elevated border border-border rounded-xl shadow-2xl shadow-black/40 py-1.5 animate-scale-in"
    >
      {items.map((item, i) => {
        if (item.type === 'sep') {
          return <div key={i} className="my-1 h-px bg-border mx-2" />
        }
        const { Icon, label, action, danger } = item as {
          Icon: typeof Copy
          label: string
          action: () => void
          danger?: boolean
        }
        return (
          <button
            key={i}
            onClick={action}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors ${
              danger
                ? 'text-danger hover:bg-danger/10'
                : 'text-text-primary hover:bg-overlay'
            }`}
          >
            <Icon className="w-4 h-4 flex-shrink-0 opacity-70" />
            {label}
          </button>
        )
      })}
    </div>
  )
}
