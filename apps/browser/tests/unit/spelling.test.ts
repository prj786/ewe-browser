import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import { isPlayableUrl, isSpellingRequest } from '@ewe/shared'
import {
  IGNORED_FILE,
  SpellingService,
  automaticLanguages,
  chromiumLanguage,
  dictionaryOfLocale,
  languageLabel,
  parseLanguageTable,
  readIgnored,
} from '../../src/main/spelling'
import { buildPageMenu, playerMediaUrl, type PageMenuParams } from '../../src/main/page-menu-model'

vi.mock('electron', () => ({
  app: { getName: () => 'ewe-browser' },
  shell: { openPath: () => Promise.resolve('') },
  nativeImage: { createFromBuffer: () => ({}) },
}))

const dirs: string[] = []
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ewe-spelling-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Chromium 152's list, as Electron 44 reports it on Linux
const CHROMIUM = [
  'af', 'bg', 'ca', 'cs', 'cy', 'da', 'de', 'de-DE', 'el', 'en-AU', 'en-CA', 'en-GB',
  'en-GB-oxendict', 'en-US', 'es', 'es-419', 'es-AR', 'es-ES', 'es-MX', 'es-US', 'et', 'fa',
  'fo', 'fr', 'fr-FR', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'it', 'it-IT', 'ko', 'lt', 'lv', 'nb',
  'nl', 'pl', 'pt', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sh', 'sk', 'sl', 'sq', 'sr', 'sv', 'ta', 'tg',
  'tr', 'uk', 'vi',
] // prettier-ignore

class FakeSession {
  availableSpellCheckerLanguages = CHROMIUM
  enabled: boolean | null = null
  languages: string[] = []
  words = new Set<string>()
  setSpellCheckerEnabled(on: boolean) {
    this.enabled = on
  }
  setSpellCheckerLanguages(langs: string[]) {
    for (const l of langs) if (!CHROMIUM.includes(l)) throw new Error(`invalid language ${l}`)
    this.languages = langs
  }
  addWordToSpellCheckerDictionary(word: string) {
    this.words.add(word)
    return true
  }
  removeWordFromSpellCheckerDictionary(word: string) {
    return this.words.delete(word)
  }
}
const asSession = (s: FakeSession) => s as unknown as Session

describe('spelling languages', () => {
  it('reads [desktop.language] from ewe-conf', () => {
    expect(
      parseLanguageTable('{"spellcheck": ["en_US", "ka_GE", "bad name"], "check_spelling": false}'),
    ).toEqual({
      spellcheck: ['en_US', 'ka_GE'],
      check_spelling: false,
    })
    expect(parseLanguageTable(null)).toBeNull()
    expect(parseLanguageTable('not json')).toBeNull()
    expect(parseLanguageTable('[]')).toBeNull()
    expect(parseLanguageTable('{}')).toEqual({})
  })

  it('picks the display language and US English when nothing is chosen', () => {
    expect(dictionaryOfLocale('de_DE.UTF-8')).toBe('de_DE')
    expect(dictionaryOfLocale('sr_RS.UTF-8@latin')).toBe('sr_RS')
    expect(dictionaryOfLocale('C.UTF-8')).toBeNull()
    expect(automaticLanguages('ka_GE.UTF-8')).toEqual(['ka_GE', 'en_US'])
    expect(automaticLanguages('en_US.UTF-8')).toEqual(['en_US'])
    expect(automaticLanguages(undefined)).toEqual(['en_US'])
  })

  it('maps hunspell names to the languages Chromium checks', () => {
    expect(chromiumLanguage('en_US', CHROMIUM)).toBe('en-US')
    expect(chromiumLanguage('en_IE', CHROMIUM)).toBeNull()
    expect(chromiumLanguage('de_AT', CHROMIUM)).toBe('de')
    expect(chromiumLanguage('de_DE', CHROMIUM)).toBe('de-DE')
    expect(chromiumLanguage('pt_BR', CHROMIUM)).toBe('pt-BR')
    expect(chromiumLanguage('es', CHROMIUM)).toBe('es')
    expect(chromiumLanguage('sr-Latn', CHROMIUM)).toBe('sr')
    expect(chromiumLanguage('ka_GE', CHROMIUM)).toBeNull()
    expect(languageLabel('ka_GE')).toBe('Georgian (Georgia)')
    expect(languageLabel('en_US')).toBe('English (United States)')
  })
})

describe('SpellingService', () => {
  it('follows ewe.conf: languages Chromium has, on or off', async () => {
    let conf: string | null = '{"spellcheck": ["ka_GE", "de_DE", "en_US", "en_GB"]}'
    const svc = new SpellingService({
      userData: temp(),
      managed: true,
      readConf: () => Promise.resolve(conf),
    })
    const ses = new FakeSession()
    svc.attach(asSession(ses))
    await svc.start()
    expect(ses.enabled).toBe(true)
    expect(ses.languages).toEqual(['de-DE', 'en-US', 'en-GB'])
    expect(svc.status()).toMatchObject({
      managed: true,
      enabled: true,
      automatic: false,
      languages: [
        { code: 'ka_GE', label: 'Georgian (Georgia)', supported: false },
        { code: 'de_DE', supported: true },
        { code: 'en_US', supported: true },
        { code: 'en_GB', supported: true },
      ],
    })
    conf = '{"spellcheck": ["ka_GE"], "check_spelling": true}'
    svc.dispose()
    const svc2 = new SpellingService({
      userData: temp(),
      managed: true,
      readConf: () => Promise.resolve(conf),
    })
    const ses2 = new FakeSession()
    svc2.attach(asSession(ses2))
    await svc2.start()
    expect(ses2.enabled).toBe(false) // nothing left that Chromium can check
    svc2.dispose()
  })

  it('writes the switch through ewe-conf and applies it', async () => {
    const writes: boolean[] = []
    const svc = new SpellingService({
      userData: temp(),
      managed: true,
      locale: 'en_US.UTF-8',
      readConf: () => Promise.resolve(null),
      writeEnabled: (on) => {
        writes.push(on)
        return Promise.resolve(true)
      },
    })
    const ses = new FakeSession()
    await svc.start()
    svc.attach(asSession(ses))
    expect(svc.status()).toMatchObject({ enabled: true, automatic: true })
    expect(ses.languages).toEqual(['en-US'])
    const next = await svc.setEnabled(false)
    expect(writes).toEqual([false])
    expect(next.enabled).toBe(false)
    expect(ses.enabled).toBe(false)
    svc.dispose()
  })

  it('outside ewe checks the display language and never writes', async () => {
    const svc = new SpellingService({
      userData: temp(),
      managed: false,
      locale: 'ru_RU.UTF-8',
      writeEnabled: () => Promise.reject(new Error('must not write')),
    })
    const ses = new FakeSession()
    svc.attach(asSession(ses))
    await svc.start()
    expect(ses.languages).toEqual(['ru', 'en-US'])
    expect((await svc.setEnabled(false)).enabled).toBe(true)
  })

  it('ignores a word for this run only; adding keeps it', async () => {
    const dir = temp()
    const svc = new SpellingService({ userData: dir, managed: false, locale: 'en_US.UTF-8' })
    const ses = new FakeSession()
    svc.attach(asSession(ses))
    svc.ignore(asSession(ses), 'ewe')
    svc.ignore(asSession(ses), 'Hyprland')
    expect(ses.words).toEqual(new Set(['ewe', 'Hyprland']))
    svc.added('Hyprland')
    await new Promise((r) => setTimeout(r, 50))
    expect(readIgnored(join(dir, IGNORED_FILE))).toEqual(['ewe'])
    // the next run removes what was only ignored
    const next = new SpellingService({ userData: dir, managed: false, locale: 'en_US.UTF-8' })
    next.attach(asSession(ses))
    expect(ses.words).toEqual(new Set(['Hyprland']))
    writeFileSync(join(dir, IGNORED_FILE), 'garbage')
    expect(readIgnored(join(dir, IGNORED_FILE))).toEqual([])
    expect(readFileSync(join(dir, IGNORED_FILE), 'utf8')).toBe('garbage')
  })

  it('validates the settings page requests', () => {
    expect(isSpellingRequest({ enabled: false })).toBe(true)
    expect(isSpellingRequest({ open: 'settings' })).toBe(true)
    expect(isSpellingRequest({ open: 'anything' })).toBe(false)
    expect(isSpellingRequest({ enabled: 'yes' })).toBe(false)
    expect(isSpellingRequest({ enabled: true, open: 'settings' })).toBe(false)
    expect(isSpellingRequest(null)).toBe(false)
  })
})

function params(extra: Partial<PageMenuParams>): PageMenuParams {
  return {
    linkURL: '',
    linkText: '',
    srcURL: '',
    mediaType: 'none',
    hasImageContents: false,
    isEditable: false,
    selectionText: '',
    misspelledWord: '',
    dictionarySuggestions: [],
    formControlType: 'none',
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: false,
    },
    mediaFlags: { isPaused: false, isMuted: false, isLooping: false, isControlsVisible: true },
    ...extra,
  }
}

const ctx = (pageUrl: string) => ({
  menuId: 'm',
  engine: 'duckduckgo' as const,
  engineName: 'DuckDuckGo',
  pageUrl,
  canGoBack: false,
  canGoForward: false,
  bookmarkable: true,
  bookmarked: false,
  safe: null,
})

describe('Play in ewe Player', () => {
  it('marks video links, media and video pages playable', () => {
    const link = buildPageMenu(
      params({ linkURL: 'https://youtu.be/dQw4w9WgXcQ' }),
      ctx('https://example.org/'),
    )
    expect(link.link?.playable).toBe(true)
    expect(link.page.playable).toBe(false)
    const plain = buildPageMenu(
      params({ linkURL: 'https://example.org/about' }),
      ctx('https://example.org/'),
    )
    expect(plain.link?.playable).toBe(false)
    const yt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const stream = buildPageMenu(
      params({ mediaType: 'video', srcURL: 'blob:https://www.youtube.com/x' }),
      ctx(yt),
    )
    expect(stream.media?.playable).toBe(true)
    expect(playerMediaUrl('blob:https://www.youtube.com/x', yt)).toBe(yt)
    const file = buildPageMenu(
      params({ mediaType: 'video', srcURL: 'https://example.org/a.mp4' }),
      ctx('https://example.org/'),
    )
    expect(file.media?.playable).toBe(true)
    expect(playerMediaUrl('https://example.org/a.mp4', 'https://example.org/')).toBe(
      'https://example.org/a.mp4',
    )
    const blobElsewhere = buildPageMenu(
      params({ mediaType: 'video', srcURL: 'blob:https://example.org/x' }),
      ctx('https://example.org/'),
    )
    expect(blobElsewhere.media?.playable).toBe(false)
    const picture = buildPageMenu(
      params({ mediaType: 'image', srcURL: 'https://example.org/a.mp4' }),
      ctx(yt),
    )
    expect(picture.media?.playable).toBe(false)
    expect(buildPageMenu(params({}), ctx(yt)).page.playable).toBe(true)
    expect(isPlayableUrl(yt)).toBe(true)
  })
})
