import { FormEvent, useState } from 'react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { userMgmt } from '../api'
import type { Permission, UserGroup } from '../types'

interface Props {
  group: UserGroup
  onClose: () => void
  onUpdated: () => void
}

const ALL_PERMS: Permission[] = ['file_read', 'file_write', 'file_delete', 'user_manage', 'group_manage', 'view_audit']

export default function EditGroupModal({ group, onClose, onUpdated }: Props) {
  const { t } = useTranslation()
  const [name, setName] = useState(group.name)
  const [selectedPerms, setSelectedPerms] = useState<Permission[]>(group.permissions)
  const [paths, setPaths] = useState(group.allowed_paths.join('\n'))
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const data: { name?: string, permissions?: Permission[], allowed_paths?: string[] } = {}
      if (name !== group.name) data.name = name
      if (JSON.stringify(selectedPerms) !== JSON.stringify(group.permissions)) data.permissions = selectedPerms
      if (paths.split('\n').filter(p => p.trim()).join('\n') !== group.allowed_paths.join('\n')) {
        data.allowed_paths = paths.split('\n').filter(p => p.trim())
      }

      if (Object.keys(data).length > 0) {
        await userMgmt.updateGroup(group.id, data)
        toast.success('Group updated')
        onUpdated()
      } else {
        onClose()
      }
    } catch (err) {
      toast.error((err as Error).message)
      setLoading(false)
    }
  }

  return (
    <ModalOverlay onClose={onClose} large>
      <form onSubmit={submit} className="p-6 space-y-6">
        <h3 className="text-lg font-semibold">{t('userManagement.editGroupTitle', { name: group.name })}</h3>

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
            placeholder="/shared
/public"
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm h-24 font-mono"
          />
          <p className="text-[10px] text-text-muted mt-1">{t('userManagement.allowedPathsHint')}</p>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-text-muted">{t('common.cancel')}</button>
          <button type="submit" disabled={loading} className="px-6 py-2 text-sm bg-accent text-white rounded-lg">
            {loading ? t('userManagement.saving') : t('userManagement.saveChanges')}
          </button>
        </div>
      </form>
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
