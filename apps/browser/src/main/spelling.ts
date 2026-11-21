import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Session } from 'electron'
import type { SpellingStatus } from '@ewe/shared'
import { writeJsonAtomic } from './storage/json-file'
import { DirWatch, eweConfigDir } from './sync/ewe-link'
import { runTool } from './files/places'
import { spawnDetached } from './files/service'

// Spell checking follows ewe (wave A+L, 2026-11-21). ewe.conf `[desktop.language]`:
// `spellcheck` = the languages (hunspell names such as en_US, ka_GE; unset = the display
// language's + en_US) and `check_spelling` (default true), both written by ewe Settings →
// Language through ewe-conf and synced. Chromium checks with its own .bdic dictionaries
// (fetched once per language by Chromium itself), so a hunspell name maps to one of
// `session.availableSpellCheckerLanguages`; a language Chromium has none for (Georgian, …)
// is reported unsupported and skipped. Without ewe-conf the browser checks the display
// language + US English and the switch is ewe's only.

export const IGNORED_FILE = 'spelling-ignored.json'
const IGNORED_MAX = 500
const CONFIG_DEBOUNCE_MS = 500

export interface LanguageTable {
  spellcheck?: string[]
  check_spelling?: boolean
}

/** `ewe-conf get desktop.language` → the table, or null (unset or no ewe-conf). */
export function parseLanguageTable(text: string | null): LanguageTable | null {
  if (text === null) return null
  try {
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
    const r = raw as Record<string, unknown>
    const out: LanguageTable = {}
    if (Array.isArray(r.spellcheck))
      out.spellcheck = r.spellcheck.filter(
        (x): x is string => typeof x === 'string' && isDictionaryName(x),
      )
    if (typeof r.check_spelling === 'boolean') out.check_spelling = r.check_spelling
    return out
  } catch {
    return null
  }
}

/** ewe-conf's shape for a dictionary name: en_US, es, sr-Latn, ro_RO-ante1993. */
export function isDictionaryName(name: string): boolean {
  return /^[a-z]{2,3}(_[A-Z]{2})?(-[A-Za-z0-9]{2,12})?$/.test(name)
}

/** "de_DE.UTF-8@euro" → "de_DE"; null for C / POSIX / nothing. */
export function dictionaryOfLocale(locale: string | undefined): string | null {
  const base = (locale ?? '').split('@')[0]?.split('.')[0] ?? ''
  if (base === '' || base === 'C' || base === 'POSIX') return null
  return isDictionaryName(base) ? base : null
}

/** The languages when ewe.conf names none: the display language's and US English. */
export function automaticLanguages(locale: string | undefined): string[] {
  const own = dictionaryOfLocale(locale)
  return own === null || own === 'en_US' ? ['en_US'] : [own, 'en_US']
}

/**
 * A hunspell name → the Chromium spellchecker language that checks it: the exact tag
 * (en_US → en-US, pt_BR → pt-BR), else the language alone (de_AT → de), else null.
 */
export function chromiumLanguage(name: string, available: readonly string[]): string | null {
  const base = name.split('-')[0] ?? name
  const tag = base.replace('_', '-')
  const lang = base.split('_')[0] ?? base
  const has = (t: string) => available.find((a) => a.toLowerCase() === t.toLowerCase())
  return has(tag) ?? has(lang) ?? null
}

const NAMES = new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' })

export function languageLabel(name: string): string {
  const tag = (name.split('-')[0] ?? name).replace('_', '-')
  try {
    return NAMES.of(tag) ?? name
  } catch {
    return name
  }
}

export interface SpellingOptions {
  userData: string
  managed: boolean
  locale?: string | undefined
  configDir?: string
  readConf?: () => Promise<string | null>
  writeEnabled?: (on: boolean) => Promise<boolean>
  openSettings?: () => Promise<boolean>
}

export class SpellingService {
  private readonly sessions = new Set<Session>()
  private table: LanguageTable | null = null
  private ignored: string[] = []
  private readonly previous: string[]
  private watch: DirWatch | null = null
  private readonly opts: SpellingOptions

  constructor(opts: SpellingOptions) {
    this.opts = opts
    this.previous = readIgnored(join(opts.userData, IGNORED_FILE))
  }

  /** Read ewe.conf once and follow it while the app runs. */
  async start(): Promise<void> {
    await this.reload()
    if (!this.opts.managed) return
    this.watch = new DirWatch(
      this.opts.configDir ?? eweConfigDir(),
      ['ewe.conf'],
      () => void this.reload(),
      CONFIG_DEBOUNCE_MS,
    )
  }

  private async reload(): Promise<void> {
    if (this.opts.managed) {
      const read =
        this.opts.readConf ?? (() => runTool('ewe-conf', ['get', 'desktop.language'], 10_000))
      this.table = parseLanguageTable(await read())
    }
    for (const ses of this.sessions) this.apply(ses)
  }

  /** Every web session the app makes (the tabs', remote workspaces', the default one). */
  attach(ses: Session): void {
    if (this.sessions.has(ses)) return
    this.sessions.add(ses)
    // words ignored in earlier runs were only ever meant for that run
    for (const word of this.previous) ses.removeWordFromSpellCheckerDictionary(word)
    this.apply(ses)
  }

  enabled(): boolean {
    return this.table?.check_spelling ?? true
  }

  languages(): string[] {
    const chosen = this.table?.spellcheck
    return chosen !== undefined && chosen.length > 0
      ? chosen
      : automaticLanguages(this.opts.locale ?? process.env.LANG)
  }

  private available(ses?: Session): readonly string[] {
    const s = ses ?? this.sessions.values().next().value
    return s?.availableSpellCheckerLanguages ?? []
  }

  /** The Chromium languages to check with, the unsupported ones left out, no duplicates. */
  chromiumLanguages(ses?: Session): string[] {
    const avail = this.available(ses)
    const out: string[] = []
    for (const name of this.languages()) {
      const tag = chromiumLanguage(name, avail)
      if (tag !== null && !out.includes(tag)) out.push(tag)
    }
    return out
  }

  private apply(ses: Session): void {
    const langs = this.chromiumLanguages(ses)
    const on = this.enabled() && langs.length > 0
    try {
      ses.setSpellCheckerEnabled(on)
      if (on) ses.setSpellCheckerLanguages(langs)
    } catch (error) {
      console.error('[ewe] spelling', error)
    }
  }

  status(): SpellingStatus {
    const avail = this.available()
    return {
      managed: this.opts.managed,
      enabled: this.enabled(),
      automatic: this.table?.spellcheck === undefined || this.table.spellcheck.length === 0,
      languages: this.languages().map((code) => ({
        code,
        label: languageLabel(code),
        supported: chromiumLanguage(code, avail) !== null,
      })),
    }
  }

  async setEnabled(on: boolean): Promise<SpellingStatus> {
    if (!this.opts.managed) return this.status()
    const write =
      this.opts.writeEnabled ??
      (async (value: boolean) =>
        (await runTool(
          'ewe-conf',
          ['set', 'desktop.language.check_spelling', value ? 'true' : 'false'],
          30_000,
        )) !== null)
    if (await write(on)) {
      this.table = { ...(this.table ?? {}), check_spelling: on }
      for (const ses of this.sessions) this.apply(ses)
    }
    return this.status()
  }

  openSettings(): Promise<boolean> {
    return this.opts.openSettings?.() ?? spawnDetached('ewe-settings', ['--page=language'])
  }

  /** "Ignore": checked as right for the rest of this run, forgotten at the next start. */
  ignore(ses: Session, word: string): void {
    if (word === '' || word.length > 100) return
    ses.addWordToSpellCheckerDictionary(word)
    this.ignored = [...this.ignored.filter((w) => w !== word), word]
    this.save()
  }

  /** "Add to dictionary" keeps the word for good, even one ignored before. */
  added(word: string): void {
    if (!this.ignored.includes(word) && !this.previous.includes(word)) return
    this.ignored = this.ignored.filter((w) => w !== word)
    const i = this.previous.indexOf(word)
    if (i >= 0) this.previous.splice(i, 1)
    this.save()
  }

  private save(): void {
    const all = [...new Set([...this.previous, ...this.ignored])].slice(-IGNORED_MAX)
    void writeJsonAtomic(join(this.opts.userData, IGNORED_FILE), { version: 1, words: all }).catch(
      () => undefined,
    )
  }

  dispose(): void {
    this.watch?.close()
    this.watch = null
  }
}

export function readIgnored(path: string): string[] {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const words = (raw as { words?: unknown }).words
    return Array.isArray(words)
      ? words.filter((w): w is string => typeof w === 'string' && w !== '').slice(-IGNORED_MAX)
      : []
  } catch {
    return []
  }
}
