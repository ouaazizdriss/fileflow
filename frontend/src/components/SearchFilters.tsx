import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type FileType = 'all' | 'folder' | 'document' | 'image' | 'video' | 'audio' | 'archive' | 'code'
export type SortBy = 'relevance' | 'name' | 'modified' | 'size'

interface Props {
  fileType: FileType
  sortBy: SortBy
  onFileTypeChange: (type: FileType) => void
  onSortChange: (sort: SortBy) => void
}

export default function SearchFilters({ fileType, sortBy, onFileTypeChange, onSortChange }: Props) {
  const { t } = useTranslation()

  const fileTypes: { value: FileType; label: string }[] = [
    { value: 'all', label: t('searchFilters.allFiles') },
    { value: 'folder', label: t('searchFilters.folders') },
    { value: 'document', label: t('searchFilters.documents') },
    { value: 'image', label: t('searchFilters.images') },
    { value: 'video', label: t('searchFilters.videos') },
    { value: 'audio', label: t('searchFilters.audio') },
    { value: 'archive', label: t('searchFilters.archives') },
    { value: 'code', label: t('searchFilters.code') },
  ]

  const sortOptions: { value: SortBy; label: string }[] = [
    { value: 'relevance', label: t('searchFilters.relevance') },
    { value: 'name', label: t('searchFilters.name') },
    { value: 'modified', label: t('searchFilters.modified') },
    { value: 'size', label: t('searchFilters.size') },
  ]

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-overlay/30 flex-wrap">
      {/* File type filter */}
      <div className="flex items-center gap-2">
        <select
          value={fileType}
          onChange={(e) => onFileTypeChange(e.target.value as FileType)}
          className="text-xs px-2 py-1 bg-overlay border border-border rounded-md text-text-primary cursor-pointer focus:border-accent outline-none"
        >
          {fileTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">{t('searchFilters.sortBy')}</span>
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          className="text-xs px-2 py-1 bg-overlay border border-border rounded-md text-text-primary cursor-pointer focus:border-accent outline-none"
        >
          {sortOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1" />

      {/* Clear filters button */}
      {(fileType !== 'all' || sortBy !== 'relevance') && (
        <button
          onClick={() => {
            onFileTypeChange('all')
            onSortChange('relevance')
          }}
          className="text-xs text-accent hover:text-accent-hover flex items-center gap-1 transition-colors"
        >
          <X className="w-3 h-3" />
          {t('searchFilters.clear')}
        </button>
      )}
    </div>
  )
}

// Helper to determine file type from extension/mime type
export function getFileType(mime: string | null, ext: string | null): FileType {
  const mimeType = mime?.toLowerCase() || ''
  const extension = ext?.toLowerCase() || ''

  // Folders
  if (extension === 'folder') return 'folder'

  // Code files
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'cs', 'php', 'json', 'xml', 'html', 'css', 'scss']
  if (codeExts.includes(extension)) return 'code'

  // Images
  if (mimeType.startsWith('image/')) return 'image'

  // Videos
  if (mimeType.startsWith('video/')) return 'video'

  // Audio
  if (mimeType.startsWith('audio/')) return 'audio'

  // Archives
  const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z', 'bz2', 'xz']
  if (archiveExts.includes(extension)) return 'archive'

  // Documents
  const docExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv']
  if (docExts.includes(extension) || mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('sheet')) {
    return 'document'
  }

  return 'document' // Default to document
}
