import {
  For,
  Index,
  Match,
  Show,
  Switch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js'
import { render } from 'solid-js/web'
import {
  HOME_RECENT_LIMIT,
  VIEWABLE_KINDS,
  filesUrl,
  isRecentFilter,
  viewerUrl,
  type FileKind,
  type FsPlace,
  type FsPlaceIcon,
  type Point,
  type RecentFilter,
  type RecentItem,
  type RecentKind,
  type RecentSource,
  type TabState,
} from '@ewe/shared'
import '../../ui/styles/base.css'
import '../pages.css'
import './home.css'
import { Favicon } from '../../ui/components/Favicon'
import { Icon, type IconName } from '../../ui/components/Icon'
import { Menu, type MenuEntry } from '../../ui/components/Menu'
import { Palette } from '../../ui/components/Palette'
import { api } from '../../ui/lib/api'
import { faviconFor } from '../../ui/lib/favicon'
import { timeAgo } from '../../ui/lib/format'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'
import { pdfPreview } from './pdf'

const FILTER_KEY = 'ewe.home.filter'
const SHORTCUT_LIMIT = 12
const SHORTCUTS_PER_ROW = 9
const PDF_PREVIEW_WIDTH = 160

const FILTERS: { id: RecentFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'doc', label: 'Docs' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Music' },
  { id: 'web', label: 'Web' },
]

const EMPTY_TEXT: Record<RecentFilter, string> = {
  all: 'Documents, videos, music and sites you open show up here.',
  doc: 'Documents you open or download show up here.',
  video: 'Videos you watch show up here.',
  audio: 'Songs you play show up here.',
  web: 'Sites you visit show up here.',
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

const KIND_ICON: Record<RecentKind, IconName> = {
  doc: 'file-text',
  video: 'video',
  audio: 'music',
  web: 'globe',
}

const VERB: Record<RecentSource, string> = {
  opened: 'Opened',
  played: 'Played',
  downloaded: 'Downloaded',
  system: 'Opened',
  visited: 'Visited',
}

type DocTone = 'pdf' | 'doc' | 'sheet' | 'slides' | 'text'

function docTone(kind: FileKind | null): DocTone {
  switch (kind) {
    case 'pdf':
      return 'pdf'
    case 'sheet':
      return 'sheet'
    case 'slides':
      return 'slides'
    case 'document':
      return 'doc'
    default:
      return 'text'
  }
}

function greeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function hue(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return h
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function loadFilter(): RecentFilter {
  try {
    const saved = localStorage.getItem(FILTER_KEY)
    return isRecentFilter(saved) ? saved : 'all'
  } catch {
    return 'all'
  }
}

function Picture(props: { src: string; class: string; fallback?: JSX.Element }): JSX.Element {
  const [failed, setFailed] = createSignal(false)
  const [loaded, setLoaded] = createSignal(false)
  return (
    <Show when={!failed()} fallback={props.fallback}>
      <img
        class={props.class}
        classList={{ loaded: loaded() }}
        src={props.src}
        alt=""
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </Show>
  )
}

function Snippet(props: { text: string; markdown: boolean }): JSX.Element {
  const lines = () => props.text.split('\n')
  return (
    <div class="rc-snippet">
      <For each={lines()}>
        {(line) => {
          const heading = props.markdown && /^#{1,6}\s/.test(line)
          const text = props.markdown
            ? line.replace(/^#{1,6}\s+/, '').replace(/\*\*|__|`/g, '')
            : line
          return <div classList={{ h: heading }}>{text === '' ? ' ' : text}</div>
        }}
      </For>
    </div>
  )
}

function DocFace(props: { ext: string }): JSX.Element {
  return (
    <div class="rc-docface">
      <div class="rc-lines" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <span class="rc-ext">{props.ext === '' ? 'DOC' : props.ext.toUpperCase()}</span>
    </div>
  )
}

function PdfPage(props: { url: string; cacheKey: string; ext: string }): JSX.Element {
  const [src, setSrc] = createSignal<string | null>(null)
  createEffect(
    on(
      () => props.cacheKey,
      (key) => {
        setSrc(null)
        void pdfPreview(props.url, key, PDF_PREVIEW_WIDTH).then((data) => {
          if (props.cacheKey === key) setSrc(data)
        })
      },
    ),
  )
  return (
    <Show when={src()} fallback={<DocFace ext={props.ext} />}>
      {(data) => <img class="rc-page loaded" src={data()} alt="" draggable={false} />}
    </Show>
  )
}

interface CardProps {
  item: RecentItem
  index: number
  token: string
  tabs: TabState[]
  where: string
  now: number
  onOpen(item: RecentItem, newTab: boolean): void
  onMenu(item: RecentItem, at: Point): void
}

function RecentCard(props: CardProps): JSX.Element {
  const media = (route: 'raw' | 'thumb' | 'cover') =>
    `app://home/${route}?${new URLSearchParams({ path: props.item.path ?? '', t: props.token }).toString()}`
  const favicon = () => (props.item.url === null ? null : faviconFor(props.item.url, props.tabs))
  const [backdrop, setBackdrop] = createSignal(true)
  const tooltip = () =>
    `${VERB[props.item.source]} ${timeAgo(props.item.time, props.now).toLowerCase()}\n${props.item.url ?? props.item.path ?? ''}`
  const fallbackCover = (
    <div
      class="rc-audio-fallback"
      style={{ '--h': String(hue(props.item.album ?? props.item.title)) }}
    >
      <Icon name="music" />
    </div>
  )
  return (
    <button
      class="rc-card"
      data-kind={props.item.kind}
      style={{ '--i': String(props.index) }}
      title={tooltip()}
      onClick={(e) => props.onOpen(props.item, e.ctrlKey || e.metaKey)}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button === 1) props.onOpen(props.item, true)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onMenu(props.item, { x: e.clientX, y: e.clientY })
      }}
    >
      <div class="rc-preview">
        <Switch>
          <Match when={props.item.kind === 'web'}>
            <div class="rc-web">
              <Show when={favicon() !== null && backdrop()}>
                <img
                  class="rc-web-backdrop"
                  src={favicon() ?? ''}
                  alt=""
                  draggable={false}
                  onError={() => setBackdrop(false)}
                />
              </Show>
              <span class="rc-web-tile">
                <Favicon src={favicon()} size={28} />
              </span>
            </div>
          </Match>
          <Match when={props.item.kind === 'video'}>
            <div class="rc-video">
              <span class="rc-glyph">
                <Icon name="video" />
              </span>
              <Show when={props.token !== ''}>
                <Picture src={media('thumb')} class="rc-img" />
              </Show>
            </div>
          </Match>
          <Match when={props.item.kind === 'audio'}>
            <div class="rc-audio">
              <Show when={props.token !== '' && props.item.cover} fallback={fallbackCover}>
                <Picture src={media('cover')} class="rc-audio-backdrop" fallback={fallbackCover} />
                <Picture src={media('cover')} class="rc-audio-art" />
              </Show>
            </div>
          </Match>
          <Match when={props.item.kind === 'doc'}>
            <div class="rc-doc" data-tone={docTone(props.item.fileKind)}>
              <div class="rc-paper">
                <Switch fallback={<DocFace ext={props.item.ext} />}>
                  <Match when={props.item.snippet}>
                    {(text) => <Snippet text={text()} markdown={props.item.ext.startsWith('m')} />}
                  </Match>
                  <Match when={props.item.fileKind === 'pdf' && props.token !== ''}>
                    <PdfPage
                      url={media('raw')}
                      cacheKey={`${props.item.key}:${props.item.size ?? 0}`}
                      ext={props.item.ext}
                    />
                  </Match>
                  <Match when={props.item.fileKind !== 'text' && props.token !== ''}>
                    <Picture
                      src={media('thumb')}
                      class="rc-page"
                      fallback={<DocFace ext={props.item.ext} />}
                    />
                  </Match>
                </Switch>
              </div>
            </div>
          </Match>
        </Switch>
        <Show when={props.item.kind === 'video' || props.item.kind === 'audio'}>
          <span class="rc-play" aria-hidden="true">
            <Icon name="play" />
          </span>
        </Show>
      </div>
      <span class="rc-text">
        <span class="rc-title">{props.item.title}</span>
        <span
          class="rc-meta"
          data-tone={props.item.kind === 'doc' ? docTone(props.item.fileKind) : props.item.kind}
        >
          <Icon name={KIND_ICON[props.item.kind]} />
          <span class="rc-meta-where">{props.where}</span>
          <span class="rc-meta-dot">·</span>
          <span class="rc-meta-time">{timeAgo(props.item.time, props.now)}</span>
        </span>
      </span>
    </button>
  )
}

function Home(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))

  const [now, setNow] = createSignal(Date.now())
  const [token, setToken] = createSignal('')
  const [places, setPlaces] = createSignal<FsPlace[]>([])
  const [filter, setFilter] = createSignal<RecentFilter>(loadFilter())
  const [recents, setRecents] = createSignal<RecentItem[] | null>(null)
  const [menu, setMenu] = createSignal<{ at: Point; items: MenuEntry[] } | null>(null)
  const [notice, setNotice] = createSignal<{ text: string; error: boolean } | null>(null)
  let noticeTimer: number | undefined
  let sequence = 0

  const name = () => (store.account()?.name ?? '').split('@')[0] ?? ''
  const shortcuts = () =>
    places()
      .filter((p) => p.group !== 'other' && p.state !== 'setup')
      .slice(0, SHORTCUT_LIMIT)
  const shortcutColumns = () => {
    const count = shortcuts().length
    return Math.ceil(count / Math.ceil(count / SHORTCUTS_PER_ROW))
  }

  const loadRecents = async () => {
    const id = ++sequence
    const result = await api.home<RecentItem[]>({
      op: 'recents',
      filter: filter(),
      limit: HOME_RECENT_LIMIT,
    })
    if (id !== sequence) return
    setNow(Date.now())
    setRecents(result.ok ? result.value : [])
  }

  const loadPlaces = async () => {
    const result = await api.home<FsPlace[]>({ op: 'places' })
    if (result.ok) setPlaces(result.value)
  }

  const refresh = () => {
    void loadRecents()
    void loadPlaces()
  }

  const showNotice = (text: string, error = false) => {
    setNotice({ text, error })
    window.clearTimeout(noticeTimer)
    noticeTimer = window.setTimeout(() => setNotice(null), 2400)
  }

  const where = (item: RecentItem): string => {
    if (item.kind === 'web') return item.host ?? ''
    if (item.kind === 'audio' && item.artist !== null) return item.artist
    const dir = item.dir ?? ''
    return places().find((p) => p.path === dir)?.label ?? (baseName(dir) || '/')
  }

  const go = (url: string, newTab: boolean) =>
    void api.send(newTab ? { type: 'tab.create', url } : { type: 'tab.navigate', input: url })

  const viewable = (item: RecentItem) => item.fileKind !== null && VIEWABLE_KINDS.has(item.fileKind)

  const run = (request: { op: 'open' | 'mpv'; path: string }) =>
    void api.home(request).then((r) => {
      if (!r.ok) showNotice(r.error, true)
    })

  const openItem = (item: RecentItem, newTab: boolean) => {
    if (item.url !== null) {
      go(item.url, newTab)
      return
    }
    const path = item.path
    if (path === null) return
    if (item.kind === 'audio') void api.send({ type: 'music.play', path })
    else if (viewable(item)) go(viewerUrl(path), newTab)
    else run({ op: 'open', path })
  }

  const forget = (item: RecentItem) =>
    void api.home({ op: 'forget', key: item.key }).then(() => loadRecents())

  const entry = (
    id: string,
    label: string,
    icon: IconName,
    action: () => void,
    extra: { danger?: boolean } = {},
  ): MenuEntry => ({ type: 'item', id, label, icon, run: action, ...extra })

  const openMenu = (item: RecentItem, at: Point) => {
    const items: MenuEntry[] = [
      entry(
        'open',
        item.kind === 'audio' ? 'Play' : 'Open',
        item.kind === 'audio' ? 'play' : 'external-link',
        () => openItem(item, false),
      ),
    ]
    if (item.kind === 'web' || (item.kind !== 'audio' && viewable(item)))
      items.push(entry('open-tab', 'Open in new tab', 'app-window', () => openItem(item, true)))
    const path = item.path
    if (path !== null) {
      if (item.kind === 'video')
        items.push(entry('mpv', 'Play in mpv', 'play', () => run({ op: 'mpv', path })))
      if (item.kind === 'audio' || viewable(item))
        items.push(
          entry('default', 'Open with default app', 'external-link', () =>
            run({ op: 'open', path }),
          ),
        )
      items.push(
        entry('reveal', 'Show in folder', 'folder-open', () =>
          go(filesUrl(item.dir ?? '/', baseName(path)), false),
        ),
      )
    }
    items.push(
      entry('copy', item.url === null ? 'Copy path' : 'Copy link', 'link', () => {
        void navigator.clipboard.writeText(item.url ?? path ?? '').then(
          () => showNotice(item.url === null ? 'Path copied' : 'Link copied'),
          () => showNotice('Could not copy', true),
        )
      }),
      { type: 'separator' },
      entry('forget', 'Remove from Recent', 'x', () => forget(item)),
    )
    setMenu({ at, items })
  }

  const chooseFilter = (next: RecentFilter) => {
    if (next === filter()) return
    setFilter(next)
    try {
      localStorage.setItem(FILTER_KEY, next)
    } catch {
      return
    }
  }

  createEffect(on(filter, () => void loadRecents(), { defer: true }))

  onMount(() => {
    void api.home<string>({ op: 'token' }).then((r) => {
      if (r.ok) setToken(r.value)
    })
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const onFocus = () => refresh()
    const onKey = (e: KeyboardEvent) => {
      if (menu() !== null || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT') return
      document.querySelector<HTMLInputElement>('.palette.hero input')?.focus()
    }
    const onChanged = () => void loadRecents()
    const offChanged = api.onHomeChanged(onChanged)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    window.addEventListener('keydown', onKey)
    onCleanup(() => {
      offChanged()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(noticeTimer)
    })
  })

  return (
    <div class="page page-home">
      <main class="home">
        <header class="home-head">
          <h1>
            {greeting(new Date(now()))}
            <Show when={name() !== ''}>{`, ${name()}`}</Show>
          </h1>
          <p>
            {new Date(now()).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </p>
        </header>

        <div class="home-search">
          <Palette
            hero
            placeholder="Search the web, type a URL or a ~/folder"
            tabs={store.tabs()}
            bookmarks={store.bookmarks()}
            engine={store.settings().searchEngine}
            onNavigate={(input) => void api.send({ type: 'tab.navigate', input })}
            onActivate={(id) => void api.send({ type: 'tab.activate', id })}
          />
        </div>

        <Show when={shortcuts().length > 0}>
          <nav
            class="home-places"
            aria-label="Folders"
            style={{ '--cols': String(shortcutColumns()) }}
          >
            <For each={shortcuts()}>
              {(place, i) => (
                <button
                  class="home-place"
                  classList={{ offline: place.state === 'offline' }}
                  style={{ '--i': String(i()) }}
                  title={place.state === 'offline' ? `${place.path} (not connected)` : place.path}
                  onClick={(e) => go(filesUrl(place.path), e.ctrlKey || e.metaKey)}
                  onMouseDown={(e) => {
                    if (e.button === 1) e.preventDefault()
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) go(filesUrl(place.path), true)
                  }}
                >
                  <span class="home-place-well" data-icon={place.icon}>
                    <Icon name={PLACE_ICON[place.icon]} />
                  </span>
                  <span class="home-place-label">{place.label}</span>
                </button>
              )}
            </For>
          </nav>
        </Show>

        <section class="home-recent" aria-label="Recent">
          <div class="home-section-bar">
            <h2 class="home-section-title">Recent</h2>
            <div class="home-seg" role="tablist" aria-label="Show">
              <For each={FILTERS}>
                {(f) => (
                  <button
                    role="tab"
                    data-filter={f.id}
                    aria-selected={filter() === f.id}
                    classList={{ on: filter() === f.id }}
                    onClick={() => chooseFilter(f.id)}
                  >
                    {f.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="rc-row">
            <Show
              when={recents()}
              fallback={
                <Index each={Array.from({ length: HOME_RECENT_LIMIT })}>
                  {() => (
                    <div class="rc-card rc-skeleton" aria-hidden="true">
                      <div class="rc-preview" />
                      <span class="rc-text">
                        <span class="rc-bar" />
                        <span class="rc-bar short" />
                      </span>
                    </div>
                  )}
                </Index>
              }
            >
              {(list) => (
                <Show
                  when={list().length > 0}
                  fallback={
                    <div class="rc-empty">
                      <Icon
                        name={filter() === 'all' ? 'history' : KIND_ICON[filter() as RecentKind]}
                      />
                      <span>{EMPTY_TEXT[filter()]}</span>
                    </div>
                  }
                >
                  <For each={list()}>
                    {(item, i) => (
                      <RecentCard
                        item={item}
                        index={i()}
                        token={token()}
                        tabs={store.tabs()}
                        where={where(item)}
                        now={now()}
                        onOpen={openItem}
                        onMenu={openMenu}
                      />
                    )}
                  </For>
                </Show>
              )}
            </Show>
          </div>
        </section>
      </main>

      <Show when={notice()}>
        {(n) => (
          <div class="home-notice" classList={{ error: n().error }} role="status">
            <Icon name={n().error ? 'circle-alert' : 'check'} />
            {n().text}
          </div>
        )}
      </Show>

      <Show when={menu()}>
        {(m) => (
          <div
            class="home-menu-backdrop"
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
if (root !== null) render(() => <Home />, root)
