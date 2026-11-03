import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileEntry } from './types'

vi.mock('./api', () => ({
  files: { list: vi.fn() },
  favorites: { list: vi.fn(), add: vi.fn(), remove: vi.fn() },
}))

import { files } from './api'
import { useFileStore } from './store'

const list = vi.mocked(files.list)

const f = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  name, path: `/${name}`, is_dir: false, size: 0, modified: null, extension: null, mime_type: null, ...extra,
})

const initial = useFileStore.getState()

beforeEach(() => {
  useFileStore.setState(initial, true)
  list.mockReset()
  list.mockImplementation(async (path: string) => ({ path, parent: null, entries: [] }))
})

describe('navigation', () => {
  it('pushes history and supports back/forward', async () => {
    const s = useFileStore.getState()
    await s.navigate('/a')
    await s.navigate('/a/b')
    expect(useFileStore.getState()).toMatchObject({ currentPath: '/a/b', history: ['/', '/a', '/a/b'], historyIndex: 2 })

    useFileStore.getState().navigateBack()
    await vi.waitFor(() => expect(useFileStore.getState().currentPath).toBe('/a'))
    useFileStore.getState().navigateForward()
    await vi.waitFor(() => expect(useFileStore.getState().currentPath).toBe('/a/b'))
    expect(useFileStore.getState().history).toEqual(['/', '/a', '/a/b'])
  })

  it('drops forward history when navigating after going back', async () => {
    const s = useFileStore.getState()
    await s.navigate('/a')
    await s.navigate('/b')
    useFileStore.getState().navigateBack()
    await vi.waitFor(() => expect(useFileStore.getState().currentPath).toBe('/a'))
    await useFileStore.getState().navigate('/c')
    expect(useFileStore.getState().history).toEqual(['/', '/a', '/c'])
  })

  it('clears selection and returns to the file browser', async () => {
    useFileStore.setState({ selectedPaths: new Set(['/x']), activeView: 'trash' })
    await useFileStore.getState().navigate('/a')
    expect(useFileStore.getState().selectedPaths.size).toBe(0)
    expect(useFileStore.getState().activeView).toBe('files')
  })

  it('keeps the current listing and records the error on failure', async () => {
    await useFileStore.getState().navigate('/a')
    list.mockRejectedValueOnce(new Error('Forbidden'))
    await useFileStore.getState().navigate('/secret')
    expect(useFileStore.getState()).toMatchObject({ currentPath: '/a', error: 'Forbidden', isLoading: false })
    expect(useFileStore.getState().history).toEqual(['/', '/a'])
  })
})

describe('sorting', () => {
  const entries = [
    f('b.txt', { size: 10, modified: '2026-01-02' }),
    f('Zeta', { is_dir: true }),
    f('A.txt', { size: 30, modified: '2026-01-01' }),
    f('alpha', { is_dir: true }),
    f('c.txt', { size: 20, modified: '2026-01-03' }),
  ]
  const names = () => useFileStore.getState().entries.map((e) => e.name)

  beforeEach(async () => {
    list.mockResolvedValue({ path: '/', parent: null, entries })
    await useFileStore.getState().navigate('/')
  })

  it('lists folders first, then names case-insensitively', () => {
    expect(names()).toEqual(['alpha', 'Zeta', 'A.txt', 'b.txt', 'c.txt'])
  })

  it('sorts by size and toggles order while keeping folders first', () => {
    useFileStore.getState().setSort('size', 'asc')
    expect(names()).toEqual(['alpha', 'Zeta', 'b.txt', 'c.txt', 'A.txt'])
    useFileStore.getState().setSort('size', 'desc')
    expect(names().slice(0, 2).every((n) => ['alpha', 'Zeta'].includes(n))).toBe(true)
    expect(names().slice(2)).toEqual(['A.txt', 'c.txt', 'b.txt'])
  })

  it('sorts by modified date', () => {
    useFileStore.getState().setSort('modified', 'asc')
    expect(names().slice(2)).toEqual(['A.txt', 'b.txt', 'c.txt'])
  })
})

describe('selection', () => {
  beforeEach(async () => {
    list.mockResolvedValue({ path: '/', parent: null, entries: [f('a'), f('b'), f('c'), f('d')] })
    await useFileStore.getState().navigate('/')
  })
  const selected = () => [...useFileStore.getState().selectedPaths].sort()

  it('select replaces, toggle adds and removes', () => {
    const s = useFileStore.getState()
    s.select('/a')
    s.select('/b')
    expect(selected()).toEqual(['/b'])
    useFileStore.getState().toggleSelect('/c')
    expect(selected()).toEqual(['/b', '/c'])
    useFileStore.getState().toggleSelect('/b')
    expect(selected()).toEqual(['/c'])
  })

  it('range-selects between the last selection and the target', () => {
    useFileStore.getState().select('/b')
    useFileStore.getState().rangeSelect('/d')
    expect(selected()).toEqual(['/b', '/c', '/d'])
  })

  it('selectAll and clearSelection', () => {
    useFileStore.getState().selectAll()
    expect(selected()).toHaveLength(4)
    useFileStore.getState().clearSelection()
    expect(selected()).toEqual([])
  })
})
