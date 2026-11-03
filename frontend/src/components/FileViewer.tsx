import { Component, useEffect, useMemo, useState } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { Download, Eye, FileCode, X, ZoomIn, ZoomOut } from 'lucide-react'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { files as api } from '../api'
import { useThemeStore } from '../theme'
import { renderMarkdown, parseCsv } from '../markdown'
import { sanitizeHtml } from '../sanitize'
import type { FileEntry } from '../types'
import { formatSize, getFileIcon } from '../utils'

interface Props {
  file: FileEntry
  onClose: () => void
}

// ─── Language detection ────────────────────────────────────────────────────────

// 'xml'  → streaming formatter (re-indents well-formed XML)
// 'html' → full fetch + xml tokenizer on raw source (HTML is not well-formed XML;
//           void elements like <br>/<meta> would inflate indent forever in the
//           streaming formatter, freezing the tab)
// 'json' → full fetch + json tokenizer
// 'text' → full fetch, plain colour
type Lang = 'xml' | 'html' | 'json' | 'text'

const XML_EXTS  = new Set(['xml','xsd','xsl','xslt','wsdl','plist','rss','atom','xaml','svg'])
const HTML_EXTS = new Set(['html','htm'])

function detectLang(mime: string, ext: string | null): Lang {
  const e = (ext ?? '').toLowerCase()
  if (HTML_EXTS.has(e) || mime === 'text/html') return 'html'
  if (XML_EXTS.has(e) || mime.includes('xml'))  return 'xml'
  if (e === 'json' || mime.includes('json'))     return 'json'
  return 'text'
}

// ─── Syntax-highlight token types ─────────────────────────────────────────────

type XmlKind  = 'tag-punct' | 'tag-name' | 'attr-name' | 'attr-value' | 'comment' | 'cdata' | 'pi' | 'text'
type JsonKind = 'key' | 'string' | 'number' | 'keyword' | 'punct' | 'text'

interface AnyToken { kind: string; value: string }

// Dark-mode palette (original)
const XML_COLORS_DARK: Record<XmlKind, string> = {
  'tag-punct': '#94a3b8', 'tag-name': '#38bdf8', 'attr-name': '#fbbf24',
  'attr-value': '#4ade80', comment: '#475569', cdata: '#a78bfa', pi: '#f472b6', text: '#cbd5e1',
}
const JSON_COLORS_DARK: Record<JsonKind, string> = {
  key: '#7dd3fc', string: '#4ade80', number: '#fb923c',
  keyword: '#a78bfa', punct: '#94a3b8', text: '#cbd5e1',
}

// Light-mode palette (saturated for readability on white)
const XML_COLORS_LIGHT: Record<XmlKind, string> = {
  'tag-punct': '#64748b', 'tag-name': '#0369a1', 'attr-name': '#b45309',
  'attr-value': '#15803d', comment: '#94a3b8', cdata: '#6d28d9', pi: '#be185d', text: '#334155',
}
const JSON_COLORS_LIGHT: Record<JsonKind, string> = {
  key: '#0369a1', string: '#15803d', number: '#c2410c',
  keyword: '#6d28d9', punct: '#64748b', text: '#334155',
}

// ─── XML tokenizer ─────────────────────────────────────────────────────────────

interface XmlToken { kind: XmlKind; value: string }

function parseXmlTag(tag: string): XmlToken[] {
  const out: XmlToken[] = []
  let i = 1
  const isClose = tag[i] === '/'
  if (isClose) i++
  out.push({ kind: 'tag-punct', value: isClose ? '</' : '<' })
  const nameStart = i
  while (i < tag.length && !/[\s/>=]/.test(tag[i])) i++
  if (i > nameStart) out.push({ kind: 'tag-name', value: tag.slice(nameStart, i) })
  while (i < tag.length) {
    const ch = tag[i]
    if (/\s/.test(ch)) {
      const s = i; while (i < tag.length && /\s/.test(tag[i])) i++
      out.push({ kind: 'text', value: tag.slice(s, i) }); continue
    }
    if (ch === '/' && tag[i + 1] === '>') { out.push({ kind: 'tag-punct', value: '/>' }); break }
    if (ch === '/') { i++; continue }
    if (ch === '>') { out.push({ kind: 'tag-punct', value: '>' }); break }
    const s = i; while (i < tag.length && !/[\s=/>]/.test(tag[i])) i++
    out.push({ kind: 'attr-name', value: tag.slice(s, i) })
    while (i < tag.length && tag[i] === ' ') i++
    if (tag[i] === '=') {
      out.push({ kind: 'tag-punct', value: '=' }); i++
      const q = tag[i]
      if (q === '"' || q === "'") {
        const end = tag.indexOf(q, i + 1)
        const to = end < 0 ? tag.length : end + 1
        out.push({ kind: 'attr-value', value: tag.slice(i, to) }); i = to
      }
    }
  }
  return out
}

function tokenizeXml(src: string): XmlToken[] {
  const out: XmlToken[] = []
  let i = 0
  while (i < src.length) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      const to = end < 0 ? src.length : end + 3
      out.push({ kind: 'comment', value: src.slice(i, to) }); i = to; continue
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      const to = end < 0 ? src.length : end + 3
      out.push({ kind: 'cdata', value: src.slice(i, to) }); i = to; continue
    }
    if (src.startsWith('<?', i) || src.startsWith('<!', i)) {
      const end = src.startsWith('<?', i) ? src.indexOf('?>', i + 2) : src.indexOf('>', i + 2)
      const to = end < 0 ? src.length : end + (src.startsWith('<?', i) ? 2 : 1)
      out.push({ kind: 'pi', value: src.slice(i, to) }); i = to; continue
    }
    if (src[i] === '<') {
      let j = i + 1; let inQ: string | null = null
      while (j < src.length) {
        if (inQ) { if (src[j] === inQ) inQ = null }
        else { if (src[j] === '"' || src[j] === "'") inQ = src[j]; else if (src[j] === '>') { j++; break } }
        j++
      }
      out.push(...parseXmlTag(src.slice(i, j))); i = j; continue
    }
    const next = src.indexOf('<', i)
    const to = next < 0 ? src.length : next
    out.push({ kind: 'text', value: src.slice(i, to) }); i = to
  }
  return out
}

// ─── JSON tokenizer ────────────────────────────────────────────────────────────

interface JsonToken { kind: JsonKind; value: string }

function tokenizeJson(src: string): JsonToken[] {
  const out: JsonToken[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      const s = i; while (i < src.length && /\s/.test(src[i])) i++
      out.push({ kind: 'text', value: src.slice(s, i) }); continue
    }
    if (ch === '"') {
      const s = i; i++
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '"') { i++; break }
        i++
      }
      let j = i; while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j++
      out.push({ kind: src[j] === ':' ? 'key' : 'string', value: src.slice(s, i) }); continue
    }
    if (/\d/.test(ch) || (ch === '-' && /\d/.test(src[i + 1] ?? ''))) {
      const s = i; if (src[i] === '-') i++
      while (i < src.length && /[\d.eE+-]/.test(src[i])) i++
      out.push({ kind: 'number', value: src.slice(s, i) }); continue
    }
    const kw = src.slice(i).match(/^(true|false|null)/)
    if (kw) { out.push({ kind: 'keyword', value: kw[1] }); i += kw[1].length; continue }
    out.push({ kind: 'punct', value: ch }); i++
  }
  return out
}

// ─── Line builder ──────────────────────────────────────────────────────────────

function buildLines(tokens: AnyToken[]): AnyToken[][] {
  const lines: AnyToken[][] = [[]]
  for (const tok of tokens) {
    const parts = tok.value.split('\n')
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) lines.push([])
      if (parts[p].length > 0) lines[lines.length - 1].push({ kind: tok.kind, value: parts[p] })
    }
  }
  return lines
}

// ─── Streaming XML formatter ───────────────────────────────────────────────────

interface XmlFmtCtx { buf: string; indent: number }

function flushXmlChunk(ctx: XmlFmtCtx, incoming: string): string[] {
  ctx.buf += incoming
  const out: string[] = []
  let i = 0
  const b = ctx.buf

  while (i < b.length) {
    while (i < b.length && (b[i] === ' ' || b[i] === '\t' || b[i] === '\r' || b[i] === '\n')) i++
    if (i >= b.length) break
    if (b[i] !== '<') {
      const next = b.indexOf('<', i)
      if (next < 0) break
      const text = b.slice(i, next).trim()
      if (text) out.push('  '.repeat(ctx.indent) + text)
      i = next; continue
    }
    if (b.startsWith('<!--', i)) {
      const end = b.indexOf('-->', i + 4); if (end < 0) break
      out.push('  '.repeat(ctx.indent) + b.slice(i, end + 3)); i = end + 3; continue
    }
    if (b.startsWith('<![CDATA[', i)) {
      const end = b.indexOf(']]>', i + 9); if (end < 0) break
      out.push('  '.repeat(ctx.indent) + b.slice(i, end + 3)); i = end + 3; continue
    }
    if (b.startsWith('<?', i)) {
      const end = b.indexOf('?>', i + 2); if (end < 0) break
      out.push('  '.repeat(ctx.indent) + b.slice(i, end + 2)); i = end + 2; continue
    }
    if (b.startsWith('<!', i)) {
      const end = b.indexOf('>', i + 2); if (end < 0) break
      out.push('  '.repeat(ctx.indent) + b.slice(i, end + 1)); i = end + 1; continue
    }
    let j = i + 1; let inQ: string | null = null; let ok = false
    while (j < b.length) {
      const c = b[j]
      if (inQ) { if (c === inQ) inQ = null }
      else if (c === '"' || c === "'") inQ = c
      else if (c === '>') { j++; ok = true; break }
      j++
    }
    if (!ok) break
    const tag = b.slice(i, j)
    const isClose = tag.startsWith('</')
    const isSelf  = tag.endsWith('/>')
    if (isClose) ctx.indent = Math.max(0, ctx.indent - 1)
    out.push('  '.repeat(ctx.indent) + tag)
    if (!isClose && !isSelf) ctx.indent = Math.min(100, ctx.indent + 1)
    i = j
  }
  ctx.buf = b.slice(i)
  return out
}

// ─── Text / code viewer ────────────────────────────────────────────────────────

const MAX_LINES = 5000
const MAX_CHARS = 400_000
const MAX_TOKENS_PER_LINE = 1000

function TextViewer({ path, previewUrl, mime, extension }: {
  path: string
  previewUrl: string
  mime: string
  extension: string | null
}) {
  const { t } = useTranslation()
  const { theme } = useThemeStore()
  const lang = detectLang(mime, extension)

  const [xmlLines, setXmlLines]   = useState<string[]>([])
  const [content, setContent]     = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [truncated, setTruncated] = useState(false)

  const lineNumStyle: CSSProperties = {
    textAlign: 'right',
    paddingRight: 12,
    paddingLeft: 8,
    color: 'rgb(var(--color-text-muted) / 0.6)',
    userSelect: 'none',
    minWidth: '3.5rem',
    width: '3.5rem',
    borderRight: '1px solid rgb(var(--color-border))',
    position: 'sticky',
    left: 0,
    backgroundColor: 'rgb(var(--color-surface))',
    zIndex: 1,
    verticalAlign: 'top',
  }

  const codeCellStyle: CSSProperties = {
    paddingLeft: 16,
    paddingRight: 48,
    whiteSpace: 'pre',
    verticalAlign: 'top',
  }

  const isDark = theme !== 'light'
  const xmlPalette  = (isDark ? XML_COLORS_DARK  : XML_COLORS_LIGHT)  as Record<string, string>
  const jsonPalette = (isDark ? JSON_COLORS_DARK : JSON_COLORS_LIGHT) as Record<string, string>
  const colors: Record<string, string> =
    lang === 'xml'  ? xmlPalette  :
    lang === 'html' ? xmlPalette  :
    lang === 'json' ? jsonPalette :
    { text: isDark ? '#cbd5e1' : '#334155' }

  // Streaming XML
  useEffect(() => {
    if (lang !== 'xml') return
    setLoading(true); setXmlLines([]); setTruncated(false)
    const ctrl = new AbortController()
    const ctx: XmlFmtCtx = { buf: '', indent: 0 }
    let count = 0
    ;(async () => {
      try {
        const res = await fetch(previewUrl, { credentials: 'include', signal: ctrl.signal })
        const reader = res.body!.getReader()
        const dec = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const batch = flushXmlChunk(ctx, dec.decode(value, { stream: true }))
          if (!batch.length) continue
          count += batch.length
          if (count >= MAX_LINES) {
            setXmlLines(prev => [...prev, ...batch.slice(0, batch.length - (count - MAX_LINES))])
            setTruncated(true); reader.cancel(); break
          }
          setXmlLines(prev => [...prev, ...batch])
        }
      } catch { /* AbortError expected on cleanup */ }
      finally { setLoading(false) }
    })()
    return () => ctrl.abort()
  }, [path, lang, previewUrl])

  // Full fetch for JSON / plain text
  useEffect(() => {
    if (lang === 'xml') return
    setLoading(true); setContent(null); setTruncated(false)
    const ctrl = new AbortController()
    fetch(previewUrl, { credentials: 'include', signal: ctrl.signal })
      .then(r => r.text())
      .then(t => { setContent(t); setLoading(false) })
      .catch(e => { if ((e as Error).name !== 'AbortError') setLoading(false) })
    return () => ctrl.abort()
  }, [path, lang, previewUrl])

  const { lines, isTruncated } = useMemo(() => {
    if (lang === 'xml') {
      const all = buildLines(tokenizeXml(xmlLines.join('\n')))
      const hasTooMany = all.some(l => l.length > MAX_TOKENS_PER_LINE)
      const processed = all.map(l => l.length > MAX_TOKENS_PER_LINE ? [...l.slice(0, MAX_TOKENS_PER_LINE), { kind: 'text', value: '...' }] : l)
      return { lines: processed, isTruncated: truncated || hasTooMany }
    }
    if (!content) return { lines: [], isTruncated: false }
    const over = content.length > MAX_CHARS
    const src = over ? content.slice(0, MAX_CHARS) : content
    // html uses the xml tokenizer on the raw source (no streaming formatter)
    const raw =
      lang === 'json' ? tokenizeJson(src) :
      lang === 'html' ? tokenizeXml(src)  :
      [{ kind: 'text', value: src }]
    const all = buildLines(raw)
    const hasTooMany = all.some(l => l.length > MAX_TOKENS_PER_LINE)
    const lineTrunc = all.length > MAX_LINES
    const processed = all.map(l => l.length > MAX_TOKENS_PER_LINE ? [...l.slice(0, MAX_TOKENS_PER_LINE), { kind: 'text', value: '...' }] : l)
    return { lines: lineTrunc ? processed.slice(0, MAX_LINES) : processed, isTruncated: over || lineTrunc || hasTooMany }
  }, [lang, xmlLines, content, truncated])

  const hasContent = lang === 'xml' ? xmlLines.length > 0 : content !== null

  if (loading && !hasContent) {
    return (
      <div className="p-6 space-y-2.5">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="h-3.5 bg-elevated rounded animate-pulse"
            style={{ width: `${35 + (i * 37 + 17) % 65}%` }} />
        ))}
      </div>
    )
  }
  if (!loading && !hasContent) {
    return <div className="flex items-center justify-center h-full text-text-muted text-sm">{t('fileViewer.failedToLoad')}</div>
  }

  return (
    <div className="h-full overflow-auto" style={{ tabSize: 2 }}>
      <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12, lineHeight: '20px' }}>
        <tbody>
          {lines.map((lineTokens, idx) => (
            <tr key={idx}>
              <td style={lineNumStyle}>{idx + 1}</td>
              <td style={codeCellStyle}>
                {lineTokens.length === 0
                  ? <span>&nbsp;</span>
                  : lineTokens.map((t, j) => (
                      <span key={j} style={{ color: colors[t.kind] ?? (theme === 'dark' ? '#cbd5e1' : '#334155') }}>
                        {t.value}
                      </span>
                    ))
                }
              </td>
            </tr>
          ))}
          {(isTruncated || loading) && (
            <tr>
              <td style={{ ...lineNumStyle, fontStyle: 'italic' }}>…</td>
              <td style={{ ...codeCellStyle, color: 'rgb(var(--color-text-muted))', fontStyle: 'italic', paddingTop: 8 }}>
                {loading ? t('common.loading') : t('fileViewer.truncatedLines', { count: MAX_LINES })}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ─── Markdown viewer ───────────────────────────────────────────────────────────

function MarkdownViewer({ path, previewUrl, extension }: {
  path: string
  previewUrl: string
  extension: string | null
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'preview' | 'source'>('preview')

  useEffect(() => {
    setLoading(true); setContent(null)
    const ctrl = new AbortController()
    fetch(previewUrl, { credentials: 'include', signal: ctrl.signal })
      .then(r => r.text())
      .then(t => { setContent(t); setLoading(false) })
      .catch(e => { if ((e as Error).name !== 'AbortError') setLoading(false) })
    return () => ctrl.abort()
  }, [path, previewUrl])

  const rendered = useMemo(() =>
    content != null ? sanitizeHtml(renderMarkdown(content)) : '', [content])

  if (loading && content === null) {
    return (
      <div className="p-8 space-y-3 max-w-2xl mx-auto">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-3.5 bg-elevated rounded animate-pulse"
            style={{ width: `${40 + (i * 31 + 13) % 55}%` }} />
        ))}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toggle bar */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-elevated/40 flex-shrink-0">
        <button
          onClick={() => setView('preview')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors',
            view === 'preview'
              ? 'bg-overlay text-text-primary font-medium'
              : 'text-text-muted hover:text-text-secondary',
          )}
        >
          <Eye className="w-3 h-3" /> {t('fileViewer.preview')}
        </button>
        <button
          onClick={() => setView('source')}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1 text-xs rounded-md transition-colors',
            view === 'source'
              ? 'bg-overlay text-text-primary font-medium'
              : 'text-text-muted hover:text-text-secondary',
          )}
        >
          <FileCode className="w-3 h-3" /> {t('fileViewer.source')}
        </button>
      </div>

      {view === 'preview' ? (
        <div className="flex-1 overflow-auto">
          <div
            className="md-body max-w-3xl mx-auto px-10 py-8"
            // `rendered` = sanitizeHtml(renderMarkdown(content)): DOMPurify output.
            // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        </div>
      ) : (
        <TextViewer
          path={path}
          previewUrl={previewUrl}
          mime="text/plain"
          extension={extension}
        />
      )}
    </div>
  )
}

// ─── CSV viewer ────────────────────────────────────────────────────────────────

const CSV_ROW_LIMIT = 500

function CsvViewer({ path, previewUrl }: { path: string; previewUrl: string }) {
  const { t } = useTranslation()
  const [rows, setRows]   = useState<string[][] | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    setLoading(true); setRows(null)
    const ctrl = new AbortController()
    fetch(previewUrl, { credentials: 'include', signal: ctrl.signal })
      .then(r => r.text())
      .then(t => { setRows(parseCsv(t)); setLoading(false) })
      .catch(e => { if ((e as Error).name !== 'AbortError') setLoading(false) })
    return () => ctrl.abort()
  }, [path, previewUrl])

  const { headers, displayed, totalRows, truncated } = useMemo(() => {
    if (!rows || rows.length === 0) return { headers: [], displayed: [], totalRows: 0, truncated: false }
    const headers = rows[0]
    let data = rows.slice(1)

    if (sortCol !== null) {
      data = [...data].sort((a, b) => {
        const av = a[sortCol] ?? ''
        const bv = b[sortCol] ?? ''
        const an = Number(av), bn = Number(bv)
        const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv)
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return {
      headers,
      displayed: data.slice(0, CSV_ROW_LIMIT),
      totalRows: data.length,
      truncated: data.length > CSV_ROW_LIMIT,
    }
  }, [rows, sortCol, sortDir])

  function handleColClick(i: number) {
    if (sortCol === i) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(i); setSortDir('asc') }
  }

  if (loading) {
    return (
      <div className="p-6 space-y-2">
        <div className="h-8 bg-elevated rounded animate-pulse w-full" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-6 bg-elevated/60 rounded animate-pulse w-full" />
        ))}
      </div>
    )
  }
  if (!rows || rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
        <span className="text-4xl">📊</span>
        <p className="text-sm">{t('fileViewer.csvNoData')}</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Stats bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-elevated/40 text-xs text-text-muted flex-shrink-0">
        <span className="font-medium text-text-secondary">{headers.length} {t('fileViewer.columns')}</span>
        <span className="text-border-strong">·</span>
        <span>{totalRows.toLocaleString()} {t('fileViewer.rows')}</span>
        {truncated && (
          <>
            <span className="text-border-strong">·</span>
            <span className="text-warning">{t('fileViewer.showingFirst', { count: CSV_ROW_LIMIT })}</span>
          </>
        )}
        <span className="ml-auto text-text-muted/60">{t('fileViewer.clickToSort')}</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              {/* Row # */}
              <th className="text-right px-3 py-2 bg-elevated border-b border-r border-border text-text-muted font-normal w-10 select-none">
                #
              </th>
              {headers.map((h, i) => (
                <th
                  key={i}
                  onClick={() => handleColClick(i)}
                  className={clsx(
                    'px-3 py-2 text-left font-semibold bg-elevated border-b border-r border-border cursor-pointer select-none transition-colors',
                    sortCol === i ? 'text-accent bg-accent/5' : 'text-text-primary hover:bg-overlay',
                  )}
                >
                  <span className="flex items-center gap-1">
                    <span className="truncate max-w-[160px]">{h || <em className="text-text-muted font-normal">col {i + 1}</em>}</span>
                    {sortCol === i && (
                      <span className="text-accent flex-shrink-0">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((row, ri) => (
              <tr
                key={ri}
                className={clsx(
                  'border-b border-border/40 transition-colors',
                  ri % 2 === 0 ? 'bg-base hover:bg-surface' : 'bg-surface/50 hover:bg-surface',
                )}
              >
                <td className="text-right px-3 py-1.5 text-text-muted border-r border-border/40 select-none tabular-nums">
                  {ri + 1}
                </td>
                {headers.map((_, ci) => (
                  <td
                    key={ci}
                    className={clsx(
                      'px-3 py-1.5 text-text-secondary border-r border-border/30 max-w-[240px] truncate',
                      sortCol === ci && 'bg-accent/5',
                    )}
                    title={row[ci] ?? ''}
                  >
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Excel viewer ──────────────────────────────────────────────────────────────

const EXCEL_ROW_LIMIT = 5000
const EXCEL_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb', 'ods'])
/// Upper bound on a spreadsheet we'll parse in the browser (defense against a
/// crafted file exhausting the main thread during parsing).
const EXCEL_MAX_BYTES = 25 * 1024 * 1024

interface Workbook { sheetNames: string[]; sheets: Record<string, string[][]> }

function ExcelViewer({ path, previewUrl }: { path: string; previewUrl: string }) {
  const { t } = useTranslation()
  const [wb, setWb]           = useState<Workbook | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  useEffect(() => {
    setLoading(true); setWb(null); setError(false); setActiveIdx(0); setSortCol(null)
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const XLSX = await import('xlsx')
        const res  = await fetch(previewUrl, { credentials: 'include', signal: ctrl.signal })
        const buf  = await res.arrayBuffer()
        // Cap the parsed size: the spreadsheet parser is CPU-heavy and a very
        // large/crafted file could otherwise tie up the main thread.
        if (buf.byteLength > EXCEL_MAX_BYTES) { setError(true); setLoading(false); return }
        const book = XLSX.read(new Uint8Array(buf), { type: 'array' })
        const sheets: Record<string, string[][]> = {}
        for (const name of book.SheetNames) {
          sheets[name] = XLSX.utils.sheet_to_json<string[]>(book.Sheets[name], {
            header: 1, defval: '', raw: false,
          })
        }
        setWb({ sheetNames: book.SheetNames, sheets })
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(true)
      } finally {
        setLoading(false)
      }
    })()
    return () => ctrl.abort()
  }, [path, previewUrl])

  useEffect(() => { setSortCol(null); setSortDir('asc') }, [activeIdx])

  // Derived values and useMemo must come before any early returns (Rules of Hooks)
  const sheetName  = wb?.sheetNames[activeIdx]
  const rawRows    = (sheetName != null ? wb?.sheets[sheetName] : null) ?? []
  const headers    = rawRows[0] ?? []
  const allData    = rawRows.slice(1)
  const truncated  = allData.length > EXCEL_ROW_LIMIT
  const colCount   = headers.length

  const sorted = useMemo(() => {
    if (sortCol === null) return allData
    return [...allData].sort((a, b) => {
      const av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
      const an = Number(av), bn = Number(bv)
      const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [allData, sortCol, sortDir])

  const displayed = truncated ? sorted.slice(0, EXCEL_ROW_LIMIT) : sorted

  if (loading) {
    return (
      <div className="p-6 space-y-2">
        <div className="h-8 bg-elevated rounded animate-pulse w-full" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-6 bg-elevated/60 rounded animate-pulse w-full" />
        ))}
      </div>
    )
  }
  if (error || !wb) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t('fileViewer.failedToLoadSheet')}
      </div>
    )
  }

  function handleColClick(i: number) {
    if (sortCol === i) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(i); setSortDir('asc') }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Sheet tabs */}
      {wb.sheetNames.length > 1 && (
        <div className="flex gap-0.5 px-3 pt-2 pb-0 border-b border-border bg-elevated/40 overflow-x-auto flex-shrink-0">
          {wb.sheetNames.map((name, i) => (
            <button
              key={name}
              onClick={() => setActiveIdx(i)}
              className={clsx(
                'px-3 py-1.5 text-xs rounded-t-md whitespace-nowrap transition-colors border border-b-0',
                i === activeIdx
                  ? 'bg-surface text-text-primary border-border font-medium'
                  : 'bg-transparent text-text-muted border-transparent hover:text-text-secondary hover:bg-overlay',
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-elevated/40 text-xs text-text-muted flex-shrink-0">
        <span className="font-medium text-text-secondary">{colCount} {t('fileViewer.columns')}</span>
        <span className="text-border-strong">·</span>
        <span>{allData.length.toLocaleString()} {t('fileViewer.rows')}</span>
        {truncated && (
          <>
            <span className="text-border-strong">·</span>
            <span className="text-warning">{t('fileViewer.showingFirst', { count: EXCEL_ROW_LIMIT })}</span>
          </>
        )}
        {wb.sheetNames.length === 1 && (
          <span className="ml-auto text-text-muted/60 font-medium">{sheetName}</span>
        )}
        {sortCol !== null && (
          <button
            onClick={() => { setSortCol(null); setSortDir('asc') }}
            className="ml-auto text-accent hover:text-accent-hover transition-colors"
          >
            {t('fileViewer.clearSort')}
          </button>
        )}
      </div>

      {/* Table */}
      {headers.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-text-muted">
          <p className="text-sm">{t('fileViewer.sheetEmpty')}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-right px-3 py-2 bg-elevated border-b border-r border-border text-text-muted font-normal w-10 select-none">
                  #
                </th>
                {headers.map((h, i) => (
                  <th
                    key={i}
                    onClick={() => handleColClick(i)}
                    className={clsx(
                      'px-3 py-2 text-left font-semibold bg-elevated border-b border-r border-border cursor-pointer select-none transition-colors',
                      sortCol === i ? 'text-accent bg-accent/5' : 'text-text-primary hover:bg-overlay',
                    )}
                  >
                    <span className="flex items-center gap-1">
                      <span className="truncate max-w-[200px]">{String(h) || <em className="text-text-muted font-normal">col {i + 1}</em>}</span>
                      {sortCol === i && <span className="text-accent flex-shrink-0">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map((row, ri) => (
                <tr
                  key={ri}
                  className={clsx(
                    'border-b border-border/40 transition-colors',
                    ri % 2 === 0 ? 'bg-base hover:bg-surface' : 'bg-surface/50 hover:bg-surface',
                  )}
                >
                  <td className="text-right px-3 py-1.5 text-text-muted border-r border-border/40 select-none tabular-nums">
                    {ri + 1}
                  </td>
                  {headers.map((_, ci) => {
                    const val = String(row[ci] ?? '')
                    return (
                      <td
                        key={ci}
                        className={clsx(
                          'px-3 py-1.5 text-text-secondary border-r border-border/30 max-w-[280px] truncate',
                          sortCol === ci && 'bg-accent/5',
                        )}
                        title={val}
                      >
                        {val}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Word (.docx) viewer ─────────────────────────────────────────────────────

function DocxViewer({ path, previewUrl }: { path: string; previewUrl: string }) {
  const { t } = useTranslation()
  const [paragraphs, setParagraphs] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true); setParagraphs(null); setError(false)
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const { extractDocx } = await import('../office')
        const res = await fetch(previewUrl, { credentials: 'include', signal: ctrl.signal })
        const buf = await res.arrayBuffer()
        setParagraphs(await extractDocx(buf))
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(true)
      } finally {
        setLoading(false)
      }
    })()
    return () => ctrl.abort()
  }, [path, previewUrl])

  if (loading) {
    return (
      <div className="p-8 max-w-3xl mx-auto space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-4 bg-elevated/60 rounded animate-pulse" style={{ width: `${70 + (i * 7) % 30}%` }} />
        ))}
      </div>
    )
  }
  if (error || !paragraphs) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        {t('fileViewer.previewFailed')}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto px-10 py-10 leading-relaxed text-text-primary text-[15px]">
        {paragraphs.map((p, i) =>
          p.trim() === '' ? (
            <div key={i} className="h-4" />
          ) : (
            <p key={i} className="mb-3 whitespace-pre-wrap break-words">{p}</p>
          ),
        )}
      </div>
    </div>
  )
}

// PowerPoint (.pptx/.ppt) has no in-app preview by design — presentations are
// treated as download-only files (see isPreviewable in utils.ts), avoiding any
// slide-rendering dependency. They fall through to the viewer's download panel.

// ─── Image viewer ──────────────────────────────────────────────────────────────

function ImageViewer({ src, name }: { src: string; name: string }) {
  const { t } = useTranslation()
  const { theme } = useThemeStore()
  const [zoom, setZoom] = useState(1)
  const step = 0.25

  const checkPattern = theme === 'light'
    ? 'repeating-conic-gradient(#e2e8f0 0% 25%, #f8fafc 0% 50%) 0 0 / 24px 24px'
    : 'repeating-conic-gradient(#1a1d28 0% 25%, #13161e 0% 50%) 0 0 / 24px 24px'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-center gap-3 px-4 py-2 border-b border-border bg-elevated/60 flex-shrink-0">
        <button
          onClick={() => setZoom(z => Math.max(0.1, +(z - step).toFixed(2)))}
          className="p-1 text-text-muted hover:text-text-primary transition-colors" title={t('fileViewer.zoomOut')}
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs text-text-muted w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => Math.min(8, +(z + step).toFixed(2)))}
          className="p-1 text-text-muted hover:text-text-primary transition-colors" title={t('fileViewer.zoomIn')}
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="text-xs text-text-muted hover:text-text-primary px-2 py-0.5 rounded hover:bg-overlay transition-colors"
        >{t('fileViewer.reset')}</button>
      </div>
      <div
        className="flex-1 overflow-auto flex items-center justify-center p-6"
        style={{ background: checkPattern }}
      >
        <img
          src={src}
          alt={name}
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'transform 0.15s ease',
            maxWidth: zoom === 1 ? '100%' : 'none',
            maxHeight: zoom === 1 ? '100%' : 'none',
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}

// ─── Error boundary ────────────────────────────────────────────────────────────

function ViewerErrorFallback({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }} onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl p-8 flex flex-col items-center gap-4 max-w-sm" onClick={e => e.stopPropagation()}>
        <p className="text-text-muted text-sm text-center">{t('fileViewer.previewFailed')}</p>
        <button onClick={onClose} className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover transition-colors">{t('common.close')}</button>
      </div>
    </div>
  )
}

class ViewerErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { crashed: boolean }> {
  state = { crashed: false }
  static getDerivedStateFromError() { return { crashed: true } }
  render() {
    if (this.state.crashed) {
      return <ViewerErrorFallback onClose={this.props.onClose} />
    }
    return this.props.children
  }
}

// ─── Main viewer ───────────────────────────────────────────────────────────────

function FileViewerInner({ file, onClose }: Props) {
  const { t } = useTranslation()
  const { Icon, color } = getFileIcon(file)
  const mime = file.mime_type ?? ''
  const ext  = (file.extension ?? '').toLowerCase()

  const isMd    = ['md', 'mdx', 'markdown'].includes(ext) || mime === 'text/markdown'
  const isCsv   = ext === 'csv' || mime === 'text/csv'
  const isImage = mime.startsWith('image/')
  const isVideo = mime.startsWith('video/')
  const isAudio = mime.startsWith('audio/')
  const isPdf   = mime === 'application/pdf'
  const isExcel = EXCEL_EXTS.has(ext) || mime.includes('spreadsheet') || mime === 'application/vnd.ms-excel'
  const isDocx  = ['docx', 'docm'].includes(ext) || mime.includes('wordprocessingml')
  // PowerPoint has no in-app preview — it falls through to the download fallback.
  const isText  = !isMd && !isCsv && !isExcel && !isDocx && !isVideo && !isAudio && (
    mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') ||
    mime.includes('javascript') || mime.includes('yaml') || mime.includes('toml')
  )

  const previewUrl = api.previewUrl(file.path)

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-6xl bg-surface border border-border rounded-2xl shadow-2xl flex flex-col animate-scale-in overflow-hidden"
        style={{ height: '90vh' }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-elevated flex-shrink-0">
          <Icon className={clsx('w-4 h-4 flex-shrink-0', color)} />
          <span className="text-sm font-medium text-text-primary truncate flex-1 min-w-0">{file.name}</span>
          <span className="text-xs text-text-muted flex-shrink-0">{formatSize(file.size)}</span>
          {file.extension && (
            <span className="text-[10px] bg-overlay text-text-muted px-2 py-0.5 rounded font-mono uppercase flex-shrink-0">
              {file.extension}
            </span>
          )}
          <a
            href={api.downloadUrl(file.path)}
            download={file.name}
            className="p-1.5 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
            title={t('common.download')}
          >
            <Download className="w-4 h-4" />
          </a>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors flex-shrink-0"
            title={`${t('common.close')} (Esc)`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isImage && <ImageViewer src={previewUrl} name={file.name} />}

          {isVideo && (
            <div className="h-full flex items-center justify-center bg-black">
              <video src={previewUrl} controls autoPlay className="max-w-full max-h-full" />
            </div>
          )}

          {isAudio && (
            <div className="h-full flex flex-col items-center justify-center gap-6 p-8">
              <Icon className={clsx('w-20 h-20 opacity-30', color)} />
              <span className="text-sm text-text-secondary truncate max-w-full">{file.name}</span>
              <audio src={previewUrl} controls autoPlay className="w-full max-w-md" />
            </div>
          )}

          {isPdf && (
            // No sandbox: the file is served as application/pdf with
            // X-Content-Type-Options: nosniff, so it can't execute as HTML, and
            // the browser's built-in PDF viewer needs its own scripts to render.
            // eslint-disable-next-line @eslint-react/dom-no-missing-iframe-sandbox
            <iframe src={previewUrl} className="w-full h-full border-0" title={file.name} />
          )}

          {isMd && (
            <MarkdownViewer path={file.path} previewUrl={previewUrl} extension={file.extension} />
          )}

          {isCsv && (
            <CsvViewer path={file.path} previewUrl={previewUrl} />
          )}

          {isExcel && (
            <ExcelViewer path={file.path} previewUrl={previewUrl} />
          )}

          {isDocx && (
            <DocxViewer path={file.path} previewUrl={previewUrl} />
          )}

          {isText && (
            <TextViewer
              path={file.path}
              previewUrl={previewUrl}
              mime={mime}
              extension={file.extension}
            />
          )}

          {!isImage && !isVideo && !isAudio && !isPdf && !isMd && !isCsv && !isExcel && !isDocx && !isText && (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-text-muted">
              <Icon className={clsx('w-16 h-16 opacity-20', color)} />
              <p className="text-sm">{t('fileViewer.noPreview')}</p>
              <a
                href={api.downloadUrl(file.path)}
                download={file.name}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover transition-colors"
              >
                {t('fileViewer.downloadFile')}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function FileViewer(props: Props) {
  return (
    <ViewerErrorBoundary onClose={props.onClose}>
      <FileViewerInner {...props} />
    </ViewerErrorBoundary>
  )
}
