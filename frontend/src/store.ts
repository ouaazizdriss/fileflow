import { create } from 'zustand'
import { files as api, favorites as favApi } from './api'
import type { Favorite, FileEntry, ModalType, SortField, SortOrder, UploadItem, ViewMode } from './types'

/** Which destination the main pane is showing. 'files' is the file browser;
 *  the rest are the sharing/collaboration workspaces promoted to the sidebar. */
export type WorkspaceView = 'files' | 'shared' | 'links' | 'team' | 'requests' | 'trash'

function sortEntries(
  entries: FileEntry[],
  field: SortField,
  order: SortOrder,
): FileEntry[] {
  return [...entries].sort((a, b) => {
    // Dirs always first
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1

    let cmp = 0
    switch (field) {
      case 'name':
        cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        break
      case 'size':
        cmp = a.size - b.size
        break
      case 'modified':
        cmp = (a.modified ?? '').localeCompare(b.modified ?? '')
        break
      case 'type':
        cmp = (a.extension ?? '').localeCompare(b.extension ?? '')
        break
    }
    return order === 'asc' ? cmp : -cmp
  })
}

interface FileStore {
  // Navigation
  currentPath: string
  history: string[]
  historyIndex: number

  // Main-pane workspace router
  activeView: WorkspaceView

  // Data
  entries: FileEntry[]
  isLoading: boolean
  error: string | null

  // Selection
  selectedPaths: Set<string>
  lastSelected: string | null

  // View
  viewMode: ViewMode
  sortField: SortField
  sortOrder: SortOrder

  // Search
  isSearchOpen: boolean
  searchQuery: string
  searchResults: FileEntry[] | null
  isSearching: boolean
  searchFullText: boolean

  // Modals
  activeModal: ModalType
  renameTarget: FileEntry | null

  // Upload
  uploads: UploadItem[]

  // Preview (side panel)
  previewFile: FileEntry | null

  // Full-screen viewer
  viewerFile: FileEntry | null

  // Clipboard
  clipboard: { paths: string[]; operation: 'copy' | 'cut' } | null

  // Favorites (starred files/folders)
  favorites: Favorite[]

  // Actions
  loadFavorites(): Promise<void>
  toggleFavorite(entry: FileEntry): Promise<void>
  isFavorite(path: string): boolean
  navigate(path: string, pushHistory?: boolean): Promise<void>
  navigateBack(): void
  navigateForward(): void
  refresh(): Promise<void>
  setView(v: WorkspaceView): void

  select(path: string): void
  toggleSelect(path: string): void
  rangeSelect(path: string): void
  selectAll(): void
  clearSelection(): void

  setViewMode(m: ViewMode): void
  setSort(field: SortField, order?: SortOrder): void

  openSearch(): void
  closeSearch(): void
  setSearchQuery(q: string): void
  toggleSearchFullText(): void
  runSearch(): Promise<void>

  openModal(type: ModalType, target?: FileEntry): void
  closeModal(): void

  addUpload(item: UploadItem): void
  updateUpload(id: string, progress: number, status: UploadItem['status'], error?: string): void
  removeUpload(id: string): void

  setPreviewFile(f: FileEntry | null): void
  openViewer(f: FileEntry): void
  closeViewer(): void
  setClipboard(paths: string[], op: 'copy' | 'cut'): void
}

export const useFileStore = create<FileStore>((set, get) => ({
  currentPath: '/',
  history: ['/'],
  historyIndex: 0,

  activeView: 'files',

  entries: [],
  isLoading: false,
  error: null,

  selectedPaths: new Set(),
  lastSelected: null,

  viewMode: 'grid',
  sortField: 'name',
  sortOrder: 'asc',

  isSearchOpen: false,
  searchQuery: '',
  searchResults: null,
  isSearching: false,
  searchFullText: false,

  activeModal: null,
  renameTarget: null,

  uploads: [],

  favorites: [],
  previewFile: null,
  viewerFile: null,
  clipboard: null,

  setView(v) {
    set({ activeView: v })
  },

  async navigate(path, pushHistory = true) {
    // Any folder navigation returns the main pane to the file browser.
    set({ isLoading: true, error: null, selectedPaths: new Set(), lastSelected: null, activeView: 'files' })
    try {
      const listing = await api.list(path)
      const { sortField, sortOrder, history, historyIndex } = get()
      const sorted = sortEntries(listing.entries, sortField, sortOrder)

      let newHistory = history
      let newIndex = historyIndex

      if (pushHistory) {
        newHistory = [...history.slice(0, historyIndex + 1), path]
        newIndex = newHistory.length - 1
      }

      set({
        currentPath: listing.path,
        entries: sorted,
        isLoading: false,
        history: newHistory,
        historyIndex: newIndex,
      })
    } catch (e) {
      set({ isLoading: false, error: (e as Error).message })
    }
  },

  navigateBack() {
    const { historyIndex, history } = get()
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1
      set({ historyIndex: newIndex })
      get().navigate(history[newIndex], false)
    }
  },

  navigateForward() {
    const { historyIndex, history } = get()
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1
      set({ historyIndex: newIndex })
      get().navigate(history[newIndex], false)
    }
  },

  async refresh() {
    await get().navigate(get().currentPath, false)
  },

  select(path) {
    set({ selectedPaths: new Set([path]), lastSelected: path })
  },

  toggleSelect(path) {
    const s = new Set(get().selectedPaths)
    if (s.has(path)) s.delete(path)
    else s.add(path)
    set({ selectedPaths: s, lastSelected: path })
  },

  rangeSelect(path) {
    const { entries, lastSelected, selectedPaths } = get()
    if (!lastSelected) {
      get().toggleSelect(path)
      return
    }
    const paths = entries.map((e) => e.path)
    const a = paths.indexOf(lastSelected)
    const b = paths.indexOf(path)
    if (a === -1 || b === -1) return
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const s = new Set(selectedPaths)
    for (let i = lo; i <= hi; i++) s.add(paths[i])
    set({ selectedPaths: s, lastSelected: path })
  },

  selectAll() {
    set({ selectedPaths: new Set(get().entries.map((e) => e.path)) })
  },

  clearSelection() {
    set({ selectedPaths: new Set(), lastSelected: null })
  },

  setViewMode(m) {
    set({ viewMode: m })
    localStorage.setItem('fileflow_view', m)
  },

  setSort(field, order) {
    const newOrder = order ?? (get().sortField === field && get().sortOrder === 'asc' ? 'desc' : 'asc')
    const sorted = sortEntries(get().entries, field, newOrder)
    set({ sortField: field, sortOrder: newOrder, entries: sorted })
  },

  openSearch() {
    set({ isSearchOpen: true, searchQuery: '', searchResults: null })
  },

  closeSearch() {
    set({ isSearchOpen: false, searchQuery: '', searchResults: null })
  },

  setSearchQuery(q) {
    set({ searchQuery: q, ...(q.startsWith('#') ? { searchFullText: false } : {}) })
  },

  toggleSearchFullText() {
    set((s) => ({ searchFullText: !s.searchFullText, searchResults: null }))
  },

  async runSearch() {
    const { searchQuery, currentPath, searchFullText } = get()
    if (searchQuery.length < 2) return
    set({ isSearching: true })
    try {
      const results = searchQuery.startsWith('#')
        ? await api.searchByTag(searchQuery)
        : await api.search(searchQuery, currentPath, searchFullText)
      set({ searchResults: results, isSearching: false })
    } catch {
      set({ isSearching: false })
    }
  },

  openModal(type, target) {
    set({ activeModal: type, renameTarget: target ?? null })
  },

  closeModal() {
    set({ activeModal: null, renameTarget: null })
  },

  addUpload(item) {
    set((s) => ({ uploads: [...s.uploads, item] }))
  },

  updateUpload(id, progress, status, error) {
    set((s) => ({
      uploads: s.uploads.map((u) =>
        u.id === id ? { ...u, progress, status, error } : u,
      ),
    }))
  },

  removeUpload(id) {
    set((s) => ({ uploads: s.uploads.filter((u) => u.id !== id) }))
  },

  async loadFavorites() {
    try {
      set({ favorites: await favApi.list() })
    } catch {
      /* non-fatal: favorites just won't show */
    }
  },

  isFavorite(path) {
    return get().favorites.some((f) => f.path === path)
  },

  async toggleFavorite(entry) {
    const exists = get().isFavorite(entry.path)
    if (exists) {
      await favApi.remove(entry.path)
      set({ favorites: get().favorites.filter((f) => f.path !== entry.path) })
    } else {
      const fav = await favApi.add(entry.path)
      set({ favorites: [...get().favorites, fav] })
    }
  },

  setPreviewFile(f) {
    set({ previewFile: f })
  },

  openViewer(f) {
    set({ viewerFile: f })
  },

  closeViewer() {
    set({ viewerFile: null })
  },

  setClipboard(paths, operation) {
    set({ clipboard: { paths, operation } })
  },
}))
