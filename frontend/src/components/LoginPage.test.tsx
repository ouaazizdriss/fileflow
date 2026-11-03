import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api', () => ({
  auth: { login: vi.fn() },
  twoFactor: { verify: vi.fn(), verifyRecovery: vi.fn() },
}))
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }))

import toast from 'react-hot-toast'
import { auth, twoFactor } from '../api'
import type { UserInfo } from '../types'
import LoginPage from './LoginPage'

const alice: UserInfo = { username: 'alice', role: 'user', permissions: [], totp_enabled: false }

async function submitCredentials(user = userEvent.setup()) {
  await user.type(screen.getByPlaceholderText('admin'), 'alice')
  await user.type(screen.getByPlaceholderText('••••••••'), 'correct horse')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
  return user
}

describe('LoginPage', () => {
  let onLogin: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.mocked(auth.login).mockReset()
    vi.mocked(twoFactor.verify).mockReset()
    vi.mocked(twoFactor.verifyRecovery).mockReset()
    onLogin = vi.fn()
    render(<LoginPage onLogin={onLogin} />)
  })

  it('logs in directly when 2FA is not enabled', async () => {
    vi.mocked(auth.login).mockResolvedValue(alice)
    await submitCredentials()
    expect(auth.login).toHaveBeenCalledWith('alice', 'correct horse')
    expect(onLogin).toHaveBeenCalledWith(alice)
  })

  it('does not submit with an empty password', async () => {
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText('admin'), 'alice')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('shows the server error and stays on the form', async () => {
    vi.mocked(auth.login).mockRejectedValue(new Error('Invalid credentials'))
    await submitCredentials()
    expect(toast.error).toHaveBeenCalledWith('Invalid credentials')
    expect(onLogin).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('asks for a TOTP code when the server requires 2FA, without logging in yet', async () => {
    vi.mocked(auth.login).mockResolvedValue({ requires_2fa: true })
    vi.mocked(twoFactor.verify).mockResolvedValue(alice)
    const user = await submitCredentials()
    expect(onLogin).not.toHaveBeenCalled()

    const codeInput = await screen.findByPlaceholderText('000000')
    await user.type(codeInput, '123456{Enter}')
    expect(twoFactor.verify).toHaveBeenCalledWith('123456')
    expect(onLogin).toHaveBeenCalledWith(alice)
  })

  it('ignores incomplete TOTP codes and clears a rejected one', async () => {
    vi.mocked(auth.login).mockResolvedValue({ requires_2fa: true })
    const user = await submitCredentials()
    const codeInput = await screen.findByPlaceholderText('000000')

    await user.type(codeInput, '123{Enter}')
    expect(twoFactor.verify).not.toHaveBeenCalled()

    vi.mocked(twoFactor.verify).mockRejectedValue(new Error('bad'))
    await user.type(codeInput, '456{Enter}')
    expect(twoFactor.verify).toHaveBeenCalledWith('123456')
    expect(toast.error).toHaveBeenCalledWith('Invalid code')
    expect(codeInput).toHaveValue('')
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('accepts a recovery code instead of the authenticator', async () => {
    vi.mocked(auth.login).mockResolvedValue({ requires_2fa: true })
    vi.mocked(twoFactor.verifyRecovery).mockResolvedValue(alice)
    const user = await submitCredentials()
    await screen.findByPlaceholderText('000000')

    await user.click(screen.getByRole('button', { name: /recovery/i }))
    await user.type(await screen.findByPlaceholderText('XXXXXX-XXXXXX'), 'ABCDEF-123456{Enter}')
    expect(twoFactor.verifyRecovery).toHaveBeenCalledWith('ABCDEF-123456')
    expect(onLogin).toHaveBeenCalledWith(alice)
  })
})
