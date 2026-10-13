import { describe, expect, it } from 'vitest'
import { middleEllipsis } from './text'

describe('middleEllipsis', () => {
  it('leaves short names alone', () => {
    expect(middleEllipsis('Home', 14)).toBe('Home')
    expect(middleEllipsis('exactly-14-chr', 14)).toBe('exactly-14-chr')
  })

  it('keeps the start and the last three characters', () => {
    expect(middleEllipsis('random workspace name', 14)).toBe('random wor…ame')
    expect(middleEllipsis('random workspace name', 14)).toHaveLength(14)
  })

  it('counts code points, not UTF-16 units', () => {
    expect(middleEllipsis('🐑🐑🐑🐑🐑🐑🐑🐑', 6)).toBe('🐑🐑…🐑🐑🐑')
  })

  it('degrades for tiny limits', () => {
    expect(middleEllipsis('abcdefgh', 3)).toBe('a…h')
    expect(middleEllipsis('abcdefgh', 2)).toBe('a…')
  })
})
