import { For, Index, Match, Show, Switch, createMemo, createSignal, type JSX } from 'solid-js'
import { hostOf, type DownloadAction, type DownloadEntry, type Point } from '@ewe/shared'
import { api } from '../../lib/api'
import { isActiveDownload } from '../../lib/downloads'
import { formatBytes, formatDuration } from '../../lib/format'
import { EmptyState } from '../EmptyState'
import { Icon, type IconName } from '../Icon'
import { Menu, type MenuEntry } from '../Menu'

export interface DownloadsPaneProps {
  downloads: DownloadEntry[]
  query: string
  onClearSearch: () => void
}

function statusLine(d: DownloadEntry): string {
  const size =
    d.total > 0 ? `${formatBytes(d.received)} of ${formatBytes(d.total)}` : formatBytes(d.received)
  switch (d.status) {
    case 'progressing': {
      if (d.speed <= 0) return size
      const left = d.total > 0 ? ` · ${formatDuration((d.total - d.received) / d.speed)} left` : ''
      return `${size} · ${formatBytes(d.speed)}/s${left}`
    }
    case 'paused':
      return `Paused · ${size}`
    case 'completed':
      return `${formatBytes(d.total > 0 ? d.total : d.received)} · ${hostOf(d.url)}`
    case 'cancelled':
      return 'Cancelled'
    case 'interrupted':
      return 'Failed'
  }
}

function progress(d: DownloadEntry): number | null {
  if (d.total <= 0) return null
  return Math.min(100, Math.max(0, (d.received / d.total) * 100))
}

interface Action {
  action: DownloadAction
  label: string
  icon: IconName
}

const REMOVE: Action = { action: 'remove', label: 'Remove from list', icon: 'x' }
const CANCEL: Action = { action: 'cancel', label: 'Cancel', icon: 'x' }
const ACTIONS: Record<DownloadEntry['status'], Action[]> = {
  progressing: [{ action: 'pause', label: 'Pause', icon: 'pause' }, CANCEL],
  paused: [{ action: 'resume', label: 'Resume', icon: 'play' }, CANCEL],
  completed: [{ action: 'show', label: 'Show in folder', icon: 'folder-open' }, REMOVE],
  cancelled: [{ action: 'retry', label: 'Retry', icon: 'rotate-ccw' }, REMOVE],
  interrupted: [{ action: 'retry', label: 'Retry', icon: 'rotate-ccw' }, REMOVE],
}

export function DownloadsPane(props: DownloadsPaneProps): JSX.Element {
  const send = (d: DownloadEntry, action: DownloadAction) =>
    void api.send({ type: 'download', id: d.id, action })

  const [ctx, setCtx] = createSignal<{ id: string; at: Point } | null>(null)
  const ctxItems = createMemo<MenuEntry[]>(() => {
    const c = ctx()
    const d = c === null ? undefined : props.downloads.find((x) => x.id === c.id)
    if (d === undefined) return []
    const item = (
      action: DownloadAction,
      label: string,
      icon: IconName,
      danger = false,
    ): MenuEntry => ({
      type: 'item',
      id: action,
      label,
      icon,
      danger,
      run: () => send(d, action),
    })
    const items: MenuEntry[] = []
    if (d.status === 'completed')
      items.push(
        item('open', 'Open', 'external-link'),
        item('show', 'Show in folder', 'folder-open'),
      )
    for (const a of ACTIONS[d.status])
      if (a.action !== 'show' && a.action !== 'remove') items.push(item(a.action, a.label, a.icon))
    items.push(
      {
        type: 'item',
        id: 'copy',
        label: 'Copy link',
        icon: 'link',
        run: () => void navigator.clipboard.writeText(d.url).catch(() => undefined),
      },
      { type: 'separator' },
      item('remove', 'Remove from list', 'x', true),
    )
    return items
  })

  const list = createMemo(() => {
    const q = props.query.trim().toLowerCase()
    if (q === '') return props.downloads
    return props.downloads.filter((d) => `${d.filename} ${d.url}`.toLowerCase().includes(q))
  })

  return (
    <div class="sb-pane" role="list" aria-label="Downloads">
      <Show
        when={list().length > 0}
        fallback={
          <Show
            when={props.query.trim() === ''}
            fallback={
              <EmptyState
                compact
                class="sb-empty"
                icon="search"
                title="No matching downloads"
                actions={
                  <button class="btn btn--secondary btn--sm" onClick={() => props.onClearSearch()}>
                    Clear search
                  </button>
                }
              >
                Nothing in your downloads matches “{props.query.trim()}”.
              </EmptyState>
            }
          >
            <EmptyState
              compact
              class="sb-empty"
              icon="download"
              title="No downloads yet"
              actions={
                <button
                  class="btn btn--secondary btn--sm sb-open-downloads"
                  onClick={() => void api.send({ type: 'downloads.openFolder' })}
                >
                  Open Downloads folder
                </button>
              }
            >
              Files you download land in your Downloads folder.
            </EmptyState>
          </Show>
        }
      >
        <Index each={list()}>
          {(d) => (
            <div
              class="sb-download"
              classList={{
                active: isActiveDownload(d()),
                done: d().status === 'completed',
                failed: d().status === 'interrupted' || d().status === 'cancelled',
              }}
              data-row
              data-id={d().id}
              tabindex="-1"
              role="listitem"
              title={`${d().filename}\n${d().url}`}
              onClick={() => {
                if (d().status === 'completed') send(d(), 'open')
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.currentTarget.focus()
                setCtx({ id: d().id, at: { x: e.clientX, y: e.clientY } })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && d().status === 'completed') send(d(), 'open')
                else if (e.key === 'Delete') send(d(), 'remove')
                else return
                e.preventDefault()
                e.stopPropagation()
              }}
            >
              <span class="sb-file-icon">
                <Switch fallback={<Icon name="file" />}>
                  <Match when={d().status === 'interrupted'}>
                    <Icon name="circle-alert" />
                  </Match>
                  <Match when={isActiveDownload(d())}>
                    <Icon name="download" />
                  </Match>
                </Switch>
              </span>
              <span class="sb-download-text">
                <span class="sb-download-name">{d().filename}</span>
                <span class="sb-download-status">{statusLine(d())}</span>
                <Show when={isActiveDownload(d())}>
                  <span
                    class="sb-progress"
                    classList={{
                      paused: d().status === 'paused',
                      indeterminate: progress(d()) === null,
                    }}
                  >
                    <span style={{ width: `${progress(d()) ?? 30}%` }} />
                  </span>
                </Show>
              </span>
              <span class="sb-actions">
                <For each={ACTIONS[d().status]}>
                  {(a) => (
                    <button
                      class="iconbtn iconbtn--sm"
                      classList={{ [`sb-${a.action}`]: true }}
                      title={a.label}
                      aria-label={a.label}
                      onClick={(e) => {
                        e.stopPropagation()
                        send(d(), a.action)
                      }}
                    >
                      <Icon name={a.icon} />
                    </button>
                  )}
                </For>
              </span>
            </div>
          )}
        </Index>
      </Show>
      <Show when={ctx()}>
        {(c) => (
          <div
            class="sb-menu-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setCtx(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Menu items={ctxItems()} at={c().at} onClose={() => setCtx(null)} />
          </div>
        )}
      </Show>
    </div>
  )
}
