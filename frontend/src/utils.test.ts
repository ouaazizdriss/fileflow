import { describe, expect, it } from 'vitest'
import type { FileEntry } from './types'
import { basename, dirname, formatSize, isPreviewable, joinPath } from './utils'

function entry(name: string, extra: Partial<FileEntry> = {}): FileEntry {
  const ext = name.includes('.') ? name.split('.').pop()! : null
  return { name, path: `/${name}`, is_dir: false, size: 1, modified: null, extension: ext, mime_type: null, ...extra } as FileEntry
}

describe('formatSize', () => {
  it.each([
    [0, '—'],
    [512, '512 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [5 * 1024 ** 2, '5.0 MB'],
    [3.2 * 1024 ** 3, '3.2 GB'],
  ])('%d bytes → %s', (bytes, out) => {
    expect(formatSize(bytes)).toBe(out)
  })
})

describe('path helpers', () => {
  it('joinPath collapses duplicate slashes', () => {
    expect(joinPath('/', 'docs')).toBe('/docs')
    expect(joinPath('/docs/', '/a.txt')).toBe('/docs/a.txt')
    expect(joinPath('')).toBe('/')
  })

  it('dirname returns the parent, with / for top-level entries', () => {
    expect(dirname('/docs/a.txt')).toBe('/docs')
    expect(dirname('/a.txt')).toBe('/')
    expect(dirname('a.txt')).toBe('/')
  })

  it('basename returns the last segment', () => {
    expect(basename('/docs/a.txt')).toBe('a.txt')
    expect(basename('/docs')).toBe('docs')
  })
})

describe('isPreviewable', () => {
  it('never previews directories', () => {
    expect(isPreviewable(entry('folder', { is_dir: true, mime_type: 'text/plain' }))).toBe(false)
  })

  it.each(['notes.md', 'data.csv', 'main.rs', 'report.docx', 'sheet.xlsx'])('previews %s by extension', (name) => {
    expect(isPreviewable(entry(name))).toBe(true)
  })

  it.each(['image/png', 'video/mp4', 'audio/mpeg', 'application/pdf', 'text/plain'])('previews mime %s', (mime) => {
    expect(isPreviewable(entry('blob', { mime_type: mime }))).toBe(true)
  })

  it('keeps PowerPoint and archives download-only', () => {
    expect(isPreviewable(entry('deck.pptx'))).toBe(false)
    expect(isPreviewable(entry('backup.zip', { mime_type: 'application/zip' }))).toBe(false)
  })
})
