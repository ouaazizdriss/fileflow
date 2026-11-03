import {
  ArrowLeft, ArrowRight, ChevronRight, FolderPlus, Grid3x3, Home, List,
  RotateCcw, Search, Tag, Trash2, Upload,
} from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { useFileStore } from '../store'

export default function Toolbar() {
  const { t } = useTranslation()
  const {
    currentPath,
    selectedPaths,
    viewMode,
    isLoading,
    history,
    historyIndex,
    navigate,
    navigateBack,
    navigateForward,
    refresh,
    setViewMode,
    openModal,
    openSearch,
    setSearchQuery,
  } = useFileStore()

  const segments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean)
  const canBack = historyIndex > 0
  const canForward = historyIndex < history.length - 1
  const hasSelection = selectedPaths.size > 0

  function getBreadcrumbPath(idx: number) {
    return '/' + segments.slice(0, idx + 1).join('/')
  }

  return (
    <header className="flex-shrink-0 border-b border-border bg-surface">
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Nav buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={navigateBack}
            disabled={!canBack}
            title={t('toolbar.back')}
            className="p-1.5 rounded-md hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={navigateForward}
            disabled={!canForward}
            title={t('toolbar.forward')}
            className="p-1.5 rounded-md hover:bg-elevated disabled:opacity-30 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={refresh}
            title={t('toolbar.refresh')}
            className={clsx(
              'p-1.5 rounded-md hover:bg-elevated text-text-secondary hover:text-text-primary transition-colors',
              isLoading && 'animate-spin',
            )}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-0.5 flex-1 min-w-0 text-sm overflow-hidden">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-text-secondary hover:text-text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-elevated flex-shrink-0"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-0.5 min-w-0">
              <ChevronRight className="w-3 h-3 text-text-muted flex-shrink-0" />
              <button
                onClick={() => navigate(getBreadcrumbPath(i))}
                className={clsx(
                  'px-1.5 py-0.5 rounded truncate max-w-[160px] transition-colors hover:bg-elevated',
                  i === segments.length - 1
                    ? 'text-text-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {seg}
              </button>
            </span>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={openSearch}
            title={t('toolbar.search')}
            className="p-1.5 rounded-md hover:bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              const q = prompt(t('toolbar.searchByTag') + ':')
              if (q) {
                const tag = q.startsWith('#') ? q : `#${q}`
                openSearch()
                setSearchQuery(tag)
              }
            }}
            title={t('toolbar.searchByTag')}
            className="p-1.5 rounded-md hover:bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          >
            <Tag className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-border mx-0.5" />

          {hasSelection && (
            <button
              onClick={() => openModal('delete')}
              title={t('toolbar.deleteSelected', { count: selectedPaths.size })}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-danger/10 hover:bg-danger/20 text-danger rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('toolbar.deleteCount', { count: selectedPaths.size })}</span>
            </button>
          )}

          <button
            onClick={() => openModal('newFolder')}
            title={t('toolbar.newFolder')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm hover:bg-elevated text-text-secondary hover:text-text-primary rounded-lg transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('toolbar.newFolder')}</span>
          </button>

          <button
            title={t('toolbar.uploadFiles')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm bg-accent/10 hover:bg-accent/20 text-accent rounded-lg transition-colors"
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.multiple = true
              input.onchange = () => {
                if (input.files?.length) {
                  window.dispatchEvent(
                    new CustomEvent('fileflow:upload', { detail: Array.from(input.files) }),
                  )
                }
              }
              input.click()
            }}
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">{t('toolbar.upload')}</span>
          </button>

          <div className="w-px h-5 bg-border mx-0.5" />

          {/* View toggle */}
          <div className="flex items-center bg-elevated rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setViewMode('grid')}
              title={t('toolbar.gridView')}
              className={clsx(
                'p-1.5 rounded transition-colors',
                viewMode === 'grid'
                  ? 'bg-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              <Grid3x3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              title={t('toolbar.listView')}
              className={clsx(
                'p-1.5 rounded transition-colors',
                viewMode === 'list'
                  ? 'bg-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
