import { describe, expect, it } from 'vitest'
import { parseEweAccount } from '../../src/main/ewe-account'

describe('parseEweAccount', () => {
  it('keeps only identity fields', () => {
    expect(
      parseEweAccount(
        JSON.stringify({
          display_name: 'Giorgi',
          email: 'g@example.org',
          server: 'https://cloud.example',
          user: 'giorgi',
          token: 'secret',
        }),
      ),
    ).toEqual({ name: 'Giorgi', email: 'g@example.org', server: 'https://cloud.example' })
  })

  it('falls back to login name and rejects empty files', () => {
    expect(parseEweAccount(JSON.stringify({ login_name: 'gio' }))?.name).toBe('gio')
    expect(parseEweAccount('{}')).toBeNull()
    expect(parseEweAccount('nope')).toBeNull()
  })
})
