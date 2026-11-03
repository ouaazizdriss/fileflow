import { useEffect, useRef, useState } from 'react'
import {
  Building2, ChevronDown, ChevronRight, File, Folder, FolderOpen, FolderPlus, Globe,
  HardDrive, Inbox, Info, KeyRound, Link2, LogOut, Moon, Plus, Shield, ShieldCheck,
  Sparkles, Star, Sun, Trash2, Upload, Users,
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { auth, collab as collabApi, files as api, internalShares, shares, uploadRequests } from '../api'
import { useFileStore } from '../store'
import { useThemeStore } from '../theme'
import { dirname } from '../utils'
import type { FileEntry, Role } from '../types'
import StorageQuotaWidget from './StorageQuotaWidget'
import ChangePasswordModal from './ChangePasswordModal'
import TwoFactorModal from './TwoFactorModal'
import AboutModal from './AboutModal'

interface Props {
  username: string
  role: Role
  canOpenAdminPanel: boolean
  totpEnabled: boolean
  onLogout: () => void
  onOpenAdmin: () => void
  onNewRequest: () => void
}

interface TreeNode {
  name: string
  path: string
  children: TreeNode[] | null // null = not loaded
  expanded: boolean
}

function buildNode(entry: FileEntry): TreeNode {
  return { name: entry.name, path: entry.path, children: null, expanded: false }
}

export default function Sidebar({ username, role, canOpenAdminPanel, totpEnabled, onLogout, onOpenAdmin, onNewRequest }: Props) {
  const { t } = useTranslation()
  const { currentPath, navigate, openModal, entries, favorites, activeView, setView } = useFileStore()
  const { theme, cycle: cycleTheme } = useThemeStore()
  const [roots, setRoots] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState({ shared: 0, links: 0, team: 0, requests: 0 })

  const [newOpen, setNewOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [showChangePw, setShowChangePw] = useState(false)
  const [show2FA, setShow2FA] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const newRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  // Initial root load
  useEffect(() => {
    api.list('/').then((listing) => {
      setRoots(listing.entries.filter((e) => e.is_dir).map(buildNode))
      setLoading(false)
    })
  }, [])

  // Live badge counts for the sharing destinations
  useEffect(() => {
    internalShares.list().then((r) => setCounts((c) => ({ ...c, shared: r.received.length }))).catch(() => {})
    shares.list().then((l) => setCounts((c) => ({ ...c, links: l.filter((s) => new Date(s.expires_at).getTime() > Date.now()).length }))).catch(() => {})
    collabApi.list().then((f) => setCounts((c) => ({ ...c, team: f.length }))).catch(() => {})
    uploadRequests.list().then((r) => setCounts((c) => ({ ...c, requests: r.filter((i) => !i.is_expired).length }))).catch(() => {})
  }, [])

  // Keep root list in sync when the main view is at '/' (picks up mkdir/delete)
  useEffect(() => {
    if (currentPath !== '/' || activeView !== 'files') return
    setRoots((prev) =>
      entries
        .filter((e) => e.is_dir)
        .map((e) => prev.find((n) => n.path === e.path) ?? buildNode(e)),
    )
  }, [entries, currentPath, activeView])

  // Close popovers on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (newRef.current && !newRef.current.contains(e.target as Node)) setNewOpen(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  async function toggle(node: TreeNode) {
    if (node.children === null) {
      const listing = await api.list(node.path)
      const children = listing.entries.filter((e) => e.is_dir).map(buildNode)
      setRoots((prev) => updateNode(prev, node.path, (n) => ({ ...n, children, expanded: true })))
    } else {
      setRoots((prev) => updateNode(prev, node.path, (n) => ({ ...n, expanded: !n.expanded })))
    }
  }

  function updateNode(nodes: TreeNode[], path: string, fn: (n: TreeNode) => TreeNode): TreeNode[] {
    return nodes.map((n) => {
      if (n.path === path) return fn(n)
      if (n.children) return { ...n, children: updateNode(n.children, path, fn) }
      return n
    })
  }

  function triggerUpload() {
    setNewOpen(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = () => {
      if (input.files?.length) {
        window.dispatchEvent(new CustomEvent('fileflow:upload', { detail: Array.from(input.files) }))
      }
    }
    input.click()
  }

  function toggleLanguage() {
    const next = i18n.language === 'en' ? 'fr' : 'en'
    i18n.changeLanguage(next)
    localStorage.setItem('fileflow_lang', next)
  }

  async function handleLogout(allDevices = false) {
    try {
      await (allDevices ? auth.logoutAll() : auth.logout())
    } catch {
      /* continue with local logout even if API call fails */
    }
    sessionStorage.clear()
    sessionStorage.setItem('logoutTime', Date.now().toString())
    deleteCookie('fileflow_token')
    deleteCookie('fileflow_2fa_pending')
    localStorage.clear()
    onLogout()
    toast.success(t('toolbar.signedOut'))
  }

  function deleteCookie(name: string) {
    const paths = ['/', '', window.location.pathname]
    const domains = [window.location.hostname, `.${window.location.hostname}`]
    paths.forEach((path) => {
      domains.forEach((domain) => {
        document.cookie = `${name}=; Max-Age=0; Path=${path}; Domain=${domain}; expires=Thu, 01 Jan 1970 00:00:00 UTC;`
        document.cookie = `${name}=; Max-Age=0; Path=${path}; expires=Thu, 01 Jan 1970 00:00:00 UTC;`
      })
    })
  }

  const themeTitle =
    theme === 'light' ? t('toolbar.switchToDark')
    : theme === 'dark' ? t('toolbar.switchToCorporate')
    : theme === 'corporate' ? t('toolbar.switchToFileflow')
    : t('toolbar.switchToLight')
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : theme === 'corporate' ? Building2 : Sparkles

  return (
    <aside className="w-60 flex-shrink-0 bg-surface border-r border-border flex flex-col overflow-hidden">
      {/* Brand + theme / language */}
      <div className="flex items-center gap-2.5 px-4 py-3.5">
        <div className="w-8 h-8 rounded-xl bg-gradient-sunset flex items-center justify-center flex-shrink-0">
          <HardDrive className="w-4 h-4 text-white" />
        </div>
        <span className="text-base font-bold tracking-tight flex-1 text-text-primary">{t('login.title')}</span>
        <button onClick={cycleTheme} title={themeTitle}
          className="p-1.5 rounded-md hover:bg-elevated text-text-secondary hover:text-text-primary transition-colors">
          <ThemeIcon className="w-4 h-4" />
        </button>
        <button onClick={toggleLanguage} title={t('toolbar.langLabel')}
          className="flex items-center gap-1 p-1.5 rounded-md hover:bg-elevated text-text-secondary hover:text-text-primary transition-colors text-xs font-semibold">
          <Globe className="w-3.5 h-3.5" />
          <span className="uppercase">{i18n.language}</span>
        </button>
      </div>

      {/* New action hub */}
      <div ref={newRef} className="px-3 pb-2 relative">
        <button onClick={() => setNewOpen((o) => !o)}
          className="w-full flex items-center justify-center gap-2 btn-brand text-sm font-semibold py-2.5 rounded-xl">
          <Plus className="w-4 h-4" /> {t('sidebar.new')}
        </button>
        {newOpen && (
          <div className="absolute left-3 right-3 top-full mt-1 bg-elevated border border-border rounded-xl shadow-2xl shadow-black/40 p-1.5 z-50 animate-scale-in">
            <button onClick={triggerUpload}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-overlay rounded-lg transition-colors">
              <Upload className="w-4 h-4 text-text-secondary" /> {t('toolbar.uploadFiles')}
            </button>
            <button onClick={() => { openModal('newFolder'); setNewOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-overlay rounded-lg transition-colors">
              <FolderPlus className="w-4 h-4 text-text-secondary" /> {t('toolbar.newFolder')}
            </button>
            <div className="my-1 h-px bg-border mx-1" />
            <button onClick={() => { onNewRequest(); setNewOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text-primary hover:bg-overlay rounded-lg transition-colors">
              <Inbox className="w-4 h-4 text-text-secondary" /> {t('sidebar.requestFiles')}
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-1 min-h-0">
        {/* My files */}
        <NavButton
          icon={<FolderOpen className="w-[18px] h-[18px]" />}
          label={t('sidebar.myFiles')}
          active={activeView === 'files'}
          onClick={() => { setView('files') }}
        />

        {/* Folder tree */}
        {loading ? (
          <div className="px-2 py-1.5 space-y-1">
            {[...Array(3)].map((_, i) => <div key={i} className="h-6 bg-elevated rounded animate-pulse" />)}
          </div>
        ) : (
          <TreeList nodes={roots} depth={1} currentPath={activeView === 'files' ? currentPath : ''} onNavigate={navigate} onToggle={toggle} />
        )}

        {/* Favorites */}
        {favorites.length > 0 && (
          <div className="mt-2">
            <SectionLabel icon={<Star className="w-3 h-3" />} label={t('sidebar.favorites')} />
            {favorites.map((fav) => (
              <button
                key={fav.path}
                onClick={() => navigate(fav.is_dir ? fav.path : dirname(fav.path))}
                title={fav.path}
                className={clsx(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-lg transition-colors',
                  activeView === 'files' && currentPath === fav.path
                    ? 'bg-accent/15 text-accent'
                    : 'text-text-secondary hover:bg-elevated hover:text-text-primary',
                )}
              >
                {fav.is_dir
                  ? <Folder className="w-3.5 h-3.5 flex-shrink-0 text-accent" />
                  : <File className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />}
                <span className="truncate">{fav.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Sharing destinations */}
        <SectionLabel icon={<Users className="w-3 h-3" />} label={t('sidebar.sharing')} />
        <NavButton icon={<Users className="w-[18px] h-[18px]" />} label={t('sidebar.sharedWithMe')}
          active={activeView === 'shared'} badge={counts.shared} onClick={() => setView('shared')} />
        <NavButton icon={<Link2 className="w-[18px] h-[18px]" />} label={t('sidebar.myLinks')}
          active={activeView === 'links'} badge={counts.links} onClick={() => setView('links')} />
        <NavButton icon={<Folder className="w-[18px] h-[18px]" />} label={t('sidebar.teamFolders')}
          active={activeView === 'team'} badge={counts.team} onClick={() => setView('team')} />
        <NavButton icon={<Inbox className="w-[18px] h-[18px]" />} label={t('sidebar.uploadRequests')}
          active={activeView === 'requests'} badge={counts.requests} onClick={() => setView('requests')} />

        <div className="my-2 h-px bg-border mx-1" />
        <NavButton icon={<Trash2 className="w-[18px] h-[18px]" />} label={t('sidebar.trash')}
          active={activeView === 'trash'} onClick={() => setView('trash')} />
      </div>

      {/* Storage */}
      <div className="border-t border-border px-3 py-3 flex-shrink-0">
        <StorageQuotaWidget />
      </div>

      {/* Admin */}
      {canOpenAdminPanel && (
        <button onClick={onOpenAdmin}
          className="mx-3 mb-1 flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-lg text-text-secondary hover:bg-elevated hover:text-text-primary transition-colors">
          <Shield className="w-[18px] h-[18px] text-accent" />
          <span className="flex-1 text-left">{t('sidebar.admin')}</span>
        </button>
      )}

      {/* User chip */}
      <div ref={userRef} className="border-t border-border p-2 relative flex-shrink-0">
        <button onClick={() => setUserOpen((o) => !o)}
          className={clsx('w-full flex items-center gap-2.5 p-1.5 rounded-xl transition-colors', userOpen ? 'bg-elevated' : 'hover:bg-elevated')}>
          <div className="w-8 h-8 rounded-full bg-gradient-sunset flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {username[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-text-primary truncate">{username}</p>
            <p className="text-xs text-text-muted truncate">
              {canOpenAdminPanel ? role.charAt(0).toUpperCase() + role.slice(1) : t('toolbar.standardUser')}
            </p>
          </div>
          <ChevronDown className={clsx('w-4 h-4 text-text-muted transition-transform flex-shrink-0', userOpen && 'rotate-180')} />
        </button>

        {userOpen && (
          <div className="absolute left-2 right-2 bottom-full mb-1 bg-elevated border border-border rounded-xl shadow-2xl shadow-black/40 py-1.5 z-50 animate-scale-in">
            <button onClick={() => { setShowChangePw(true); setUserOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-text-primary hover:bg-overlay transition-colors">
              <KeyRound className="w-4 h-4 text-text-secondary" /> {t('toolbar.changePassword')}
            </button>
            <button onClick={() => { setShow2FA(true); setUserOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-text-primary hover:bg-overlay transition-colors">
              <ShieldCheck className="w-4 h-4 text-text-secondary" />
              <span className="flex-1 text-left">{t('toolbar.twoFactorAuth')}</span>
              {totpEnabled && <span className="text-xs text-success font-medium">On</span>}
            </button>
            <button onClick={() => { setShowAbout(true); setUserOpen(false) }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-text-primary hover:bg-overlay transition-colors">
              <Info className="w-4 h-4 text-text-secondary" /> {t('toolbar.about')}
            </button>
            <div className="my-1 h-px bg-border mx-2" />
            <button onClick={() => handleLogout(false)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-danger hover:bg-danger/10 transition-colors">
              <LogOut className="w-4 h-4" /> {t('toolbar.signOut')}
            </button>
            <button onClick={() => handleLogout(true)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-text-muted hover:bg-overlay hover:text-text-secondary transition-colors">
              <ShieldCheck className="w-3.5 h-3.5" /> {t('toolbar.signOutAll')}
            </button>
          </div>
        )}
      </div>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
      {show2FA && <TwoFactorModal totpEnabled={totpEnabled} onClose={() => setShow2FA(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </aside>
  )
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pt-3 pb-1.5 text-text-muted">
      {icon}
      <span className="text-[10.5px] font-bold uppercase tracking-wider">{label}</span>
    </div>
  )
}

function NavButton({ icon, label, active, badge, onClick }: {
  icon: React.ReactNode
  label: string
  active: boolean
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-lg transition-colors font-medium',
        active ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:bg-elevated hover:text-text-primary',
      )}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="flex-1 text-left truncate">{label}</span>
      {badge != null && badge > 0 && (
        <span className={clsx(
          'min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums flex items-center justify-center',
          active ? 'bg-accent text-white' : 'bg-accent/15 text-accent',
        )}>
          {badge}
        </span>
      )}
    </button>
  )
}

interface TreeListProps {
  nodes: TreeNode[]
  depth: number
  currentPath: string
  onNavigate: (path: string) => void
  onToggle: (node: TreeNode) => void
}

function TreeList({ nodes, depth, currentPath, onNavigate, onToggle }: TreeListProps) {
  if (nodes.length === 0) return null
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.path}>
          <div
            className={clsx(
              'flex items-center gap-1.5 py-1 pr-2 text-sm rounded-lg cursor-pointer transition-colors group',
              currentPath === node.path
                ? 'bg-accent/15 text-accent'
                : 'text-text-secondary hover:bg-elevated hover:text-text-primary',
            )}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
          >
            <button
              onClick={() => onToggle(node)}
              className="flex-shrink-0 w-4 h-4 flex items-center justify-center opacity-50 hover:opacity-100"
            >
              <ChevronRight className={clsx('w-3 h-3 transition-transform duration-150', node.expanded && 'rotate-90')} />
            </button>
            <button className="flex items-center gap-1.5 flex-1 min-w-0" onClick={() => onNavigate(node.path)}>
              {node.expanded
                ? <FolderOpen className="w-3.5 h-3.5 flex-shrink-0 text-accent" />
                : <Folder className="w-3.5 h-3.5 flex-shrink-0 text-accent" />}
              <span className="truncate">{node.name}</span>
            </button>
          </div>
          {node.expanded && node.children && (
            <TreeList nodes={node.children} depth={depth + 1} currentPath={currentPath} onNavigate={onNavigate} onToggle={onToggle} />
          )}
        </li>
      ))}
    </ul>
  )
}
