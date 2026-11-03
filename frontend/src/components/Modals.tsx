import { FormEvent, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileText, FilePen, FolderPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'
import { useFileStore } from '../store'
import type { FileEntry } from '../types'
import VersionModal from './VersionModal'
import MoveModal from './MoveModal'
import BulkTagModal from './BulkTagModal'
import SearchFilters, { type FileType, type SortBy, getFileType } from './SearchFilters'

// ─── Shared overlay ────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-scale-in">
      {children}
    </div>
  )
}

// ─── New Folder ────────────────────────────────────────────────────────────────

function NewFolderModal() {
  const { t } = useTranslation()
  const { currentPath, closeModal, refresh } = useFileStore()
  const [name, setName] = useState(t('modals.newFolder'))
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      await api.mkdir(currentPath, name.trim())
      await refresh()
      toast.success(t('modals.folderCreated', { name }))
      closeModal()
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <Overlay onClose={closeModal}>
      <Modal>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
              <FolderPlus className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">{t('modals.newFolder')}</h2>
          </div>
          <form onSubmit={submit}>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors mb-5"
              placeholder={t('modals.folderName')}
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={closeModal}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors">
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={loading || !name.trim()}
                className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors">
                {loading ? t('modals.creating') : t('common.create')}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </Overlay>
  )
}

// ─── Rename ───────────────────────────────────────────────────────────────────

function RenameModal({ target }: { target: FileEntry }) {
  const { t } = useTranslation()
  const { closeModal, refresh } = useFileStore()
  const [name, setName] = useState(target.name)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const ext = target.extension ? target.name.lastIndexOf('.') : -1
    if (inputRef.current) {
      inputRef.current.setSelectionRange(0, ext > 0 ? ext : target.name.length)
      inputRef.current.focus()
    }
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || name === target.name) { closeModal(); return }
    setLoading(true)
    try {
      await api.rename(target.path, name.trim())
      await refresh()
      toast.success(t('modals.renamed', { name }))
      closeModal()
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <Overlay onClose={closeModal}>
      <Modal>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center">
              <FilePen className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">{t('modals.rename')}</h2>
          </div>
          <form onSubmit={submit}>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors mb-5"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={closeModal}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors">
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={loading || !name.trim()}
                className="px-4 py-2 text-sm bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors">
                {loading ? t('common.saving') : t('common.rename')}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </Overlay>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────

function DeleteModal() {
  const { t } = useTranslation()
  const { selectedPaths, closeModal, refresh, clearSelection } = useFileStore()
  const [loading, setLoading] = useState(false)
  const count = selectedPaths.size

  async function confirm() {
    setLoading(true)
    try {
      await api.delete(Array.from(selectedPaths))
      await refresh()
      clearSelection()
      toast.success(t('common.item', { count }))
      closeModal()
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <Overlay onClose={closeModal}>
      <Modal>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-danger/15 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-danger" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">{t('modals.moveToTrash')}</h2>
          </div>
          <p className="text-sm text-text-secondary mb-6">
            {t('modals.moveToTrashBody', { count })}
          </p>
          <div className="flex gap-2 justify-end">
            <button onClick={closeModal}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay rounded-lg transition-colors">
              {t('common.cancel')}
            </button>
            <button onClick={confirm} disabled={loading}
              className="px-4 py-2 text-sm bg-danger hover:bg-red-500 disabled:opacity-50 text-white rounded-lg transition-colors">
              {loading ? t('modals.moving') : t('modals.moveToTrashAction')}
            </button>
          </div>
        </div>
      </Modal>
    </Overlay>
  )
}

// ─── Search ───────────────────────────────────────────────────────────────────

function SearchModal() {
  const { t } = useTranslation()
  const {
    searchQuery,
    searchResults,
    isSearching,
    searchFullText,
    closeSearch,
    setSearchQuery,
    toggleSearchFullText,
    runSearch,
    navigate,
  } = useFileStore()
  const [fileType, setFileType] = useState<FileType>('all')
  const [sortBy, setSortBy] = useState<SortBy>('relevance')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const timer = setTimeout(() => { if (searchQuery.length >= 2) runSearch() }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, searchFullText])

  const filteredResults = searchResults?.filter((entry) => {
    if (fileType === 'all') return true
    return getFileType(entry.mime_type, entry.extension) === fileType
  }) || []

  const sortedResults = [...filteredResults].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'modified':
        return (b.modified ?? '').localeCompare(a.modified ?? '')
      case 'size':
        return (b.size ?? 0) - (a.size ?? 0)
      case 'relevance':
      default:
        return 0 // Keep original order from search
    }
  })

  return (
    <Overlay onClose={closeSearch}>
      <div className="bg-elevated border border-border rounded-2xl shadow-2xl w-full max-w-2xl mx-4 animate-scale-in overflow-hidden flex flex-col max-h-[90vh]">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
          <svg className="w-4 h-4 text-text-muted flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('modals.searchPlaceholder')}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-text-muted hover:text-text-secondary">
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}
          {!searchQuery.startsWith('#') && (
            <button
              onClick={toggleSearchFullText}
              title={searchFullText ? t('modals.fullTextOn') : t('modals.fullTextOff')}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md transition-colors flex-shrink-0 ${
                searchFullText
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text-secondary hover:bg-overlay'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{searchFullText ? t('modals.contentLabel') : t('modals.nameLabel')}</span>
            </button>
          )}
        </div>

        {/* Filters */}
        {searchResults && searchResults.length > 0 && (
          <SearchFilters
            fileType={fileType}
            sortBy={sortBy}
            onFileTypeChange={setFileType}
            onSortChange={setSortBy}
          />
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isSearching && (
            <div className="flex items-center gap-3 px-4 py-8 justify-center text-text-muted text-sm">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              {t('modals.searching')}
            </div>
          )}

          {!isSearching && searchResults !== null && searchResults.length === 0 && (
            <div className="flex items-center justify-center px-4 py-8 text-text-muted text-sm">
              {t('modals.noResults')}
            </div>
          )}

          {!isSearching && sortedResults.length === 0 && searchResults && searchResults.length > 0 && (
            <div className="flex items-center justify-center px-4 py-8 text-text-muted text-sm">
              {t('modals.noResults')}
            </div>
          )}

          {!isSearching && sortedResults.map((entry) => (
            <button
              key={entry.path}
              onClick={() => {
                const dir = entry.path.substring(0, entry.path.lastIndexOf('/')) || '/'
                navigate(entry.is_dir ? entry.path : dir)
                closeSearch()
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-overlay transition-colors text-left"
            >
              <span className="text-lg">{entry.is_dir ? '📁' : '📄'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{entry.name}</div>
                <div className="text-xs text-text-muted truncate">{entry.path}</div>
              </div>
            </button>
          ))}

          {!searchQuery && (
            <div className="flex items-center justify-center px-4 py-8 text-text-muted text-sm">
              {t('modals.typeToSearch')}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border text-xs text-text-muted flex justify-between flex-shrink-0">
          <span>{t('modals.searchHint')}</span>
          {searchResults && <span>{t('common.item', { count: sortedResults.length })}</span>}
        </div>
      </div>
    </Overlay>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Modals() {
  const { activeModal, renameTarget, isSearchOpen, closeModal, selectedPaths, refresh } = useFileStore()

  return (
    <>
      {activeModal === 'newFolder' && <NewFolderModal />}
      {activeModal === 'rename' && renameTarget && <RenameModal target={renameTarget} />}
      {activeModal === 'delete' && <DeleteModal />}
      {activeModal === 'move' && <MoveModal />}
      {activeModal === 'versions' && renameTarget && <VersionModal file={renameTarget} onClose={closeModal} />}
      {activeModal === 'bulkTag' && (
        <BulkTagModal
          fileCount={selectedPaths.size}
          selectedPaths={Array.from(selectedPaths)}
          onClose={closeModal}
          onSuccess={refresh}
        />
      )}
      {isSearchOpen && <SearchModal />}
    </>
  )
}
