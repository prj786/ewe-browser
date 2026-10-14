import {
  For,
  Index,
  Match,
  Show,
  Switch,
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
  compareTracks,
  filesUrl,
  formatDuration,
  groupAlbums,
  groupArtists,
  searchTracks,
  shuffled,
  type Album,
  type Artist,
  type MusicLibrary,
  type Track,
  type UiEvent,
} from '@ewe/shared'
import '../../ui/styles/base.css'
import './music.css'
import { Icon, type IconName } from '../../ui/components/Icon'
import { api } from '../../ui/lib/api'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'

type MainView = 'songs' | 'albums' | 'artists'

type View = { kind: MainView } | { kind: 'album'; key: string } | { kind: 'artist'; name: string }

type Repeat = 'off' | 'all' | 'one'

const STATE_KEY = 'ewe.music.state'

interface Saved {
  volume: number
  repeat: Repeat
  shuffle: boolean
  queue: string[]
  index: number
  view: MainView
}

function loadSaved(): Saved {
  const base: Saved = {
    volume: 0.8,
    repeat: 'off',
    shuffle: false,
    queue: [],
    index: 0,
    view: 'albums',
  }
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}')
    if (typeof raw !== 'object' || raw === null) return base
    const p = raw as Record<string, unknown>
    return {
      volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : base.volume,
      repeat: p.repeat === 'all' || p.repeat === 'one' ? p.repeat : 'off',
      shuffle: p.shuffle === true,
      queue: Array.isArray(p.queue)
        ? p.queue.filter((x): x is string => typeof x === 'string')
        : [],
      index: typeof p.index === 'number' ? p.index : 0,
      view: p.view === 'songs' || p.view === 'artists' ? p.view : 'albums',
    }
  } catch {
    return base
  }
}

function hue(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return h
}

function joinParts(parts: string[]): string {
  return parts.filter((x) => x !== '').join(' · ')
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function MusicApp(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))

  const saved = loadSaved()
  const [library, setLibrary] = createSignal<MusicLibrary | null>(null)
  const [token, setToken] = createSignal('')
  const [view, setView] = createSignal<View>({ kind: saved.view })
  const [query, setQuery] = createSignal('')
  const [queue, setQueue] = createSignal<Track[]>([])
  const [index, setIndex] = createSignal(saved.index)
  const [playing, setPlaying] = createSignal(false)
  const [time, setTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [volume, setVolume] = createSignal(saved.volume)
  const [shuffle, setShuffle] = createSignal(saved.shuffle)
  const [repeat, setRepeat] = createSignal<Repeat>(saved.repeat)
  const [error, setError] = createSignal<string | null>(null)
  let audio: HTMLAudioElement | undefined
  let search: HTMLInputElement | undefined
  let restored = false
  let pendingPlay = new URLSearchParams(location.search).get('play')
  if (pendingPlay !== null) history.replaceState(null, '', location.pathname)

  const tracks = createMemo(() => [...(library()?.tracks ?? [])].sort(compareTracks))
  const albums = createMemo(() => groupAlbums(tracks()))
  const artists = createMemo(() => groupArtists(albums()))
  const found = createMemo(() => searchTracks(tracks(), query()))
  const current = () => queue()[index()]

  const url = (route: 'raw' | 'cover', path: string) =>
    `app://music/${route}?${new URLSearchParams({ path, t: token() }).toString()}`

  const play = () => queueMicrotask(() => void audio?.play().catch(() => undefined))

  const playList = (list: Track[], start: Track | undefined) => {
    if (list.length === 0) return
    const first = start ?? list[0]
    const q = shuffle() ? shuffled(list, first) : list
    setQueue(q)
    setIndex(Math.max(0, first === undefined ? 0 : q.indexOf(first)))
    setError(null)
    play()
  }

  const playPath = (path: string) => {
    const track = tracks().find((t) => t.path === path)
    if (track === undefined) {
      pendingPlay = path
      return
    }
    pendingPlay = null
    const album = albums().find((a) => a.tracks.includes(track))
    setQuery('')
    if (album !== undefined) setView({ kind: 'album', key: album.key })
    playList(album?.tracks ?? [track], track)
  }

  const onUiEvent = (event: UiEvent) => {
    if (event.type === 'music.play') playPath(event.path)
  }

  const togglePlay = () => {
    if (audio === undefined) return
    if (current() === undefined) {
      playList(found(), undefined)
      return
    }
    if (audio.paused) void audio.play().catch(() => undefined)
    else audio.pause()
  }

  const next = (manual: boolean) => {
    const q = queue()
    if (q.length === 0) return
    if (!manual && repeat() === 'one' && audio !== undefined) {
      audio.currentTime = 0
      play()
      return
    }
    if (index() + 1 < q.length) setIndex(index() + 1)
    else if (repeat() === 'all' || manual) setIndex(0)
    else {
      setPlaying(false)
      return
    }
    play()
  }

  const previous = () => {
    if (audio !== undefined && audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }
    const q = queue()
    if (q.length === 0) return
    setIndex((index() - 1 + q.length) % q.length)
    play()
  }

  const toggleShuffle = () => {
    const enabled = !shuffle()
    setShuffle(enabled)
    const track = current()
    if (track === undefined) return
    const base = enabled ? shuffled(queue(), track) : [...queue()].sort(compareTracks)
    setQueue(base)
    setIndex(Math.max(0, base.indexOf(track)))
  }

  const cycleRepeat = () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))

  const rescan = () =>
    void api.music({ op: 'rescan' }).then((r) => {
      if (r.ok) setLibrary(r.value)
    })

  const openFolder = () => {
    const root = library()?.roots[0]
    if (root !== undefined) void api.send({ type: 'tab.create', url: filesUrl(root) })
  }

  onMount(() => {
    void api.music<string>({ op: 'token' }).then((r) => {
      if (r.ok) setToken(r.value)
    })
    void api.music({ op: 'library' }).then((r) => {
      if (r.ok) setLibrary(r.value)
    })
    const off = api.onMusic(setLibrary)
    const offUi = api.onUi(onUiEvent)
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT') return
      if (e.key === ' ') togglePlay()
      else if (e.key === 'ArrowRight' && audio !== undefined) audio.currentTime += 10
      else if (e.key === 'ArrowLeft' && audio !== undefined) audio.currentTime -= 10
      else if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key === 'f')) search?.focus()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    if ('mediaSession' in navigator) {
      const session = navigator.mediaSession
      session.setActionHandler('play', () => void audio?.play())
      session.setActionHandler('pause', () => audio?.pause())
      session.setActionHandler('previoustrack', previous)
      session.setActionHandler('nexttrack', () => next(true))
      session.setActionHandler('seekto', (d) => {
        if (audio !== undefined && d.seekTime !== undefined) audio.currentTime = d.seekTime
      })
    }
    onCleanup(() => {
      off()
      offUi()
      window.removeEventListener('keydown', onKey)
    })
  })

  createEffect(
    on(tracks, (list) => {
      if (list.length === 0) return
      if (pendingPlay !== null) {
        restored = true
        playPath(pendingPlay)
        return
      }
      if (restored) return
      restored = true
      const byPath = new Map(list.map((t) => [t.path, t]))
      const q = saved.queue.map((p) => byPath.get(p)).filter((t): t is Track => t !== undefined)
      if (q.length === 0) return
      setQueue(q)
      setIndex(Math.min(saved.index, q.length - 1))
    }),
  )

  createEffect(() => {
    const v = view().kind
    const state: Saved = {
      volume: volume(),
      repeat: repeat(),
      shuffle: shuffle(),
      queue: queue().map((t) => t.path),
      index: index(),
      view: v === 'songs' || v === 'artists' ? v : 'albums',
    }
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state))
    } catch {
      return
    }
  })

  createEffect(() => {
    if (audio !== undefined) audio.volume = volume()
  })

  createEffect(
    on([current, token], ([track, t]) => {
      if (audio === undefined || track === undefined || t === '') return
      const src = url('raw', track.path)
      if (audio.src === src) return
      audio.src = src
      setTime(0)
      setDuration(track.duration ?? 0)
    }),
  )

  createEffect(() => {
    const track = current()
    document.title =
      track === undefined
        ? 'Music'
        : `${track.title}${track.artist === '' ? '' : ` · ${track.artist}`}`
    if (!('mediaSession' in navigator) || track === undefined) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork:
        track.cover && token() !== '' ? [{ src: url('cover', track.path), sizes: '512x512' }] : [],
    })
  })

  createEffect(() => {
    if ('mediaSession' in navigator)
      navigator.mediaSession.playbackState = playing() ? 'playing' : 'paused'
  })

  const albumOf = (key: string): Album | undefined => albums().find((a) => a.key === key)
  const artistOf = (name: string): Artist | undefined => artists().find((a) => a.name === name)
  const openedAlbum = () => {
    const v = view()
    return v.kind === 'album' ? albumOf(v.key) : undefined
  }
  const openedArtist = () => {
    const v = view()
    return v.kind === 'artist' ? artistOf(v.name) : undefined
  }

  const Cover = (props: {
    track: Track | null
    label: string
    size?: 'sm' | 'lg' | undefined
  }): JSX.Element => {
    const [failed, setFailed] = createSignal(false)
    createEffect(
      on(
        () => props.track?.path,
        () => setFailed(false),
        { defer: true },
      ),
    )
    const show = () => props.track !== null && props.track.cover && !failed() && token() !== ''
    return (
      <span class={`mu-cover ${props.size ?? ''}`} style={{ '--h': String(hue(props.label)) }}>
        <Icon name="music" size={props.size === 'sm' ? 14 : 28} />
        <Show when={show()}>
          <img
            src={url('cover', props.track?.path ?? '')}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </Show>
      </span>
    )
  }

  const TrackRows = (props: {
    list: Track[]
    showAlbum?: boolean
    numbers?: boolean
  }): JSX.Element => (
    <div class="mu-table" role="list">
      <Index each={props.list}>
        {(track, i) => {
          const isCurrent = () => current()?.path === track().path
          return (
            <div
              class="mu-track"
              classList={{ current: isCurrent() }}
              role="listitem"
              tabindex="0"
              data-path={track().path}
              onDblClick={() => playList(props.list, track())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') playList(props.list, track())
              }}
            >
              <span class="mu-num">
                <Show
                  when={isCurrent() && playing()}
                  fallback={
                    <>
                      <span class="mu-index">
                        {props.numbers === true ? (track().track ?? i + 1) : i + 1}
                      </span>
                      <button
                        class="mu-play-row"
                        aria-label={`Play ${track().title}`}
                        onClick={() => playList(props.list, track())}
                      >
                        <Icon name="play" size={12} />
                      </button>
                    </>
                  }
                >
                  <Icon name="audio-lines" size={14} class="mu-eq" />
                </Show>
              </span>
              <span class="mu-title-cell">
                <Show when={props.showAlbum ?? true}>
                  <Cover track={track()} label={track().album || track().title} size="sm" />
                </Show>
                <span class="mu-title-text">
                  <span class="mu-title">{track().title}</span>
                  <span class="mu-sub">{track().artist || 'Unknown artist'}</span>
                </span>
              </span>
              <Show when={props.showAlbum ?? true}>
                <span class="mu-album-cell">{track().album}</span>
              </Show>
              <span class="mu-time">{formatDuration(track().duration)}</span>
            </div>
          )
        }}
      </Index>
    </div>
  )

  const AlbumGrid = (props: { list: Album[] }): JSX.Element => (
    <div class="mu-grid">
      <For each={props.list}>
        {(album) => (
          <button class="mu-tile" onClick={() => setView({ kind: 'album', key: album.key })}>
            <Cover track={album.cover} label={album.title || album.artist} />
            <span class="mu-tile-title">{album.title || 'Unknown album'}</span>
            <span class="mu-tile-sub">{album.artist || 'Unknown artist'}</span>
          </button>
        )}
      </For>
    </div>
  )

  const AlbumHeader = (props: { album: Album }): JSX.Element => {
    const total = () => props.album.tracks.reduce((s, t) => s + (t.duration ?? 0), 0)
    return (
      <div class="mu-hero">
        <Cover
          track={props.album.cover}
          label={props.album.title || props.album.artist}
          size="lg"
        />
        <div class="mu-hero-text">
          <span class="mu-overline">Album</span>
          <h1>{props.album.title || 'Unknown album'}</h1>
          <span class="mu-sub">
            {joinParts([
              props.album.artist || 'Unknown artist',
              props.album.year === null ? '' : String(props.album.year),
              plural(props.album.tracks.length, 'song'),
              formatDuration(total()),
            ])}
          </span>
          <div class="mu-actions">
            <button
              class="btn btn--primary mu-play-all"
              onClick={() => playList(props.album.tracks, undefined)}
            >
              <Icon name="play" size={14} /> Play
            </button>
            <button
              class="btn btn--secondary"
              onClick={() => {
                setShuffle(true)
                playList(props.album.tracks, undefined)
              }}
            >
              <Icon name="shuffle" size={14} /> Shuffle
            </button>
          </div>
        </div>
      </div>
    )
  }

  const NAV: { kind: MainView; label: string; icon: IconName; count: () => number }[] = [
    { kind: 'albums', label: 'Albums', icon: 'disc', count: () => albums().length },
    { kind: 'artists', label: 'Artists', icon: 'users', count: () => artists().length },
    { kind: 'songs', label: 'Songs', icon: 'music', count: () => tracks().length },
  ]

  const navKind = (): MainView => {
    const v = view()
    if (v.kind === 'album') return 'albums'
    if (v.kind === 'artist') return 'artists'
    return v.kind
  }

  const heading = () => {
    if (query() !== '') return 'Search'
    const album = openedAlbum()
    if (album !== undefined) return album.title || 'Album'
    const artist = openedArtist()
    if (artist !== undefined) return artist.name || 'Unknown artist'
    return NAV.find((n) => n.kind === navKind())?.label ?? 'Music'
  }

  const empty = () => (library()?.tracks.length ?? 0) === 0
  const rootLabel = () => library()?.roots[0]?.replace(/^\/home\/[^/]+/, '~') ?? ''

  return (
    <div class="mu">
      <aside class="mu-nav">
        <div class="mu-brand">
          <Icon name="music" />
          Music
        </div>
        <For each={NAV}>
          {(item) => (
            <button
              class="mu-nav-item"
              classList={{ active: navKind() === item.kind && query() === '' }}
              data-view={item.kind}
              onClick={() => {
                setQuery('')
                setView({ kind: item.kind })
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              <span class="mu-count">{item.count()}</span>
            </button>
          )}
        </For>
        <span class="mu-grow" />
        <div class="mu-root" title={library()?.roots.join('\n')}>
          <Icon name="folder" size={14} />
          <span>{rootLabel()}</span>
        </div>
        <button
          class="btn btn--ghost btn--sm mu-rescan"
          onClick={rescan}
          disabled={library()?.scanning ?? false}
        >
          <Icon name="rotate-cw" size={14} />
          {(library()?.scanning ?? false) ? 'Scanning…' : 'Rescan'}
        </button>
      </aside>

      <main class="mu-main">
        <header class="mu-head">
          <Show when={view().kind === 'album' || view().kind === 'artist'}>
            <button class="iconbtn" aria-label="Back" onClick={() => setView({ kind: navKind() })}>
              <Icon name="arrow-left" />
            </button>
          </Show>
          <h2>{heading()}</h2>
          <label class="mu-search">
            <Icon name="search" size={14} />
            <input
              ref={search}
              value={query()}
              placeholder="Search songs, artists, albums"
              spellcheck={false}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('')
                  e.currentTarget.blur()
                } else if (e.key === 'Enter') playList(found(), found()[0])
              }}
            />
          </label>
        </header>

        <div class="mu-content">
          <Show
            when={!empty()}
            fallback={
              <div class="mu-empty">
                <span class="mu-empty-art">
                  <Icon name="music" size={36} />
                </span>
                <span class="mu-empty-title">
                  {library() === null || (library()?.scanning ?? false)
                    ? 'Looking for music…'
                    : 'No music yet'}
                </span>
                <span class="mu-empty-desc">
                  Put songs in {rootLabel() || 'your Music folder'} and they show up here.
                </span>
                <div class="mu-actions">
                  <button class="btn btn--secondary btn--sm" onClick={openFolder}>
                    <Icon name="folder-open" size={14} /> Open folder
                  </button>
                  <button class="btn btn--ghost btn--sm" onClick={rescan}>
                    <Icon name="rotate-cw" size={14} /> Rescan
                  </button>
                </div>
              </div>
            }
          >
            <Switch>
              <Match when={query() !== ''}>
                <Show
                  when={found().length > 0}
                  fallback={<div class="mu-empty">Nothing matches “{query()}”</div>}
                >
                  <TrackRows list={found()} />
                </Show>
              </Match>
              <Match when={openedAlbum()}>
                {(album) => (
                  <>
                    <AlbumHeader album={album()} />
                    <TrackRows list={album().tracks} showAlbum={false} numbers />
                  </>
                )}
              </Match>
              <Match when={openedArtist()}>
                {(artist) => <AlbumGrid list={artist().albums} />}
              </Match>
              <Match when={view().kind === 'songs'}>
                <TrackRows list={tracks()} />
              </Match>
              <Match when={view().kind === 'albums'}>
                <AlbumGrid list={albums()} />
              </Match>
              <Match when={view().kind === 'artists'}>
                <div class="mu-artists">
                  <For each={artists()}>
                    {(artist) => (
                      <button
                        class="mu-artist"
                        onClick={() => setView({ kind: 'artist', name: artist.name })}
                      >
                        <Cover
                          track={artist.albums[0]?.cover ?? null}
                          label={artist.name}
                          size="sm"
                        />
                        <span class="mu-title">{artist.name || 'Unknown artist'}</span>
                        <span class="mu-sub">
                          {joinParts([
                            plural(artist.albums.length, 'album'),
                            plural(artist.tracks, 'song'),
                          ])}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Match>
            </Switch>
          </Show>
        </div>
      </main>

      <footer class="mu-bar" classList={{ idle: current() === undefined }}>
        <div class="mu-now">
          <Show when={current()}>
            {(track) => (
              <>
                <Cover track={track()} label={track().album || track().title} />
                <span class="mu-now-text">
                  <span class="mu-title">{track().title}</span>
                  <span class="mu-sub">
                    {[track().artist, track().album].filter((x) => x !== '').join(' — ')}
                  </span>
                </span>
              </>
            )}
          </Show>
        </div>
        <div class="mu-transport">
          <div class="mu-buttons">
            <button
              class="iconbtn mu-shuffle"
              classList={{ on: shuffle() }}
              aria-label="Shuffle"
              aria-pressed={shuffle()}
              onClick={toggleShuffle}
            >
              <Icon name="shuffle" />
            </button>
            <button class="iconbtn" aria-label="Previous" onClick={previous}>
              <Icon name="skip-back" />
            </button>
            <button class="mu-play" aria-label={playing() ? 'Pause' : 'Play'} onClick={togglePlay}>
              <Icon name={playing() ? 'pause' : 'play'} size={18} />
            </button>
            <button class="iconbtn" aria-label="Next" onClick={() => next(true)}>
              <Icon name="skip-forward" />
            </button>
            <button
              class="iconbtn mu-repeat"
              classList={{ on: repeat() !== 'off' }}
              aria-label={`Repeat ${repeat()}`}
              onClick={cycleRepeat}
            >
              <Icon name={repeat() === 'one' ? 'repeat-1' : 'repeat'} />
            </button>
          </div>
          <div class="mu-seek">
            <span class="mu-time">{formatDuration(time())}</span>
            <input
              type="range"
              min="0"
              max={Math.max(1, duration())}
              step="0.1"
              value={time()}
              aria-label="Seek"
              style={{ '--p': `${duration() > 0 ? (time() / duration()) * 100 : 0}%` }}
              onInput={(e) => {
                if (audio !== undefined) audio.currentTime = Number(e.currentTarget.value)
              }}
            />
            <span class="mu-time">{formatDuration(duration())}</span>
          </div>
          <Show when={error()}>
            <span class="mu-error">{error()}</span>
          </Show>
        </div>
        <div class="mu-volume">
          <button
            class="iconbtn"
            aria-label={volume() === 0 ? 'Unmute' : 'Mute'}
            onClick={() => setVolume((v) => (v === 0 ? 0.8 : 0))}
          >
            <Icon name={volume() === 0 ? 'volume-x' : 'volume-2'} />
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume()}
            aria-label="Volume"
            style={{ '--p': `${volume() * 100}%` }}
            onInput={(e) => setVolume(Number(e.currentTarget.value))}
          />
        </div>
      </footer>

      <audio
        ref={audio}
        preload="auto"
        onPlay={() => {
          setPlaying(true)
          const track = current()
          if (track !== undefined) void api.music({ op: 'played', path: track.path })
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration)
        }}
        onEnded={() => next(false)}
        onError={() => {
          const track = current()
          setError(track === undefined ? null : `Cannot play ${track.title}`)
          setPlaying(false)
        }}
      />
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <MusicApp />, root)
