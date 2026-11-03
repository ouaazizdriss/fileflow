import DOMPurify from 'dompurify'

// Defense-in-depth sanitizer for any HTML passed to dangerouslySetInnerHTML.
// Our markdown renderer and syntax highlighter already escape untrusted input at
// the source, but routing their output through DOMPurify guarantees no script,
// event handler, or javascript:/data: URL can reach the DOM even if a renderer
// regresses. `target="_blank"` links keep their rel/target attributes.
// Form controls are forbidden outright: neither renderer emits them, and a
// rendered form inside a trusted preview is a phishing vector.
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option'],
  })
}
