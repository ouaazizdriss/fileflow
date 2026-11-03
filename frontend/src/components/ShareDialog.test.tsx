import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api', () => ({
  shares: { create: vi.fn(), publicUrl: (t: string) => `https://files.example/api/s/${t}` },
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

import toast from 'react-hot-toast'
import { shares } from '../api'
import type { FileEntry, ShareLink } from '../types'
import ShareDialog from './ShareDialog'

const file: FileEntry = {
  name: 'report.pdf', path: '/docs/report.pdf', is_dir: false, size: 10,
  modified: null, extension: 'pdf', mime_type: 'application/pdf',
}

const link = (extra: Partial<ShareLink> = {}): ShareLink => ({
  token: 'tok123', file_path: file.path, filename: file.name, created_by: 'alice',
  created_at: '2026-10-12T10:00:00Z', expires_at: '2026-10-19T10:00:00Z',
  has_password: false, max_downloads: null, download_count: 0, ...extra,
})

const create = vi.mocked(shares.create)

describe('ShareDialog', () => {
  let user: ReturnType<typeof userEvent.setup>
  beforeEach(() => {
    create.mockReset()
    create.mockResolvedValue(link())
    user = userEvent.setup()
    render(<ShareDialog file={file} onClose={() => {}} />)
  })

  const createButton = () => screen.getByRole('button', { name: 'Create Link' })

  it('defaults to a 7-day public link with no download limit', async () => {
    await user.click(createButton())
    expect(create).toHaveBeenCalledWith('/docs/report.pdf', 7 * 86400, undefined, null)
    expect(await screen.findByDisplayValue('https://files.example/api/s/tok123')).toBeInTheDocument()
  })

  it('uses the selected expiry preset', async () => {
    await user.click(screen.getByRole('button', { name: '1 hour' }))
    await user.click(createButton())
    expect(create).toHaveBeenCalledWith('/docs/report.pdf', 3600, undefined, null)
  })

  it('sends the generated password shown to the user', async () => {
    await user.click(screen.getByRole('button', { name: /Password protect/ }))
    const shown = screen.getByText(/^[A-HJ-NP-Za-km-z2-9]{16}$/).textContent!
    await user.click(createButton())
    expect(create).toHaveBeenCalledWith('/docs/report.pdf', 7 * 86400, shown, null)
  })

  it('lets the limit be cleared and retyped', async () => {
    await user.click(screen.getByRole('button', { name: /Limit downloads/ }))
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '5')
    expect(input).toHaveValue(5)
    await user.click(createButton())
    expect(create).toHaveBeenCalledWith('/docs/report.pdf', 7 * 86400, undefined, 5)
  })

  it('never sends a limit below 1', async () => {
    await user.click(screen.getByRole('button', { name: /Limit downloads/ }))
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '0')
    await user.tab()
    expect(input).toHaveValue(1)
    await user.clear(input)
    await user.click(createButton())
    expect(create).toHaveBeenCalledWith('/docs/report.pdf', 7 * 86400, undefined, 1)
  })

  it('drops the limit again when the toggle is switched off', async () => {
    const toggle = screen.getByRole('button', { name: /Limit downloads/ })
    await user.click(toggle)
    await user.click(toggle)
    await user.click(createButton())
    expect(create).toHaveBeenCalledWith('/docs/report.pdf', 7 * 86400, undefined, null)
  })

  it('shows the error and keeps the options when creation fails', async () => {
    create.mockRejectedValue(new Error('Permission denied'))
    await user.click(createButton())
    expect(toast.error).toHaveBeenCalledWith('Permission denied')
    expect(createButton()).toBeEnabled()
  })
})
