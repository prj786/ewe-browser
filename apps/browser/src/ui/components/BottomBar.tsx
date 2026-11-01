import { For, Index, Show, createEffect, createSignal, on, type JSX } from 'solid-js'
import { WORKSPACE_COLORS, type SidebarSection, type Workspace } from '@ewe/shared'
import { api } from '../lib/api'
import type { BrowserStore } from '../lib/store'
import { Icon, type IconName } from './Icon'
import './BottomBar.css'

export interface BottomBarProps {
  store: BrowserStore
  downloadsActive: number
  renameRequest?: { id: string; n: number } | undefined
  dropTarget?: string | null | undefined
}

const WORKSPACE_NAME_MAX = 40

const SIDEBAR_BUTTONS: { section: SidebarSection; label: string; icon: IconName }[] = [
  { section: 'bookmarks', label: 'Bookmarks', icon: 'bookmark' },
  { section: 'downloads', label: 'Downloads', icon: 'download' },
  { section: 'history', label: 'History', icon: 'history' },
]

function tabCount(store: BrowserStore, id: string): number {
  return store.state()?.tabs.filter((t) => t.workspaceId === id).length ?? 0
}

function viaLabel(ws: Workspace): string | null {
  const remote = ws.remote
  return remote === undefined || remote.name === ws.name ? null : `via ${remote.name}`
}

function chipTitle(ws: Workspace, tabs: number): string {
  const via = ws.remote === undefined ? '' : ` · browses from ${ws.remote.name}`
  return `${ws.name}${via} · ${tabs} tabs`
}

export function BottomBar(props: BottomBarProps): JSX.Element {
  const store = () => props.store
  const [renaming, setRenaming] = createSignal<string | null>(null)
  const [nameDraft, setNameDraft] = createSignal('')
  const activeId = () => store().activeWorkspace()?.id
  const sidebar = () => store().state()?.sidebar?.section ?? null

  const startRename = (ws: Workspace) => {
    setNameDraft(ws.name)
    setRenaming(ws.id)
  }

  const commitRename = () => {
    const id = renaming()
    if (id === null) return
    const next = nameDraft().trim().slice(0, WORKSPACE_NAME_MAX)
    const current = store()
      .workspaces()
      .find((w) => w.id === id)
    if (next !== '' && current !== undefined && next !== current.name)
      void api.send({ type: 'workspace.update', id, name: next })
    setRenaming(null)
  }

  createEffect(
    on(
      () => props.renameRequest?.n,
      () => {
        const request = props.renameRequest
        const ws = store()
          .workspaces()
          .find((w) => w.id === request?.id)
        if (ws !== undefined && (request?.n ?? 0) > 0) startRename(ws)
      },
      { defer: true },
    ),
  )

  const openMenu = (e: MouseEvent, id: string) => {
    e.preventDefault()
    void api.send({
      type: 'menu.open',
      menu: { kind: 'workspace', id },
      x: e.clientX,
      y: e.clientY,
    })
  }

  return (
    <footer class="bar" aria-label="Workspaces and tools">
      <div class="bar-workspaces" role="tablist" aria-label="Workspaces">
        <Index each={store().workspaces()}>
          {(ws) => (
            <Show
              when={renaming() === ws().id}
              fallback={
                <button
                  class="bar-ws"
                  classList={{
                    on: ws().id === activeId(),
                    target: props.dropTarget === ws().id,
                    remote: ws().remote !== undefined,
                  }}
                  style={{ '--dot': WORKSPACE_COLORS[ws().color] }}
                  data-ws={ws().id}
                  data-remote={ws().remote?.id}
                  role="tab"
                  aria-selected={ws().id === activeId()}
                  title={chipTitle(ws(), tabCount(store(), ws().id))}
                  onClick={() => {
                    if (ws().id !== activeId())
                      void api.send({ type: 'workspace.activate', id: ws().id })
                  }}
                  onDblClick={() => startRename(ws())}
                  onContextMenu={(e) => openMenu(e, ws().id)}
                >
                  <i class="bar-ws-dot" />
                  <Show when={ws().remote}>
                    <Icon name="monitor" class="bar-ws-remote" />
                  </Show>
                  <span class="bar-ws-name">{ws().name}</span>
                  <Show when={viaLabel(ws())}>
                    {(via) => <span class="bar-ws-via">{via()}</span>}
                  </Show>
                </button>
              }
            >
              <div
                class="bar-ws on editing"
                style={{ '--dot': WORKSPACE_COLORS[ws().color] }}
                data-ws={ws().id}
              >
                <i class="bar-ws-dot" />
                <input
                  ref={(el) => {
                    queueMicrotask(() => {
                      el.focus()
                      el.select()
                    })
                  }}
                  class="bar-ws-input"
                  value={nameDraft()}
                  maxLength={WORKSPACE_NAME_MAX}
                  size={Math.max(8, nameDraft().length)}
                  spellcheck={false}
                  aria-label="Workspace name"
                  onInput={(e) => setNameDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setRenaming(null)
                  }}
                  onBlur={commitRename}
                />
              </div>
            </Show>
          )}
        </Index>
        <button
          class="iconbtn iconbtn--sm bar-ws-add"
          title="New workspace"
          aria-label="New workspace"
          onClick={(e) => {
            const at = e.currentTarget.getBoundingClientRect()
            void api.send({ type: 'workspace.new', x: at.left, y: at.top })
          }}
        >
          <Icon name="plus" />
        </button>
      </div>
      <div class="bar-actions">
        <For each={SIDEBAR_BUTTONS}>
          {(b) => (
            <button
              class="iconbtn iconbtn--sm bar-action"
              classList={{ on: sidebar() === b.section }}
              data-section={b.section}
              title={b.label}
              aria-label={b.label}
              aria-pressed={sidebar() === b.section}
              onClick={() => void api.send({ type: 'sidebar.toggle', section: b.section })}
            >
              <Icon name={b.icon} />
              <Show when={b.section === 'downloads' && props.downloadsActive > 0}>
                <span class="bar-dot" />
              </Show>
            </button>
          )}
        </For>
        <span class="bar-sep" />
        <button
          class="iconbtn iconbtn--sm bar-action bar-music"
          title="Music"
          aria-label="Music"
          onClick={() => void api.send({ type: 'open.internal', page: 'music' })}
        >
          <Icon name="music" />
        </button>
        <button
          class="iconbtn iconbtn--sm bar-action bar-files"
          title="Files (Ctrl+Shift+E)"
          aria-label="Files"
          onClick={() => void api.send({ type: 'open.internal', page: 'files' })}
        >
          <Icon name="folder" />
        </button>
        <button
          class="iconbtn iconbtn--sm bar-action bar-settings"
          title="Settings"
          aria-label="Settings"
          onClick={() => void api.send({ type: 'open.internal', page: 'settings' })}
        >
          <Icon name="settings" />
        </button>
      </div>
    </footer>
  )
}
