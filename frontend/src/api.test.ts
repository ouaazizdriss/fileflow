import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auth, files, SESSION_EXPIRED_EVENT, shares } from './api'

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let calls: { url: string; init: RequestInit }[]

function mockFetch(handler: Handler) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return handler(url, init)
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('request helper', () => {
  it('sends cookies and JSON content type, and parses JSON', async () => {
    mockFetch(() => json({ username: 'alice', role: 'user', permissions: [], totp_enabled: false }))
    const user = await auth.login('alice', 'pw')
    expect(user).toMatchObject({ username: 'alice' })
    expect(calls[0].url).toBe('/api/auth/login')
    expect(calls[0].init.credentials).toBe('include')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ username: 'alice', password: 'pw' })
  })

  it('surfaces the server error message', async () => {
    mockFetch(() => json({ error: 'Invalid credentials' }, 401))
    await expect(auth.login('alice', 'bad')).rejects.toThrow('Invalid credentials')
  })

  it('falls back to the HTTP status when the error body has no message', async () => {
    mockFetch(() => json({}, 500))
    await expect(auth.me()).rejects.toThrow('HTTP 500')
  })

  it('explains an HTML response (SPA fallback) instead of a JSON parse error', async () => {
    mockFetch(() => new Response('<!doctype html><html></html>', { status: 404, headers: { 'Content-Type': 'text/html' } }))
    await expect(auth.me()).rejects.toThrow(/returned HTML instead of JSON/)
  })

  it('returns undefined for 204 No Content', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    await expect(auth.logout()).resolves.toBeUndefined()
  })

  it('rejects a 200 that is not JSON', async () => {
    mockFetch(() => new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } }))
    await expect(auth.me()).rejects.toThrow(/Expected JSON/)
  })
})

describe('session expiry', () => {
  let expired: ReturnType<typeof vi.fn>
  beforeEach(() => {
    expired = vi.fn()
    window.addEventListener(SESSION_EXPIRED_EVENT, expired)
  })
  afterEach(() => window.removeEventListener(SESSION_EXPIRED_EVENT, expired))

  it('signals a lost session on 401 from an authenticated call', async () => {
    mockFetch(() => json({ error: 'Unauthorized' }, 401))
    await expect(shares.list()).rejects.toThrow('Unauthorized')
    expect(expired).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['startup probe', () => auth.me()],
    ['wrong password at login', () => auth.login('alice', 'bad')],
  ])('stays quiet for the expected 401 of the %s', async (_name, call) => {
    mockFetch(() => json({ error: 'Unauthorized' }, 401))
    await expect(call()).rejects.toThrow()
    expect(expired).not.toHaveBeenCalled()
  })

  it('ignores other errors such as 403 and 400', async () => {
    mockFetch(() => json({ error: 'Forbidden' }, 403))
    await expect(shares.list()).rejects.toThrow()
    mockFetch(() => json({ error: 'Current password is incorrect' }, 400))
    await expect(auth.logoutAll()).rejects.toThrow()
    expect(expired).not.toHaveBeenCalled()
  })

  it('does not retry upload chunks once the session is gone', async () => {
    mockFetch((url) => {
      if (url === '/api/uploads/init') return json({ upload_id: 'u1', offset: 0 })
      if (url.startsWith('/api/uploads/chunk')) return json({ error: 'Unauthorized' }, 401)
      return json({ ok: true })
    })
    await expect(files.uploadResumable('/dir', new File(['abcd'], 'a.bin'), () => {}, { chunkSize: 4 })).rejects.toThrow('Session expired')
    expect(calls.filter((c) => c.url.startsWith('/api/uploads/chunk'))).toHaveLength(1)
    expect(expired).toHaveBeenCalledTimes(1)
  })
})

describe('shares.create', () => {
  beforeEach(() => mockFetch(() => json({ token: 't' })))
  const body = () => JSON.parse(calls[0].init.body as string)

  it('sends nulls for an unprotected, unlimited link', async () => {
    await shares.create('/a.txt', 3600)
    expect(body()).toEqual({ file_path: '/a.txt', expires_in_secs: 3600, password: null, max_downloads: null })
  })

  it('sends the password and download limit when set', async () => {
    await shares.create('/a.txt', 86400, 'S3cret', 5)
    expect(body()).toEqual({ file_path: '/a.txt', expires_in_secs: 86400, password: 'S3cret', max_downloads: 5 })
  })

  it('treats an empty password as no password', async () => {
    await shares.create('/a.txt', 60, '')
    expect(body().password).toBeNull()
  })
})

describe('URL builders', () => {
  it('encodes paths so they cannot inject query parameters', () => {
    expect(files.downloadUrl('/a b&c=d.txt')).toBe('/api/files/download?path=%2Fa%20b%26c%3Dd.txt')
    expect(files.previewUrl('/x?y')).toBe('/api/files/preview?path=%2Fx%3Fy')
  })

  it('repeats the paths parameter for bulk downloads', () => {
    expect(files.downloadBulk(['/a', '/b&c'])).toBe('/api/files/download-bulk?paths=%2Fa&paths=%2Fb%26c')
  })
})

describe('files.uploadResumable', () => {
  const file = (size: number) => new File([new Uint8Array(size)], 'big.bin')

  function chunkOffsets() {
    return calls
      .filter((c) => c.url.startsWith('/api/uploads/chunk'))
      .map((c) => Number(new URL(c.url, 'http://x').searchParams.get('offset')))
  }

  it('uploads in chunks, reports progress and finalises', async () => {
    mockFetch((url, init) => {
      if (url === '/api/uploads/init') return json({ upload_id: 'u1', offset: 0 })
      if (url.startsWith('/api/uploads/chunk')) {
        const offset = Number(new URL(url, 'http://x').searchParams.get('offset'))
        return json({ offset: offset + (init.body as Blob).size })
      }
      if (url === '/api/uploads/finish') return json({ ok: true })
      throw new Error(`unexpected ${url}`)
    })
    const progress: number[] = []
    await files.uploadResumable('/dir', file(10), (p) => progress.push(p), { chunkSize: 4 })

    expect(JSON.parse(calls[0].init.body as string)).toEqual({ path: '/dir', filename: 'big.bin', size: 10 })
    expect(chunkOffsets()).toEqual([0, 4, 8])
    expect(progress).toEqual([40, 80, 100, 100])
    expect(calls[calls.length - 1].url).toBe('/api/uploads/finish')
  })

  it('resyncs to the server offset on 409 instead of re-sending', async () => {
    let first = true
    mockFetch((url, init) => {
      if (url === '/api/uploads/init') return json({ upload_id: 'u1', offset: 0 })
      if (url.startsWith('/api/uploads/status')) return json({ offset: 8 })
      if (url.startsWith('/api/uploads/chunk')) {
        if (first) { first = false; return json({ error: 'offset mismatch' }, 409) }
        const offset = Number(new URL(url, 'http://x').searchParams.get('offset'))
        return json({ offset: offset + (init.body as Blob).size })
      }
      return json({ ok: true })
    })
    await files.uploadResumable('/dir', file(10), () => {}, { chunkSize: 4 })
    // Server already had 8 bytes: only the tail is sent after the conflict.
    expect(chunkOffsets()).toEqual([0, 8])
  })

  it('retries a failed chunk after a network error', async () => {
    vi.useFakeTimers()
    let failures = 1
    mockFetch((url, init) => {
      if (url === '/api/uploads/init') return json({ upload_id: 'u1', offset: 0 })
      if (url.startsWith('/api/uploads/status')) return json({ offset: 0 })
      if (url.startsWith('/api/uploads/chunk')) {
        if (failures-- > 0) throw new TypeError('network down')
        return json({ offset: (init.body as Blob).size })
      }
      return json({ ok: true })
    })
    const done = files.uploadResumable('/dir', file(4), () => {}, { chunkSize: 4 })
    await vi.runAllTimersAsync()
    await done
    vi.useRealTimers()
    expect(chunkOffsets()).toEqual([0, 0])
  })

  it('aborts the server-side upload when it gives up', async () => {
    mockFetch((url) => {
      if (url === '/api/uploads/init') return json({ upload_id: 'u1', offset: 0 })
      if (url.startsWith('/api/uploads/chunk')) return json({ offset: 4 })
      if (url === '/api/uploads/finish') return json({ error: 'quota exceeded' }, 413)
      return json({ ok: true })
    })
    await expect(files.uploadResumable('/dir', file(4), () => {}, { chunkSize: 4 })).rejects.toThrow('quota exceeded')
    expect(calls[calls.length - 1].url).toBe('/api/uploads/abort?upload_id=u1')
    expect(calls[calls.length - 1].init.method).toBe('POST')
  })

  it('surfaces an init failure without starting an upload', async () => {
    mockFetch(() => json({ error: 'Quota exceeded' }, 413))
    await expect(files.uploadResumable('/dir', file(4), () => {})).rejects.toThrow('Quota exceeded')
    expect(calls).toHaveLength(1)
  })
})
