import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js'
import {
  SEARCH_ENGINES,
  displayUrl,
  rankBookmarks,
  resolveInput,
  type BookmarkFolder,
  type HistorySuggestion,
  type SearchEngineId,
  type TabState,
} from '@ewe/shared'
import { api } from '../lib/api'
import { faviconFor } from '../lib/favicon'
import { Favicon } from './Favicon'
import { Icon, type IconName } from './Icon'
import './Palette.css'

export interface PaletteProps {
  tabs: TabState[]
  bookmarks?: BookmarkFolder | null | undefined
  engine: SearchEngineId
  large?: boolean
  hero?: boolean
  placeholder?: string
  autofocus?: boolean
  initial?: string
  newTab?: boolean
  onNavigate(input: string): void
  onActivate(id: string): void
  onClose?(): void
}

interface Row {
  key: string
  icon: IconName
  favicon: string | null
  label: string
  hint: string
  url?: string | undefined
  run(): void
}

function matches(tab: TabState, query: string): boolean {
  const q = query.toLowerCase()
  return q === '' || tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)
}

export function Palette(props: PaletteProps): JSX.Element {
  const [value, setValue] = createSignal(props.initial ?? '')
  const [selected, setSelected] = createSignal(0)
  const [history, setHistory] = createSignal<HistorySuggestion[]>([])
  const [focused, setFocused] = createSignal(false)

  createEffect(
    on(value, (v) => {
      const q = v.trim()
      if (q === '' || q.startsWith('t:') || q.startsWith('b:')) {
        setHistory([])
        return
      }
      const query = q.startsWith('w:') ? q.slice(2).trim() : q
      void api.suggest(query).then((rows) => {
        if (value().trim() === q) setHistory(rows)
      })
    }),
  )
  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined

  const resolved = createMemo(() => resolveInput(value(), props.engine))
  const mode = createMemo<'url' | 'search' | 'tabs' | 'bookmarks'>(() => {
    const v = value().trim()
    if (v === '') return 'url'
    return resolved().kind
  })

  const rows = createMemo<Row[]>(() => {
    const v = value().trim()
    const r = resolved()
    const list: Row[] = []
    const tabRows = (query: string, limit: number): Row[] =>
      props.tabs
        .filter(
          (t) => t.kind !== 'newtab' && !(t.kind === 'home' && query === '') && matches(t, query),
        )
        .slice(0, limit)
        .map((t) => ({
          key: `tab:${t.id}`,
          icon: t.kind === 'home' ? 'house' : 'app-window',
          favicon: t.favicon,
          label: t.title === '' ? displayUrl(t.url) : t.title,
          hint: t.pinned ? `Pinned · ${displayUrl(t.url)}` : displayUrl(t.url),
          run: () => props.onActivate(t.id),
        }))
    const bookmarkRows = (query: string, limit: number, skip: Set<string>): Row[] => {
      const root = props.bookmarks
      if (root === null || root === undefined) return []
      return rankBookmarks(root, query, limit + skip.size)
        .filter((hit) => !skip.has(hit.item.url))
        .slice(0, limit)
        .map((hit) => ({
          key: `bookmark:${hit.item.id}`,
          icon: 'bookmark',
          favicon: hit.item.url.startsWith('app://') ? null : faviconFor(hit.item.url, props.tabs),
          label: hit.item.title === '' ? displayUrl(hit.item.url) : hit.item.title,
          hint: [...hit.path, displayUrl(hit.item.url)].join(' · '),
          url: hit.item.url,
          run: () => props.onNavigate(hit.item.url),
        }))
    }

    if (r.kind === 'tabs') return tabRows(r.query, 12)
    if (r.kind === 'bookmarks') return bookmarkRows(r.query, 12, new Set())
    if (v === '') return props.hero === true ? [] : tabRows('', 6)
    if (r.kind === 'url') {
      list.push({
        key: 'go',
        icon: 'globe',
        favicon: null,
        label: r.url,
        hint: props.newTab ? 'Open in a new tab' : 'Open',
        run: () => props.onNavigate(v),
      })
    } else {
      list.push({
        key: 'search',
        icon: 'search',
        favicon: null,
        label: r.query,
        hint: `${props.newTab ? 'New tab · ' : ''}Search ${SEARCH_ENGINES[props.engine].name}`,
        run: () => props.onNavigate(v),
      })
    }
    const openTabs = tabRows(r.query, 4)
    const openUrls = new Set(props.tabs.map((t) => t.url))
    const bookmarks = bookmarkRows(r.query, 3, openUrls)
    const seen = new Set(bookmarks.map((row) => row.url))
    const historyRows: Row[] = history()
      .filter((h) => {
        if (openUrls.has(h.url) || seen.has(h.url)) return false
        seen.add(h.url)
        return true
      })
      .slice(0, 5)
      .map((h) => ({
        key: `history:${h.url}`,
        icon: 'history',
        favicon: null,
        label: h.title === '' ? h.host : h.title,
        hint: displayUrl(h.url),
        run: () => props.onNavigate(h.url),
      }))
    return list.concat(bookmarks, historyRows, openTabs)
  })

  createEffect(
    on(
      () => props.initial,
      (initial) => {
        setValue(initial ?? '')
        queueMicrotask(() => input?.select())
      },
      { defer: true },
    ),
  )
  createEffect(on(value, () => setSelected(0)))
  createEffect(() => {
    if (selected() >= rows().length) setSelected(Math.max(0, rows().length - 1))
  })
  createEffect(() => {
    const index = selected()
    list?.children[index]?.scrollIntoView({ block: 'nearest' })
  })
  createEffect(() => {
    if (props.autofocus ?? true) {
      queueMicrotask(() => {
        input?.focus()
        input?.select()
      })
    }
  })

  const run = () => {
    const row = rows()[selected()]
    if (row !== undefined) row.run()
    else if (value().trim() !== '' && mode() !== 'tabs') props.onNavigate(value())
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, Math.max(0, rows().length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (value() !== '') setValue('')
      else if (props.hero === true) input?.blur()
      else props.onClose?.()
    }
  }

  const modeIcon = (): IconName => {
    switch (mode()) {
      case 'tabs':
        return 'app-window'
      case 'bookmarks':
        return 'bookmark'
      case 'search':
        return 'search'
      case 'url':
        return 'globe'
    }
  }

  return (
    <div class="palette" classList={{ large: props.large ?? false, hero: props.hero ?? false }}>
      <div class="palette-search">
        <span class={`palette-mode ${mode()}`}>
          <Icon name={modeIcon()} />
        </span>
        <Show when={props.newTab}>
          <span class="palette-chip">New tab</span>
        </Show>
        <input
          ref={input}
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={onKey}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={
            props.placeholder ?? 'Search or type a URL. w: web search, t: open tabs, b: bookmarks'
          }
          aria-label="Search or type a URL"
          spellcheck={false}
          autocomplete="off"
        />
        <Show when={props.onClose !== undefined}>
          <span class="kbd">Esc</span>
        </Show>
      </div>
      <Show when={rows().length > 0 && (props.hero !== true || focused())}>
        <div class="palette-results" role="listbox" ref={list}>
          <For each={rows()}>
            {(row, i) => (
              <div
                class="palette-row"
                classList={{ selected: i() === selected() }}
                role="option"
                aria-selected={i() === selected()}
                onMouseEnter={() => setSelected(i())}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => row.run()}
              >
                <span class="palette-well">
                  <Show when={row.favicon !== null} fallback={<Icon name={row.icon} />}>
                    <Favicon src={row.favicon} />
                  </Show>
                </span>
                <span class="palette-text">
                  <span class="palette-label">{row.label}</span>
                  <span class="palette-hint">{row.hint}</span>
                </span>
                <span class="palette-trail">
                  <span class="kbd">Enter</span>
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={props.large === true && props.hero !== true}>
        <div class="palette-legend">
          <span>
            <span class="kbd">w:</span> Web search
          </span>
          <span>
            <span class="kbd">t:</span> Open tabs
          </span>
          <span>
            <span class="kbd">b:</span> Bookmarks
          </span>
          <span>
            <span class="kbd-combo">
              <span class="kbd">↑</span>
              <span class="kbd">↓</span>
            </span>
            Choose
          </span>
          <span>
            <span class="kbd">Enter</span> Go
          </span>
        </div>
      </Show>
    </div>
  )
}
