import { MouseEvent, useEffect, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { CheckCircle2, Upload, XCircle } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'
import { useFileStore } from '../store'
import { basename, formatSize } from '../utils'
import type { FileEntry, Permission, Role } from '../types'

import CollabManager from './CollabManager'
import ContextMenu from './ContextMenu'
import FileGrid from './FileGrid'
import FileList from './FileList'
import FileViewer from './FileViewer'
import Modals from './Modals'
import PreviewPanel from './PreviewPanel'
import InternalShareDialog from './InternalShareDialog'
import InternalSharesManager from './InternalSharesManager'
import ShareDialog from './ShareDialog'
import SharesManager from './SharesManager'
import Sidebar from './Sidebar'
import StatusBar from './StatusBar'
import Toolbar from './Toolbar'
import TrashModal from './TrashModal'
import UploadRequestDialog from './UploadRequestDialog'
import UploadRequestsManager from './UploadRequestsManager'
import UserManagement from './UserManagement'

interface Props {
  username: string
  role: Role
  permissions: Permission[]
  totpEnabled: boolean
  onLogout: () => void
}

interface CtxMenu {
  x: number
  y: number
  entry: FileEntry
}

export default function FileManager({ username, role, permissions, totpEnabled, onLogout }: Props) {
  const { t } = useTranslation()
  const isAdmin = role === 'admin'
  const canManageUsers = permissions.includes('user_manage')
  const canManageGroups = permissions.includes('group_manage')
  const canViewAudit = permissions.includes('view_audit')
  const canOpenAdminPanel = isAdmin || canManageUsers || canManageGroups || canViewAudit
  const store = useFileStore()
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [showUsers, setShowUsers] = useState(false)
  const [shareTarget, setShareTarget] = useState<FileEntry | null>(null)
  const [internalShareTarget, setInternalShareTarget] = useState<FileEntry | null>(null)
  const [uploadRequestTarget, setUploadRequestTarget] = useState<FileEntry | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)

  // Initial load
  useEffect(() => {
    const saved = localStorage.getItem('fileflow_view') as 'grid' | 'list' | null
    if (saved) store.setViewMode(saved)
    store.navigate('/')
    store.loadFavorites()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        store.openSearch()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        store.selectAll()
      }
      if (e.key === 'F2' && store.selectedPaths.size === 1) {
        const entry = store.entries.find((en) => store.selectedPaths.has(en.path))
        if (entry) store.openModal('rename', entry)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedPaths.size > 0) {
        if (e.key === 'Backspace' && !e.metaKey) return
        store.openModal('delete')
      }
      if (e.key === 'Escape') {
        store.clearSelection()
        store.setPreviewFile(null)
        store.closeViewer()
        setCtx(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  // Upload via toolbar / sidebar button (custom event)
  useEffect(() => {
    function onUploadEvent(e: Event) {
      const fileList = (e as CustomEvent<File[]>).detail
      handleUpload(fileList)
    }
    window.addEventListener('fileflow:upload', onUploadEvent)
    return () => window.removeEventListener('fileflow:upload', onUploadEvent)
  }, [store.currentPath])

  async function handleUploadTo(targetPath: string, fileList: File[]) {
    if (fileList.length === 0) return

    // Create one upload item per file
    const batch = fileList.map((file) => {
      const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      store.addUpload({ id, name: file.name, progress: 0, status: 'uploading', size: file.size })
      return { id, file }
    })

    // Files above this size use the resumable, chunked uploader (survives
    // flaky connections); smaller files take the faster single-shot path.
    const RESUMABLE_THRESHOLD = 8 * 1024 * 1024

    const results = await Promise.allSettled(
      batch.map(({ id, file }) => {
        const onProgress = (pct: number) => store.updateUpload(id, pct, 'uploading')
        const uploader = file.size > RESUMABLE_THRESHOLD
          ? api.uploadResumable(targetPath, file, onProgress)
          : api.uploadSingle(targetPath, file, onProgress)
        return uploader
          .then(() => store.updateUpload(id, 100, 'done'))
          .catch((err: Error) => {
            store.updateUpload(id, 0, 'error', err.message)
            throw err
          })
      }),
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.filter((r) => r.status === 'rejected').length

    if (succeeded > 0) {
      await store.refresh()
      if (failed === 0) {
        toast.success(t('fileManager.uploadedCount', { count: succeeded }))
      } else {
        toast.success(t('fileManager.uploadedWithErrors', { succeeded, failed }))
      }
    } else {
      toast.error(t('fileManager.uploadFailed', { count: failed }))
    }

    // Auto-clear successful uploads after 4s; leave errors visible until dismissed
    const doneIds = batch
      .filter((_, i) => results[i].status === 'fulfilled')
      .map(({ id }) => id)
    setTimeout(() => doneIds.forEach((id) => store.removeUpload(id)), 4000)
  }

  async function handleUpload(fileList: File[]) {
    await handleUploadTo(store.currentPath, fileList)
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleUpload,
    noClick: true,
    noKeyboard: true,
  })

  function handleOpen(entry: FileEntry) {
    if (entry.is_dir) {
      store.navigate(entry.path)
    } else {
      store.openViewer(entry)
    }
  }

  function handleContextMenu(e: MouseEvent, entry: FileEntry) {
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY, entry })
  }

  // "Request files" from the New hub / requests view — targets the current folder.
  function handleNewRequest() {
    const name = store.currentPath === '/' ? t('sidebar.myFiles') : basename(store.currentPath)
    setUploadRequestTarget({
      name, path: store.currentPath, is_dir: true, size: 0, modified: null, extension: null, mime_type: null,
    })
  }

  const activeUploads = store.uploads.filter((u) => u.status === 'uploading')
  const doneUploads = store.uploads.filter((u) => u.status === 'done')
  const errorUploads = store.uploads.filter((u) => u.status === 'error')
  const showTray = store.uploads.length > 0
  const isFileView = store.activeView === 'files'

  return (
    <div className="flex h-screen bg-base overflow-hidden">
      {/* User management overlay */}
      {showUsers && canOpenAdminPanel && (
        <UserManagement currentUser={username} canManageUsers={canManageUsers} canManageGroups={canManageGroups} canViewAudit={canViewAudit} onClose={() => setShowUsers(false)} />
      )}

      {/* Sidebar */}
      <Sidebar
        username={username}
        role={role}
        canOpenAdminPanel={canOpenAdminPanel}
        totpEnabled={totpEnabled}
        onLogout={onLogout}
        onOpenAdmin={() => setShowUsers(true)}
        onNewRequest={handleNewRequest}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {isFileView ? (
          <>
            <Toolbar />

            {/* Drop zone + file view */}
            <div
              ref={mainRef}
              {...getRootProps()}
              className="relative flex flex-1 overflow-hidden"
            >
              <input {...getInputProps()} />

              {/* Drop overlay */}
              {isDragActive && (
                <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-base/95 border-2 border-dashed border-accent pointer-events-none animate-fade-in">
                  <div className="w-16 h-16 rounded-2xl bg-accent/15 flex items-center justify-center mb-4">
                    <Upload className="w-8 h-8 text-accent" />
                  </div>
                  <p className="text-lg font-semibold text-text-primary">{t('fileManager.dropTitle')}</p>
                  <p className="text-sm text-text-secondary mt-1">{t('fileManager.dropSubtitle')}</p>
                </div>
              )}

              {/* Error state */}
              {store.error && (
                <div className="flex items-center justify-center flex-1 text-sm text-danger">
                  {store.error}
                </div>
              )}

              {/* File view (scrollable) */}
              {!store.error && (
                <div className="flex flex-1 overflow-hidden">
                  <div className="flex-1 overflow-y-auto">
                    {store.viewMode === 'grid' ? (
                      <FileGrid
                        onContextMenu={handleContextMenu}
                        onOpen={handleOpen}
                        onDropInto={(folderPath, files) => handleUploadTo(folderPath, files)}
                      />
                    ) : (
                      <FileList
                        onContextMenu={handleContextMenu}
                        onOpen={handleOpen}
                        onDropInto={(folderPath, files) => handleUploadTo(folderPath, files)}
                      />
                    )}
                  </div>

                  {/* Preview panel */}
                  {store.previewFile && (
                    <PreviewPanel
                      file={store.previewFile}
                      onClose={() => store.setPreviewFile(null)}
                    />
                  )}
                </div>
              )}
            </div>

            <StatusBar />
          </>
        ) : (
          /* Workspace views — sharing / collaboration destinations */
          <div className="flex-1 overflow-hidden">
            {store.activeView === 'shared' && <InternalSharesManager />}
            {store.activeView === 'links' && <SharesManager isAdmin={isAdmin} />}
            {store.activeView === 'team' && <CollabManager />}
            {store.activeView === 'requests' && <UploadRequestsManager onNew={handleNewRequest} />}
            {store.activeView === 'trash' && <TrashModal />}
          </div>
        )}
      </div>

      {/* Context menu */}
      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          entry={ctx.entry}
          onClose={() => setCtx(null)}
          onShare={(entry) => { setShareTarget(entry); setCtx(null) }}
          onInternalShare={(entry) => { setInternalShareTarget(entry); setCtx(null) }}
          onCollabFolder={() => { store.setView('team'); setCtx(null) }}
          onUploadRequest={(entry) => { setUploadRequestTarget(entry); setCtx(null) }}
        />
      )}

      {shareTarget && (
        <ShareDialog file={shareTarget} onClose={() => setShareTarget(null)} />
      )}

      {internalShareTarget && (
        <InternalShareDialog file={internalShareTarget} onClose={() => setInternalShareTarget(null)} />
      )}

      {uploadRequestTarget && (
        <UploadRequestDialog
          folder={uploadRequestTarget}
          onClose={() => setUploadRequestTarget(null)}
        />
      )}

      {/* Upload progress tray */}
      {showTray && (
        <div className="fixed bottom-12 right-4 bg-elevated border border-border rounded-xl shadow-2xl shadow-black/30 min-w-[300px] max-w-[360px] z-40 animate-slide-up overflow-hidden">
          {/* Tray header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">
              {activeUploads.length > 0 ? t('fileManager.uploadingHeader') : t('fileManager.uploadComplete')}
            </span>
            <span className="text-xs text-text-muted tabular-nums">
              {doneUploads.length + errorUploads.length} / {store.uploads.length}
            </span>
          </div>

          {/* File rows */}
          <div className="max-h-52 overflow-y-auto divide-y divide-border/50">
            {store.uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs text-text-primary truncate">{u.name}</span>
                    <span className="text-[11px] text-text-muted flex-shrink-0 tabular-nums">
                      {u.status === 'uploading' && `${u.progress}%`}
                      {u.status === 'done' && u.size ? formatSize(u.size) : ''}
                    </span>
                  </div>
                  <div className="h-1 bg-border rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all duration-200',
                        u.status === 'done'
                          ? 'bg-success'
                          : u.status === 'error'
                            ? 'bg-danger'
                            : 'bg-accent',
                      )}
                      style={{ width: `${u.status === 'done' ? 100 : u.progress}%` }}
                    />
                  </div>
                  {u.status === 'error' && u.error && (
                    <p className="text-[10px] text-danger mt-1 truncate">{u.error}</p>
                  )}
                </div>

                {/* Status icon */}
                <div className="flex-shrink-0">
                  {u.status === 'done' && (
                    <CheckCircle2 className="w-4 h-4 text-success" />
                  )}
                  {u.status === 'error' && (
                    <button
                      onClick={() => store.removeUpload(u.id)}
                      title="Dismiss"
                      className="text-danger hover:text-danger/70 transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                  {u.status === 'uploading' && (
                    <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals (new folder, rename, delete, search) */}
      <Modals />

      {/* Full-screen file viewer */}
      {store.viewerFile && (
        <FileViewer
          file={store.viewerFile}
          onClose={() => store.closeViewer()}
        />
      )}
    </div>
  )
}
