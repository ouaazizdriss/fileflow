import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from './sanitize'

// Parse the sanitized output so assertions check the resulting DOM, not
// incidental string formatting.
function dom(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = sanitizeHtml(html)
  return root
}

const EVENT_ATTR = /^on/i

function hasEventHandlers(root: HTMLElement): boolean {
  return Array.from(root.querySelectorAll('*')).some((el) =>
    Array.from(el.attributes).some((a) => EVENT_ATTR.test(a.name)),
  )
}

describe('sanitizeHtml', () => {
  it.each([
    ['script tag', '<script>alert(1)</script>'],
    ['img onerror', '<img src=x onerror=alert(1)>'],
    ['svg onload', '<svg onload=alert(1)></svg>'],
    ['nested svg script', '<svg><script>alert(1)</script></svg>'],
    ['iframe', '<iframe src="https://evil.example"></iframe>'],
    ['object', '<object data="evil.swf"></object>'],
    ['embed', '<embed src="evil.swf">'],
    ['form + formaction', '<form action="https://evil.example"><input name=pw><button formaction="javascript:alert(1)">x</button></form>'],
    ['details ontoggle', '<details open ontoggle=alert(1)>'],
    ['body onload', '<body onload=alert(1)>'],
    ['style tag', '<style>body{background:url(javascript:alert(1))}</style>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
    ['math mutation', '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>'],
    ['noscript mutation', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
  ])('neutralises %s', (_name, payload) => {
    const root = dom(payload)
    expect(root.querySelector('script, iframe, object, embed, style, meta, form, input, button')).toBeNull()
    expect(hasEventHandlers(root)).toBe(false)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
  ])('strips dangerous href %j', (href) => {
    const a = dom(`<a href="${href}">x</a>`).querySelector('a')!
    expect(a.getAttribute('href') ?? '').not.toMatch(/script:|data:text\/html/i)
  })

  it('keeps the formatting the markdown and syntax renderers emit', () => {
    const html =
      '<h2 id="intro">Intro</h2><p><strong>b</strong> <em>i</em> <del>s</del> <code>c</code></p>' +
      '<pre><code class="language-rust"><span class="hljs-keyword">fn</span></code></pre>' +
      '<table><thead><tr><th style="text-align:left">h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>' +
      '<ul><li>one</li></ul><blockquote><p>q</p></blockquote><hr>'
    const root = dom(html)
    expect(root.querySelector('h2#intro')).not.toBeNull()
    expect(root.querySelector('span.hljs-keyword')?.textContent).toBe('fn')
    expect(root.querySelector('th')?.getAttribute('style')).toBe('text-align:left')
    expect(root.querySelectorAll('strong, em, del, code, table, ul, blockquote, hr')).toHaveLength(9)
  })

  it('keeps safe external links with target/rel', () => {
    const a = dom('<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">x</a>').querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://example.com/a?b=1')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
