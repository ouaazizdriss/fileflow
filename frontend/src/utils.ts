import {
  Archive,
  Code,
  File,
  FileText,
  FileType,
  Folder,
  Image,
  Music,
  Presentation,
  Table,
  Video,
  type LucideIcon,
} from 'lucide-react'
import type { FileEntry } from './types'

export function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${i === 0 ? val : val.toFixed(1)} ${units[i]}`
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 365)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

type IconInfo = { Icon: LucideIcon; color: string }

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','svg','bmp','ico','tiff','avif'])
const VIDEO_EXTS = new Set(['mp4','mov','avi','mkv','webm','flv','wmv','m4v'])
const AUDIO_EXTS = new Set(['mp3','wav','flac','ogg','aac','m4a','opus','wma'])
const CODE_EXTS = new Set(['js','ts','jsx','tsx','py','rs','go','java','cpp','c','h','hpp','cs','php','rb','swift','kt','dart','vue','svelte','html','css','scss','less','json','yaml','yml','toml','xml','sh','bash','zsh','fish','ps1','sql','graphql','proto'])
const ARCHIVE_EXTS = new Set(['zip','tar','gz','bz2','xz','rar','7z','tgz','tbz2'])
const DOC_EXTS = new Set(['pdf'])
const WORD_EXTS = new Set(['doc','docx','docm','odt','rtf'])
const SLIDE_EXTS = new Set(['ppt','pptx','pptm','odp'])
const SHEET_EXTS = new Set(['xls','xlsx','csv','ods'])
const TEXT_EXTS = new Set(['txt','md','rst','log','conf','ini','env','gitignore','dockerfile'])

export function getFileIcon(entry: FileEntry): IconInfo {
  if (entry.is_dir) return { Icon: Folder, color: 'text-yellow-400' }

  const ext = (entry.extension ?? '').toLowerCase()

  if (IMAGE_EXTS.has(ext)) return { Icon: Image, color: 'text-emerald-400' }
  if (VIDEO_EXTS.has(ext)) return { Icon: Video, color: 'text-violet-400' }
  if (AUDIO_EXTS.has(ext)) return { Icon: Music, color: 'text-pink-400' }
  if (CODE_EXTS.has(ext)) return { Icon: Code, color: 'text-sky-400' }
  if (ARCHIVE_EXTS.has(ext)) return { Icon: Archive, color: 'text-orange-400' }
  if (DOC_EXTS.has(ext)) return { Icon: FileText, color: 'text-red-400' }
  if (WORD_EXTS.has(ext)) return { Icon: FileType, color: 'text-blue-400' }
  if (SLIDE_EXTS.has(ext)) return { Icon: Presentation, color: 'text-orange-400' }
  if (SHEET_EXTS.has(ext)) return { Icon: Table, color: 'text-green-500' }
  if (TEXT_EXTS.has(ext)) return { Icon: FileText, color: 'text-slate-400' }

  return { Icon: File, color: 'text-slate-400' }
}

const PREVIEW_EXTS = new Set([
  // Markdown
  'md', 'mdx', 'markdown',
  // CSV / data
  'csv', 'tsv',
  // Code / text (backends often return text/plain for these)
  'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h',
  'sh', 'bash', 'zsh', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf',
  'sql', 'graphql', 'json', 'xml', 'html', 'htm', 'svg', 'css', 'scss',
  'txt', 'log', 'rst', 'dockerfile',
  // Office Open XML — rendered by the in-app docx/xlsx viewers.
  // PowerPoint is intentionally excluded: it's treated as a download-only file
  // (no in-app preview) rather than pulling in a slide-rendering dependency.
  'docx', 'docm', 'xlsx', 'xls', 'xlsm', 'ods',
])

export function isPreviewable(entry: FileEntry): boolean {
  if (entry.is_dir) return false
  const mime = entry.mime_type ?? ''
  const ext = (entry.extension ?? '').toLowerCase()
  return (
    mime.startsWith('image/') ||
    mime.startsWith('text/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime === 'application/json' ||
    mime === 'application/pdf' ||
    mime.includes('javascript') ||
    mime.includes('xml') ||
    PREVIEW_EXTS.has(ext)
  )
}

export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  // Fallback for HTTP (non-secure) contexts
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0'
  document.body.appendChild(el)
  el.focus()
  el.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(el)
  if (!ok) throw new Error('copy failed')
}

export function joinPath(...parts: string[]): string {
  const joined = parts.join('/').replace(/\/+/g, '/')
  return joined || '/'
}

export function dirname(path: string): string {
  const idx = path.lastIndexOf('/')
  if (idx <= 0) return '/'
  return path.slice(0, idx)
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path
}
