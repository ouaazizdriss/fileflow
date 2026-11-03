import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

vi.mock('./api', () => ({
  SESSION_EXPIRED_EVENT: 'fileflow:session-expired',
  auth: { me: vi.fn() },
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))
// The real file manager pulls in the whole app; a stub is enough to know we're "in".
vi.mock('./components/FileManager', () => ({ default: ({ username }: { username: string }) => <p>files of {username}</p> }))
vi.mock('./components/LoginPage', () => ({ default: () => <p>login page</p> }))

import toast from 'react-hot-toast'
import { auth } from './api'
import App from './App'

describe('App session handling', () => {
  it('shows the login page when there is no session', async () => {
    vi.mocked(auth.me).mockRejectedValue(new Error('Unauthorized'))
    render(<App />)
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })

  it('returns to the login page with one notice when the session expires', async () => {
    vi.mocked(auth.me).mockResolvedValue({ username: 'alice', role: 'user', permissions: [], totp_enabled: false })
    render(<App />)
    expect(await screen.findByText('files of alice')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('fileflow:session-expired'))
      window.dispatchEvent(new Event('fileflow:session-expired'))
    })

    expect(await screen.findByText('login page')).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith('Your session has expired. Please sign in again.', { id: 'session-expired' })
  })
})
