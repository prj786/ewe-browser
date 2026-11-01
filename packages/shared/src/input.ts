import type { SafeFieldKind } from './safe'

export type SwipeDirection = 'back' | 'forward'

export interface GestureSettings {
  swipe: boolean
}

export const DEFAULT_GESTURE_SETTINGS: GestureSettings = { swipe: true }

export function sanitizeGestureSettings(value: unknown, base: GestureSettings): GestureSettings {
  if (typeof value !== 'object' || value === null) return base
  const v = value as Record<string, unknown>
  return { swipe: typeof v.swipe === 'boolean' ? v.swipe : base.swipe }
}

export const SWIPE_THRESHOLD = 160
export const SWIPE_LOCK = 12
export const SWIPE_RATIO = 2
export const SWIPE_END_MS = 150

export interface SwipeWheel {
  dx: number
  dy: number
  ctrl: boolean
  shift: boolean
  time: number
}

export type SwipeEvent =
  | { type: 'start' | 'move' | 'end'; dir: SwipeDirection; progress: number }
  | { type: 'cancel'; dir: SwipeDirection }

type SwipeState = 'idle' | 'deciding' | 'ignored' | 'tracking'

export class SwipeTracker {
  private state: SwipeState = 'idle'
  private sx = 0
  private sy = 0
  private last = 0
  private dir: SwipeDirection = 'back'

  get tracking(): boolean {
    return this.state === 'tracking'
  }

  wheel(w: SwipeWheel, blocked: (dir: SwipeDirection) => boolean): SwipeEvent[] {
    const out: SwipeEvent[] = []
    const ended = this.idle(w.time)
    if (ended !== null) out.push(ended)
    this.last = w.time
    if (this.state === 'idle') {
      this.state = w.ctrl || w.shift ? 'ignored' : 'deciding'
      this.sx = 0
      this.sy = 0
    }
    if (this.state === 'ignored') return out
    if (w.ctrl || w.shift) {
      if (this.state === 'tracking') out.push({ type: 'cancel', dir: this.dir })
      this.state = 'ignored'
      return out
    }
    this.sx += w.dx
    this.sy += w.dy
    if (this.state === 'deciding') {
      if (Math.abs(this.sx) + Math.abs(this.sy) < SWIPE_LOCK) return out
      const dir: SwipeDirection = this.sx < 0 ? 'back' : 'forward'
      if (Math.abs(this.sx) <= Math.abs(this.sy) * SWIPE_RATIO || blocked(dir)) {
        this.state = 'ignored'
        return out
      }
      this.dir = dir
      this.state = 'tracking'
      out.push({ type: 'start', dir, progress: this.progress() })
      return out
    }
    out.push({ type: 'move', dir: this.dir, progress: this.progress() })
    return out
  }

  idle(time: number): SwipeEvent | null {
    if (this.state === 'idle' || time - this.last < SWIPE_END_MS) return null
    const was = this.state
    this.state = 'idle'
    return was === 'tracking' ? { type: 'end', dir: this.dir, progress: this.progress() } : null
  }

  private progress(): number {
    const travel = this.dir === 'back' ? -this.sx : this.sx
    return Math.round(Math.min(1, Math.max(0, travel / SWIPE_THRESHOLD)) * 100) / 100
  }
}

export type PageInput =
  | {
      kind: 'swipe'
      phase: 'start' | 'move' | 'end' | 'cancel'
      dir: SwipeDirection
      progress: number
    }
  | { kind: 'button'; dir: SwipeDirection }
  | { kind: 'probe'; safe: SafeFieldKind | null }
  | { kind: 'key'; code: string }

const SWIPE_PHASES = new Set<string>(['start', 'move', 'end', 'cancel'])
const DIRECTIONS = new Set<string>(['back', 'forward'])
const PROBE_KINDS = new Set<string>(['login', 'new-password', 'otp'])

export function isPageInput(value: unknown): value is PageInput {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  switch (v.kind) {
    case 'swipe':
      return (
        typeof v.phase === 'string' &&
        SWIPE_PHASES.has(v.phase) &&
        typeof v.dir === 'string' &&
        DIRECTIONS.has(v.dir) &&
        typeof v.progress === 'number' &&
        Number.isFinite(v.progress) &&
        v.progress >= 0 &&
        v.progress <= 1
      )
    case 'button':
      return typeof v.dir === 'string' && DIRECTIONS.has(v.dir)
    case 'probe':
      return v.safe === null || (typeof v.safe === 'string' && PROBE_KINDS.has(v.safe))
    case 'key':
      return typeof v.code === 'string' && /^[A-Za-z0-9]{1,24}$/.test(v.code)
    default:
      return false
  }
}

export const PAGE_ACTIONS = [
  'media.play',
  'media.pause',
  'media.mute',
  'media.unmute',
  'media.loop',
  'media.unloop',
  'media.controls',
  'media.nocontrols',
  'safe.fill',
  'safe.generate',
  'safe.key',
] as const

export type PageAction = (typeof PAGE_ACTIONS)[number]

export function isPageAction(value: unknown): value is { op: PageAction } {
  if (typeof value !== 'object' || value === null) return false
  const op = (value as Record<string, unknown>).op
  return typeof op === 'string' && (PAGE_ACTIONS as readonly string[]).includes(op)
}

export interface FindResult {
  matches: number
  active: number
}

export interface PageMenuLink {
  url: string
  text: string
  openable: boolean
}

export interface PageMenuMedia {
  kind: 'image' | 'video' | 'audio'
  url: string
  openable: boolean
  savable: boolean
  copyable: boolean
  paused: boolean
  muted: boolean
  loop: boolean
  controls: boolean
}

export interface PageMenuEdit {
  undo: boolean
  redo: boolean
  cut: boolean
  copy: boolean
  paste: boolean
  selectAll: boolean
  misspelled: string
  suggestions: string[]
  safe: SafeFieldKind | null
}

export interface PageMenuPage {
  back: boolean
  forward: boolean
  bookmarkable: boolean
  bookmarked: boolean
  web: boolean
}

export interface PageMenu {
  menuId: string
  engine: string
  link: PageMenuLink | null
  media: PageMenuMedia | null
  selection: string
  selectionUrl: string | null
  edit: PageMenuEdit | null
  page: PageMenuPage
}

export type PageMenuAction =
  | 'link.tab'
  | 'link.workspace'
  | 'link.window'
  | 'link.save'
  | 'link.copy'
  | 'media.tab'
  | 'media.save'
  | 'media.copy'
  | 'media.copyUrl'
  | 'media.play'
  | 'media.mute'
  | 'media.loop'
  | 'media.controls'
  | 'selection.copy'
  | 'selection.search'
  | 'selection.open'
  | `spell.${number}`
  | 'spell.add'
  | 'safe.fill'
  | 'safe.generate'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.pastePlain'
  | 'edit.selectAll'
  | 'page.back'
  | 'page.forward'
  | 'page.reload'
  | 'page.bookmark'
  | 'page.save'
  | 'page.print'
  | 'page.source'
  | 'inspect'

export type PageMenuEntry =
  | {
      type: 'item'
      action: PageMenuAction
      label: string
      hint?: string | undefined
      disabled?: boolean | undefined
      on?: boolean | undefined
    }
  | { type: 'separator' }

export const PAGE_MENU_SUGGESTIONS = 5
export const PAGE_MENU_SELECTION = 32

export function shortText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const parts = Array.from(new Intl.Segmenter().segment(flat), (s) => s.segment)
  return parts.length <= max
    ? flat
    : `${parts
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
}

function item(
  action: PageMenuAction,
  label: string,
  extra: { hint?: string; disabled?: boolean; on?: boolean } = {},
): PageMenuEntry {
  return { type: 'item', action, label, ...extra }
}

function linkItems(link: PageMenuLink): PageMenuEntry[] {
  const closed = !link.openable
  return [
    item('link.tab', 'Open link in new tab', { disabled: closed }),
    item('link.workspace', 'Open link in new workspace', { disabled: closed }),
    item('link.window', 'Open link in new window', { disabled: closed }),
    { type: 'separator' },
    item('link.save', 'Save link', { disabled: closed }),
    item('link.copy', 'Copy link'),
  ]
}

function mediaItems(media: PageMenuMedia): PageMenuEntry[] {
  if (media.kind === 'image')
    return [
      item('media.tab', 'Open image in new tab', { disabled: !media.openable }),
      item('media.save', 'Save image', { disabled: !media.savable }),
      item('media.copy', 'Copy image', { disabled: !media.copyable }),
      item('media.copyUrl', 'Copy image address', { disabled: media.url === '' }),
    ]
  const noun = media.kind === 'video' ? 'video' : 'audio'
  return [
    item('media.play', media.paused ? 'Play' : 'Pause'),
    item('media.mute', media.muted ? 'Unmute' : 'Mute'),
    item('media.loop', 'Loop', { on: media.loop }),
    item('media.controls', 'Show controls', { on: media.controls }),
    { type: 'separator' },
    item('media.tab', `Open ${noun} in new tab`, { disabled: !media.openable }),
    item('media.save', `Save ${noun}`, { disabled: !media.savable }),
    item('media.copyUrl', `Copy ${noun} address`, { disabled: media.url === '' }),
  ]
}

function editItems(edit: PageMenuEdit): PageMenuEntry[] {
  const out: PageMenuEntry[] = []
  if (edit.misspelled !== '') {
    edit.suggestions
      .slice(0, PAGE_MENU_SUGGESTIONS)
      .forEach((word, i) => out.push(item(`spell.${i}`, word)))
    if (edit.suggestions.length === 0)
      out.push(item('spell.0', 'No suggestions', { disabled: true }))
    out.push(item('spell.add', 'Add to dictionary'), { type: 'separator' })
  }
  if (edit.safe === 'new-password')
    out.push(item('safe.generate', 'Use a strong password'), { type: 'separator' })
  else if (edit.safe !== null)
    out.push(item('safe.fill', 'Fill from ewe Safe'), { type: 'separator' })
  out.push(
    item('edit.undo', 'Undo', { hint: 'Ctrl+Z', disabled: !edit.undo }),
    item('edit.redo', 'Redo', { hint: 'Ctrl+Shift+Z', disabled: !edit.redo }),
    { type: 'separator' },
    item('edit.cut', 'Cut', { hint: 'Ctrl+X', disabled: !edit.cut }),
    item('edit.copy', 'Copy', { hint: 'Ctrl+C', disabled: !edit.copy }),
    item('edit.paste', 'Paste', { hint: 'Ctrl+V', disabled: !edit.paste }),
    item('edit.pastePlain', 'Paste as plain text', {
      hint: 'Ctrl+Shift+V',
      disabled: !edit.paste,
    }),
    item('edit.selectAll', 'Select all', { hint: 'Ctrl+A', disabled: !edit.selectAll }),
  )
  return out
}

function selectionItems(menu: PageMenu): PageMenuEntry[] {
  const out: PageMenuEntry[] = []
  if (menu.edit === null) out.push(item('selection.copy', 'Copy', { hint: 'Ctrl+C' }))
  out.push(
    item(
      'selection.search',
      `Search ${menu.engine} for “${shortText(menu.selection, PAGE_MENU_SELECTION)}”`,
    ),
  )
  if (menu.selectionUrl !== null && menu.link === null)
    out.push(item('selection.open', `Go to ${shortText(menu.selection, PAGE_MENU_SELECTION)}`))
  return out
}

function pageItems(page: PageMenuPage): PageMenuEntry[] {
  return [
    item('page.back', 'Back', { hint: 'Alt+←', disabled: !page.back }),
    item('page.forward', 'Forward', { hint: 'Alt+→', disabled: !page.forward }),
    item('page.reload', 'Reload', { hint: 'Ctrl+R' }),
    { type: 'separator' },
    item('page.bookmark', page.bookmarked ? 'Remove bookmark' : 'Bookmark this page', {
      hint: 'Ctrl+D',
      disabled: !page.bookmarkable,
    }),
    item('page.save', 'Save page', { disabled: !page.web }),
    item('page.print', 'Print…', { hint: 'Ctrl+P' }),
    item('page.source', 'View page source', { hint: 'Ctrl+U', disabled: !page.web }),
  ]
}

function tidy(entries: PageMenuEntry[]): PageMenuEntry[] {
  const out: PageMenuEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'separator' && (out.length === 0 || out.at(-1)?.type === 'separator'))
      continue
    out.push(entry)
  }
  while (out.at(-1)?.type === 'separator') out.pop()
  return out
}

export function pageMenuItems(menu: PageMenu): PageMenuEntry[] {
  const groups: PageMenuEntry[][] = []
  if (menu.link !== null) groups.push(linkItems(menu.link))
  if (menu.media !== null) groups.push(mediaItems(menu.media))
  if (menu.selection !== '') groups.push(selectionItems(menu))
  if (menu.edit !== null) groups.push(editItems(menu.edit))
  if (groups.length === 0) groups.push(pageItems(menu.page))
  groups.push([item('inspect', 'Inspect')])
  return tidy(groups.flatMap((g): PageMenuEntry[] => [{ type: 'separator' }, ...g]))
}

export function pageMenuAllows(menu: PageMenu, action: string): action is PageMenuAction {
  return pageMenuItems(menu).some(
    (e) => e.type === 'item' && e.action === action && e.disabled !== true,
  )
}

export const PASSWORD_MANAGER_EXTENSIONS: Readonly<Record<string, string>> = {
  aeblfdkhhhdcdjpifhhbdiojplfjncoa: '1Password',
  khgocmkkpikpnmmkgmdnfckapcdkgfaf: '1Password Beta',
  nngceckbapebfimnlniiiahkandclblb: 'Bitwarden',
  hdokiejnpimakedhajhdlcegeplioahd: 'LastPass',
  fdjamakpfbbddfjaooikfcpapjohcfmg: 'Dashlane',
  bfogiafebfohielmmehodmfbbebbbpei: 'Keeper',
  eiaeiblijfjekdanodkjadfinkhbfgcd: 'NordPass',
  fooolghllnmhmmndgjiamiiodkpenpbb: 'NordPass',
  ghmbeldphafepmbegfdlkpapadhbakde: 'Proton Pass',
  pnlccmojcmeohlpggmfnbbiapkmbliob: 'RoboForm',
  kmcfomidfpdkfieipokbalgegidffkal: 'Enpass',
  oboonakemofpalcgghocfoadofidjkkk: 'KeePassXC-Browser',
  mmhlniccooihdimnnjhamobppdhaolme: 'Kee',
  naepdomgkenhinolocfifgehidddafch: 'Browserpass',
  heflipieckodmcppbnembejjmabajjjj: 'Buttercup',
  admmjipmmciaobhojoghlmleefbicajg: 'Norton Password Manager',
  igkpcodhieompeloncfnbekccinhapdb: 'Zoho Vault',
  eljmjmgjkbmpmfljlmklcfineebidmlo: 'Psono',
  didegimhafipceonhjepacocaffmoppf: 'Passbolt',
  cpaibbcbodhimfnjnakiidgbpiehfgci: 'True Key',
  aomjjhallfgjeglblehebfpbcfeobpgk: '1Password X',
  pejdijmoenmkgeppbflobdenhhabjlaj: 'iCloud Passwords',
  gcmahhkjkpigcpfpmdjnbiakmbdegfeh: 'Bitdefender SecurePass',
  bnfdmghkeppfadphbnkjcicejfepnbfe: 'Sticky Password',
  caljgklbbfbcjjanaijlacgncafpegll: 'Avira Password Manager',
  folnjigffmbjmcjgmbbfcpleeddaedal: 'LogMeOnce',
  fmhmiaejopepamlcjkncpgpdjichnecm: 'KeePass Tusk',
  jgnfghanfbjmimbdmnjfofnbcgpkbegj: 'KeePassHelper',
  dphoaaiomekdhacmfoblfblmncpnbahm: 'ChromeKeePass',
  cpjcaabhelajbdeekeffbkckmcagmgfl: 'ChromeKeePass',
  bocdfmfhfcobbagfcbimemeclglilcbk: 'chromeIPass',
  eohhbhdnnfcpdggfdhhinnikmjnmnijj: 'KeePass Password Manager',
  mhajlicjhgoofheldnmollgbgjheenbi: 'Passwords for Nextcloud',
  cnlhokffphohmfcddnibpohmkdfafdli: 'MultiPassword',
  hfdkpbblioghdghhkdppipefbchgpohn: 'Password Manager Pro',
  kmbjcfefmceiibhnddbeenklcmpehmdd: 'TweakPass',
}

export const SAFE_ONLY_MESSAGE = 'ewe Browser fills passwords with ewe Safe'

export function passwordManagerName(id: string): string | null {
  return Object.hasOwn(PASSWORD_MANAGER_EXTENSIONS, id)
    ? (PASSWORD_MANAGER_EXTENSIONS[id] ?? null)
    : null
}
