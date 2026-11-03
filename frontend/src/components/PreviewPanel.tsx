import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Tag, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'
import { renderMarkdown, parseCsv } from '../markdown'
import { sanitizeHtml } from '../sanitize'
import { highlightCode, isSyntaxHighlightable, SYNTAX_HIGHLIGHT_CSS } from '../syntax'
import type { FileEntry } from '../types'
import { formatSize, formatDate } from '../utils'

interface Props {
  file: FileEntry
  onClose: () => void
}

const PANEL_CSV_ROWS = 20
const PANEL_CSV_COLS = 6

export default function PreviewPanel({ file, onClose }: Props) {
  const { t } = useTranslation()
  const mime = file.mime_type ?? ''
  const ext  = (file.extension ?? '').toLowerCase()

  const isMd    = ['md', 'mdx', 'markdown'].includes(ext) || mime === 'text/markdown'
  const isCsv   = ext === 'csv' || mime === 'text/csv'
  const isImage = mime.startsWith('image/')
  const isPdf   = mime === 'application/pdf'
  const isText  = !isMd && !isCsv && (
    mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript')
  )

  const [rawContent, setRawContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [collections, setCollections] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)
  const previewUrl = api.previewUrl(file.path)

  useEffect(() => {
    if (isText || isMd || isCsv) {
      setLoading(true)
      const ctrl = new AbortController()
      fetch(previewUrl, { credentials: 'include', signal: ctrl.signal })
        .then(r => r.text())
        .then(t => { setRawContent(t); setLoading(false) })
        .catch(e => { if ((e as Error).name !== 'AbortError') setLoading(false) })
      return () => ctrl.abort()
    }
  }, [file.path])

  useEffect(() => {
    api.getTags(file.path)
      .then((meta) => { setTags(meta.tags); setCollections(meta.collections) })
      .catch(() => {})
  }, [file.path])

  async function saveTags(newTags: string[], newCollections: string[]) {
    try {
      await api.setTags(file.path, newTags, newCollections)
    } catch {
      toast.error('Failed to save tags')
    }
  }

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase()
    if (!tag || tags.includes(tag)) return
    const next = [...tags, tag]
    setTags(next)
    saveTags(next, collections)
    setTagInput('')
  }

  function removeTag(tag: string) {
    const next = tags.filter((x) => x !== tag)
    setTags(next)
    saveTags(next, collections)
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const mdHtml = useMemo(
    () => (isMd && rawContent != null ? renderMarkdown(rawContent) : null),
    [isMd, rawContent],
  )

  const csvData = useMemo(
    () => (isCsv && rawContent != null ? parseCsv(rawContent) : null),
    [isCsv, rawContent],
  )

  const loadingSkeleton = (
    <div className="p-3 space-y-2">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="h-3 bg-elevated rounded animate-pulse"
          style={{ width: `${60 + (i * 31 + 7) % 35}%` }} />
      ))}
    </div>
  )

  return (
    <div className="w-80 border-l border-border bg-surface flex flex-col flex-shrink-0 animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
        <span className="text-sm font-semibold text-text-primary truncate">{file.name}</span>
        <div className="flex items-center gap-1">
          <a
            href={api.downloadUrl(file.path)}
            download={file.name}
            className="p-1.5 rounded-md hover:bg-elevated text-text-secondary hover:text-text-primary transition-colors"
            title={t('common.download')}
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-elevated text-text-secondary hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-auto min-h-0">

        {isImage && (
          <div className="flex items-center justify-center p-4 min-h-[200px]">
            <img
              src={previewUrl}
              alt={file.name}
              className="max-w-full max-h-[400px] rounded-lg object-contain"
            />
          </div>
        )}

        {isPdf && (
          // No sandbox — served as application/pdf + nosniff (cannot run as
          // HTML); the native PDF viewer needs scripts to render.
          // eslint-disable-next-line @eslint-react/dom-no-missing-iframe-sandbox
          <iframe
            src={previewUrl}
            className="w-full h-full min-h-[400px]"
            title={file.name}
          />
        )}

        {isMd && (
          loading || mdHtml === null ? loadingSkeleton : (
            <div
              className="md-body px-4 py-4 text-[13px]"
              // HTML is escaped by renderMarkdown and re-sanitized via DOMPurify.
              // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(mdHtml) }} // eslint-disable-line @eslint-react/dom-no-dangerously-set-innerhtml
            />
          )
        )}

        {isCsv && (
          loading || csvData === null ? loadingSkeleton : (
            <PanelCsvTable rows={csvData} />
          )
        )}

        {isText && (
          <div className="p-3">
            {loading ? loadingSkeleton : isSyntaxHighlightable(file.name) ? (
              <>
                <style>{SYNTAX_HIGHLIGHT_CSS}</style>
                <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-words leading-relaxed overflow-x-auto">
                  <code
                    className="hljs"
                    // highlight.js escapes all code text; output re-sanitized via DOMPurify.
                    // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                    dangerouslySetInnerHTML={{
                      // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
                      __html: sanitizeHtml(
                        highlightCode(
                          rawContent?.slice(0, 10000) ?? '',
                          file.name,
                        ) + ((rawContent?.length ?? 0) > 10000 ? '\n\n… (truncated)' : ''),
                      ),
                    }}
                  />
                </pre>
              </>
            ) : (
              <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all leading-relaxed">
                {rawContent?.slice(0, 10000)}
                {(rawContent?.length ?? 0) > 10000 && '\n\n… (truncated)'}
              </pre>
            )}
          </div>
        )}

        {!isImage && !isPdf && !isMd && !isCsv && !isText && (
          <div className="flex flex-col items-center justify-center h-40 text-text-muted gap-2">
            <span className="text-4xl">📄</span>
            <span className="text-sm">{t('fileViewer.noPreview')}</span>
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="border-t border-border px-4 py-3 space-y-2 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Tag className="w-3 h-3 text-text-muted" />
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Tags</h4>
        </div>
        <div
          className="flex flex-wrap gap-1.5 min-h-[28px] cursor-text"
          onClick={() => tagInputRef.current?.focus()}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-xs bg-accent/15 text-accent px-2 py-0.5 rounded-full"
            >
              {tag}
              <button
                onClick={(e) => { e.stopPropagation(); removeTag(tag) }}
                className="hover:text-accent-hover ml-0.5"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <input
            ref={tagInputRef}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={onTagKeyDown}
            onBlur={() => { if (tagInput) addTag(tagInput) }}
            placeholder={tags.length === 0 ? t('previewPanel.addTag') : ''}
            className="text-xs bg-transparent text-text-primary outline-none placeholder:text-text-muted min-w-[60px] flex-1"
          />
        </div>
      </div>

      {/* File info */}
      <div className="border-t border-border px-4 py-3 space-y-2 flex-shrink-0">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{t('previewPanel.info')}</h4>
        <dl className="space-y-1.5">
          <Row label={t('common.size')} value={formatSize(file.size)} />
          <Row label={t('common.type')} value={file.mime_type ?? '—'} />
          <Row label={t('common.modified')} value={formatDate(file.modified)} />
          {file.extension && <Row label={t('common.extension')} value={`.${file.extension}`} />}
        </dl>
      </div>
    </div>
  )
}

function PanelCsvTable({ rows }: { rows: string[][] }) {
  if (rows.length === 0) {
    return <p className="p-4 text-xs text-text-muted">Empty file</p>
  }

  const headers   = rows[0].slice(0, PANEL_CSV_COLS)
  const dataRows  = rows.slice(1, PANEL_CSV_ROWS + 1)
  const moreRows  = rows.length - 1 - dataRows.length
  const moreCols  = rows[0].length - PANEL_CSV_COLS

  return (
    <div className="overflow-x-auto">
      <div className="px-3 py-1.5 text-[10px] text-text-muted border-b border-border bg-elevated/40">
        {rows[0].length} col · {(rows.length - 1).toLocaleString()} row
        {(moreRows > 0 || moreCols > 0) && ' — scroll or open for full view'}
      </div>

      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-2 py-1 text-left font-semibold text-text-primary bg-elevated border-b border-r border-border truncate max-w-[80px]"
                title={h}
              >
                {h || <em className="text-text-muted font-normal">col {i + 1}</em>}
              </th>
            ))}
            {moreCols > 0 && (
              <th className="px-2 py-1 text-left text-text-muted bg-elevated border-b border-border">
                +{moreCols}…
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-base' : 'bg-surface/50'}>
              {headers.map((_, ci) => (
                <td
                  key={ci}
                  className="px-2 py-1 text-text-secondary border-b border-r border-border/30 truncate max-w-[80px]"
                  title={row[ci] ?? ''}
                >
                  {row[ci] ?? ''}
                </td>
              ))}
              {moreCols > 0 && <td className="px-2 py-1 border-b border-border/30 text-text-muted">…</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {moreRows > 0 && (
        <p className="px-3 py-1.5 text-[10px] text-text-muted border-t border-border bg-elevated/20 text-center">
          + {moreRows.toLocaleString()} more rows — open file to see all
        </p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <dt className="text-text-muted w-16 flex-shrink-0">{label}</dt>
      <dd className="text-text-secondary truncate">{value}</dd>
    </div>
  )
}
