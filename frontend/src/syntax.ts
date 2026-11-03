import hljs from 'highlight.js'

// Map file extensions to language aliases for highlight.js
const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  xml: 'xml',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gradle: 'gradle',
  svg: 'xml',
  pl: 'perl',
  lua: 'lua',
  swift: 'swift',
  kotlin: 'kotlin',
  groovy: 'groovy',
  clojure: 'clojure',
  scala: 'scala',
  r: 'r',
  diff: 'diff',
  patch: 'diff',
  graphql: 'graphql',
  prisma: 'prisma',
  mdx: 'javascript',
  vue: 'vue',
}

export function detectLanguage(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (!ext) return null

  // Handle special filenames
  if (filename.toLowerCase() === 'dockerfile') return 'dockerfile'
  if (filename.toLowerCase() === 'makefile') return 'makefile'
  if (filename.toLowerCase().startsWith('dockerfile.')) {
    return 'dockerfile'
  }

  return LANGUAGE_MAP[ext] || null
}

export function highlightCode(code: string, filename: string): string {
  const language = detectLanguage(filename)

  try {
    if (language && hljs.getLanguage(language)) {
      const result = hljs.highlight(code, { language, ignoreIllegals: true })
      return result.value
    }
  } catch (e) {
    console.warn(`Failed to highlight ${language}:`, e)
  }

  // Fallback to auto-detection
  try {
    const result = hljs.highlightAuto(code)
    return result.value
  } catch (e) {
    console.warn('Failed to auto-highlight code:', e)
  }

  // Return plain text escaped
  return escapeHtml(code)
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

export function isSyntaxHighlightable(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (!ext) return false
  if (filename.toLowerCase() === 'dockerfile') return true
  if (filename.toLowerCase() === 'makefile') return true
  return ext in LANGUAGE_MAP
}

export const SYNTAX_HIGHLIGHT_CSS = `
.hljs {
  background: transparent;
  color: inherit;
}
.hljs-attr, .hljs-attribute { color: #d19a66; }
.hljs-literal { color: #56b6c2; }
.hljs-meta { color: #7f848e; }
.hljs-meta-keyword { color: #7f848e; }
.hljs-number { color: #d19a66; }
.hljs-operator { color: #5c6370; }
.hljs-selector-attr { color: #d19a66; }
.hljs-selector-class { color: #d19a66; }
.hljs-selector-id { color: #e45649; }
.hljs-selector-pseudo { color: #c678dd; }
.hljs-selector-tag { color: #e45649; }
.hljs-string { color: #98c379; }
.hljs-tag { color: #e45649; }
.hljs-type { color: #56b6c2; }
.hljs-variable { color: #e06c75; }
.hljs-title { color: #61afef; }
.hljs-params { color: #e06c75; }
.hljs-builtin-name { color: #61afef; }
.hljs-keyword { color: #c678dd; }
.hljs-comment { color: #7f848e; font-style: italic; }
.hljs-function .hljs-title { color: #61afef; }
.hljs-name { color: #e06c75; }
.hljs-section { color: #e45649; font-weight: bold; }
.hljs-bullet { color: #56b6c2; }
.hljs-emphasis { color: #e06c75; font-style: italic; }
.hljs-strong { color: #e06c75; font-weight: bold; }
.hljs-addition { background-color: #144620; color: #85e89d; }
.hljs-deletion { background-color: #621c25; color: #f97583; }
`
