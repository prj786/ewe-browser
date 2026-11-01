import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js'
import { displayUrl, hostOf, type HistoryVisit, type Point, type TabState } from '@ewe/shared'
import { api } from '../../lib/api'
import { faviconFor } from '../../lib/favicon'
import { clockTime, dayLabel } from '../../lib/format'
import { EmptyState } from '../EmptyState'
import { Favicon } from '../Favicon'
import { Icon } from '../Icon'
import { Menu, type MenuEntry } from '../Menu'

const LIMIT = 400
const QUERY_DELAY_MS = 120

export interface HistoryPaneProps {
  tabs: TabState[]
  query: string
  onOpen: (url: string, newTab: boolean) => void
  onClearSearch: () => void
}

interface Group {
  label: string
  visits: HistoryVisit[]
}

interface Ctx {
  visit: HistoryVisit
  at: Point
}

function group(visits: HistoryVisit[], now: number): Group[] {
  const out: Group[] = []
  for (const visit of visits) {
    const label = dayLabel(visit.last, now)
    const last = out.at(-1)
    if (last?.label === label) last.visits.push(visit)
    else out.push({ label, visits: [visit] })
  }
  return out
}

export function HistoryPane(props: HistoryPaneProps): JSX.Element {
  const [visits, setVisits] = createSignal<HistoryVisit[]>([])
  const [loaded, setLoaded] = createSignal(false)
  const [ctx, setCtx] = createSignal<Ctx | null>(null)
  let timer: number | undefined
  let seq = 0

  const load = () => {
    const id = ++seq
    void api.history(props.query, LIMIT).then((list) => {
      if (id !== seq) return
      setVisits(list)
      setLoaded(true)
    })
  }

  createEffect(
    on(
      () => props.query,
      () => {
        window.clearTimeout(timer)
        timer = window.setTimeout(load, QUERY_DELAY_MS)
      },
      { defer: true },
    ),
  )

  onMount(() => {
    load()
    const off = api.onHistory(load)
    onCleanup(() => {
      off()
      window.clearTimeout(timer)
    })
  })

  const groups = createMemo(() => group(visits(), Date.now()))

  const remove = (visit: HistoryVisit) => {
    setVisits((list) => list.filter((v) => v.url !== visit.url))
    void api.send({ type: 'history.remove', url: visit.url })
  }

  const ctxItems = createMemo<MenuEntry[]>(() => {
    const c = ctx()
    if (c === null) return []
    const visit = c.visit
    return [
      {
        type: 'item',
        id: 'open',
        label: 'Open',
        icon: 'arrow-right',
        run: () => props.onOpen(visit.url, false),
      },
      {
        type: 'item',
        id: 'open-new',
        label: 'Open in new tab',
        icon: 'external-link',
        run: () => props.onOpen(visit.url, true),
      },
      {
        type: 'item',
        id: 'copy',
        label: 'Copy link',
        icon: 'link',
        run: () => void navigator.clipboard.writeText(visit.url).catch(() => undefined),
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'remove',
        label: 'Remove from history',
        icon: 'trash-2',
        danger: true,
        run: () => remove(visit),
      },
    ]
  })

  return (
    <div class="sb-pane" role="list" aria-label="History">
      <Show
        when={groups().length > 0}
        fallback={
          <Show when={loaded()}>
            <Show
              when={props.query.trim() === ''}
              fallback={
                <EmptyState
                  compact
                  class="sb-empty"
                  icon="search"
                  title="No matching pages"
                  actions={
                    <button
                      class="btn btn--secondary btn--sm"
                      onClick={() => props.onClearSearch()}
                    >
                      Clear search
                    </button>
                  }
                >
                  Nothing in your history matches “{props.query.trim()}”.
                </EmptyState>
              }
            >
              <EmptyState
                compact
                class="sb-empty"
                icon="history"
                title="No history yet"
                actions={
                  <button
                    class="btn btn--secondary btn--sm sb-start"
                    onClick={() => void api.send({ type: 'tab.create' })}
                  >
                    Start browsing
                  </button>
                }
              >
                Sites you visit show up here, grouped by day.
              </EmptyState>
            </Show>
          </Show>
        }
      >
        <For each={groups()}>
          {(g) => (
            <>
              <div class="sb-group">{g.label}</div>
              <For each={g.visits}>
                {(visit) => (
                  <div
                    class="sb-row sb-visit"
                    classList={{ 'ctx-open': ctx()?.visit.url === visit.url }}
                    data-row
                    data-id={visit.url}
                    tabindex="-1"
                    role="listitem"
                    title={`${visit.title}\n${visit.url}`}
                    onClick={(e) => props.onOpen(visit.url, e.ctrlKey || e.metaKey)}
                    onAuxClick={(e) => {
                      if (e.button !== 1) return
                      e.preventDefault()
                      props.onOpen(visit.url, true)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.currentTarget.focus()
                      setCtx({ visit, at: { x: e.clientX, y: e.clientY } })
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') props.onOpen(visit.url, e.ctrlKey || e.metaKey)
                      else if (e.key === 'Delete') remove(visit)
                      else return
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                  >
                    <span class="sb-icon">
                      <Favicon src={faviconFor(visit.url, props.tabs)} />
                    </span>
                    <span class="sb-label">
                      {visit.title === '' ? displayUrl(visit.url) : visit.title}
                    </span>
                    <span class="sb-hint">{hostOf(visit.url)}</span>
                    <span class="sb-time">{clockTime(visit.last)}</span>
                    <button
                      class="iconbtn iconbtn--sm sb-remove"
                      title="Remove from history"
                      aria-label="Remove from history"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(visit)
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  </div>
                )}
              </For>
            </>
          )}
        </For>
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
