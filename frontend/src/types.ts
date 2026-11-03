export interface FileEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: string | null
  extension: string | null
  mime_type: string | null
}

export interface DirectoryListing {
  path: string
  entries: FileEntry[]
  parent: string | null
}

export type ViewMode = 'grid' | 'list'
export type SortField = 'name' | 'size' | 'modified' | 'type'
export type SortOrder = 'asc' | 'desc'

export interface UploadItem {
  id: string
  name: string
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
  size?: number
}

export type ModalType = 'rename' | 'newFolder' | 'delete' | 'move' | 'trash' | 'versions' | 'bulkTag' | null

export interface TrashEntry {
  id: string
  original_path: string
  deleted_at: string
  username: string
}

export interface VersionEntry {
  path: string
  version_id: string
  timestamp: string
  size: number
}

export interface FileMetadata {
  tags: string[]
  collections: string[]
}

export type Role = 'admin' | 'manager' | 'editor' | 'viewer' | 'user'

export type Permission =
  | 'file_read'
  | 'file_write'
  | 'file_delete'
  | 'user_manage'
  | 'group_manage'
  | 'view_audit'

export type UserStatus = 'active' | 'disabled'

export interface UserMetadata {
  full_name: string | null
  email: string | null
}

export interface UserGroup {
  id: string
  name: string
  permissions: Permission[]
  allowed_paths: string[]
}

export interface UserInfo {
  username: string
  role: Role
  permissions: Permission[]
  totp_enabled: boolean
}

export interface LoginChallenge {
  requires_2fa: true
}

export interface UserView {
  username: string
  role: Role
  status: UserStatus
  permissions: Permission[]
  groups: string[]
  quota_gb: number | null
  used_bytes: number
  last_login: string | null
  metadata: UserMetadata
  created_at: string
}

export interface AuditEntry {
  timestamp: string
  username: string
  action: string
  resource: string | null
  ip: string | null
  details: string | null
}

export interface ShareLink {
  token: string
  file_path: string
  filename: string
  created_by: string
  created_at: string
  expires_at: string
  has_password: boolean
  max_downloads: number | null
  download_count: number
}

export interface SharedFolderMember {
  username: string
  can_write: boolean
}

export interface SharedFolder {
  id: string
  name: string
  path: string
  created_by: string
  created_at: string
  members: SharedFolderMember[]
}

export interface Favorite {
  username: string
  path: string
  name: string
  is_dir: boolean
  created_at: string
}

export interface InternalShare {
  id: string
  path: string
  name: string
  is_dir: boolean
  owner: string
  recipient: string
  can_write: boolean
  created_at: string
}

export interface UploadRequestView {
  token: string
  name: string
  folder_path: string
  created_by: string
  created_at: string
  expires_at: string | null
  has_password: boolean
  is_expired: boolean
}
