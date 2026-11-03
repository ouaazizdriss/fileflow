import type { AuditEntry, DirectoryListing, Favorite, FileEntry, FileMetadata, InternalShare, LoginChallenge, Role, ShareLink, SharedFolder, SharedFolderMember, TrashEntry, UploadRequestView, UserGroup, UserInfo, UserView, VersionEntry } from './types'

const BASE = '/api'

/** Fired on `window` when an authenticated call gets 401: the session expired
 *  or was revoked (log out everywhere, password change, deleted account). */
export const SESSION_EXPIRED_EVENT = 'fileflow:session-expired'

// Endpoints where 401 is an expected answer, not a lost session: the startup
// session probe and the login / second-factor steps.
const ANONYMOUS_AUTH = ['/auth/me', '/auth/login', '/auth/2fa/verify']

function checkSession(status: number, url: string) {
  if (status === 401 && !ANONYMOUS_AUTH.some((p) => url.startsWith(p))) {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
  }
}

async function req<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body && typeof opts.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(`${BASE}${url}`, {
    credentials: 'include',
    ...opts,
    headers: { ...headers, ...(opts.headers as Record<string, string> ?? {}) },
  })

  const contentType = res.headers.get('Content-Type')
  const isJson = contentType && contentType.includes('application/json')

  if (!res.ok) {
    checkSession(res.status, url)
    if (isJson) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? `HTTP ${res.status}`)
    } else {
      const text = await res.text().catch(() => '')
      if (text.trim().startsWith('<!doctype html>') || text.trim().startsWith('<html')) {
        throw new Error(`API error (${res.status}): Server returned HTML instead of JSON. This usually means the API route was not found and matched the SPA fallback.`)
      }
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 100)}`)
    }
  }

  if (res.status === 204) return undefined as T
  
  if (!isJson) {
    throw new Error(`Expected JSON but got ${contentType}`)
  }

  return res.json()
}

/** Thrown by the resumable uploader so a lost session isn't retried. */
class SessionExpiredError extends Error {
  constructor() { super('Session expired') }
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  me: () => req<UserInfo>('/auth/me'),
  login: (username: string, password: string) =>
    req<UserInfo | LoginChallenge>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => req<void>('/auth/logout', { method: 'POST' }),
  logoutAll: () => req<void>('/auth/logout-all', { method: 'POST' }),
}

export const twoFactor = {
  setup: () => req<{ qr_code_png_b64: string }>('/auth/2fa/setup', { method: 'POST' }),
  confirm: (code: string) => req<{ backup_codes: string[] }>('/auth/2fa/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  verify: (code: string) => req<UserInfo>('/auth/2fa/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }),
  verifyRecovery: (recovery_code: string) => req<UserInfo>('/auth/2fa/verify-recovery', {
    method: 'POST',
    body: JSON.stringify({ recovery_code }),
  }),
  disable: (password: string, code: string) => req<void>('/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  }),
  regenerateCodes: (password: string, code: string) => req<string[]>('/auth/2fa/recovery-codes/regenerate', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  }),
}

export const userMgmt = {
  list: () => req<UserView[]>('/admin/users'),

  create: (username: string, password: string, role: Role) =>
    req<UserView>('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ username, password, role }),
    }),

  delete: (username: string) =>
    req<void>(`/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' }),

  update: (username: string, data: Partial<UserView>) =>
    req<UserView>(`/admin/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  setPassword: (username: string, newPassword: string) =>
    req<void>(`/admin/users/${encodeURIComponent(username)}/password`, {
      method: 'PUT',
      body: JSON.stringify({ new_password: newPassword }),
    }),

  changeOwnPassword: (currentPassword: string, newPassword: string) =>
    req<void>('/users/me/password', {
      method: 'PUT',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  listGroups: () => req<UserGroup[]>('/admin/groups'),

  createGroup: (name: string, permissions: string[], allowed_paths: string[]) =>
    req<UserGroup>('/admin/groups', {
      method: 'POST',
      body: JSON.stringify({ name, permissions, allowed_paths }),
    }),

  deleteGroup: (id: string) =>
    req<void>(`/admin/groups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  
  updateGroup: (id: string, data: { name?: string, permissions?: string[], allowed_paths?: string[] }) =>
    req<UserGroup>(`/admin/groups/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  listAudit: (filters?: {
    username?: string
    action?: string
    from?: string
    to?: string
    resource?: string
    limit?: number
    offset?: number
  }) => {
    const params = new URLSearchParams()
    if (filters?.username) params.append('username', filters.username)
    if (filters?.action) params.append('action', filters.action)
    if (filters?.from) params.append('from', filters.from)
    if (filters?.to) params.append('to', filters.to)
    if (filters?.resource) params.append('resource', filters.resource)
    if (filters?.limit) params.append('limit', String(filters.limit))
    if (filters?.offset) params.append('offset', String(filters.offset))
    const qs = params.toString()
    return req<AuditEntry[]>(`/admin/audit${qs ? '?' + qs : ''}`)
  },

  exportAudit: (filters?: {
    username?: string
    action?: string
    from?: string
    to?: string
    resource?: string
  }) => {
    const params = new URLSearchParams()
    if (filters?.username) params.append('username', filters.username)
    if (filters?.action) params.append('action', filters.action)
    if (filters?.from) params.append('from', filters.from)
    if (filters?.to) params.append('to', filters.to)
    if (filters?.resource) params.append('resource', filters.resource)
    const qs = params.toString()
    return fetch(`/api/admin/audit/export${qs ? '?' + qs : ''}`, {
      credentials: 'include',
    })
  },
}

// ─── Shares ───────────────────────────────────────────────────────────────────

export const shares = {
  create: (file_path: string, expires_in_secs: number, password?: string, max_downloads?: number | null) =>
    req<ShareLink>('/shares', {
      method: 'POST',
      body: JSON.stringify({ file_path, expires_in_secs, password: password || null, max_downloads: max_downloads ?? null }),
    }),

  list: () => req<ShareLink[]>('/shares'),

  delete: (token: string) =>
    req<void>(`/shares/${token}`, { method: 'DELETE' }),

  publicUrl: (token: string) =>
    `${window.location.origin}/api/s/${token}`,
}

// ─── Collab (Shared Folders) ───────────────────────────────────────────────────

export const collab = {
  list: () => req<SharedFolder[]>('/shared-folders'),

  create: (name: string, path: string) =>
    req<SharedFolder>('/shared-folders', {
      method: 'POST',
      body: JSON.stringify({ name, path }),
    }),

  get: (id: string) => req<SharedFolder>(`/shared-folders/${id}`),

  delete: (id: string) => req<void>(`/shared-folders/${id}`, { method: 'DELETE' }),

  updateMembers: (id: string, members: SharedFolderMember[]) =>
    req<SharedFolder>(`/shared-folders/${id}/members`, {
      method: 'PUT',
      body: JSON.stringify(members),
    }),
}

// ─── Internal (user-to-user) shares ────────────────────────────────────────────

export const internalShares = {
  list: () => req<{ owned: InternalShare[]; received: InternalShare[] }>('/internal-shares'),

  create: (path: string, username: string, can_write: boolean) =>
    req<InternalShare>('/internal-shares', {
      method: 'POST',
      body: JSON.stringify({ path, username, can_write }),
    }),

  delete: (id: string) => req<void>(`/internal-shares/${id}`, { method: 'DELETE' }),

  sharedWithMe: () => req<FileEntry[]>('/shared-with-me'),
}

// ─── Favorites ─────────────────────────────────────────────────────────────────

export const favorites = {
  list: () => req<Favorite[]>('/favorites'),
  add: (path: string) =>
    req<Favorite>('/favorites', { method: 'POST', body: JSON.stringify({ path }) }),
  remove: (path: string) =>
    req<void>(`/favorites?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
}

// ─── Upload Requests ───────────────────────────────────────────────────────────

export const uploadRequests = {
  list: () => req<UploadRequestView[]>('/upload-requests'),

  create: (name: string, folder_path: string, expires_in_secs?: number, password?: string) =>
    req<UploadRequestView>('/upload-requests', {
      method: 'POST',
      body: JSON.stringify({ name, folder_path, expires_in_secs: expires_in_secs ?? null, password: password || null }),
    }),

  delete: (token: string) => req<void>(`/upload-requests/${token}`, { method: 'DELETE' }),

  publicUrl: (token: string) => `${window.location.origin}/api/r/${token}`,
}

// ─── Files ─────────────────────────────────────────────────────────────────────

export const files = {
  list: (path: string) =>
    req<DirectoryListing>(`/files?path=${encodeURIComponent(path)}`),

  search: (q: string, path = '/', fullText = false) =>
    req<FileEntry[]>(`/files/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(path)}${fullText ? '&full_text=true' : ''}`),

  searchByTag: (tag: string) =>
    req<FileEntry[]>(`/metadata/search?q=${encodeURIComponent(tag)}`),

  setTags: (path: string, tags: string[], collections: string[]) =>
    req<void>('/metadata/tags', {
      method: 'POST',
      body: JSON.stringify({ path, tags, collections }),
    }),

  setTagsBulk: (paths: string[], tags: string[], collections: string[]) =>
    req<void>('/metadata/tags/bulk', {
      method: 'POST',
      body: JSON.stringify({ paths, tags, collections }),
    }),

  mkdir: (path: string, name: string) =>
    req<{ path: string; name: string }>('/files/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }),

  rename: (old_path: string, new_name: string) =>
    req<{ path: string; name: string }>('/files/rename', {
      method: 'POST',
      body: JSON.stringify({ old_path, new_name }),
    }),

  delete: (paths: string[]) =>
    req<{ deleted: string[]; count: number }>('/files/delete', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),

  move: (paths: string[], destination: string) =>
    req<{ moved: string[]; count: number }>('/files/move', {
      method: 'POST',
      body: JSON.stringify({ paths, destination }),
    }),

  // Trash
  listTrash: () => req<TrashEntry[]>('/trash'),
  restoreTrash: (id: string) =>
    req<void>('/trash/restore', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  emptyTrash: () => req<void>('/trash/empty', { method: 'POST' }),

  // Versions
  listVersions: (path: string) =>
    req<VersionEntry[]>(`/versions?path=${encodeURIComponent(path)}`),
  restoreVersion: (path: string, version_id: string) =>
    req<void>('/versions/restore', {
      method: 'POST',
      body: JSON.stringify({ path, version_id }),
    }),

  // Metadata / tags
  getTags: (path: string) =>
    req<FileMetadata>(`/metadata/tags?path=${encodeURIComponent(path)}`),

  downloadUrl: (path: string) =>
    `${BASE}/files/download?path=${encodeURIComponent(path)}`,

  downloadBulk: (paths: string[]) => {
    const params = new URLSearchParams()
    paths.forEach(p => params.append('paths', p))
    return `${BASE}/files/download-bulk?${params.toString()}`
  },

  previewUrl: (path: string) =>
    `${BASE}/files/preview?path=${encodeURIComponent(path)}`,

  upload: (
    path: string,
    fileList: File[],
    onProgress: (pct: number) => void,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const form = new FormData()
      fileList.forEach((f) => form.append('files', f))

      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE}/files/upload?path=${encodeURIComponent(path)}`)
      xhr.withCredentials = true

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else {
          checkSession(xhr.status, '/files/upload')
          const body = JSON.parse(xhr.responseText || '{}')
          reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error during upload'))
      xhr.send(form)
    }),

  uploadSingle: (
    path: string,
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const form = new FormData()
      form.append('files', file)

      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE}/files/upload?path=${encodeURIComponent(path)}`)
      xhr.withCredentials = true

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else {
          checkSession(xhr.status, '/files/upload')
          const body = JSON.parse(xhr.responseText || '{}')
          reject(new Error(body.error ?? `Upload failed (${xhr.status})`))
        }
      }
      xhr.onerror = () => reject(new Error('Network error during upload'))
      xhr.send(form)
    }),

  /**
   * Resumable, chunked upload for a single file. Survives transient network
   * failures by re-syncing the server offset and retrying the failed chunk.
   */
  uploadResumable: async (
    path: string,
    file: File,
    onProgress: (pct: number) => void,
    opts: { chunkSize?: number; signal?: AbortSignal } = {},
  ): Promise<void> => {
    const chunkSize = opts.chunkSize ?? 5 * 1024 * 1024
    const maxRetries = 4

    const initRes = await fetch(`${BASE}/uploads/init`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, filename: file.name, size: file.size }),
      signal: opts.signal,
    })
    if (!initRes.ok) {
      checkSession(initRes.status, '/uploads/init')
      const b = await initRes.json().catch(() => ({}))
      throw new Error(b.error ?? `Upload init failed (${initRes.status})`)
    }
    const { upload_id } = (await initRes.json()) as { upload_id: string; offset: number }

    async function serverOffset(): Promise<number | null> {
      try {
        const st = await fetch(`${BASE}/uploads/status?upload_id=${upload_id}`, { credentials: 'include' })
        if (st.ok) return ((await st.json()) as { offset: number }).offset
      } catch { /* ignore */ }
      return null
    }

    let offset = 0
    try {
      while (offset < file.size) {
        const blob = file.slice(offset, Math.min(offset + chunkSize, file.size))
        let attempt = 0
        for (;;) {
          try {
            const res = await fetch(
              `${BASE}/uploads/chunk?upload_id=${upload_id}&offset=${offset}`,
              { method: 'PUT', credentials: 'include', body: blob, signal: opts.signal },
            )
            if (res.status === 409) {
              // Offset drifted — resync from the server and re-slice.
              const so = await serverOffset()
              if (so !== null) offset = so
              break
            }
            if (!res.ok) {
              checkSession(res.status, '/uploads/chunk')
              if (res.status === 401) throw new SessionExpiredError()
              const b = await res.json().catch(() => ({}))
              throw new Error(b.error ?? `Chunk upload failed (${res.status})`)
            }
            offset = ((await res.json()) as { offset: number }).offset
            onProgress(Math.round((offset / Math.max(file.size, 1)) * 100))
            break
          } catch (err) {
            if (opts.signal?.aborted || err instanceof SessionExpiredError) throw err
            if (++attempt > maxRetries) throw err
            const so = await serverOffset()
            if (so !== null) offset = so
            await new Promise((r) => setTimeout(r, 500 * attempt))
          }
        }
      }

      const finRes = await fetch(`${BASE}/uploads/finish`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_id }),
        signal: opts.signal,
      })
      if (!finRes.ok) {
        checkSession(finRes.status, '/uploads/finish')
        const b = await finRes.json().catch(() => ({}))
        throw new Error(b.error ?? `Finalize failed (${finRes.status})`)
      }
      onProgress(100)
    } catch (err) {
      // Best-effort cleanup of the server-side temp file.
      fetch(`${BASE}/uploads/abort?upload_id=${upload_id}`, { method: 'POST', credentials: 'include' }).catch(() => {})
      throw err
    }
  },
}
