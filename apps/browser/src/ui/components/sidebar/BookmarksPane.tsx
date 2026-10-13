import { For, Show, createEffect, createMemo, createSignal, on, onMount, type JSX } from 'solid-js'
import {
  BOOKMARKS_ROOT_ID,
  countBookmarks,
  displayUrl,
  flattenBookmarks,
  hostOf,
  type BookmarkFolder,
  type BookmarkItem,
  type BookmarkNode,
  type Point,
  type TabState,
} from '@ewe/shared'
import { api } from '../../lib/api'
import { faviconFor } from '../../lib/favicon'
import { Favicon } from '../Favicon'
import { Icon } from '../Icon'
import { Menu, type MenuEntry } from '../Menu'

const EXPANDED_KEY = 'ewe.sidebar.expanded'

type Where = 'before' | 'after' | 'into'

interface Drop {
  id: string
  where: Where
}

type Form = { kind: 'edit'; node: BookmarkNode } | { kind: 'folder'; parentId: string }

interface Ctx {
  node: BookmarkNode
  at: Point
}

export interface BookmarksPaneProps {
  root: BookmarkFolder
  tabs: TabState[]
  query: string
  newFolderRequest: number
  onOpen: (url: string, newTab: boolean) => void
}

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [],
    )
  } catch {
    return new Set()
  }
}

function saveExpanded(ids: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]))
  } catch {
    return
  }
}

function label(node: BookmarkNode): string {
  if (node.title !== '') return node.title
  return node.kind === 'bookmark' ? displayUrl(node.url) : 'Untitled'
}

function asItem(node: BookmarkNode): BookmarkItem | null {
  return node.kind === 'bookmark' ? node : null
}

function asFolder(node: BookmarkNode): BookmarkFolder | null {
  return node.kind === 'folder' ? node : null
}

function BookmarkForm(props: {
  heading: string
  title: string
  url: string | null
  depth: number
  onSave: (title: string, url: string) => void
  onCancel: () => void
}): JSX.Element {
  let titleEl: HTMLInputElement | undefined
  let urlEl: HTMLInputElement | undefined
  onMount(() => {
    titleEl?.focus()
    titleEl?.select()
  })
  const save = () => props.onSave(titleEl?.value ?? '', urlEl?.value ?? '')
  return (
    <div
      class="sb-form"
      style={{ '--depth': props.depth }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') save()
        else if (e.key === 'Escape') props.onCancel()
      }}
    >
      <span class="sb-form-title">{props.heading}</span>
      <input
        ref={titleEl}
        class="sb-input"
        value={props.title}
        placeholder="Title"
        aria-label="Title"
        spellcheck={false}
      />
      <Show when={props.url !== null}>
        <input
          ref={urlEl}
          class="sb-input"
          value={props.url ?? ''}
          placeholder="https://"
          aria-label="Url"
          spellcheck={false}
        />
      </Show>
      <div class="sb-form-actions">
        <button class="btn btn--ghost btn--sm" onClick={() => props.onCancel()}>
          Cancel
        </button>
        <button class="btn btn--primary btn--sm" onClick={save}>
          Save
        </button>
      </div>
    </div>
  )
}

export function BookmarksPane(props: BookmarksPaneProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(loadExpanded())
  const [form, setForm] = createSignal<Form | null>(null)
  const [ctx, setCtx] = createSignal<Ctx | null>(null)
  const [dragId, setDragId] = createSignal<string | null>(null)
  const [drop, setDrop] = createSignal<Drop | null>(null)

  const words = createMemo(() =>
    props.query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== ''),
  )
  const hits = createMemo(() => {
    const w = words()
    if (w.length === 0) return null
    return flattenBookmarks(props.root).filter((hit) => {
      const text = `${hit.item.title} ${hit.item.url}`.toLowerCase()
      return w.every((word) => text.includes(word))
    })
  })

  const isOpen = (id: string) => expanded().has(id)
  const toggle = (id: string, open = !isOpen(id)) => {
    const next = new Set(expanded())
    if (open) next.add(id)
    else next.delete(id)
    setExpanded(next)
    saveExpanded(next)
  }

  createEffect(
    on(
      () => props.newFolderRequest,
      () => setForm({ kind: 'folder', parentId: BOOKMARKS_ROOT_ID }),
      { defer: true },
    ),
  )

  const saveForm = (title: string, url: string) => {
    const f = form()
    if (f === null) return
    if (f.kind === 'folder') {
      void api.send({
        type: 'bookmark.folder.create',
        title,
        ...(f.parentId === BOOKMARKS_ROOT_ID ? {} : { parentId: f.parentId }),
      })
      if (f.parentId !== BOOKMARKS_ROOT_ID) toggle(f.parentId, true)
    } else {
      void api.send({
        type: 'bookmark.update',
        id: f.node.id,
        title,
        ...(f.node.kind === 'bookmark' ? { url } : {}),
      })
    }
    setForm(null)
  }

  const openAll = (folder: BookmarkFolder) => {
    for (const { item } of flattenBookmarks(folder))
      void api.send({ type: 'tab.create', url: item.url, activate: false })
  }

  const ctxItems = createMemo<MenuEntry[]>(() => {
    const c = ctx()
    if (c === null) return []
    const node = c.node
    if (node.kind === 'bookmark') {
      return [
        {
          type: 'item',
          id: 'open',
          label: 'Open',
          icon: 'arrow-right',
          run: () => props.onOpen(node.url, false),
        },
        {
          type: 'item',
          id: 'open-new',
          label: 'Open in new tab',
          icon: 'external-link',
          run: () => props.onOpen(node.url, true),
        },
        { type: 'separator' },
        {
          type: 'item',
          id: 'edit',
          label: 'Edit',
          icon: 'pencil',
          run: () => setForm({ kind: 'edit', node }),
        },
        { type: 'separator' },
        {
          type: 'item',
          id: 'delete',
          label: 'Delete',
          icon: 'trash-2',
          danger: true,
          run: () => void api.send({ type: 'bookmark.remove', id: node.id }),
        },
      ]
    }
    const count = countBookmarks(node)
    return [
      {
        type: 'item',
        id: 'open-all',
        label: count === 0 ? 'Open all' : `Open all (${count})`,
        icon: 'layers',
        disabled: count === 0,
        run: () => openAll(node),
      },
      {
        type: 'item',
        id: 'new-folder',
        label: 'New folder inside',
        icon: 'folder-plus',
        run: () => {
          toggle(node.id, true)
          setForm({ kind: 'folder', parentId: node.id })
        },
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'rename',
        label: 'Rename',
        icon: 'pencil',
        run: () => setForm({ kind: 'edit', node }),
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'delete',
        label: 'Delete folder',
        icon: 'trash-2',
        danger: true,
        run: () => void api.send({ type: 'bookmark.remove', id: node.id }),
      },
    ]
  })

  const whereFor = (e: DragEvent, node: BookmarkNode): Where => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    if (node.kind === 'folder') {
      if (y < 0.25) return 'before'
      if (y > 0.75 && !isOpen(node.id)) return 'after'
      return 'into'
    }
    return y < 0.5 ? 'before' : 'after'
  }

  const finishDrop = (node: BookmarkNode, parent: BookmarkFolder, index: number) => {
    const d = drop()
    const id = dragId()
    setDrop(null)
    setDragId(null)
    if (d === null || id === null || id === node.id) return
    if (d.where === 'into') {
      void api.send({ type: 'bookmark.update', id, folderId: node.id })
      toggle(node.id, true)
      return
    }
    void api.send({
      type: 'bookmark.update',
      id,
      folderId: parent.id,
      index: d.where === 'before' ? index : index + 1,
    })
  }

  const onRowKey = (e: KeyboardEvent, node: BookmarkNode) => {
    if (e.key === 'Enter') {
      if (node.kind === 'folder') toggle(node.id)
      else props.onOpen(node.url, e.ctrlKey || e.metaKey)
    } else if (e.key === 'ArrowRight' && node.kind === 'folder') toggle(node.id, true)
    else if (e.key === 'ArrowLeft' && node.kind === 'folder') toggle(node.id, false)
    else if (e.key === 'F2') setForm({ kind: 'edit', node })
    else if (e.key === 'Delete') void api.send({ type: 'bookmark.remove', id: node.id })
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const dropClass = (id: string, where: Where) => {
    const d = drop()
    return d !== null && d.id === id && d.where === where
  }

  const Row = (rowProps: {
    node: BookmarkNode
    parent: BookmarkFolder
    index: number
    depth: number
    hint?: string | undefined
  }): JSX.Element => {
    const node = () => rowProps.node
    const editing = () => {
      const f = form()
      return f?.kind === 'edit' && f.node.id === node().id
    }
    return (
      <Show
        when={!editing()}
        fallback={
          <BookmarkForm
            heading={node().kind === 'folder' ? 'Rename folder' : 'Edit bookmark'}
            title={node().title}
            url={asItem(node())?.url ?? null}
            depth={rowProps.depth}
            onSave={saveForm}
            onCancel={() => setForm(null)}
          />
        }
      >
        <div
          class="sb-row"
          classList={{
            folder: node().kind === 'folder',
            dragging: dragId() === node().id,
            'drop-before': dropClass(node().id, 'before'),
            'drop-after': dropClass(node().id, 'after'),
            'drop-into': dropClass(node().id, 'into'),
            'ctx-open': ctx()?.node.id === node().id,
          }}
          style={{ '--depth': rowProps.depth }}
          data-row
          data-id={node().id}
          tabindex="-1"
          role="treeitem"
          aria-expanded={node().kind === 'folder' ? isOpen(node().id) : undefined}
          title={(() => {
            const item = asItem(node())
            return item === null ? label(node()) : `${label(item)}\n${item.url}`
          })()}
          draggable={props.query === ''}
          onClick={(e) => {
            const n = node()
            if (n.kind === 'folder') toggle(n.id)
            else props.onOpen(n.url, e.ctrlKey || e.metaKey)
          }}
          onAuxClick={(e) => {
            const n = node()
            if (e.button !== 1 || n.kind !== 'bookmark') return
            e.preventDefault()
            props.onOpen(n.url, true)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.currentTarget.focus()
            setCtx({ node: node(), at: { x: e.clientX, y: e.clientY } })
          }}
          onKeyDown={(e) => onRowKey(e, node())}
          onDragStart={(e) => {
            const n = node()
            setDragId(n.id)
            e.dataTransfer?.setData('text/x-ewe-bookmark', n.id)
            if (n.kind === 'bookmark') e.dataTransfer?.setData('text/uri-list', n.url)
            if (e.dataTransfer !== null) e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => {
            setDragId(null)
            setDrop(null)
          }}
          onDragOver={(e) => {
            if (dragId() === null || dragId() === node().id) return
            e.preventDefault()
            setDrop({ id: node().id, where: whereFor(e, node()) })
          }}
          onDragLeave={(e) => {
            if (
              !e.currentTarget.contains(e.relatedTarget as Node | null) &&
              drop()?.id === node().id
            )
              setDrop(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            finishDrop(node(), rowProps.parent, rowProps.index)
          }}
        >
          <Show when={asFolder(node())}>
            {(folder) => (
              <>
                <Icon
                  name="chevron-right"
                  size={14}
                  class={isOpen(folder().id) ? 'sb-chevron open' : 'sb-chevron'}
                />
                <span class="sb-icon sb-folder-icon">
                  <Icon name={isOpen(folder().id) ? 'folder-open' : 'folder'} />
                </span>
                <span class="sb-label">{label(folder())}</span>
                <span class="sb-count">{countBookmarks(folder())}</span>
              </>
            )}
          </Show>
          <Show when={asItem(node())}>
            {(item) => (
              <>
                <span class="sb-chevron-space" />
                <span class="sb-icon">
                  <Show
                    when={!item().url.startsWith('app://')}
                    fallback={<Icon name="app-window" />}
                  >
                    <Favicon src={faviconFor(item().url, props.tabs)} />
                  </Show>
                </span>
                <span class="sb-label">{label(item())}</span>
                <span class="sb-hint">{rowProps.hint ?? hostOf(item().url)}</span>
              </>
            )}
          </Show>
        </div>
      </Show>
    )
  }

  const folderFormFor = (parentId: string) => {
    const f = form()
    return f?.kind === 'folder' && f.parentId === parentId
  }

  const Tree = (treeProps: { folder: BookmarkFolder; depth: number }): JSX.Element => (
    <>
      <Show when={folderFormFor(treeProps.folder.id)}>
        <BookmarkForm
          heading="New folder"
          title=""
          url={null}
          depth={treeProps.depth}
          onSave={saveForm}
          onCancel={() => setForm(null)}
        />
      </Show>
      <For each={treeProps.folder.children}>
        {(node, i) => (
          <>
            <Row node={node} parent={treeProps.folder} index={i()} depth={treeProps.depth} />
            <Show when={asFolder(node)}>
              {(folder) => (
                <Show when={isOpen(folder().id)}>
                  <Show
                    when={folder().children.length > 0 || folderFormFor(folder().id)}
                    fallback={
                      <div class="sb-row-empty" style={{ '--depth': treeProps.depth + 1 }}>
                        Empty folder
                      </div>
                    }
                  >
                    <Tree folder={folder()} depth={treeProps.depth + 1} />
                  </Show>
                </Show>
              )}
            </Show>
          </>
        )}
      </For>
    </>
  )

  return (
    <div class="sb-pane" role="tree" aria-label="Bookmarks">
      <Show
        when={hits()}
        fallback={
          <Show
            when={props.root.children.length > 0 || form() !== null}
            fallback={
              <div class="sb-empty">
                <Icon name="bookmark" size={24} />
                <span class="sb-empty-title">No bookmarks yet</span>
                <span class="sb-empty-desc">
                  Press Ctrl+D on a page, or import from Chrome in Settings.
                </span>
              </div>
            }
          >
            <Tree folder={props.root} depth={0} />
          </Show>
        }
      >
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={
              <div class="sb-empty">
                <span class="sb-empty-title">No matching bookmarks</span>
              </div>
            }
          >
            <For each={list()}>
              {(hit, i) => (
                <Row
                  node={hit.item}
                  parent={props.root}
                  index={i()}
                  depth={0}
                  hint={hit.path.length > 0 ? hit.path.join(' / ') : hostOf(hit.item.url)}
                />
              )}
            </For>
          </Show>
        )}
      </Show>
      <Show when={ctx()}>
        {(c) => (
          <div
            class="sb-menu-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setCtx(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Menu
              items={ctxItems()}
              at={c().at}
              onClose={() => {
                const id = c().node.id
                setCtx(null)
                document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.focus()
              }}
            />
          </div>
        )}
      </Show>
    </div>
  )
}
