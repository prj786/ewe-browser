import {
  For,
  Index,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js'
import { render } from 'solid-js/web'
import {
  THUMBNAIL_KINDS,
  VIEWABLE_KINDS,
  filesUrl,
  viewerUrl,
  fileKind,
  filterEntries,
  isFileName,
  pathFromFilesUrl,
  sortEntries,
  syncAction,
  syncLabel,
  syncRootOf,
  type ArchiveFormat,
  type ArchiveListing,
  type FileKind,
  type FsClipboard,
  type FsEntry,
  type FsListing,
  type FsPlace,
  type FsPlaceGroup,
  type FsPlaceIcon,
  type FsPlaceSync,
  type FsRequest,
  type FsSyncState,
  type Point,
  type SortKey,
} from '@ewe/shared'
import '../../ui/styles/base.css'
import './files.css'
import { Icon, type IconName } from '../../ui/components/Icon'
import { Menu, type MenuEntry } from '../../ui/components/Menu'
import { api } from '../../ui/lib/api'
import { formatBytes } from '../../ui/lib/format'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'
import { ArchiveDialog } from './archive'
import { MediaViewer } from './viewer'

const KIND_ICON: Record<FileKind, IconName> = {
  folder: 'folder',
  image: 'image',
  video: 'video',
  audio: 'music',
  pdf: 'file-text',
  text: 'file-text',
  code: 'code',
  archive: 'archive',
  document: 'file-text',
  sheet: 'table',
  slides: 'presentation',
  font: 'type',
  disk: 'disc',
  executable: 'terminal',
  package: 'package',
  other: 'file',
}

const KIND_LABEL: Record<FileKind, string> = {
  folder: 'Folder',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  text: 'Text',
  code: 'Code',
  archive: 'Archive',
  document: 'Document',
  sheet: 'Spreadsheet',
  slides: 'Presentation',
  font: 'Font',
  disk: 'Disk image',
  executable: 'Program',
  package: 'App package',
  other: 'File',
}

const PLACE_ICON: Record<FsPlaceIcon, IconName> = {
  house: 'house',
  folder: 'folder',
  download: 'download',
  file: 'file-text',
  image: 'image',
  music: 'music',
  video: 'video',
  code: 'code',
  cloud: 'cloud',
  drive: 'hard-drive',
  'hard-drive': 'hard-drive',
  server: 'server',
  'trash-2': 'trash-2',
  monitor: 'monitor',
}

const GROUPS: { id: FsPlaceGroup; label: string }[] = [
  { id: 'places', label: 'Places' },
  { id: 'cloud', label: 'Cloud' },
  { id: 'synced', label: 'Synced' },
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'devices', label: 'Devices' },
  { id: 'other', label: 'Other' },
]

const SYNC_ICON: Record<FsSyncState, IconName> = {
  synced: 'cloud',
  syncing: 'refresh-cw',
  pending: 'cloud',
  paused: 'pause',
  error: 'circle-alert',
  conflict: 'triangle-alert',
  offline: 'cloud',
}

function syncTitle(path: string, sync: FsPlaceSync): string {
  const parts = [path, syncLabel(sync)]
  if (sync.engine === 'nextcloud-app') parts.push('Synced by the Nextcloud app')
  if (sync.state === 'error' && sync.error !== '') parts.push(sync.error)
  if (sync.lastSync !== null)
    parts.push(
      `Last synced ${new Date(sync.lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`,
    )
  return parts.join(' · ')
}

const SORT_KEYS: SortKey[] = ['name', 'mtime', 'size', 'kind']
const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  mtime: 'Modified',
  size: 'Size',
  kind: 'Type',
}

type View = 'grid' | 'list'

const PREFS_KEY = 'ewe.files.prefs'

interface Prefs {
  view: View
  sort: SortKey
  desc: boolean
  hidden: boolean
}

function loadPrefs(): Prefs {
  const base: Prefs = { view: 'grid', sort: 'name', desc: false, hidden: false }
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    if (typeof raw !== 'object' || raw === null) return base
    const p = raw as Record<string, unknown>
    return {
      view: p.view === 'list' ? 'list' : 'grid',
      sort: p.sort === 'mtime' || p.sort === 'size' || p.sort === 'kind' ? p.sort : 'name',
      desc: p.desc === true,
      hidden: p.hidden === true,
    }
  } catch {
    return base
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    return
  }
}

async function fs<T>(request: FsRequest): Promise<T> {
  const result = await api.fs<T>(request)
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function baseName(path: string): string {
  if (path === '/') return '/'
  return path.slice(path.lastIndexOf('/') + 1)
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

function formatDate(ms: number): string {
  const d = new Date(ms)
  return d.toDateString() === new Date().toDateString()
    ? `Today ${timeFormat.format(d)}`
    : dateFormat.format(d)
}

function uniqueName(entries: FsEntry[], base: string): string {
  const names = new Set(entries.map((e) => e.name))
  if (!names.has(base)) return base
  for (let n = 2; n < 1000; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`
  return `${base} ${Date.now()}`
}

function item(
  id: string,
  label: string,
  icon: IconName | null,
  run: () => void,
  extra: Partial<{ hint: string; disabled: boolean; danger: boolean }> = {},
): MenuEntry {
  return { type: 'item', id, label, ...(icon === null ? {} : { icon }), run, ...extra }
}

function FilesApp(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))

  const prefs = loadPrefs()
  const [view, setView] = createSignal<View>(prefs.view)
  const [sortKey, setSortKey] = createSignal<SortKey>(prefs.sort)
  const [desc, setDesc] = createSignal(prefs.desc)
  const [hidden, setHidden] = createSignal(prefs.hidden)
  createEffect(() => savePrefs({ view: view(), sort: sortKey(), desc: desc(), hidden: hidden() }))

  const [path, setPath] = createSignal('')
  const [listing, setListing] = createSignal<FsListing | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [places, setPlaces] = createSignal<FsPlace[]>([])
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [anchor, setAnchor] = createSignal<string | null>(null)
  const [renaming, setRenaming] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal('')
  const [token, setToken] = createSignal('')
  const [menu, setMenu] = createSignal<{ at: Point; items: MenuEntry[] } | null>(null)
  const [notice, setNotice] = createSignal<{ text: string; error: boolean } | null>(null)
  const [editingPath, setEditingPath] = createSignal(false)
  const [dropTarget, setDropTarget] = createSignal<string | null>(null)
  const [clipboard, setClipboard] = createSignal<FsClipboard>(null)
  const [busy, setBusy] = createSignal(false)
  const [viewer, setViewer] = createSignal<{ items: FsEntry[]; index: number } | null>(null)
  const [eweSync, setEweSync] = createSignal(false)
  const [archive, setArchive] = createSignal<{
    entry: FsEntry
    listing: ArchiveListing | null
    error: string | null
  } | null>(null)
  let dragPaths: string[] | null = null
  let content: HTMLDivElement | undefined
  let filterInput: HTMLInputElement | undefined
  let noticeTimer: number | undefined
  let loadSeq = 0

  const home = () => places().find((p) => p.id === 'home')?.path ?? ''
  const entries = createMemo(() =>
    sortEntries(filterEntries(listing()?.entries ?? [], filter()), sortKey(), desc()),
  )
  const selectedEntries = () => entries().filter((e) => selected().has(e.path))
  const selectOnly = (p: string) => {
    setSelected(new Set([p]))
    setAnchor(p)
  }

  const say = (text: string, isError = false) => {
    window.clearTimeout(noticeTimer)
    setNotice({ text, error: isError })
    noticeTimer = window.setTimeout(() => setNotice(null), isError ? 5000 : 2500)
  }

  const run = async (job: () => Promise<void>) => {
    setBusy(true)
    try {
      await job()
    } catch (e) {
      say(e instanceof Error ? e.message : 'Something went wrong', true)
    } finally {
      setBusy(false)
    }
  }

  const titleFor = (p: string): string => {
    if (p === home()) return 'Home'
    if (p === '/') return 'File system'
    return places().find((pl) => pl.path === p)?.label ?? baseName(p)
  }

  const updateUrl = (p: string, push: boolean) => {
    const url = filesUrl(p)
    if (location.href === url) return
    if (push) history.pushState(null, '', url)
    else history.replaceState(null, '', url)
  }

  const reveal = (p: string) => {
    content
      ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(p)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const load = async (
    target: string,
    options: { push?: boolean; keep?: boolean; select?: string | null } = {},
  ) => {
    const seq = ++loadSeq
    const result = await api.fs<FsListing>({ op: 'list', path: target, hidden: hidden() })
    if (seq !== loadSeq) return
    const previous = path()
    if (!result.ok) {
      setError(result.error)
      setListing(null)
      setPath(target)
      updateUrl(target, options.push ?? false)
      document.title = baseName(target)
      return
    }
    const next = result.value
    setError(null)
    setListing(next)
    setPath(next.path)
    if (next.path !== previous) {
      setFilter('')
      setRenaming(null)
      setAnchor(null)
    }
    const chosen = options.select
    if (chosen !== undefined && chosen !== null) {
      const full = joinPath(next.path, chosen)
      selectOnly(full)
      queueMicrotask(() => reveal(full))
    } else if (options.keep === true) {
      const alive = new Set(next.entries.map((e) => e.path))
      setSelected(new Set([...selected()].filter((p) => alive.has(p))))
    } else setSelected(new Set<string>())
    updateUrl(next.path, options.push ?? false)
    document.title = titleFor(next.path)
    void api.fs({ op: 'watch', path: next.path })
  }

  const go = (p: string) => void load(p, { push: true })
  const reload = () => void load(path(), { keep: true })

  const refreshPlaces = async () => {
    const result = await api.fs<FsPlace[]>({ op: 'places' })
    if (result.ok) setPlaces(result.value)
  }

  const refreshClipboard = async () => {
    const result = await api.fs<FsClipboard>({ op: 'clipboard.get' })
    if (result.ok) setClipboard(result.value)
  }

  onMount(() => {
    const params = new URLSearchParams(location.search)
    void api.fs<string>({ op: 'token' }).then((r) => {
      if (r.ok) setToken(r.value)
    })
    void refreshPlaces().then(() => {
      if (path() !== '') document.title = titleFor(path())
    })
    void refreshClipboard()
    void api.eweSync({ op: 'available' }).then(setEweSync)
    const select = params.get('select')
    void load(params.get('path') ?? '~', { select }).then(() => {
      if (params.get('view') !== '1' || select === null) return
      const entry = entries().find((e) => e.name === select)
      if (entry !== undefined) openViewer(entry)
    })
    const onPop = () => {
      const p = pathFromFilesUrl(location.href)
      if (p !== null) void load(p)
    }
    const onFocus = () => {
      void refreshPlaces()
      void refreshClipboard()
    }
    const offChanged = api.onFsChanged((p) => {
      if (p === path()) void load(p, { keep: true })
    })
    const offPlaces = api.onPlacesChanged(() => void refreshPlaces())
    const clearDrag = () => {
      dragPaths = null
      setDropTarget(null)
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pointerdown', clearDrag)
    window.addEventListener('keydown', onKey)
    onCleanup(() => {
      offChanged()
      offPlaces()
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pointerdown', clearDrag)
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(noticeTimer)
    })
  })

  createEffect(
    on(
      hidden,
      () => {
        if (path() !== '') void load(path(), { keep: true })
      },
      { defer: true },
    ),
  )

  const thumbUrl = (entry: FsEntry) =>
    `app://files/thumb?${new URLSearchParams({ path: entry.path, t: token() }).toString()}`

  const select = (entry: FsEntry, e: MouseEvent | KeyboardEvent) => {
    const list = entries()
    const start = anchor()
    if (e.shiftKey && start !== null) {
      const a = list.findIndex((x) => x.path === start)
      const b = list.findIndex((x) => x.path === entry.path)
      const [from, to] = a < b ? [a, b] : [b, a]
      const range = list.slice(Math.max(0, from), to + 1).map((x) => x.path)
      setSelected(new Set(e.ctrlKey ? [...selected(), ...range] : range))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected())
      if (next.has(entry.path)) next.delete(entry.path)
      else next.add(entry.path)
      setSelected(next)
      setAnchor(entry.path)
    } else selectOnly(entry.path)
  }

  const openExternal = (entry: FsEntry) =>
    run(async () => {
      await fs({ op: 'open', path: entry.path })
    })

  const playInMpv = (entry: FsEntry) =>
    run(async () => {
      await fs({ op: 'mpv', path: entry.path })
    })

  const openViewer = (entry: FsEntry) => {
    const items = entries().filter((e) => VIEWABLE_KINDS.has(fileKind(e)))
    const index = items.findIndex((e) => e.path === entry.path)
    if (index === -1) return
    setViewer({ items, index })
    void api.fs({ op: 'recent', path: entry.path })
  }

  const viewInNewTab = (entry: FsEntry) => {
    void api.send({ type: 'tab.create', url: viewerUrl(entry.path) })
  }

  const openArchive = (entry: FsEntry) => {
    setArchive({ entry, listing: null, error: null })
    void api.fs<ArchiveListing>({ op: 'archive.list', path: entry.path }).then((r) => {
      if (archive()?.entry.path !== entry.path) return
      setArchive(
        r.ok ? { entry, listing: r.value, error: null } : { entry, listing: null, error: r.error },
      )
    })
  }

  const extract = (entry: FsEntry) =>
    run(async () => {
      const dest = await fs<string>({ op: 'extract', path: entry.path })
      setArchive(null)
      await load(path(), { keep: true })
      selectOnly(dest)
      reveal(dest)
      say(`Extracted ${dest.slice(dest.lastIndexOf('/') + 1)}`)
    })

  const compress = (paths: string[], format: ArchiveFormat) =>
    run(async () => {
      say('Compressing…')
      const out = await fs<string>({ op: 'compress', paths, format })
      await load(path(), { keep: true })
      selectOnly(out)
      reveal(out)
      say(`Created ${out.slice(out.lastIndexOf('/') + 1)}`)
    })

  const open = async (entry: FsEntry, newTab = false) => {
    if (entry.dir) {
      if (newTab) void api.send({ type: 'tab.create', url: filesUrl(entry.path), activate: false })
      else go(entry.path)
      return
    }
    const kind = fileKind(entry)
    if (VIEWABLE_KINDS.has(kind)) {
      if (newTab) viewInNewTab(entry)
      else openViewer(entry)
      return
    }
    if (kind === 'archive') {
      openArchive(entry)
      return
    }
    await openExternal(entry)
  }

  const trash = (paths: string[]) =>
    run(async () => {
      if (paths.length === 0) return
      await fs({ op: 'trash', paths })
      say(paths.length === 1 ? 'Moved to Trash' : `Moved ${paths.length} items to Trash`)
      reload()
    })

  const setClip = (mode: 'copy' | 'cut', paths: string[]) =>
    run(async () => {
      if (paths.length === 0) return
      const clip = { mode, paths }
      await fs({ op: 'clipboard.set', clipboard: clip })
      setClipboard(clip)
      const what = paths.length === 1 ? baseName(paths[0] ?? '') : `${paths.length} items`
      say(`${mode === 'cut' ? 'Cut' : 'Copied'} ${what}`)
    })

  const paste = (dir = path()) =>
    run(async () => {
      const clip = await fs<FsClipboard>({ op: 'clipboard.get' })
      if (clip === null || clip.paths.length === 0) return
      const done = await fs<string[]>({
        op: clip.mode === 'cut' ? 'move' : 'copy',
        paths: clip.paths,
        dir,
      })
      if (clip.mode === 'cut') setClipboard(null)
      await load(path(), { keep: true })
      if (dir === path()) setSelected(new Set(done))
    })

  const transfer = (paths: string[], dir: string, copy: boolean) =>
    run(async () => {
      const done = await fs<string[]>({ op: copy ? 'copy' : 'move', paths, dir })
      if (done.length > 0)
        say(`${copy ? 'Copied' : 'Moved'} ${done.length === 1 ? '1 item' : `${done.length} items`}`)
      reload()
    })

  const newFolder = () =>
    run(async () => {
      const name = uniqueName(listing()?.entries ?? [], 'New folder')
      const created = await fs<string>({ op: 'mkdir', dir: path(), name })
      await load(path(), { keep: true })
      selectOnly(created)
      setRenaming(created)
    })

  const commitRename = (entry: FsEntry, name: string) => {
    if (renaming() !== entry.path) return
    setRenaming(null)
    const next = name.trim()
    if (next === '' || next === entry.name) return
    if (!isFileName(next)) {
      say('A name cannot contain /', true)
      return
    }
    void run(async () => {
      const renamed = await fs<string>({ op: 'rename', path: entry.path, name: next })
      await load(path(), { keep: true })
      selectOnly(renamed)
    })
  }

  const columns = (): number => {
    if (view() === 'list' || content === undefined) return 1
    const tiles = [...content.querySelectorAll<HTMLElement>('.fm-tile')]
    const top = tiles[0]?.offsetTop
    if (top === undefined) return 1
    return Math.max(1, tiles.filter((t) => t.offsetTop === top).length)
  }

  const moveSelection = (delta: number, e: KeyboardEvent) => {
    const list = entries()
    if (list.length === 0) return
    const current = list.findIndex((x) => x.path === anchor())
    const next =
      current === -1
        ? delta > 0
          ? 0
          : list.length - 1
        : Math.min(Math.max(0, current + delta), list.length - 1)
    const entry = list[next]
    if (entry === undefined) return
    if (e.shiftKey && current !== -1) {
      const [from, to] = current < next ? [current, next] : [next, current]
      setSelected(new Set(list.slice(from, to + 1).map((x) => x.path)))
      setAnchor(entry.path)
    } else selectOnly(entry.path)
    reveal(entry.path)
  }

  function onKey(e: KeyboardEvent): void {
    if (renaming() !== null || editingPath() || menu() !== null) return
    if (viewer() !== null || archive() !== null) return
    const target = e.target as HTMLElement | null
    if (target?.tagName === 'INPUT') return
    const ctrl = e.ctrlKey || e.metaKey
    const sel = [...selected()]
    const first = selectedEntries()[0]
    const parent = listing()?.parent ?? null
    if (e.key === 'ArrowDown') moveSelection(columns(), e)
    else if (e.key === 'ArrowUp' && e.altKey) {
      if (parent !== null) go(parent)
    } else if (e.key === 'ArrowUp') moveSelection(-columns(), e)
    else if (e.key === 'ArrowRight' && view() === 'grid' && !e.altKey) moveSelection(1, e)
    else if (e.key === 'ArrowLeft' && view() === 'grid' && !e.altKey) moveSelection(-1, e)
    else if (e.key === 'Home') moveSelection(-entries().length, e)
    else if (e.key === 'End') moveSelection(entries().length, e)
    else if (e.key === 'Enter') {
      if (first !== undefined) void open(first, ctrl)
    } else if (e.key === 'Backspace') history.back()
    else if (e.key === 'Delete') void trash(sel)
    else if (e.key === 'F2') {
      if (first !== undefined) setRenaming(first.path)
    } else if (ctrl && e.key === 'a') setSelected(new Set(entries().map((x) => x.path)))
    else if (ctrl && e.key === 'c') void setClip('copy', sel)
    else if (ctrl && e.key === 'x') void setClip('cut', sel)
    else if (ctrl && e.key === 'v') void paste()
    else if (ctrl && e.key === 'f') filterInput?.focus()
    else if (e.key === 'Escape') {
      if (filter() !== '') setFilter('')
      else setSelected(new Set<string>())
    } else if (e.key.length === 1 && !ctrl && !e.altKey && e.key !== ' ') {
      filterInput?.focus()
      setFilter((f) => f + e.key)
    } else return
    e.preventDefault()
  }

  const openTerminal = (p: string) =>
    run(async () => {
      await fs({ op: 'terminal', path: p })
    })

  const copyPath = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => say('Path copied'),
      () => say('Could not copy the path', true),
    )
  }

  const openSyncSettings = () =>
    void api.eweSync({ op: 'pane', pane: 'folders' }).then((ok) => {
      if (!ok) say('ewe Sync is not installed', true)
    })

  const keepInAccount = (p: string) =>
    void api.eweSync({ op: 'add-folder', path: p }).then((ok) => {
      say(ok ? 'Opening ewe Sync…' : 'Could not open ewe Sync', !ok)
    })

  const syncItem = (p: string): MenuEntry | null => {
    if (!eweSync()) return null
    const action = syncAction(p, places(), home())
    if (action === 'keep')
      return item('sync-keep', 'Keep in your account…', 'cloud', () => keepInAccount(p))
    if (action === 'settings')
      return item('sync-settings', 'Sync settings…', 'refresh-cw', openSyncSettings)
    return null
  }

  const entryMenu = (entry: FsEntry, at: Point) => {
    if (!selected().has(entry.path)) selectOnly(entry.path)
    const paths = [...selected()]
    const many = paths.length > 1
    const items: MenuEntry[] = [
      item('open', 'Open', entry.dir ? 'folder-open' : 'external-link', () => void open(entry), {
        disabled: many,
      }),
    ]
    const kind = fileKind(entry)
    if (!many && (entry.dir || VIEWABLE_KINDS.has(kind)))
      items.push(item('open-tab', 'Open in new tab', 'app-window', () => void open(entry, true)))
    if (!many && kind === 'video')
      items.push(item('mpv', 'Play in mpv', 'play', () => void playInMpv(entry)))
    if (!many && kind === 'archive')
      items.push(item('extract', 'Extract here', 'archive', () => void extract(entry)))
    if (!many && !entry.dir && (VIEWABLE_KINDS.has(kind) || kind === 'archive'))
      items.push(
        item('open-with', 'Open with default app', 'external-link', () => void openExternal(entry)),
      )
    items.push({
      type: 'item',
      id: 'compress',
      label: 'Compress',
      icon: 'archive',
      items: [
        item(
          'zip',
          paths.length === 1 ? `${entry.name}.zip` : 'Archive.zip',
          null,
          () => void compress(paths, 'zip'),
        ),
        item('tar.gz', '.tar.gz', null, () => void compress(paths, 'tar.gz')),
        item('tar.zst', '.tar.zst', null, () => void compress(paths, 'tar.zst')),
      ],
    })
    items.push(
      { type: 'separator' },
      item('cut', 'Cut', 'scissors', () => void setClip('cut', paths), { hint: 'Ctrl+X' }),
      item('copy', 'Copy', 'copy', () => void setClip('copy', paths), { hint: 'Ctrl+C' }),
    )
    if (entry.dir && !many && clipboard() !== null)
      items.push(item('paste-into', 'Paste into folder', 'clipboard', () => void paste(entry.path)))
    items.push(
      { type: 'separator' },
      item('rename', 'Rename', 'pencil', () => setRenaming(entry.path), {
        hint: 'F2',
        disabled: many,
      }),
      item('copy-path', many ? 'Copy paths' : 'Copy path', 'link', () =>
        copyPath(paths.join('\n')),
      ),
    )
    if (entry.dir && !many)
      items.push(
        item('terminal', 'Open terminal here', 'terminal', () => void openTerminal(entry.path)),
      )
    const sync = entry.dir && !many ? syncItem(entry.path) : null
    if (sync !== null) items.push({ type: 'separator' }, sync)
    items.push(
      { type: 'separator' },
      item('trash', 'Move to Trash', 'trash-2', () => void trash(paths), {
        hint: 'Del',
        danger: true,
      }),
    )
    setMenu({ at, items })
  }

  const backgroundMenu = (at: Point) => {
    setSelected(new Set<string>())
    const sync = syncItem(path())
    const writable = listing()?.writable ?? false
    setMenu({
      at,
      items: [
        item('new-folder', 'New folder', 'folder-plus', () => void newFolder(), {
          disabled: !writable,
        }),
        item('paste', 'Paste', 'clipboard', () => void paste(), {
          hint: 'Ctrl+V',
          disabled: clipboard() === null || !writable,
        }),
        { type: 'separator' },
        item(
          'hidden',
          hidden() ? 'Hide hidden files' : 'Show hidden files',
          hidden() ? 'eye-off' : 'eye',
          () => setHidden((h) => !h),
        ),
        item(
          'select-all',
          'Select all',
          'check',
          () => setSelected(new Set(entries().map((x) => x.path))),
          { hint: 'Ctrl+A' },
        ),
        { type: 'separator' },
        item('terminal', 'Open terminal here', 'terminal', () => void openTerminal(path())),
        item('copy-path', 'Copy path', 'link', () => copyPath(path())),
        ...(sync === null ? [] : [{ type: 'separator' as const }, sync]),
      ],
    })
  }

  const sortMenu = (at: Point) => {
    setMenu({
      at,
      items: [
        ...SORT_KEYS.map((k) =>
          item(`sort-${k}`, SORT_LABELS[k], sortKey() === k ? 'check' : null, () => setSortKey(k)),
        ),
        { type: 'separator' },
        item('desc', 'Descending', desc() ? 'check' : null, () => setDesc((d) => !d)),
      ],
    })
  }

  const startDrag = (e: DragEvent, entry: FsEntry) => {
    e.preventDefault()
    if (!selected().has(entry.path)) selectOnly(entry.path)
    dragPaths = [...selected()]
    void api.fs({ op: 'drag', paths: dragPaths })
  }

  const dropHandlers = (dir: () => string) => ({
    onDragOver: (e: DragEvent) => {
      const paths = dragPaths
      if (paths === null || paths.includes(dir()) || dir() === path()) return
      e.preventDefault()
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move'
      setDropTarget(dir())
    },
    onDragLeave: () => {
      if (dropTarget() === dir()) setDropTarget(null)
    },
    onDrop: (e: DragEvent) => {
      const paths = dragPaths
      dragPaths = null
      setDropTarget(null)
      if (paths === null) return
      e.preventDefault()
      void transfer(paths, dir(), e.ctrlKey)
    },
  })

  const crumbs = createMemo(() => {
    const p = path()
    const h = home()
    if (p === '') return []
    const out: { label: string; path: string }[] = []
    let acc = ''
    let rest = p
    if (h !== '' && (p === h || p.startsWith(`${h}/`))) {
      out.push({ label: 'Home', path: h })
      acc = h
      rest = p.slice(h.length)
    } else out.push({ label: '/', path: '/' })
    for (const part of rest.split('/').filter((x) => x !== '')) {
      acc = `${acc}/${part}`
      out.push({ label: part, path: acc })
    }
    return out
  })

  const activePlace = createMemo(() => {
    const p = path()
    let best: FsPlace | null = null
    for (const place of places()) {
      const inside = p === place.path || p.startsWith(place.path === '/' ? '/' : `${place.path}/`)
      if (inside && (best === null || place.path.length > best.path.length)) best = place
    }
    return best?.id ?? null
  })

  const syncRoot = createMemo(() => syncRootOf(path(), places()))
  const syncedFolders = createMemo(
    () =>
      new Map(places().flatMap((p) => (p.sync === undefined ? [] : [[p.path, p.sync] as const]))),
  )

  const openPlace = (place: FsPlace) => {
    if (place.state === 'setup') {
      say(`Sign in to your ewe account in ewe Sync to use ${place.label}`, true)
      return
    }
    const target = place.mount
    if (place.state === 'offline' && target !== undefined) {
      void run(async () => {
        say(`Connecting ${place.label}…`)
        setPlaces(await fs<FsPlace[]>({ op: 'mount', target }))
        go(place.path)
      })
      return
    }
    go(place.path)
  }

  const status = createMemo(() => {
    const list = listing()
    if (list === null) return ''
    const shown = entries()
    const folders = shown.filter((e) => e.dir).length
    const files = shown.length - folders
    const counts = [
      folders > 0 ? `${folders} folder${folders === 1 ? '' : 's'}` : '',
      files > 0 ? `${files} file${files === 1 ? '' : 's'}` : '',
    ]
      .filter((x) => x !== '')
      .join(', ')
    const parts = [counts === '' ? 'Empty' : counts]
    const sel = selectedEntries()
    if (sel.length > 0) {
      const bytes = sel.filter((e) => !e.dir).reduce((sum, e) => sum + e.size, 0)
      parts.push(`${sel.length} selected${bytes > 0 ? ` (${formatBytes(bytes)})` : ''}`)
    }
    if (list.free !== null) parts.push(`${formatBytes(list.free)} free`)
    return parts.join(' · ')
  })

  const isCut = (p: string) => {
    const clip = clipboard()
    return clip?.mode === 'cut' && clip.paths.includes(p)
  }

  const EntryIcon = (props: { entry: FsEntry; size: number }): JSX.Element => {
    const kind = () => fileKind(props.entry)
    const [thumb, setThumb] = createSignal<'loading' | 'ok' | 'failed'>('loading')
    createEffect(
      on(
        () => props.entry.path,
        () => setThumb('loading'),
        { defer: true },
      ),
    )
    const wantsThumb = () => THUMBNAIL_KINDS.has(kind()) && token() !== '' && thumb() !== 'failed'
    const sync = () => (props.entry.dir ? syncedFolders().get(props.entry.path) : undefined)
    return (
      <span
        class={`fm-icon kind-${kind()}`}
        classList={{ folder: props.entry.dir, 'has-thumb': wantsThumb() && thumb() === 'ok' }}
      >
        <Icon name={KIND_ICON[kind()]} size={props.size} />
        <Show when={sync()}>
          {(state) => (
            <span
              class="fm-icon-sync"
              classList={{ [state().state]: true }}
              title={syncLabel(state())}
            >
              <Icon name={SYNC_ICON[state().state]} size={props.size > 20 ? 14 : 10} />
            </span>
          )}
        </Show>
        <Show when={wantsThumb()}>
          <img
            class="fm-thumb"
            src={thumbUrl(props.entry)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setThumb('ok')}
            onError={() => setThumb('failed')}
          />
        </Show>
      </span>
    )
  }

  const NameField = (props: { entry: FsEntry }): JSX.Element => (
    <input
      class="fm-rename"
      value={props.entry.name}
      spellcheck={false}
      aria-label="New name"
      ref={(el) =>
        queueMicrotask(() => {
          el.focus()
          const dot = props.entry.dir ? -1 : props.entry.name.lastIndexOf('.')
          el.setSelectionRange(0, dot > 0 ? dot : props.entry.name.length)
        })
      }
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commitRename(props.entry, e.currentTarget.value)
        else if (e.key === 'Escape') setRenaming(null)
      }}
      onBlur={(e) => commitRename(props.entry, e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
    />
  )

  const itemProps = (entry: () => FsEntry) => ({
    'data-path': entry().path,
    draggable: renaming() !== entry().path,
    onClick: (e: MouseEvent) => {
      e.stopPropagation()
      select(entry(), e)
    },
    onDblClick: () => void open(entry()),
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      if (entry().dir) void open(entry(), true)
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      entryMenu(entry(), { x: e.clientX, y: e.clientY })
    },
    onDragStart: (e: DragEvent) => startDrag(e, entry()),
  })

  const entryClasses = (entry: FsEntry) => ({
    selected: selected().has(entry.path),
    cut: isCut(entry.path),
    hidden: entry.hidden,
    drop: dropTarget() === entry.path,
  })

  return (
    <div class="fm">
      <aside class="fm-places" aria-label="Places">
        <For each={GROUPS}>
          {(group) => (
            <Show when={places().some((p) => p.group === group.id)}>
              <div class="fm-group">{group.label}</div>
              <For each={places().filter((p) => p.group === group.id)}>
                {(place) => (
                  <button
                    class="fm-place"
                    classList={{
                      active: activePlace() === place.id,
                      [place.state]: true,
                      drop: dropTarget() === place.path,
                    }}
                    data-place={place.id}
                    title={
                      place.state === 'setup'
                        ? 'Sign in to your ewe account in ewe Sync'
                        : place.state === 'offline' && place.mount !== undefined
                          ? `Connect ${place.label}`
                          : place.sync === undefined
                            ? place.path
                            : syncTitle(place.path, place.sync)
                    }
                    onClick={() => openPlace(place)}
                    onAuxClick={(e) => {
                      if (e.button !== 1 || place.state !== 'ready') return
                      e.preventDefault()
                      void api.send({
                        type: 'tab.create',
                        url: filesUrl(place.path),
                        activate: false,
                      })
                    }}
                    {...dropHandlers(() => place.path)}
                  >
                    <Icon name={PLACE_ICON[place.icon]} />
                    <span class="fm-place-label">{place.label}</span>
                    <Show when={place.state === 'offline' && place.mount !== undefined}>
                      <span class="fm-place-state">Connect</span>
                    </Show>
                    <Show when={place.state === 'ready' ? place.sync : undefined}>
                      {(sync) => (
                        <span
                          class="fm-place-sync"
                          classList={{ [sync().state]: true }}
                          aria-label={syncLabel(sync())}
                        >
                          <Icon name={SYNC_ICON[sync().state]} size={12} />
                        </span>
                      )}
                    </Show>
                    <Show when={place.state === 'setup'}>
                      <span class="fm-place-state">Set up</span>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          )}
        </For>
      </aside>

      <section class="fm-main">
        <header class="fm-toolbar">
          <button class="iconbtn" title="Back" aria-label="Back" onClick={() => history.back()}>
            <Icon name="arrow-left" />
          </button>
          <button
            class="iconbtn"
            title="Forward"
            aria-label="Forward"
            onClick={() => history.forward()}
          >
            <Icon name="arrow-right" />
          </button>
          <button
            class="iconbtn fm-up"
            title="Up (Alt+Up)"
            aria-label="Up"
            disabled={(listing()?.parent ?? null) === null}
            onClick={() => {
              const parent = listing()?.parent ?? null
              if (parent !== null) go(parent)
            }}
          >
            <Icon name="arrow-up" />
          </button>
          <div
            class="fm-crumbs"
            classList={{ editing: editingPath() }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditingPath(true)
            }}
          >
            <Show
              when={editingPath()}
              fallback={
                <Index each={crumbs()}>
                  {(crumb, i) => (
                    <>
                      <Show when={i > 0}>
                        <Icon name="chevron-right" size={12} class="fm-crumb-sep" />
                      </Show>
                      <button
                        class="fm-crumb"
                        classList={{
                          last: i === crumbs().length - 1,
                          drop: dropTarget() === crumb().path,
                        }}
                        onClick={() => go(crumb().path)}
                        {...dropHandlers(() => crumb().path)}
                      >
                        <Show when={crumb().label === 'Home' && i === 0}>
                          <Icon name="house" size={14} />
                        </Show>
                        {crumb().label}
                      </button>
                    </>
                  )}
                </Index>
              }
            >
              <input
                class="fm-path-input"
                value={path()}
                spellcheck={false}
                aria-label="Location"
                ref={(el) =>
                  queueMicrotask(() => {
                    el.focus()
                    el.select()
                  })
                }
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    const value = e.currentTarget.value.trim()
                    setEditingPath(false)
                    go(value === '' ? '~' : value)
                  } else if (e.key === 'Escape') setEditingPath(false)
                }}
                onBlur={() => setEditingPath(false)}
              />
            </Show>
          </div>
          <Show when={syncRoot()}>
            {(root) => (
              <Show when={root().sync}>
                {(sync) => (
                  <button
                    class="fm-sync-chip"
                    classList={{ [sync().state]: true }}
                    title={`${syncTitle(root().path, sync())} · Sync settings in ewe Sync`}
                    onClick={openSyncSettings}
                  >
                    <Icon name={SYNC_ICON[sync().state]} size={14} />
                    <span>{syncLabel(sync())}</span>
                  </button>
                )}
              </Show>
            )}
          </Show>
          <label class="fm-filter">
            <Icon name="search" size={14} />
            <input
              ref={filterInput}
              value={filter()}
              placeholder="Filter"
              spellcheck={false}
              aria-label="Filter this folder"
              onInput={(e) => setFilter(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') {
                  setFilter('')
                  content?.focus()
                } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  content?.focus()
                  const first = entries()[0]
                  if (first === undefined) return
                  selectOnly(first.path)
                  if (e.key === 'Enter') void open(first)
                }
              }}
            />
          </label>
          <button
            class="iconbtn fm-new-folder"
            title="New folder"
            aria-label="New folder"
            disabled={!(listing()?.writable ?? false)}
            onClick={() => void newFolder()}
          >
            <Icon name="folder-plus" />
          </button>
          <button
            class="iconbtn"
            classList={{ on: hidden() }}
            title={hidden() ? 'Hide hidden files' : 'Show hidden files'}
            aria-label="Hidden files"
            aria-pressed={hidden()}
            onClick={() => setHidden((h) => !h)}
          >
            <Icon name={hidden() ? 'eye' : 'eye-off'} />
          </button>
          <button
            class="iconbtn"
            title={`Sort by ${SORT_LABELS[sortKey()].toLowerCase()}`}
            aria-label="Sort"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              sortMenu({ x: r.left, y: r.bottom + 4 })
            }}
          >
            <Icon name="arrow-up-down" />
          </button>
          <div class="fm-views" role="radiogroup" aria-label="View">
            <button
              class="fm-view"
              classList={{ on: view() === 'grid' }}
              role="radio"
              aria-checked={view() === 'grid'}
              title="Grid"
              onClick={() => setView('grid')}
            >
              <Icon name="layout-grid" size={14} />
            </button>
            <button
              class="fm-view"
              classList={{ on: view() === 'list' }}
              role="radio"
              aria-checked={view() === 'list'}
              title="List"
              onClick={() => setView('list')}
            >
              <Icon name="list" size={14} />
            </button>
          </div>
        </header>

        <div
          class="fm-content"
          classList={{ grid: view() === 'grid', list: view() === 'list' }}
          ref={content}
          tabindex="0"
          onClick={() => setSelected(new Set<string>())}
          onContextMenu={(e) => {
            e.preventDefault()
            backgroundMenu({ x: e.clientX, y: e.clientY })
          }}
        >
          <Show when={error()}>
            {(message) => (
              <div class="fm-empty">
                <Icon name="circle-alert" size={32} />
                <span class="fm-empty-title">{message()}</span>
                <span class="fm-empty-desc">{path()}</span>
                <button class="btn btn--secondary btn--sm" onClick={() => go('~')}>
                  Go home
                </button>
              </div>
            )}
          </Show>
          <Show when={listing() !== null && entries().length === 0}>
            <div class="fm-empty">
              <Icon name={filter() === '' ? 'folder-open' : 'search'} size={32} />
              <span class="fm-empty-title">
                {filter() === '' ? 'This folder is empty' : `Nothing matches “${filter()}”`}
              </span>
            </div>
          </Show>
          <Show when={view() === 'list' && entries().length > 0}>
            <div class="fm-head">
              <For each={SORT_KEYS}>
                {(key) => (
                  <button
                    class={`fm-col fm-col-${key}`}
                    classList={{ on: sortKey() === key }}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (sortKey() === key) setDesc((d) => !d)
                      else {
                        setSortKey(key)
                        setDesc(false)
                      }
                    }}
                  >
                    {SORT_LABELS[key]}
                    <Show when={sortKey() === key}>
                      <Icon name={desc() ? 'chevron-down' : 'arrow-up'} size={12} />
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Index each={entries()}>
            {(entry) => (
              <Show
                when={view() === 'grid'}
                fallback={
                  <div
                    class="fm-row"
                    classList={entryClasses(entry())}
                    {...itemProps(entry)}
                    {...(entry().dir ? dropHandlers(() => entry().path) : {})}
                  >
                    <span class="fm-col fm-col-name">
                      <EntryIcon entry={entry()} size={16} />
                      <Show
                        when={renaming() === entry().path}
                        fallback={<span class="fm-name">{entry().name}</span>}
                      >
                        <NameField entry={entry()} />
                      </Show>
                    </span>
                    <span class="fm-col fm-col-mtime">{formatDate(entry().mtime)}</span>
                    <span class="fm-col fm-col-size">
                      {entry().dir ? '' : formatBytes(entry().size)}
                    </span>
                    <span class="fm-col fm-col-kind">{KIND_LABEL[fileKind(entry())]}</span>
                  </div>
                }
              >
                <div
                  class="fm-tile"
                  classList={entryClasses(entry())}
                  title={entry().name}
                  {...itemProps(entry)}
                  {...(entry().dir ? dropHandlers(() => entry().path) : {})}
                >
                  <EntryIcon entry={entry()} size={36} />
                  <Show
                    when={renaming() === entry().path}
                    fallback={<span class="fm-name">{entry().name}</span>}
                  >
                    <NameField entry={entry()} />
                  </Show>
                </div>
              </Show>
            )}
          </Index>
        </div>

        <footer class="fm-status">
          <span class="fm-status-text">{status()}</span>
          <Show when={busy()}>
            <span class="fm-spinner" aria-label="Working" />
          </Show>
        </footer>
      </section>

      <Show when={viewer()}>
        {(v) => (
          <MediaViewer
            items={v().items}
            index={v().index}
            token={token()}
            onIndex={(index) => {
              setViewer({ items: v().items, index })
              const current = v().items[index]
              if (current !== undefined) selectOnly(current.path)
            }}
            onClose={() => {
              setViewer(null)
              content?.focus()
            }}
            onNewTab={viewInNewTab}
            onExternal={(entry) => void openExternal(entry)}
            onMpv={(entry) => void playInMpv(entry)}
          />
        )}
      </Show>

      <Show when={archive()}>
        {(a) => (
          <ArchiveDialog
            entry={a().entry}
            listing={a().listing}
            error={a().error}
            busy={busy()}
            onExtract={() => void extract(a().entry)}
            onExternal={() => {
              void openExternal(a().entry)
              setArchive(null)
            }}
            onClose={() => setArchive(null)}
          />
        )}
      </Show>

      <Show when={notice()}>
        {(n) => (
          <div class="fm-notice" classList={{ error: n().error }} role="status">
            <Icon name={n().error ? 'circle-alert' : 'check'} size={14} />
            {n().text}
          </div>
        )}
      </Show>

      <Show when={menu()}>
        {(m) => (
          <div
            class="fm-menu-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setMenu(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Menu items={m().items} at={m().at} onClose={() => setMenu(null)} />
          </div>
        )}
      </Show>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <FilesApp />, root)
