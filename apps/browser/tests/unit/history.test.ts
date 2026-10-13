import { describe, expect, it } from 'vitest'
import {
  completeHost,
  entryFor,
  rankSuggestions,
  scoreEntry,
  recentEntries,
} from '../../src/main/history'

const now = Date.UTC(2026, 9, 12)
const day = 86_400_000
const entries = [
  { ...entryFor('https://en.wikipedia.org/wiki/Sheep', 'Sheep - Wikipedia', now - day), count: 3 },
  { ...entryFor('https://wikipedia.org/', 'Wikipedia', now - 60 * day), count: 1 },
  { ...entryFor('https://github.com/prj786/ewe', 'prj786/ewe', now), count: 10 },
  { ...entryFor('https://example.com/', 'Example Domain', now - 2 * day), count: 1 },
]

describe('scoreEntry', () => {
  it('prefers host prefix matches and recent, frequent visits', () => {
    const wiki = entries[0]
    const github = entries[2]
    if (wiki === undefined || github === undefined) throw new Error('fixture')
    expect(scoreEntry(wiki, 'en.wiki', now)).toBeGreaterThan(scoreEntry(wiki, 'sheep', now))
    expect(scoreEntry(github, 'nothing', now)).toBe(0)
  })
})

describe('rankSuggestions', () => {
  it('ranks by match quality times frecency and caps the list', () => {
    const rows = rankSuggestions(entries, 'wiki', 10, now)
    expect(rows.map((r) => r.host)).toEqual(['en.wikipedia.org', 'wikipedia.org'])
    expect(rankSuggestions(entries, 'e', 1, now)).toHaveLength(1)
    expect(rankSuggestions(entries, '   ', 5, now)).toEqual([])
  })
})

describe('completeHost', () => {
  it('completes a typed prefix to the best known host', () => {
    expect(completeHost(entries, 'git', now)).toBe('github.com')
    expect(completeHost(entries, 'en.w', now)).toBe('en.wikipedia.org')
    expect(completeHost(entries, 'github.com', now)).toBeNull()
    expect(completeHost(entries, 'git hub', now)).toBeNull()
    expect(completeHost(entries, 'https://g', now)).toBeNull()
  })
})

describe('recentEntries', () => {
  it('lists the newest visits first and filters by every word', () => {
    const entries = [
      { url: 'https://a.test/docs', title: 'Alpha docs', host: 'a.test', count: 1, last: 10 },
      { url: 'https://b.test/', title: 'Beta', host: 'b.test', count: 3, last: 30 },
      { url: 'https://c.test/docs', title: 'Gamma', host: 'c.test', count: 2, last: 20 },
    ]
    expect(recentEntries(entries, '', 10).map((e) => e.title)).toEqual([
      'Beta',
      'Gamma',
      'Alpha docs',
    ])
    expect(recentEntries(entries, 'DOCS', 10).map((e) => e.title)).toEqual(['Gamma', 'Alpha docs'])
    expect(recentEntries(entries, 'docs alpha', 10).map((e) => e.title)).toEqual(['Alpha docs'])
    expect(recentEntries(entries, '', 1)).toHaveLength(1)
  })
})
