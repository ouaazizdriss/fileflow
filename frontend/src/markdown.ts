// Lightweight Markdown → HTML renderer.
// Covers: headings (ATX + setext), paragraphs, bold/italic/strikethrough, inline
// code, fenced code blocks, blockquotes, ordered/unordered lists, GFM tables,
// horizontal rules, links, images, and auto-links.
//
// All raw HTML in source files is escaped first, so the output is XSS-safe
// even when rendered via dangerouslySetInnerHTML.

/**
 * Parse a single-line ATX heading (`## Title ##`) without a backtracking regex:
 * the equivalent `/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/` is quadratic on long
 * whitespace runs, so a crafted .md file could freeze the preview (ReDoS).
 */
export function parseAtxHeading(line: string): { lvl: number; text: string } | null {
  const open = /^#{1,6}/.exec(line)
  if (!open || !/\s/.test(line.charAt(open[0].length))) return null
  let text = line.slice(open[0].length).trim()
  // Optional closing sequence: a run of '#' preceded by whitespace.
  let end = text.length
  while (end > 0 && text[end - 1] === '#') end--
  if (end < text.length && end > 0 && /\s/.test(text.charAt(end - 1))) {
    text = text.slice(0, end).trimEnd()
  }
  return text ? { lvl: open[0].length, text } : null
}

export function renderMarkdown(raw: string): string {
  // ── Escape helpers ──────────────────────────────────────────────────────────
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // ── Stash: protect code spans/blocks from further processing ───────────────
  const stash: string[] = []
  const stashPush = (html: string) => {
    const id = `\x00S${stash.length}\x00`
    stash.push(html)
    return id
  }

  let src = raw
    // Normalise line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')

  // Fenced code blocks (``` or ~~~)
  src = src.replace(/^(`{3,}|~{3,})([\w+-]*)\n([\s\S]*?)\n?\1\s*$/gm, (_, _f, lang, code) => {
    const cls = lang ? ` class="language-${esc(lang)}"` : ''
    return stashPush(`<pre><code${cls}>${esc(code)}</code></pre>`)
  })

  // Inline code (single and double backticks)
  src = src.replace(/``([^`]+?)``|`([^`\n]+?)`/g, (_, a, b) =>
    stashPush(`<code>${esc(a ?? b)}</code>`))

  // ── Inline spans ───────────────────────────────────────────────────────────
  // `s` is always already escaped (callers pass esc(...)), so captured URLs and
  // alt text are attribute-safe as-is; escaping them again would turn `&` into
  // `&amp;amp;` and break query strings.
  function inline(s: string): string {
    // Bold + italic
    s = s.replace(/\*{3}(.+?)\*{3}/g, '<strong><em>$1</em></strong>')
    s = s.replace(/\*{2}(.+?)\*{2}/g, '<strong>$1</strong>')
    s = s.replace(/_{2}(.+?)_{2}/g, '<strong>$1</strong>')
    s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
    s = s.replace(/_([^_\n]+?)_/g, '<em>$1</em>')
    // Strikethrough
    s = s.replace(/~~(.+?)~~/g, '<del>$1</del>')
    // Images (before links)
    // eslint-disable-next-line security/detect-unsafe-regex -- measured linear on adversarial input (see markdown.test.ts)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) =>
      stashPush(`<img src="${url}" alt="${alt}" loading="lazy" />`))
    // Links
    // eslint-disable-next-line security/detect-unsafe-regex -- measured linear on adversarial input (see markdown.test.ts)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, text, url) => {
      const safe = /^(https?|mailto|ftp):/.test(url) ? url : '#'
      return stashPush(`<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`)
    })
    // Auto-links
    s = s.replace(/\bhttps?:\/\/[^\s<>"]+/g, (url) =>
      stashPush(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`))
    return s
  }

  // ── Block processing ───────────────────────────────────────────────────────
  const out: string[] = []
  const blocks = src.split(/\n{2,}/)

  for (const rawBlock of blocks) {
    const b = rawBlock.trim()
    if (!b) continue

    // Stash passthrough
    // eslint-disable-next-line no-control-regex -- NUL-delimited stash sentinel
    if (/^\x00S\d+\x00$/.test(b)) { out.push(b); continue }

    // Horizontal rule
    // eslint-disable-next-line security/detect-unsafe-regex -- measured linear on adversarial input (see markdown.test.ts)
    if (/^([-*_])( *\1){2,}\s*$/.test(b)) { out.push('<hr />'); continue }

    // ATX heading  (# to ######)
    const heading = b.includes('\n') ? null : parseAtxHeading(b)
    if (heading) {
      const { lvl, text } = heading
      const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
      out.push(`<h${lvl} id="${id}">${inline(esc(text))}</h${lvl}>`)
      continue
    }

    // Setext heading
    const setLines = b.split('\n')
    if (setLines.length === 2) {
      if (/^=+\s*$/.test(setLines[1])) { out.push(`<h1>${inline(esc(setLines[0]))}</h1>`); continue }
      if (/^-+\s*$/.test(setLines[1])) { out.push(`<h2>${inline(esc(setLines[0]))}</h2>`); continue }
    }

    // Blockquote
    if (/^>/.test(b)) {
      const inner = b.split('\n').map(l => l.replace(/^>[ \t]?/, '')).join('\n')
      // Simple paragraph-level rendering inside blockquote
      const bqLines = inner.split('\n').map(l => inline(esc(l))).join('<br />')
      out.push(`<blockquote><p>${bqLines}</p></blockquote>`)
      continue
    }

    // Unordered list
    if (/^[-*+] /.test(b)) {
      const lis = buildListItems(b, /^[-*+] /)
        .map(li => `<li>${inline(esc(li))}</li>`).join('')
      out.push(`<ul>${lis}</ul>`)
      continue
    }

    // Ordered list
    if (/^\d+[.)]\s/.test(b)) {
      const lis = buildListItems(b, /^\d+[.)]\s+/)
        .map(li => `<li>${inline(esc(li))}</li>`).join('')
      out.push(`<ol>${lis}</ol>`)
      continue
    }

    // GFM table
    const tableLines = b.split('\n')
    if (tableLines.length >= 2 && tableLines[0].includes('|') &&
        /^[\s|:-]+$/.test(tableLines[1])) {
      const aligns = tableLines[1].replace(/^\||\|$/g, '').split('|').map(c => {
        const t = c.trim()
        if (t.startsWith(':') && t.endsWith(':')) return 'center'
        if (t.endsWith(':')) return 'right'
        return 'left'
      })
      const parseRow = (l: string) =>
        l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const ths = parseRow(tableLines[0])
        .map((h, i) => `<th style="text-align:${aligns[i] ?? 'left'}">${inline(esc(h))}</th>`)
        .join('')
      const trs = tableLines.slice(2)
        .filter(l => l.trim())
        .map(l => {
          const tds = parseRow(l)
            .map((c, i) => `<td style="text-align:${aligns[i] ?? 'left'}">${inline(esc(c))}</td>`)
            .join('')
          return `<tr>${tds}</tr>`
        }).join('')
      out.push(`<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`)
      continue
    }

    // Paragraph — hard-break on trailing two spaces
    const pLines = b.split('\n').map(l => {
      if (l.endsWith('  ')) return inline(esc(l.slice(0, -2))) + '<br />'
      return inline(esc(l))
    })
    out.push(`<p>${pLines.join('\n')}</p>`)
  }

  // Restore stash
  let result = out.join('\n')
  // eslint-disable-next-line no-control-regex -- NUL-delimited stash sentinel
  result = result.replace(/\x00S(\d+)\x00/g, (_, i) => stash[+i])
  return result
}

function buildListItems(block: string, re: RegExp): string[] {
  const items: string[] = []
  let current = ''
  for (const line of block.split('\n')) {
    if (re.test(line)) {
      if (current) items.push(current.trim())
      current = line.replace(re, '')
    } else if (/^\s{2,}/.test(line)) {
      current += ' ' + line.trimStart()
    }
  }
  if (current) items.push(current.trim())
  return items
}

// ── RFC-4180 CSV parser ────────────────────────────────────────────────────────
// Supports: quoted fields, embedded commas, embedded newlines, escaped quotes ("").

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuote = false
  let i = 0
  const n = text.length

  while (i < n) {
    const ch = text[i]
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2 }
      else if (ch === '"') { inQuote = false; i++ }
      else { cell += ch; i++ }
    } else if (ch === '"') {
      inQuote = true; i++
    } else if (ch === ',') {
      row.push(cell); cell = ''; i++
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell); cell = ''
      if (row.length > 0) rows.push(row)
      row = []; i += 2
    } else if (ch === '\n') {
      row.push(cell); cell = ''
      if (row.length > 0) rows.push(row)
      row = []; i++
    } else {
      cell += ch; i++
    }
  }

  // Flush last cell / row
  row.push(cell)
  if (row.some(c => c !== '')) rows.push(row)

  return rows
}
