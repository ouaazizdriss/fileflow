import { useEffect, useState } from 'react'
import { FolderOpen, Plus, Trash2, UserPlus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { collab as api } from '../api'
import type { SharedFolder, SharedFolderMember } from '../types'

export default function CollabManager() {
  const { t } = useTranslation()
  const [folders, setFolders] = useState<SharedFolder[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SharedFolder | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    api.list().then(setFolders).catch(() => toast.error('Failed to load shared folders')).finally(() => setLoading(false))
  }, [])

  async function handleDelete(id: string) {
    if (!confirm('Remove this shared folder? Files are not deleted.')) return
    await api.delete(id).catch(() => { toast.error('Delete failed'); return })
    setFolders((prev) => prev.filter((f) => f.id !== id))
    if (selected?.id === id) setSelected(null)
    toast.success('Shared folder removed')
  }

  function handleCreated(folder: SharedFolder) {
    setFolders((prev) => [folder, ...prev])
    setShowCreate(false)
    setSelected(folder)
  }

  async function handleMembersUpdated(folder: SharedFolder) {
    setSelected(folder)
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? folder : f)))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center flex-shrink-0">
          <FolderOpen className="w-5 h-5 text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-text-primary leading-tight">{t('collabManager.title')}</h1>
          <p className="text-xs text-text-secondary mt-0.5">{t('collabManager.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm btn-brand rounded-lg flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t('collabManager.new')}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
          {/* Folder list */}
          <div className="w-64 border-r border-border overflow-y-auto flex-shrink-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-overlay rounded animate-pulse" />)}
              </div>
            ) : folders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-text-muted gap-2 text-sm">
                <FolderOpen className="w-8 h-8 opacity-40" />
                <span>{t('collabManager.noFolders')}</span>
              </div>
            ) : (
              <ul className="py-1">
                {folders.map((f) => (
                  <li key={f.id}>
                    <button
                      onClick={() => setSelected(f)}
                      className={`w-full text-left px-4 py-3 transition-colors flex items-start gap-3 ${selected?.id === f.id ? 'bg-accent/10 text-accent' : 'text-text-primary hover:bg-overlay'}`}
                    >
                      <FolderOpen className="w-4 h-4 flex-shrink-0 mt-0.5 text-yellow-400" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{f.name}</div>
                        <div className="text-xs text-text-muted truncate">{f.path}</div>
                        <div className="text-xs text-text-muted">{f.members.length} member{f.members.length !== 1 ? 's' : ''}</div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Detail panel */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <FolderDetail
                folder={selected}
                onDelete={() => handleDelete(selected.id)}
                onUpdated={handleMembersUpdated}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-text-muted gap-2 text-sm">
                <FolderOpen className="w-10 h-10 opacity-30" />
                <span>{t('collabManager.selectFolder')}</span>
              </div>
            )}
          </div>
        </div>

      {showCreate && (
        <CreateDialog onClose={() => setShowCreate(false)} onCreate={handleCreated} />
      )}
    </div>
  )
}

function FolderDetail({
  folder,
  onDelete,
  onUpdated,
}: {
  folder: SharedFolder
  onDelete: () => void
  onUpdated: (f: SharedFolder) => void
}) {
  const [members, setMembers] = useState<SharedFolderMember[]>(folder.members)
  const [newUser, setNewUser] = useState('')
  const [newWrite, setNewWrite] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMembers(folder.members)
  }, [folder.id])

  async function save(next: SharedFolderMember[]) {
    setSaving(true)
    try {
      const updated = await api.updateMembers(folder.id, next)
      setMembers(updated.members)
      onUpdated(updated)
      toast.success('Members updated')
    } catch {
      toast.error('Failed to update members')
    } finally {
      setSaving(false)
    }
  }

  function addMember() {
    const u = newUser.trim().toLowerCase()
    if (!u || members.some((m) => m.username === u)) return
    const next = [...members, { username: u, can_write: newWrite }]
    setNewUser('')
    setNewWrite(false)
    save(next)
  }

  function removeMember(username: string) {
    save(members.filter((m) => m.username !== username))
  }

  function toggleWrite(username: string) {
    save(members.map((m) => m.username === username ? { ...m, can_write: !m.can_write } : m))
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-text-primary">{folder.name}</h3>
          <p className="text-sm text-text-muted font-mono">{folder.path}</p>
          <p className="text-xs text-text-muted mt-1">Owner: {folder.created_by}</p>
        </div>
        <button onClick={onDelete} className="p-1.5 rounded-md hover:bg-danger/10 text-danger transition-colors" title="Remove shared folder">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Members</h4>
        <div className="space-y-2 mb-4">
          {members.length === 0 && (
            <p className="text-sm text-text-muted">No members yet. Add users below.</p>
          )}
          {members.map((m) => (
            <div key={m.username} className="flex items-center gap-3 bg-overlay rounded-lg px-3 py-2">
              <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
                {m.username[0]?.toUpperCase()}
              </div>
              <span className="flex-1 text-sm text-text-primary">{m.username}</span>
              <button
                onClick={() => toggleWrite(m.username)}
                disabled={saving}
                className={`text-xs px-2 py-0.5 rounded-full transition-colors ${m.can_write ? 'bg-accent/15 text-accent' : 'bg-border text-text-muted hover:bg-elevated'}`}
              >
                {m.can_write ? 'Read & Write' : 'Read only'}
              </button>
              <button onClick={() => removeMember(m.username)} disabled={saving} className="p-1 rounded hover:bg-danger/10 text-danger transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={newUser}
            onChange={(e) => setNewUser(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMember()}
            placeholder="Username"
            className="flex-1 bg-overlay border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
          />
          <label className="flex items-center gap-1.5 text-sm text-text-secondary cursor-pointer flex-shrink-0">
            <input type="checkbox" checked={newWrite} onChange={(e) => setNewWrite(e.target.checked)} className="rounded" />
            Write
          </label>
          <button
            onClick={addMember}
            disabled={!newUser.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-accent/10 hover:bg-accent/20 text-accent rounded-lg transition-colors disabled:opacity-50"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (f: SharedFolder) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [path, setPath] = useState('/')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const folder = await api.create(name.trim(), path || '/')
      onCreate(folder)
      toast.success('Shared folder created')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-elevated border border-border rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-semibold text-text-primary mb-4">{t('collabManager.newFolderTitle')}</h3>
        <div className="space-y-3 mb-5">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">{t('collabManager.namePlaceholder')}</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Team Projects"
              className="w-full bg-overlay border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">{t('collabManager.folderPath')}</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/projects"
              className="w-full bg-overlay border border-border rounded-lg px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-accent"
            />
            <p className="text-xs text-text-muted mt-1">{t('collabManager.folderPathHint')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-3 py-2 text-sm text-text-secondary hover:bg-overlay rounded-lg transition-colors">{t('common.cancel')}</button>
          <button
            onClick={submit}
            disabled={!name.trim() || saving}
            className="flex-1 px-3 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? t('collabManager.creating') : t('collabManager.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
