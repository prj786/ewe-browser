import { For, Index, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js'
import {
  storeExtensionId,
  WORKSPACE_COLORS,
  displayUrl,
  hostOf,
  isBookmarkableUrl,
  pathFromFilesUrl,
  type TabState,
} from '@ewe/shared'
import { api } from '../lib/api'
import type { BrowserStore } from '../lib/store'
import { Favicon } from './Favicon'
import { createExtensions } from '../lib/extensions'
import { ExtensionActions } from './Extensions'
import { Icon, type IconName } from './Icon'
import './Rail.css'

export type RailMode = 'expanded' | 'peek'

export interface RailProps {
  store: BrowserStore
  mode: RailMode
  editRequest?: number | undefined
  onEditingChange?: ((editing: boolean) => void) | undefined
  onDropTarget?: ((workspaceId: string | null) => void) | undefined
}

interface Drag {
  id: string
  startY: number
  moved: boolean
  target: number | null
  workspace: string | null
}

function tabTitle(tab: TabState): string {
  if (tab.kind === 'newtab') return 'New tab'
  return tab.title === '' ? displayUrl(tab.url) || 'Untitled' : tab.title
}

function kindIcon(tab: TabState): IconName {
  if (tab.kind === 'home') return 'house'
  if (tab.kind === 'files') return 'folder'
  if (tab.kind === 'music') return 'music'
  if (tab.kind === 'newtab') return 'search'
  return 'app-window'
}

function TabGlyph(props: { tab: TabState }): JSX.Element {
  return (
    <span class="rail-fav" classList={{ loading: props.tab.loading }}>
      <Show when={props.tab.kind === 'page'} fallback={<Icon name={kindIcon(props.tab)} />}>
        <Favicon src={props.tab.favicon} />
      </Show>
    </span>
  )
}

function openMenu(e: MouseEvent, menu: { kind: 'tab'; id: string }): void {
  e.preventDefault()
  void api.send({ type: 'menu.open', menu, x: e.clientX, y: e.clientY })
}

export function Rail(props: RailProps): JSX.Element {
  const store = () => props.store
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal('')
  const [drag, setDrag] = createSignal<Drag | null>(null)
  let addressInput: HTMLInputElement | undefined
  let listEl: HTMLDivElement | undefined

  const extensions = createExtensions()
  const storeOffer = () => {
    const id = storeExtensionId(active()?.url ?? '')
    return id !== null && !extensions().list.some((e) => e.id === id) ? id : null
  }
  const activeId = () => store().state()?.activeTabId ?? null
  const active = () => store().activeTab()
  const workspace = () => store().activeWorkspace()
  const accent = () => {
    const ws = workspace()
    return ws === undefined ? undefined : WORKSPACE_COLORS[ws.color]
  }
  const pinned = createMemo(() =>
    store()
      .visibleTabs()
      .filter((t) => t.pinned),
  )
  const unpinned = createMemo(() =>
    store()
      .visibleTabs()
      .filter((t) => !t.pinned),
  )
  const isBookmarked = () => {
    const tab = active()
    return tab !== undefined && store().bookmarked().has(tab.url)
  }
  const canBookmark = () => {
    const tab = active()
    return tab !== undefined && tab.kind !== 'newtab' && isBookmarkableUrl(tab.url)
  }

  const beginEdit = () => {
    const tab = active()
    if (tab === undefined) return
    setDraft(tab.kind === 'newtab' ? '' : (pathFromFilesUrl(tab.url) ?? tab.url))
    setEditing(true)
    props.onEditingChange?.(true)
  }

  const endEdit = () => {
    if (!editing()) return
    setEditing(false)
    props.onEditingChange?.(false)
  }

  const submit = () => {
    const input = (addressInput?.value ?? draft()).trim()
    const id = active()?.id
    endEdit()
    if (input !== '' && id !== undefined) void api.send({ type: 'tab.navigate', id, input })
  }

  const onAddressInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    const el = e.currentTarget
    const typed = el.value
    setDraft(typed)
    if (e.inputType.startsWith('delete') || typed.trim() === '' || /\s/.test(typed)) return
    void api.suggest(typed).then((rows) => {
      if (el.value !== typed || !editing()) return
      const host = rows.find((r) => r.host.toLowerCase().startsWith(typed.toLowerCase()))?.host
      if (host === undefined || host.toLowerCase() === typed.toLowerCase()) return
      el.value = host
      el.setSelectionRange(typed.length, host.length)
      setDraft(host)
    })
  }

  createEffect(
    on(
      () => props.editRequest,
      (req, prev) => {
        if (req !== undefined && req !== prev) beginEdit()
      },
      { defer: true },
    ),
  )
  createEffect(on(activeId, endEdit, { defer: true }))

  createEffect(
    on(
      () => drag()?.workspace ?? null,
      (id) => props.onDropTarget?.(id),
    ),
  )

  createEffect(
    on(activeId, () => {
      listEl?.querySelector<HTMLElement>('.rail-tab.active')?.scrollIntoView({ block: 'nearest' })
    }),
  )

  const indexFromPointer = (y: number): number => {
    const rows = [...(listEl?.querySelectorAll<HTMLElement>('.rail-tab[data-tab]') ?? [])]
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]?.getBoundingClientRect()
      if (r !== undefined && y < r.top + r.height / 2) return i
    }
    return rows.length
  }

  const workspaceAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-ws]')
    const id = el?.dataset.ws ?? null
    return id === workspace()?.id ? null : id
  }

  const onPointerDown = (e: PointerEvent, tab: TabState) => {
    if (e.button === 1) {
      e.preventDefault()
      void api.send({ type: 'tab.close', id: tab.id })
      return
    }
    if (e.button !== 0) return
    setDrag({ id: tab.id, startY: e.clientY, moved: false, target: null, workspace: null })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = drag()
    if (d === null) return
    if ((e.buttons & 1) === 0) {
      setDrag(null)
      return
    }
    const moved = d.moved || Math.abs(e.clientY - d.startY) > 6
    if (!moved) return
    const ws = workspaceAt(e.clientX, e.clientY)
    setDrag({
      ...d,
      moved,
      workspace: ws,
      target: ws === null ? indexFromPointer(e.clientY) : null,
    })
  }

  const onPointerUp = (tab: TabState) => {
    const d = drag()
    setDrag(null)
    if (d === null) return
    if (!d.moved) {
      void api.send({ type: 'tab.activate', id: tab.id })
      return
    }
    if (d.workspace !== null) {
      void api.send({ type: 'tab.moveToWorkspace', id: d.id, workspaceId: d.workspace })
      return
    }
    if (d.target === null) return
    const from = unpinned().findIndex((t) => t.id === d.id)
    const to = d.target > from ? d.target - 1 : d.target
    if (from === -1 || to === from) return
    void api.send({ type: 'tab.move', id: d.id, index: pinned().length + to })
  }

  const dropClass = (i: number) => {
    const d = drag()
    if (d === null || !d.moved || d.target === null) return {}
    const list = unpinned()
    const from = list.findIndex((t) => t.id === d.id)
    if (d.target === from || d.target === from + 1) return {}
    return {
      'drop-before': d.target === i,
      'drop-after': d.target === list.length && i === list.length - 1,
    }
  }

  const newTab = () => void api.send({ type: 'overlay.request', part: 'palette', newTab: true })
  const toggleRail = () => {
    const next = props.mode === 'expanded' ? 'collapsed' : 'expanded'
    void api.send({ type: 'settings.update', patch: { rail: next } })
  }

  const addressIcon = (): IconName => {
    const tab = active()
    if (tab === undefined || tab.kind === 'newtab') return 'search'
    if (tab.kind === 'files') return 'folder'
    if (tab.url.startsWith('https://')) return 'lock'
    if (tab.url.startsWith('http://')) return 'lock-open'
    if (tab.url.startsWith('app://')) return 'app-window'
    return 'globe'
  }

  const siteInfoOn = () => /^(https?|file):/i.test(active()?.url ?? '')
  const openSiteInfo = (e: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    void api.send({
      type: 'siteinfo.open',
      x: Math.round(r.left - 4),
      y: Math.round(r.bottom + 8),
    })
  }

  const addressParts = () => {
    const tab = active()
    if (tab === undefined || tab.kind === 'newtab') return null
    const filesPath = pathFromFilesUrl(tab.url)
    if (filesPath !== null) {
      const slash = filesPath.lastIndexOf('/')
      if (slash <= 0) return { host: filesPath, rest: '' }
      return { host: filesPath.slice(0, slash + 1), rest: filesPath.slice(slash + 1) }
    }
    try {
      const u = new URL(tab.url)
      if (u.protocol === 'app:') return { host: u.host, rest: '' }
      const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`
      return { host: hostOf(tab.url), rest }
    } catch {
      return { host: tab.url, rest: '' }
    }
  }

  const TabRow = (rowProps: { tab: () => TabState; index: number }): JSX.Element => {
    const tab = () => rowProps.tab()
    const isActive = () => tab().id === activeId()
    return (
      <div
        class="rail-tab"
        classList={{
          active: isActive(),
          dragging: drag()?.id === tab().id && (drag()?.moved ?? false),
          ...dropClass(rowProps.index),
        }}
        role="tab"
        aria-selected={isActive()}
        data-tab={tab().id}
        title={tab().kind === 'newtab' ? 'New tab' : `${tabTitle(tab())}\n${tab().url}`}
        onPointerDown={(e) => onPointerDown(e, tab())}
        onPointerMove={onPointerMove}
        onPointerUp={() => onPointerUp(tab())}
        onPointerCancel={() => setDrag(null)}
        onLostPointerCapture={() => {
          if (drag()?.id === tab().id) queueMicrotask(() => setDrag(null))
        }}
        onAuxClick={(e) => e.preventDefault()}
        onContextMenu={(e) => openMenu(e, { kind: 'tab', id: tab().id })}
      >
        <TabGlyph tab={tab()} />
        <span class="rail-tab-label">{tabTitle(tab())}</span>
        <Show when={tab().audible || tab().muted}>
          <button
            class="iconbtn iconbtn--sm rail-audio"
            classList={{ muted: tab().muted }}
            title={tab().muted ? 'Unmute tab' : 'Mute tab'}
            aria-label={tab().muted ? 'Unmute tab' : 'Mute tab'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => void api.send({ type: 'tab.mute', id: tab().id, muted: !tab().muted })}
          >
            <Icon name={tab().muted ? 'volume-x' : 'volume-2'} />
          </button>
        </Show>
        <button
          class="iconbtn iconbtn--sm rail-close"
          title="Close tab"
          aria-label="Close tab"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void api.send({ type: 'tab.close', id: tab().id })}
        >
          <Icon name="x" />
        </button>
      </div>
    )
  }

  return (
    <nav
      class="rail"
      classList={{
        peek: props.mode === 'peek',
        dragging: drag()?.moved ?? false,
      }}
      style={accent() === undefined ? undefined : { '--ws-accent': accent() }}
      aria-label="Tabs"
    >
      <div class="rail-top">
        <button
          class="iconbtn rail-toggle"
          title={props.mode === 'expanded' ? 'Hide tabs (Ctrl+Shift+S)' : 'Keep tabs open'}
          aria-label={props.mode === 'expanded' ? 'Hide tabs' : 'Keep tabs open'}
          onClick={toggleRail}
        >
          <Icon name="panel-left" />
        </button>
        <span class="rail-grow" />
        <button
          class="iconbtn rail-back"
          title="Back"
          aria-label="Back"
          disabled={!(active()?.canGoBack ?? false)}
          onClick={() => void api.send({ type: 'nav.back' })}
        >
          <Icon name="arrow-left" />
        </button>
        <button
          class="iconbtn rail-forward"
          title="Forward"
          aria-label="Forward"
          disabled={!(active()?.canGoForward ?? false)}
          onClick={() => void api.send({ type: 'nav.forward' })}
        >
          <Icon name="arrow-right" />
        </button>
        <Show
          when={active()?.loading}
          fallback={
            <button
              class="iconbtn rail-reload"
              title="Reload"
              aria-label="Reload"
              onClick={() => void api.send({ type: 'nav.reload' })}
            >
              <Icon name="rotate-cw" />
            </button>
          }
        >
          <button
            class="iconbtn rail-reload"
            title="Stop"
            aria-label="Stop"
            onClick={() => void api.send({ type: 'nav.stop' })}
          >
            <Icon name="x" />
          </button>
        </Show>
      </div>

      <div
        class="rail-address"
        classList={{ editing: editing() }}
        onClick={() => {
          if (!editing()) beginEdit()
        }}
      >
        <Show when={siteInfoOn() && !editing()} fallback={<Icon name={addressIcon()} size={14} />}>
          <button
            class="rail-site"
            classList={{ insecure: addressIcon() === 'lock-open' }}
            title="Site information"
            aria-label="Site information"
            tabindex="-1"
            onMouseDown={(e) => e.preventDefault()}
            onClick={openSiteInfo}
          >
            <Icon name={addressIcon()} size={14} />
          </button>
        </Show>
        <Show
          when={editing()}
          fallback={
            <Show
              when={addressParts()}
              fallback={<span class="rail-address-placeholder">Search or type a URL</span>}
            >
              {(parts) => (
                <span class="rail-address-text" classList={{ files: active()?.kind === 'files' }}>
                  <span class="rail-host">{parts().host}</span>
                  <span class="rail-path">{parts().rest}</span>
                </span>
              )}
            </Show>
          }
        >
          <input
            ref={(el) => {
              addressInput = el
              queueMicrotask(() => {
                el.focus()
                el.select()
              })
            }}
            class="rail-address-input"
            value={draft()}
            placeholder="Search or type a URL"
            spellcheck={false}
            onInput={onAddressInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') endEdit()
              e.stopPropagation()
            }}
            onBlur={endEdit}
          />
        </Show>
        <Show when={/^https?:/i.test(active()?.url ?? '')}>
          <button
            class="iconbtn iconbtn--sm rail-key"
            title="Fill a password (Ctrl+Shift+L)"
            aria-label="Fill a password"
            tabindex="-1"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              void api.send({ type: 'passwords.open' })
            }}
          >
            <Icon name="key-round" />
          </button>
        </Show>
        <Show when={canBookmark()}>
          <button
            class="iconbtn iconbtn--sm rail-star"
            classList={{ on: isBookmarked() }}
            title={isBookmarked() ? 'Remove bookmark' : 'Bookmark this page'}
            aria-label={isBookmarked() ? 'Remove bookmark' : 'Bookmark this page'}
            aria-pressed={isBookmarked()}
            tabindex="-1"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              void api.send({ type: 'bookmark.toggle' })
            }}
          >
            <Icon name="star" class={isBookmarked() ? 'filled' : undefined} />
          </button>
        </Show>
      </div>

      <Show when={pinned().length > 0}>
        <div class="rail-pins">
          <For each={pinned()}>
            {(tab) => (
              <button
                class="rail-pin"
                classList={{ active: tab.id === activeId() }}
                data-tab={tab.id}
                title={`${tabTitle(tab)}\n${tab.url}`}
                aria-label={tabTitle(tab)}
                onClick={() => void api.send({ type: 'tab.activate', id: tab.id })}
                onAuxClick={(e) => {
                  if (e.button !== 1) return
                  e.preventDefault()
                  void api.send({ type: 'tab.close', id: tab.id })
                }}
                onContextMenu={(e) => openMenu(e, { kind: 'tab', id: tab.id })}
              >
                <TabGlyph tab={tab} />
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="rail-tabs" role="tablist" aria-label="Open tabs" ref={listEl}>
        <Index each={unpinned()}>{(tab, i) => <TabRow tab={tab} index={i} />}</Index>
        <button class="rail-tab rail-new" title="New tab (Ctrl+T)" onClick={newTab}>
          <span class="rail-fav">
            <Icon name="plus" />
          </span>
          <span class="rail-tab-label">New tab</span>
        </button>
      </div>

      <Show when={storeOffer()}>
        {(id) => (
          <button
            class="rail-store-add"
            onClick={() => void api.send({ type: 'extension.install', source: id() })}
          >
            <Icon name="puzzle" />
            <span>Add to ewe browser</span>
          </button>
        )}
      </Show>

      <ExtensionActions state={extensions()} />
    </nav>
  )
}
