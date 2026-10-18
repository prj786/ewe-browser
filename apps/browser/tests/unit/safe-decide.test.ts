import { describe, expect, it } from 'vitest'
import { candidatesToCheck, decideSave } from '../../src/main/safe/decide'

const login = (id: string, username: string, samePassword = false) => ({
  id,
  title: `Login ${id}`,
  username,
  samePassword,
})

describe('decideSave', () => {
  it('offers to save when the site has no login for that username', () => {
    expect(decideSave('sam', [])).toEqual({ mode: 'save' })
    expect(decideSave('sam', [login('a', 'alex')])).toEqual({ mode: 'save' })
  })

  it('says nothing when the same login is already saved', () => {
    expect(decideSave('sam', [login('a', 'Sam ', true)])).toEqual({ mode: 'none' })
  })

  it('offers to update a changed password for the same username', () => {
    expect(decideSave('sam', [login('a', 'alex'), login('b', 'SAM')])).toEqual({
      mode: 'update',
      id: 'b',
      title: 'Login b',
    })
  })

  it('handles password-only forms', () => {
    expect(decideSave('', [])).toEqual({ mode: 'save' })
    expect(decideSave('', [login('a', 'sam', true), login('b', 'alex')])).toEqual({ mode: 'none' })
    expect(decideSave('', [login('a', 'sam')])).toEqual({
      mode: 'update',
      id: 'a',
      title: 'Login a',
    })
    expect(decideSave('', [login('a', 'sam'), login('b', 'alex')])).toEqual({ mode: 'save' })
  })
})

describe('candidatesToCheck', () => {
  it('reveals only logins with the same username, at most five', () => {
    const logins = ['sam', 'alex', 'SAM', 'sam', 'sam', 'sam', 'sam'].map((username, i) => ({
      id: String(i),
      username,
    }))
    expect(candidatesToCheck('Sam', logins).map((l) => l.id)).toEqual(['0', '2', '3', '4', '5'])
    expect(candidatesToCheck('', logins, 2).map((l) => l.id)).toEqual(['0', '1'])
  })
})

describe('sign-ups', () => {
  const exact = (id: string, username: string, samePassword = false) => ({
    ...login(id, username, samePassword),
    exact: true,
  })
  const other = (id: string, username: string) => ({ ...login(id, username), exact: false })

  it('saves a new login unless the same host has that username', () => {
    expect(decideSave('sam', [], 'signup')).toEqual({ mode: 'save' })
    expect(decideSave('sam', [exact('a', 'alex')], 'signup')).toEqual({ mode: 'save' })
    expect(decideSave('sam', [other('a', 'sam')], 'signup')).toEqual({ mode: 'save' })
    expect(decideSave('sam', [exact('a', 'SAM')], 'signup')).toEqual({
      mode: 'update',
      id: 'a',
      title: 'Login a',
    })
    expect(decideSave('sam', [exact('a', 'sam', true)], 'signup')).toEqual({ mode: 'none' })
  })

  it('never updates the only login of the site when the username is unknown', () => {
    expect(decideSave('', [exact('a', 'sam')], 'signup')).toEqual({ mode: 'save' })
    expect(decideSave('', [exact('a', 'sam', true)], 'signup')).toEqual({ mode: 'save' })
    expect(decideSave('', [exact('a', 'sam')], 'change')).toEqual({
      mode: 'update',
      id: 'a',
      title: 'Login a',
    })
  })

  it('reveals only same-host logins with that username', () => {
    const logins = [
      { id: '1', username: 'sam', match: 'exact' },
      { id: '2', username: 'sam', match: 'domain' },
      { id: '3', username: 'alex', match: 'exact' },
    ]
    expect(candidatesToCheck('Sam', logins, 5, 'signup').map((l) => l.id)).toEqual(['1'])
    expect(candidatesToCheck('', logins, 5, 'signup')).toEqual([])
  })
})
