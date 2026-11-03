import { FormEvent, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  LayoutGrid,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Shield,
  Trash2,
  User,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { userMgmt } from '../api'
import type { AuditEntry, Permission, Role, UserGroup, UserView } from '../types'
import { formatDate } from '../utils'
import EditGroupModal from './EditGroupModal'

type AuditFilters = NonNullable<Parameters<typeof userMgmt.listAudit>[0]>

interface Props {
  currentUser: string
  canManageUsers: boolean
  canManageGroups: boolean
  canViewAudit: boolean
  onClose: () => void
}

type Tab = 'users' | 'groups' | 'audit'

export default function UserManagement({ currentUser, canManageUsers, canManageGroups, canViewAudit, onClose }: Props) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<Tab>('users')
  const [users, setUsers] = useState<UserView[]>([])
  const [groups, setGroups] = useState<UserGroup[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  const [showAddUser, setShowAddUser] = useState(false)
  const [showAddGroup, setShowAddGroup] = useState(false)
  const [editingUser, setEditingUser] = useState<UserView | null>(null)
  const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'user' | 'group', id: string, name: string } | null>(null)
  const [auditFilters, setAuditFilters] = useState<AuditFilters>({})

  const tabLabels: Record<Tab, string> = {
    users: t('userManagement.tabUsers'),
    groups: t('userManagement.tabGroups'),
    audit: t('userManagement.tabAudit'),
  }

  async function load() {
    setLoading(true)
    try {
      if (activeTab === 'users') {
        const [u, g] = await Promise.all([userMgmt.list(), userMgmt.listGroups()])
        setUsers(u)
        setGroups(g)
      } else if (activeTab === 'groups') {
        setGroups(await userMgmt.listGroups())
      } else if (activeTab === 'audit') {
        setAuditLogs(await userMgmt.listAudit())
      }
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleAuditFilterChange = async (filters: AuditFilters) => {
    setAuditFilters(filters)
    setLoading(true)
    try {
      const logs = await userMgmt.listAudit(filters)
      setAuditLogs(logs)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleAuditExport = async () => {
    try {
      const response = await userMgmt.exportAudit(auditFilters)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const filename = response.headers.get('content-disposition')?.split('filename="')[1]?.split('"')[0] || 'audit.csv'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  useEffect(() => { load() }, [activeTab])

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-3xl bg-surface border-l border-border flex flex-col h-full animate-slide-in-right shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-accent/15 flex items-center justify-center">
              <Users className="w-4 h-4 text-accent" />
            </div>
            <h2 className="text-base font-semibold text-text-primary">{t('userManagement.title')}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-elevated text-text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-6 border-b border-border bg-elevated/30">
          {(['users', 'groups', 'audit'] as Tab[]).filter(tab => {
            if (tab === 'users') return canManageUsers
            if (tab === 'groups') return canManageGroups
            if (tab === 'audit') return canViewAudit
            return false
          }).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors capitalize',
                activeTab === tab
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-muted hover:text-text-primary'
              )}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* The audit table shows its own loading state: unmounting it here would re-run its fetch-on-mount effect forever. */}
          {loading && activeTab !== 'audit' ? (
            <div className="flex items-center justify-center h-40 text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              {t('userManagement.loading')}
            </div>
          ) : (
            <div className="p-6">
              {activeTab === 'users' && (
                <UserList
                  users={users}
                  currentUser={currentUser}
                  onAdd={() => setShowAddUser(true)}
                  onEdit={setEditingUser}
                  onDelete={(u) => setDeleteTarget({ type: 'user', id: u.username, name: u.username })}
                />
              )}
              {activeTab === 'groups' && (
                <GroupList
                  groups={groups}
                  onAdd={() => setShowAddGroup(true)}
                  onEdit={setEditingGroup}
                  onDelete={(g) => setDeleteTarget({ type: 'group', id: g.id, name: g.name })}
                />
              )}
              {activeTab === 'audit' && <AuditLogTable logs={auditLogs} isLoading={loading} onFilterChange={handleAuditFilterChange} onExport={handleAuditExport} />}
            </div>
          )}
        </div>

        {/* Modals */}
        {showAddUser && (
          <AddUserModal onClose={() => setShowAddUser(false)} onCreated={() => { setShowAddUser(false); load() }} />
        )}
        {showAddGroup && (
          <AddGroupModal onClose={() => setShowAddGroup(false)} onCreated={() => { setShowAddGroup(false); load() }} />
        )}
        {editingUser && (
          <EditUserModal
            user={editingUser}
            groups={groups}
            onClose={() => setEditingUser(null)}
            onUpdated={() => { setEditingUser(null); load() }}
          />
        )}
        {editingGroup && (
          <EditGroupModal
            group={editingGroup}
            onClose={() => setEditingGroup(null)}
            onUpdated={() => { setEditingGroup(null); load() }}
          />
        )}
        {deleteTarget && (
          <DeleteConfirmModal
            target={deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onDeleted={() => { setDeleteTarget(null); load() }}
          />
        )}
      </div>
    </div>
  )
}

// ─── User List ────────────────────────────────────────────────────────────────

function UserList({ users, currentUser, onAdd, onEdit, onDelete }: {
  users: UserView[]
  currentUser: string
  onAdd: () => void
  onEdit: (u: UserView) => void
  onDelete: (u: UserView) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-text-secondary capitalize">{t('userManagement.tabUsers')}</h3>
        <button onClick={onAdd} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> {t('userManagement.addUser')}
        </button>
      </div>
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-elevated/50 text-text-muted text-xs uppercase font-semibold">
            <tr>
              <th className="px-4 py-3">{t('userManagement.colUser')}</th>
              <th className="px-4 py-3">{t('common.status')}</th>
              <th className="px-4 py-3">{t('common.role')}</th>
              <th className="px-4 py-3">{t('userManagement.colLastLogin')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {users.map(u => (
              <tr key={u.username} className="hover:bg-elevated/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-xs font-bold">
                      {u.username[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-text-primary">{u.username}</div>
                      <div className="text-[10px] text-text-muted">{u.metadata.email || t('userManagement.noEmail')}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={clsx(
                    'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase',
                    u.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'
                  )}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-secondary capitalize">{u.role}</td>
                <td className="px-4 py-3 text-text-muted text-xs">{u.last_login ? formatDate(u.last_login) : t('userManagement.never')}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-1 justify-end">
                    <button onClick={() => onEdit(u)} className="p-1.5 hover:bg-elevated rounded-lg text-text-muted hover:text-text-primary">
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDelete(u)}
                      disabled={u.username === currentUser}
                      className="p-1.5 hover:bg-danger/10 rounded-lg text-text-muted hover:text-danger disabled:opacity-20"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Group List ───────────────────────────────────────────────────────────────

function GroupList({ groups, onAdd, onEdit, onDelete }: {
  groups: UserGroup[]
  onAdd: () => void
  onEdit: (g: UserGroup) => void
  onDelete: (g: UserGroup) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-text-secondary capitalize">{t('userManagement.tabGroups')}</h3>
        <button onClick={onAdd} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> {t('userManagement.createGroup')}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {groups.map(g => (
          <div key={g.id} className="p-4 border border-border rounded-xl bg-elevated/20 group">
            <div className="flex justify-between items-start mb-2">
              <div className="font-semibold text-text-primary">{g.name}</div>
              <div className="flex gap-1">
                <button onClick={() => onEdit(g)} className="p-1 text-text-muted hover:text-accent opacity-0 group-hover:opacity-100 transition-opacity">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(g)} className="p-1 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {g.permissions.map(p => (
                <span key={p} className="px-1.5 py-0.5 bg-accent/10 text-accent text-[9px] font-bold rounded uppercase">
                  {p.replace('_', ' ')}
                </span>
              ))}
            </div>
            <div className="text-[10px] text-text-muted flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" />
              {g.allowed_paths.length > 0
                ? t('userManagement.pathsRestricted', { count: g.allowed_paths.length })
                : t('userManagement.allPaths')}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="col-span-2 py-10 text-center text-text-muted text-sm border border-dashed border-border rounded-xl">
            {t('userManagement.noGroups')}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

const ACTION_CATEGORIES = {
  auth: ['login', 'login_failed', 'logout', 'password_change', 'password_reset_admin', 'password_change_failed'],
  files: ['upload', 'download', 'preview', 'mkdir', 'rename', 'move', 'trash', 'restore', 'restore_version', 'update_tags', 'version_archive', 'trash_empty'],
  admin: ['user_create', 'user_update', 'user_delete', 'group_create', 'group_update', 'group_delete'],
  collab: ['share_create', 'share_delete', 'shared_folder_create', 'shared_folder_delete', 'shared_folder_members_update'],
}

function AuditLogTable({ logs, isLoading, onFilterChange, onExport }: {
  logs: AuditEntry[]
  isLoading: boolean
  onFilterChange: (filters: AuditFilters) => void
  onExport: () => void
}) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 100

  const applyFilters = () => {
    onFilterChange({
      username: username || undefined,
      action: actionFilter || undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
      limit: pageSize,
      offset: page * pageSize,
    })
  }

  const clearFilters = () => {
    setUsername('')
    setActionFilter('')
    setDateFrom('')
    setDateTo('')
    setPage(0)
    onFilterChange({
      limit: pageSize,
      offset: 0,
    })
  }

  useEffect(() => {
    applyFilters()
  }, [page])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-secondary">{t('userManagement.auditTitle')}</h3>
        <button onClick={onExport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent/10 hover:bg-accent/20 text-accent rounded-lg transition-colors">
          <Download className="w-3 h-3" />
          Export CSV
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-elevated/30 border border-border rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs"
          />
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs"
          >
            <option value="">All Actions</option>
            <optgroup label="Authentication">
              {ACTION_CATEGORIES.auth.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
            <optgroup label="Files">
              {ACTION_CATEGORIES.files.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
            <optgroup label="Admin">
              {ACTION_CATEGORIES.admin.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
            <optgroup label="Collaboration">
              {ACTION_CATEGORIES.collab.map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs"
            title="From date"
          />
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-xs"
            title="To date"
          />
          <div className="flex gap-2">
            <button onClick={applyFilters} className="flex-1 px-3 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/90 font-medium">
              Apply
            </button>
            <button onClick={clearFilters} className="flex-1 px-3 py-1.5 text-xs bg-surface border border-border text-text-primary rounded-lg hover:bg-elevated">
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-elevated/50 text-text-muted uppercase font-semibold sticky top-0">
              <tr>
                <th className="px-4 py-2 whitespace-nowrap">Time</th>
                <th className="px-4 py-2 whitespace-nowrap">User</th>
                <th className="px-4 py-2 whitespace-nowrap">Action</th>
                <th className="px-4 py-2 whitespace-nowrap">Resource</th>
                <th className="px-4 py-2 whitespace-nowrap">IP</th>
                <th className="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 font-mono">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                    No audit entries found
                  </td>
                </tr>
              ) : (
                logs.map((log, i) => (
                  <tr key={i} className="hover:bg-elevated/30 transition-colors">
                    <td className="px-4 py-2 text-text-muted whitespace-nowrap text-[10px]">{formatDate(log.timestamp)}</td>
                    <td className="px-4 py-2 text-accent font-semibold whitespace-nowrap">{log.username}</td>
                    <td className="px-4 py-2 text-text-primary whitespace-nowrap">
                      <span className="px-1.5 py-0.5 bg-surface border border-border rounded text-[9px] uppercase">{log.action}</span>
                    </td>
                    <td className="px-4 py-2 text-text-secondary truncate max-w-[150px]" title={log.resource || ''}>
                      {log.resource || '-'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary whitespace-nowrap text-[10px]">
                      {log.ip || '-'}
                    </td>
                    <td className="px-4 py-2 text-text-secondary truncate max-w-[200px]" title={log.details || ''}>
                      {log.details || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {!isLoading && logs.length > 0 && (
        <div className="flex items-center justify-between text-xs text-text-muted">
          <div>Showing {page * pageSize + 1} - {page * pageSize + logs.length}</div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 border border-border rounded-lg hover:bg-elevated disabled:opacity-50"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1.5">Page {page + 1}</span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={logs.length < pageSize}
              className="px-3 py-1.5 border border-border rounded-lg hover:bg-elevated disabled:opacity-50"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function AddUserModal({ onClose, onCreated }: { onClose: () => void, onCreated: () => void }) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('user')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await userMgmt.create(username, password, role)
      toast.success(t('userManagement.userCreated'))
      onCreated()
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} large>
      <form onSubmit={submit} className="p-6 space-y-4">
        <h3 className="text-base font-semibold">{t('userManagement.createUserTitle')}</h3>
        <input
          autoFocus placeholder={t('userManagement.usernameLabel')}
          value={username} onChange={e => setUsername(e.target.value)}
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="password" placeholder={t('userManagement.passwordLabel')}
          value={password} onChange={e => setPassword(e.target.value)}
          className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm"
        />
        <div>
          <label className="block text-xs font-bold text-text-muted uppercase mb-2">{t('userManagement.globalRole')}</label>
          <div className="grid grid-cols-3 gap-2">
            {(['admin', 'manager', 'editor', 'viewer', 'user'] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={clsx(
                  'flex items-center justify-center gap-2 py-2 rounded-lg text-xs border transition-colors capitalize font-medium',
                  role === r ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:text-text-primary'
                )}
              >
                {r === 'admin' || r === 'manager' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-text-muted">{t('common.cancel')}</button>
          <button type="submit" disabled={loading} className="px-4 py-2 text-sm bg-accent text-white rounded-lg">
            {loading ? t('userManagement.creating') : t('userManagement.create')}
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}

function EditUserModal({ user, groups, onClose, onUpdated }: {
  user: UserView,
  groups: UserGroup[],
  onClose: () => void,
  onUpdated: () => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState(user.status)
  const [role, setRole] = useState(user.role)
  const [quota, setQuota] = useState(user.quota_gb?.toString() || '')
  const [selectedGroups, setSelectedGroups] = useState<string[]>(user.groups)
  const [permissions, setPermissions] = useState<Permission[]>(user.permissions)
  const [loading, setLoading] = useState(false)

  const ALL_PERMS: Permission[] = ['file_read', 'file_write', 'file_delete', 'user_manage', 'group_manage', 'view_audit']

  const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    admin: ['file_read', 'file_write', 'file_delete', 'user_manage', 'group_manage', 'view_audit'],
    manager: ['file_read', 'file_write', 'file_delete', 'user_manage', 'group_manage', 'view_audit'],
    editor: ['file_read', 'file_write', 'file_delete'],
    viewer: ['file_read'],
    user: ['file_read'],
  }

  function applyRoleTemplate(selectedRole: Role) {
    setRole(selectedRole)
    setPermissions(ROLE_PERMISSIONS[selectedRole])
  }

  async function save() {
    setLoading(true)
    try {
      await userMgmt.update(user.username, {
        status,
        role,
        quota_gb: quota ? parseFloat(quota) : null,
        groups: selectedGroups,
        permissions
      })
      toast.success(t('userManagement.userUpdated'))
      onUpdated()
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} large>
      <div className="p-6 space-y-6">
        <div className="flex justify-between items-center border-b border-border pb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <User className="w-5 h-5" /> {t('userManagement.editUserTitle', { username: user.username })}
          </h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="w-5 h-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase mb-2">{t('userManagement.accountStatus')}</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setStatus('active')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm border',
                    status === 'active' ? 'bg-green-500/10 border-green-500 text-green-500' : 'border-border text-text-muted'
                  )}
                >
                  <UserCheck className="w-4 h-4" /> {t('userManagement.active')}
                </button>
                <button
                  onClick={() => setStatus('disabled')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm border',
                    status === 'disabled' ? 'bg-red-500/10 border-red-500 text-red-500' : 'border-border text-text-muted'
                  )}
                >
                  <UserMinus className="w-4 h-4" /> {t('userManagement.disabled')}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-text-muted uppercase mb-2">{t('userManagement.globalRole')}</label>
              <div className="grid grid-cols-2 gap-2">
                {(['admin', 'manager', 'editor', 'viewer', 'user'] as Role[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => applyRoleTemplate(r)}
                    className={clsx(
                      'flex items-center justify-center gap-2 py-2 rounded-lg text-sm border transition-colors capitalize',
                      role === r ? 'bg-accent/10 border-accent text-accent' : 'border-border text-text-muted hover:text-text-primary'
                    )}
                  >
                    {r === 'admin' || r === 'manager' ? <Shield className="w-4 h-4" /> : <User className="w-4 h-4" />}
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-text-muted uppercase mb-2">{t('userManagement.storageQuota')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="number" step="0.1" placeholder={t('userManagement.unlimited')}
                  value={quota} onChange={e => setQuota(e.target.value)}
                  className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm"
                />
                <Database className="w-5 h-5 text-text-muted" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-text-muted uppercase mb-2">{t('userManagement.directPermissions')}</label>
              <div className="space-y-2">
                {ALL_PERMS.map(perm => (
                  <label key={perm} className="flex items-center gap-2 p-2 hover:bg-elevated rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions.includes(perm)}
                      onChange={e => {
                        if (e.target.checked) setPermissions([...permissions, perm])
                        else setPermissions(permissions.filter(p => p !== perm))
                      }}
                      className="accent-accent"
                    />
                    <span className="text-sm capitalize">{perm.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-bold text-text-muted uppercase">{t('userManagement.groupMemberships')}</label>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
              {groups.map(g => (
                <label key={g.id} className="flex items-center gap-2 p-2 hover:bg-elevated rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedGroups.includes(g.id)}
                    onChange={e => {
                      if (e.target.checked) setSelectedGroups([...selectedGroups, g.id])
                      else setSelectedGroups(selectedGroups.filter(id => id !== g.id))
                    }}
                    className="accent-accent"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{g.name}</div>
                    <div className="text-[10px] text-text-muted">{g.permissions.length} {t('userManagement.perms')}</div>
                  </div>
                </label>
              ))}
              {groups.length === 0 && <div className="text-xs text-text-muted italic">{t('userManagement.noGroupsDefined')}</div>}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted hover:text-text-primary">{t('common.cancel')}</button>
          <button onClick={save} disabled={loading} className="px-6 py-2 text-sm bg-accent text-white rounded-lg font-semibold">
            {loading ? t('userManagement.saving') : t('userManagement.saveChanges')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function AddGroupModal({ onClose, onCreated }: { onClose: () => void, onCreated: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [selectedPerms, setSelectedPerms] = useState<Permission[]>([])
  const [paths, setPaths] = useState('')
  const [loading, setLoading] = useState(false)

  const ALL_PERMS: Permission[] = ['file_read', 'file_write', 'file_delete', 'user_manage', 'group_manage', 'view_audit']

  async function submit() {
    setLoading(true)
    try {
      await userMgmt.createGroup(name, selectedPerms, paths.split('\n').filter(p => p.trim()))
      toast.success(t('userManagement.groupCreated'))
      onCreated()
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} large>
      <div className="p-6 space-y-6">
        <h3 className="text-lg font-semibold">{t('userManagement.createGroupTitle')}</h3>

        <div>
          <label className="block text-xs font-bold text-text-muted uppercase mb-2">{t('userManagement.groupName')}</label>
          <input
            autoFocus value={name} onChange={e => setName(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-text-muted uppercase mb-2">{t('userManagement.permissions')}</label>
          <div className="grid grid-cols-2 gap-2">
            {ALL_PERMS.map(p => (
              <label key={p} className="flex items-center gap-2 p-2 border border-border rounded-lg cursor-pointer hover:bg-elevated">
                <input
                  type="checkbox"
                  checked={selectedPerms.includes(p)}
                  onChange={e => {
                    if (e.target.checked) setSelectedPerms([...selectedPerms, p])
                    else setSelectedPerms(selectedPerms.filter(id => id !== p))
                  }}
                  className="accent-accent"
                />
                <span className="text-xs capitalize">{p.replace('_', ' ')}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold text-text-muted uppercase mb-2">{t('userManagement.allowedPaths')}</label>
          <textarea
            value={paths} onChange={e => setPaths(e.target.value)}
            placeholder="/shared\n/public"
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm h-24 font-mono"
          />
          <p className="text-[10px] text-text-muted mt-1">{t('userManagement.allowedPathsHint')}</p>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted">{t('common.cancel')}</button>
          <button onClick={submit} disabled={loading || !name} className="px-6 py-2 text-sm bg-accent text-white rounded-lg">
            {loading ? t('userManagement.creatingGroup') : t('userManagement.createGroupBtn')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function DeleteConfirmModal({ target, onClose, onDeleted }: {
  target: { type: 'user' | 'group', id: string, name: string },
  onClose: () => void,
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)

  async function confirm() {
    setLoading(true)
    try {
      if (target.type === 'user') await userMgmt.delete(target.id)
      else await userMgmt.deleteGroup(target.id)
      toast.success(target.type === 'user' ? t('userManagement.userDeleted') : t('userManagement.groupDeleted'))
      onDeleted()
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-danger/15 flex items-center justify-center text-danger">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold">{t('userManagement.deleteTitle', { type: target.type })}</h3>
        </div>
        <p className="text-sm text-text-secondary mb-6">
          {t('userManagement.deleteConfirm')} <span className="text-text-primary font-bold">{target.name}</span>?
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted">{t('common.cancel')}</button>
          <button onClick={confirm} disabled={loading} className="px-4 py-2 text-sm bg-danger text-white rounded-lg">
            {loading ? t('userManagement.deleting') : t('common.delete')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function ModalOverlay({ children, onClose, large }: { children: React.ReactNode, onClose: () => void, large?: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className={clsx("bg-surface border border-border rounded-2xl shadow-2xl mx-4 animate-scale-in w-full", large ? 'max-w-2xl' : 'max-w-sm')} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
