import {
  For,
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
import {
  SIDEBAR_SECTIONS,
  isBookmarkableUrl,
  type SidebarSection,
  type WebPanel,
} from '@ewe/shared'
import { Favicon } from '../components/Favicon'
import { Icon, type IconName } from '../components/Icon'
import { BookmarksPane } from '../components/sidebar/BookmarksPane'
import { DownloadsPane } from '../components/sidebar/DownloadsPane'
import { HistoryPane } from '../components/sidebar/HistoryPane'
import { api } from '../lib/api'
import { createDownloads, isActiveDownload } from '../lib/downloads'
import { applyTheme, createBrowserStore } from '../lib/store'
import './App.css'

type BuiltIn = (typeof SIDEBAR_SECTIONS)[number]

const SECTIONS: Record<BuiltIn, { label: string; icon: IconName; search: string }> = {
  bookmarks: { label: 'Bookmarks', icon: 'bookmark', search: 'Search bookmarks' },
  downloads: { label: 'Downloads', icon: 'download', search: 'Search downloads' },
  history: { label: 'History', icon: 'history', search: 'Search history' },
}

function isBuiltIn(section: SidebarSection): section is BuiltIn {
  return (SIDEBAR_SECTIONS as readonly string[]).includes(section)
}

function panelIcon(url: string): string | null {
  try {
    return `${new URL(url).origin}/favicon.ico`
  } catch {
    return null
  }
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-row]')]
}

export function SidebarApp(): JSX.Element {
  const store = createBrowserStore()
  const downloads = createDownloads()
  const [query, setQuery] = createSignal('')
  const [newFolder, setNewFolder] = createSignal(0)
  let search: HTMLInputElement | undefined

  createEffect(() => applyTheme(store.settings, store.theme))

  const section = (): SidebarSection => store.state()?.sidebar?.section ?? 'bookmarks'
  const panels = (): WebPanel[] => store.settings().panels
  const panel = () => panels().find((p) => `panel:${p.id}` === section())
  const builtIn = (): BuiltIn => {
    const s = section()
    return isBuiltIn(s) ? s : 'bookmarks'
  }
  const canPanel = () => /^https?:\/\//i.test(activeUrl()) && panels().length < 12
  createEffect(on(section, () => setQuery(''), { defer: true }))

  const activeDownloads = createMemo(() => downloads().filter(isActiveDownload).length)
  const finished = createMemo(() => downloads().some((d) => !isActiveDownload(d)))
  const activeUrl = () => store.activeTab()?.url ?? ''
  const isBookmarked = () => store.bookmarked().has(activeUrl())
  const canBookmark = () => isBookmarkableUrl(activeUrl())

  const open = (url: string, newTab: boolean) =>
    void api.send({ type: 'tab.navigate', input: url, newTab })

  const close = () => void api.send({ type: 'sidebar.close' })

  const focusSearch = () => {
    search?.focus()
    search?.select()
  }

  const moveFocus = (delta: number) => {
    const list = rows()
    if (list.length === 0) return
    const index = list.findIndex((el) => el === document.activeElement)
    const next =
      index === -1
        ? delta > 0
          ? 0
          : list.length - 1
        : Math.min(Math.max(0, index + delta), list.length - 1)
    list[next]?.focus()
    list[next]?.scrollIntoView({ block: 'nearest' })
  }

  onMount(() => {
    const off = api.onUi((event) => {
      if (event.type === 'sidebar.focus') focusSearch()
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        if (query() !== '') setQuery('')
        else close()
      } else if (e.key === 'ArrowDown') moveFocus(1)
      else if (e.key === 'ArrowUp') {
        if (rows()[0] === document.activeElement) focusSearch()
        else moveFocus(-1)
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') focusSearch()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => {
      off()
      window.removeEventListener('keydown', onKey)
    })
  })

  let drag: { startX: number; startWidth: number; width: number; frame: number } | null = null
  const onResizeDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const width = store.state()?.sidebar?.width ?? window.innerWidth
    drag = { startX: e.screenX, startWidth: width, width, frame: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    document.documentElement.classList.add('resizing')
  }
  const onResizeMove = (e: PointerEvent) => {
    const d = drag
    if (d === null) return
    d.width = d.startWidth + (d.startX - e.screenX)
    if (d.frame !== 0) return
    d.frame = requestAnimationFrame(() => {
      d.frame = 0
      void api.send({ type: 'sidebar.resize', width: d.width })
    })
  }
  const onResizeUp = () => {
    const d = drag
    if (d === null) return
    drag = null
    cancelAnimationFrame(d.frame)
    document.documentElement.classList.remove('resizing')
    void api.send({ type: 'sidebar.resize', width: d.width, commit: true })
  }

  return (
    <aside
      class="sidebar"
      classList={{ 'has-panel': panel() !== undefined }}
      aria-label={panel()?.title ?? SECTIONS[builtIn()].label}
    >
      <div
        class="sb-resize"
        title="Drag to resize, double-click to reset"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        onDblClick={() => void api.send({ type: 'sidebar.resize', width: 360, commit: true })}
      />
      <header class="sb-head">
        <nav class="sb-tabs" role="tablist" aria-label="Sidebar sections">
          <For each={SIDEBAR_SECTIONS}>
            {(id) => (
              <button
                class="sb-tab"
                classList={{ active: section() === id }}
                role="tab"
                aria-selected={section() === id}
                aria-label={SECTIONS[id].label}
                title={SECTIONS[id].label}
                data-section={id}
                onClick={() => {
                  if (section() !== id) void api.send({ type: 'sidebar.toggle', section: id })
                }}
              >
                <Icon name={SECTIONS[id].icon} />
                <span class="sb-tab-label">{SECTIONS[id].label}</span>
                <Show when={id === 'downloads' && activeDownloads() > 0}>
                  <span class="sb-badge">{activeDownloads()}</span>
                </Show>
              </button>
            )}
          </For>
          <Show when={panels().length > 0}>
            <span class="sb-tabs-sep" aria-hidden="true" />
          </Show>
          <For each={panels()}>
            {(p) => (
              <button
                class="sb-tab sb-panel-tab"
                classList={{ active: section() === `panel:${p.id}` }}
                role="tab"
                aria-selected={section() === `panel:${p.id}`}
                aria-label={p.title}
                title={p.title}
                data-panel={p.id}
                onClick={() => {
                  if (section() !== `panel:${p.id}`)
                    void api.send({ type: 'sidebar.toggle', section: `panel:${p.id}` })
                }}
              >
                <Favicon src={panelIcon(p.url)} size={16} />
              </button>
            )}
          </For>
          <button
            class="sb-tab sb-add-panel"
            title="Add this page as a panel"
            aria-label="Add this page as a panel"
            disabled={!canPanel()}
            onClick={() => {
              const tab = store.activeTab()
              if (tab !== undefined)
                void api.send({ type: 'panel.add', url: tab.url, title: tab.title })
            }}
          >
            <Icon name="plus" />
          </button>
        </nav>
        <Show when={panel()}>
          {(p) => (
            <>
              <button
                class="iconbtn iconbtn--sm sb-panel-open"
                title="Open in a tab"
                aria-label="Open in a tab"
                onClick={() => open(p().url, true)}
              >
                <Icon name="app-window" />
              </button>
              <button
                class="iconbtn iconbtn--sm sb-panel-remove"
                title="Remove panel"
                aria-label="Remove panel"
                onClick={() => void api.send({ type: 'panel.remove', id: p().id })}
              >
                <Icon name="trash-2" />
              </button>
            </>
          )}
        </Show>
        <button
          class="iconbtn iconbtn--sm sb-close"
          title="Close sidebar"
          aria-label="Close sidebar"
          onClick={close}
        >
          <Icon name="x" />
        </button>
      </header>
      <Show when={panel() === undefined}>
        <div class="sb-search">
          <Icon name="search" size={14} />
          <input
            ref={search}
            value={query()}
            placeholder={SECTIONS[builtIn()].search}
            aria-label={SECTIONS[builtIn()].search}
            spellcheck={false}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              rows()[0]?.click()
              e.preventDefault()
            }}
          />
          <Show when={query() !== ''}>
            <button
              class="iconbtn iconbtn--sm"
              aria-label="Clear search"
              onClick={() => {
                setQuery('')
                search?.focus()
              }}
            >
              <Icon name="x" />
            </button>
          </Show>
        </div>
      </Show>
      <div class="sb-body">
        <Switch>
          <Match when={section() === 'bookmarks'}>
            <Show when={store.bookmarks()}>
              {(root) => (
                <BookmarksPane
                  root={root()}
                  tabs={store.tabs()}
                  query={query()}
                  newFolderRequest={newFolder()}
                  onOpen={open}
                />
              )}
            </Show>
          </Match>
          <Match when={section() === 'downloads'}>
            <DownloadsPane downloads={downloads()} query={query()} />
          </Match>
          <Match when={section() === 'history'}>
            <HistoryPane tabs={store.tabs()} query={query()} onOpen={open} />
          </Match>
        </Switch>
      </div>
      <Switch>
        <Match when={panel() !== undefined}>{null}</Match>
        <Match when={section() === 'bookmarks'}>
          <footer class="sb-foot">
            <button
              class="btn btn--ghost btn--sm sb-bookmark-tab"
              disabled={!canBookmark()}
              onClick={() => void api.send({ type: 'bookmark.toggle' })}
            >
              <Icon name="star" class={isBookmarked() ? 'filled' : undefined} />
              {isBookmarked() ? 'Remove this tab' : 'Bookmark this tab'}
            </button>
            <button
              class="btn btn--ghost btn--sm sb-new-folder"
              onClick={() => setNewFolder((n) => n + 1)}
            >
              <Icon name="folder-plus" />
              New folder
            </button>
          </footer>
        </Match>
        <Match when={section() === 'downloads'}>
          <footer class="sb-foot">
            <button
              class="btn btn--ghost btn--sm sb-clear"
              disabled={!finished()}
              onClick={() => void api.send({ type: 'downloads.clear' })}
            >
              <Icon name="trash-2" />
              Clear finished
            </button>
          </footer>
        </Match>
      </Switch>
    </aside>
  )
}
