import { describe, expect, it } from 'vitest'
import { parseAtxHeading, parseCsv, renderMarkdown } from './markdown'
import { sanitizeHtml } from './sanitize'

function render(md: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown(md)
  return root
}

describe('renderMarkdown — untrusted input', () => {
  it('escapes raw HTML instead of rendering it', () => {
    const root = render('Hello <script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(root.querySelector('script, img')).toBeNull()
    expect(root.textContent).toContain('<script>alert(1)</script>')
  })

  it('escapes HTML inside headings, lists, tables, quotes and code', () => {
    const md = [
      '# <img src=x onerror=alert(1)>',
      '- <b onmouseover=alert(1)>item</b>',
      '| <i>h</i> |\n|---|\n| <svg onload=alert(1)> |',
      '> <iframe src=x></iframe>',
      '```\n<script>alert(1)</script>\n```',
      '`<script>`',
    ].join('\n\n')
    const root = render(md)
    expect(root.querySelector('img, b, i, svg, iframe, script')).toBeNull()
  })

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    '//evil.example',
  ])('replaces non-allowlisted link target %j with #', (url) => {
    const a = render(`[click](${url})`).querySelector('a')!
    expect(a.getAttribute('href')).toBe('#')
  })

  it('cannot break out of the href attribute', () => {
    const a = render('[x](https://a.example/"onmouseover="alert(1))').querySelector('a')
    expect(a?.getAttributeNames().filter((n) => n.startsWith('on'))).toEqual([])
  })

  it('cannot break out of the code-block language class', () => {
    const root = render('```js"onclick="alert(1)\ncode\n```')
    root.querySelectorAll('*').forEach((el) =>
      expect(el.getAttributeNames().filter((n) => n.startsWith('on'))).toEqual([]),
    )
  })

  it('opens links in a new tab without opener access', () => {
    const a = render('[docs](https://example.com)').querySelector('a')!
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('stays inert after the DOMPurify pass used by the viewers', () => {
    const md = '![x](javascript:alert(1))\n\n[a](javascript:alert(1))\n\n<script>alert(1)</script>'
    const root = document.createElement('div')
    root.innerHTML = sanitizeHtml(renderMarkdown(md))
    expect(root.querySelector('script')).toBeNull()
    root.querySelectorAll('[src], [href]').forEach((el) => {
      expect(el.getAttribute('src') ?? el.getAttribute('href')).not.toMatch(/^javascript:/i)
    })
  })
})

describe('renderMarkdown — formatting', () => {
  it('renders headings with ids, emphasis and inline code', () => {
    const root = render('## Getting Started\n\n**bold** *it* ~~gone~~ `x < y`')
    expect(root.querySelector('h2')?.id).toBe('getting-started')
    expect(root.querySelector('strong')?.textContent).toBe('bold')
    expect(root.querySelector('em')?.textContent).toBe('it')
    expect(root.querySelector('del')?.textContent).toBe('gone')
    expect(root.querySelector('code')?.textContent).toBe('x < y')
  })

  it('renders fenced code verbatim with its language class', () => {
    const root = render('```rust\nfn main() { *p = 1; }\n```')
    const code = root.querySelector('pre > code')!
    expect(code.className).toBe('language-rust')
    // No emphasis processing inside code blocks.
    expect(code.textContent).toBe('fn main() { *p = 1; }')
  })

  it('renders GFM tables with alignment', () => {
    const root = render('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |')
    const ths = root.querySelectorAll('th')
    expect(Array.from(ths, (th) => th.style.textAlign)).toEqual(['left', 'center', 'right'])
    expect(root.querySelectorAll('tbody td')).toHaveLength(3)
  })

  it('renders ordered and unordered lists, joining continuation lines', () => {
    const root = render('- one\n  more\n- two\n\n1. first\n2. second')
    expect(Array.from(root.querySelectorAll('ul li'), (li) => li.textContent)).toEqual(['one more', 'two'])
    expect(root.querySelectorAll('ol li')).toHaveLength(2)
  })

  it('renders blockquotes, rules, setext headings and hard breaks', () => {
    const root = render('> quoted\n\n---\n\nTitle\n=====\n\nline one  \nline two')
    expect(root.querySelector('blockquote')?.textContent).toBe('quoted')
    expect(root.querySelector('hr')).not.toBeNull()
    expect(root.querySelector('h1')?.textContent).toBe('Title')
    expect(root.querySelector('p br')).not.toBeNull()
  })

  it('auto-links bare URLs', () => {
    const a = render('see https://example.com/page now').querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com/page')
  })

  it('preserves query strings in link, auto-link and image URLs', () => {
    const root = render('[q](https://example.com/s?a=1&b=2)\n\nhttps://example.com/t?c=3&d=4\n\n![a & b](/img?x=1&y=2)')
    const [link, auto] = root.querySelectorAll('a')
    expect(link.getAttribute('href')).toBe('https://example.com/s?a=1&b=2')
    expect(auto.getAttribute('href')).toBe('https://example.com/t?c=3&d=4')
    expect(auto.textContent).toBe('https://example.com/t?c=3&d=4')
    const img = root.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/img?x=1&y=2')
    expect(img.getAttribute('alt')).toBe('a & b')
  })
})

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles quoted commas, newlines and escaped quotes', () => {
    expect(parseCsv('name,note\n"Doe, J","says ""hi""\nthen leaves"')).toEqual([
      ['name', 'note'],
      ['Doe, J', 'says "hi"\nthen leaves'],
    ])
  })

  it('handles CRLF line endings and a missing trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('keeps empty cells', () => {
    expect(parseCsv('a,,c\n,,\n')).toEqual([['a', '', 'c'], ['', '', '']])
  })

  it('parses ATX headings like the CommonMark subset it replaces', () => {
    expect(parseAtxHeading('# Title')).toEqual({ lvl: 1, text: 'Title' })
    expect(parseAtxHeading('###   Spaced   ')).toEqual({ lvl: 3, text: 'Spaced' })
    expect(parseAtxHeading('## Closed ##')).toEqual({ lvl: 2, text: 'Closed' })
    expect(parseAtxHeading('## C# ##')).toEqual({ lvl: 2, text: 'C#' })
    expect(parseAtxHeading('# foo#')).toEqual({ lvl: 1, text: 'foo#' })
    expect(parseAtxHeading('# #')).toEqual({ lvl: 1, text: '#' })
    expect(parseAtxHeading('#NoSpace')).toBeNull()
    expect(parseAtxHeading('####### seven')).toBeNull()
    expect(parseAtxHeading('#')).toBeNull()
  })

  it('parses a heading crafted for regex backtracking in linear time (ReDoS)', () => {
    const evil = '# a' + ' '.repeat(100_000) + '#' + ' '.repeat(100_000) + '\u0000'
    const start = performance.now()
    parseAtxHeading(evil)
    expect(performance.now() - start).toBeLessThan(200)
  })

  it('renders links, images and rules crafted for backtracking in linear time (ReDoS)', () => {
    const n = 50_000
    for (const evil of ['![a](b' + ' "'.repeat(n), '[a](b' + ' "'.repeat(n), '-' + ' -'.repeat(n) + ' x']) {
      const start = performance.now()
      renderMarkdown(evil)
      expect(performance.now() - start).toBeLessThan(500)
    }
  })
})
