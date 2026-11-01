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
import { render } from 'solid-js/web'
import {
  HISTORY_KEEP_DAYS,
  HISTORY_KEEP_LABELS,
  HISTORY_RANGES,
  HISTORY_RANGE_LABELS,
  WORKSPACE_COLORS,
  displayUrl,
  isHistoryKeepDays,
  isSite,
  nextLocalDay,
  remoteTabCount,
  siteOf,
  type ClearDataResult,
  type HistoryCursor,
  type HistoryDayRow,
  type HistoryRange,
  type HistoryRows,
  type HistorySummary,
  type Point,
  type RemoteMachine,
  HOME_URL,
} from '@ewe/shared'
import '../../ui/styles/base.css'
import '../pages.css'
import './history.css'
import { EmptyState } from '../../ui/components/EmptyState'
import { Favicon } from '../../ui/components/Favicon'
import { Icon } from '../../ui/components/Icon'
import { Menu, type MenuEntry } from '../../ui/components/Menu'
import { api } from '../../ui/lib/api'
import { faviconFor } from '../../ui/lib/favicon'
import { clockTime, dayLabel, timeAgo } from '../../ui/lib/format'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'

const PAGE_SIZE = 100
const QUERY_DELAY_MS = 150
const NOTICE_MS = 2600
const MACHINE_PREVIEW = 8

interface Group {
  day: number
  label: string
  rows: HistoryDayRow[]
}

type Dialog =
  | { kind: 'clear' }
  | { kind: 'site'; site: string; count: number; siteData: boolean }
  | { kind: 'selection'; count: number }

const keyOf = (row: HistoryDayRow): string => `${row.day}\n${row.url}`

function mergeRows(list: HistoryDayRow[], more: HistoryDayRow[]): HistoryDayRow[] {
  const index = new Map(list.map((row, i) => [keyOf(row), i]))
  const out = list.slice()
  for (const row of more) {
    const at = index.get(keyOf(row))
    const existing = at === undefined ? undefined : out[at]
    if (at === undefined || existing === undefined) {
      index.set(keyOf(row), out.length)
      out.push(row)
    } else out[at] = { ...existing, visits: existing.visits + row.visits }
  }
  return out
}

function group(rows: HistoryDayRow[], now: number): Group[] {
  const out: Group[] = []
  for (const row of rows) {
    const last = out.at(-1)
    if (last?.day === row.day) last.rows.push(row)
    else out.push({ day: row.day, label: dayLabel(row.last, now), rows: [row] })
  }
  return out
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

type MachineItem =
  | { kind: 'workspace'; key: string; name: string; color: string | null }
  | { kind: 'tab'; key: string; url: string; title: string }

function machineItems(machine: RemoteMachine, limit: number): MachineItem[] {
  const out: MachineItem[] = []
  let left = limit
  machine.windows.forEach((win, w) => {
    win.workspaces.forEach((ws, i) => {
      if (left <= 0 || ws.tabs.length === 0) return
      out.push({
        kind: 'workspace',
        key: `${w}:${i}`,
        name: ws.name,
        color: ws.color === null ? null : WORKSPACE_COLORS[ws.color],
      })
      for (const [t, tab] of ws.tabs.slice(0, left).entries())
        out.push({ kind: 'tab', key: `${w}:${i}:${t}`, url: tab.url, title: tab.title })
      left -= ws.tabs.length
    })
  })
  return out
}

function MachineCard(props: {
  name: string
  machine: RemoteMachine
  onOpen: (url: string, newTab: boolean) => void
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false)
  const total = () => remoteTabCount(props.machine.windows)
  const items = createMemo(() =>
    machineItems(props.machine, expanded() ? Number.MAX_SAFE_INTEGER : MACHINE_PREVIEW),
  )
  return (
    <div class="list hp-machine" data-machine={props.machine.id ?? props.machine.machine}>
      <div class="row hp-machine-head">
        <span class="row-tile">
          <Icon name="monitor" />
        </span>
        <span class="row-text">
          <span class="row-title">{props.name}</span>
          <span class="row-desc">
            {plural(total(), 'tab')} · updated {timeAgo(props.machine.savedAt).toLowerCase()}
          </span>
        </span>
      </div>
      <For each={items()}>
        {(item) => (
          <Show
            when={item.kind === 'tab' ? item : null}
            fallback={
              <div class="hp-ws">
                <span
                  class="hp-ws-dot"
                  style={
                    item.kind === 'workspace' && item.color !== null
                      ? { '--dot': item.color }
                      : undefined
                  }
                />
                {item.kind === 'workspace' ? item.name : ''}
              </div>
            }
          >
            {(tab) => (
              <a
                class="hp-row hp-remote-tab"
                href={tab().url}
                title={`${tab().title}\n${tab().url}`}
                onClick={(e) => {
                  e.preventDefault()
                  props.onOpen(tab().url, e.ctrlKey || e.metaKey)
                }}
                onAuxClick={(e) => {
                  if (e.button !== 1) return
                  e.preventDefault()
                  props.onOpen(tab().url, true)
                }}
              >
                <span class="hp-icon">
                  <Favicon src={faviconFor(tab().url, [])} />
                </span>
                <span class="hp-title">
                  {tab().title === '' ? displayUrl(tab().url) : tab().title}
                </span>
                <span class="hp-host">{displayUrl(tab().url)}</span>
              </a>
            )}
          </Show>
        )}
      </For>
      <Show when={total() > MACHINE_PREVIEW}>
        <button
          class="btn btn--ghost btn--sm hp-machine-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded() ? 'Show fewer' : `Show all ${total()}`}
        </button>
      </Show>
    </div>
  )
}

function OtherComputers(props: {
  machines: RemoteMachine[]
  sync: boolean
  onOpen: (url: string, newTab: boolean) => void
}): JSX.Element {
  return (
    <section class="hp-machines" aria-label="Other computers">
      <h2 class="section-header">Other computers</h2>
      <Show
        when={props.sync}
        fallback={
          <div class="list">
            <div class="row hp-sync-off">
              <span class="row-tile">
                <Icon name="monitor" />
              </span>
              <span class="row-text">
                <span class="row-title">Tabs from your other computers</span>
                <span class="row-desc">
                  Turn on sync to see the tabs that are open on your other computers.
                </span>
              </span>
              <button
                class="btn btn--secondary btn--sm hp-sync-on"
                onClick={() => void api.send({ type: 'tab.create', url: 'app://settings/#sync' })}
              >
                Turn on sync
              </button>
            </div>
          </div>
        }
      >
        <Show
          when={props.machines.length > 0}
          fallback={
            <p class="hp-muted">
              No other computer has shared its tabs yet. They show up here after ewe Browser syncs
              on them.
            </p>
          }
        >
          <For each={props.machines}>
            {(machine) => (
              <MachineCard
                name={
                  props.machines.filter((m) => m.machine === machine.machine).length > 1
                    ? `${machine.machine} · ${machine.id?.slice(0, 4) ?? 'old'}`
                    : machine.machine
                }
                machine={machine}
                onOpen={props.onOpen}
              />
            )}
          </For>
        </Show>
      </Show>
    </section>
  )
}

function HistoryPage(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))
  const params = new URLSearchParams(location.search)
  const startSite = siteOf(params.get('site') ?? '')
  const [query, setQuery] = createSignal(params.get('q') ?? '')
  const [site, setSite] = createSignal<string | undefined>(
    isSite(startSite) ? startSite : undefined,
  )
  const [rows, setRows] = createSignal<HistoryDayRow[]>([])
  const [next, setNext] = createSignal<HistoryCursor | null>(null)
  const [loaded, setLoaded] = createSignal(false)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [summary, setSummary] = createSignal<HistorySummary | null>(null)
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  const [anchor, setAnchor] = createSignal<string | null>(null)
  const [dialog, setDialog] = createSignal<Dialog | null>(
    params.get('clear') === '1' ? { kind: 'clear' } : null,
  )
  const [range, setRange] = createSignal<HistoryRange>('hour')
  const [what, setWhat] = createSignal({
    history: true,
    cookies: false,
    cache: false,
    downloads: true,
  })
  const [busy, setBusy] = createSignal(false)
  const [notice, setNotice] = createSignal<string | null>(null)
  const [menu, setMenu] = createSignal<{ at: Point; items: MenuEntry[]; key: string } | null>(null)
  const [now, setNow] = createSignal(Date.now())
  let search: HTMLInputElement | undefined
  let sentinel: HTMLDivElement | undefined
  let seq = 0
  let queryTimer: number | undefined
  let noticeTimer: number | undefined

  const allTime = () => range() === 'all'
  const clearDialog = () => dialog()?.kind === 'clear'
  const siteDialog = () => {
    const d = dialog()
    return d?.kind === 'site' ? d : null
  }
  const selectionDialog = () => {
    const d = dialog()
    return d?.kind === 'selection' ? d : null
  }

  const load = (keep = false) => {
    const id = ++seq
    const limit = keep ? Math.min(Math.max(rows().length, PAGE_SIZE), 200) : PAGE_SIZE
    void api
      .historyPage<HistoryRows>({ op: 'rows', query: query(), site: site(), limit })
      .then((result) => {
        if (id !== seq || !result.ok) return
        setNow(Date.now())
        setRows(result.value.rows)
        setNext(result.value.next)
        setLoaded(true)
        const keys = new Set(result.value.rows.map(keyOf))
        setSelected((set) => new Set([...set].filter((k) => keys.has(k))))
      })
  }

  const loadMore = () => {
    const cursor = next()
    if (cursor === null || loadingMore()) return
    setLoadingMore(true)
    const id = seq
    void api
      .historyPage<HistoryRows>({
        op: 'rows',
        query: query(),
        site: site(),
        before: cursor,
        limit: PAGE_SIZE,
      })
      .then((result) => {
        setLoadingMore(false)
        if (id !== seq || !result.ok) return
        setRows((list) => mergeRows(list, result.value.rows))
        setNext(result.value.next)
      })
  }

  const loadSummary = () => {
    void api.historyPage<HistorySummary>({ op: 'summary' }).then((result) => {
      if (result.ok) setSummary(result.value)
    })
  }

  createEffect(
    on(
      query,
      () => {
        window.clearTimeout(queryTimer)
        queryTimer = window.setTimeout(() => load(), QUERY_DELAY_MS)
      },
      { defer: true },
    ),
  )
  createEffect(on(site, () => load(), { defer: true }))

  const notify = (message: string) => {
    window.clearTimeout(noticeTimer)
    setNotice(message)
    noticeTimer = window.setTimeout(() => setNotice(null), NOTICE_MS)
  }

  const refresh = () => {
    load(true)
    loadSummary()
  }

  onMount(() => {
    load()
    loadSummary()
    const off = api.onHistory(refresh)
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((i) => i.isIntersecting)) loadMore()
      },
      { rootMargin: '600px' },
    )
    if (sentinel !== undefined) observer.observe(sentinel)
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'SELECT'
      if (e.key === 'Escape') {
        if (dialog() !== null) setDialog(null)
        else if (selected().size > 0) setSelected(new Set<string>())
        else return
        e.preventDefault()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selected().size > 0) {
        e.preventDefault()
        askDeleteSelection()
      } else if ((e.key === '/' && !typing) || (e.key === 'f' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        search?.focus()
        search?.select()
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      off()
      observer.disconnect()
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(queryTimer)
      window.clearTimeout(noticeTimer)
    })
  })

  const groups = createMemo(() => group(rows(), now()))

  const open = (url: string, newTab: boolean) => {
    if (newTab) void api.send({ type: 'tab.create', url, activate: false })
    else void api.send({ type: 'tab.navigate', input: url })
  }

  const itemOf = (row: HistoryDayRow) => ({
    url: row.url,
    from: row.day,
    to: nextLocalDay(row.day) - 1,
  })

  const deleteRows = (list: HistoryDayRow[]) => {
    if (list.length === 0) return
    const keys = new Set(list.map(keyOf))
    setRows((all) => all.filter((r) => !keys.has(keyOf(r))))
    setSelected((set) => new Set([...set].filter((k) => !keys.has(k))))
    void api
      .historyPage<{ removed: number }>({ op: 'delete', items: list.map(itemOf) })
      .then((result) => {
        if (!result.ok) notify(result.error)
        else
          notify(
            list.length === 1 ? 'Removed from history' : `Removed ${plural(list.length, 'item')}`,
          )
        load(true)
        loadSummary()
      })
  }

  const selectedRows = () => rows().filter((r) => selected().has(keyOf(r)))

  const askDeleteSelection = () => {
    const count = selectedRows().length
    if (count === 0) return
    if (count === 1) deleteRows(selectedRows())
    else setDialog({ kind: 'selection', count })
  }

  const toggle = (row: HistoryDayRow, shift: boolean) => {
    const key = keyOf(row)
    const from = anchor()
    setSelected((set) => {
      const next = new Set(set)
      if (shift && from !== null) {
        const keys = rows().map(keyOf)
        const a = keys.indexOf(from)
        const b = keys.indexOf(key)
        if (a >= 0 && b >= 0) {
          const on = !set.has(key)
          for (const k of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (on) next.add(k)
            else next.delete(k)
          }
          return next
        }
      }
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setAnchor(key)
  }

  const toggleDay = (g: Group) => {
    const keys = g.rows.map(keyOf)
    setSelected((set) => {
      const next = new Set(set)
      const all = keys.every((k) => set.has(k))
      for (const k of keys) {
        if (all) next.delete(k)
        else next.add(k)
      }
      return next
    })
  }

  const askSite = (host: string) => {
    const s = siteOf(host)
    if (!isSite(s)) return
    void api.historyPage<number>({ op: 'siteCount', site: s }).then((result) => {
      setDialog({ kind: 'site', site: s, count: result.ok ? result.value : 0, siteData: false })
    })
  }

  const deleteSite = (s: string, siteData: boolean) => {
    setBusy(true)
    void api
      .historyPage<{ removed: number; siteData: boolean }>({ op: 'deleteSite', site: s, siteData })
      .then((result) => {
        setBusy(false)
        setDialog(null)
        if (!result.ok) {
          notify(result.error)
          return
        }
        if (site() === s) setSite(undefined)
        notify(
          `Deleted ${plural(result.value.removed, 'page')} from ${s}${result.value.siteData ? ', with its cookies and site data' : ''}`,
        )
        load(true)
        loadSummary()
      })
  }

  const clearData = () => {
    const choice = what()
    setBusy(true)
    void api
      .historyPage<ClearDataResult>({
        op: 'clear',
        range: range(),
        history: choice.history,
        cookies: choice.cookies && allTime(),
        cache: choice.cache && allTime(),
        downloads: choice.downloads,
      })
      .then((result) => {
        setBusy(false)
        if (!result.ok) {
          notify(result.error)
          return
        }
        setDialog(null)
        const parts: string[] = []
        if (choice.history) parts.push('history')
        if (result.value.cookies) parts.push('cookies and site data')
        if (result.value.cache) parts.push('cached files')
        if (choice.downloads) parts.push('the downloads list')
        notify(parts.length === 0 ? 'Nothing was cleared' : `Cleared ${parts.join(', ')}`)
        load()
        loadSummary()
      })
  }

  const openMenu = (row: HistoryDayRow, at: Point) => {
    const host = siteOf(row.host)
    const items: MenuEntry[] = [
      {
        type: 'item',
        id: 'open',
        label: 'Open',
        icon: 'arrow-right',
        run: () => open(row.url, false),
      },
      {
        type: 'item',
        id: 'open-new',
        label: 'Open in new tab',
        icon: 'external-link',
        run: () => open(row.url, true),
      },
      {
        type: 'item',
        id: 'copy',
        label: 'Copy link',
        icon: 'link',
        run: () => void navigator.clipboard.writeText(row.url).catch(() => undefined),
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'site',
        label: `More from ${host}`,
        icon: 'search',
        run: () => setSite(host),
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'remove',
        label: 'Remove from history',
        icon: 'trash-2',
        danger: true,
        run: () => deleteRows([row]),
      },
      {
        type: 'item',
        id: 'remove-site',
        label: `Delete everything from ${host}…`,
        icon: 'trash-2',
        danger: true,
        run: () => askSite(row.host),
      },
    ]
    setMenu({ at, items, key: keyOf(row) })
  }

  const keepDays = () => {
    const days = store.settings().historyDays
    return isHistoryKeepDays(days) ? days : 0
  }

  const describe = () => {
    const s = summary()
    if (s === null) return ''
    const kept =
      s.keepDays === 0 ? 'kept with no time limit' : `kept for ${HISTORY_KEEP_LABELS[s.keepDays]}`
    const sync = !s.sync
      ? 'Only on this computer.'
      : s.lastSync === null
        ? 'Sync is on.'
        : `Synced with your other computers at ${clockTime(s.lastSync)}.`
    return `${plural(s.pages, 'page')}, ${kept}. ${sync}`
  }

  return (
    <div
      class="page page-history"
      onContextMenu={(e) => e.target === e.currentTarget && e.preventDefault()}
    >
      <div class="history">
        <div class="settings-head">
          <h1>History</h1>
          <p class="hp-summary">{describe()}</p>
          <Show when={summary()?.warning}>
            {(warning) => (
              <p class="hp-warning">
                <Icon name="circle-alert" />
                {warning()}
              </p>
            )}
          </Show>
        </div>
        <div class="list">
          <div class="row">
            <span class="row-tile">
              <Icon name="history" />
            </span>
            <span class="row-text">
              <span class="row-title">Keep history for</span>
              <span class="row-desc">
                Older visits are deleted every day. With sync on, this applies to all your
                computers.
              </span>
            </span>
            <span class="select">
              <select
                aria-label="Keep history for"
                class="hp-keep"
                value={String(keepDays())}
                onChange={(e) => {
                  const days = Number(e.currentTarget.value)
                  if (!isHistoryKeepDays(days)) return
                  void api.historyPage({ op: 'keep', days }).then(() => {
                    load(true)
                    loadSummary()
                  })
                }}
              >
                <For each={HISTORY_KEEP_DAYS}>
                  {(days) => <option value={String(days)}>{HISTORY_KEEP_LABELS[days]}</option>}
                </For>
              </select>
              <Icon name="chevron-down" />
            </span>
          </div>
          <div class="list-divider" />
          <div class="row">
            <span class="row-tile">
              <Icon name="trash-2" />
            </span>
            <span class="row-text">
              <span class="row-title">Clear browsing data</span>
              <span class="row-desc">
                History, cookies and site data, cached files, the downloads list.
              </span>
            </span>
            <button
              class="btn btn--secondary btn--sm hp-clear-open"
              onClick={() => setDialog({ kind: 'clear' })}
            >
              Clear browsing data…
            </button>
          </div>
        </div>

        <OtherComputers
          machines={summary()?.machines ?? []}
          sync={summary()?.sync ?? false}
          onOpen={open}
        />

        <div class="hp-toolbar">
          <Show
            when={selected().size === 0}
            fallback={
              <div class="hp-selection">
                <span class="hp-selection-count">{plural(selected().size, 'item')} selected</span>
                <button
                  class="btn btn--ghost btn--sm"
                  onClick={() => setSelected(new Set<string>())}
                >
                  Cancel
                </button>
                <button
                  class="btn btn--sm hp-danger hp-delete-selected"
                  onClick={askDeleteSelection}
                >
                  <Icon name="trash-2" />
                  Delete
                </button>
              </div>
            }
          >
            <label class="hp-search">
              <Icon name="search" />
              <input
                ref={search}
                type="search"
                placeholder="Search history"
                aria-label="Search history"
                spellcheck={false}
                autocomplete="off"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query() !== '') {
                    e.preventDefault()
                    e.stopPropagation()
                    setQuery('')
                  }
                }}
              />
            </label>
            <Show when={site()}>
              {(s) => (
                <span class="hp-chip">
                  <Icon name="globe" />
                  {s()}
                  <button
                    class="iconbtn iconbtn--sm"
                    aria-label="Show all sites"
                    title="Show all sites"
                    onClick={() => setSite(undefined)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              )}
            </Show>
            <Show when={site()}>
              {(s) => (
                <button class="btn btn--ghost btn--sm hp-delete-site" onClick={() => askSite(s())}>
                  Delete everything from this site…
                </button>
              )}
            </Show>
          </Show>
        </div>

        <Show
          when={groups().length > 0}
          fallback={
            <Show when={loaded()}>
              <Show
                when={query().trim() !== '' || site() !== undefined}
                fallback={
                  <EmptyState
                    class="hp-empty"
                    icon="history"
                    title="No history yet"
                    actions={
                      <button
                        class="btn btn--secondary hp-empty-home"
                        onClick={() => void api.send({ type: 'tab.navigate', input: HOME_URL })}
                      >
                        <Icon name="search" /> Start browsing
                      </button>
                    }
                  >
                    Sites you visit show up here, grouped by day.
                  </EmptyState>
                }
              >
                <EmptyState
                  class="hp-empty"
                  icon="search"
                  title="No matching pages"
                  actions={
                    <button
                      class="btn btn--secondary hp-show-all"
                      onClick={() => {
                        setQuery('')
                        setSite(undefined)
                      }}
                    >
                      Show all history
                    </button>
                  }
                >
                  {query().trim() === ''
                    ? `No pages from ${site() ?? 'this site'}.`
                    : `Nothing matches “${query().trim()}”.`}
                </EmptyState>
              </Show>
            </Show>
          }
        >
          <For each={groups()}>
            {(g) => {
              const all = () => g.rows.every((r) => selected().has(keyOf(r)))
              return (
                <section class="hp-day" data-day={g.day}>
                  <div class="hp-day-head">
                    <input
                      type="checkbox"
                      class="hp-check"
                      aria-label={`Select ${g.label}`}
                      checked={all()}
                      onChange={() => toggleDay(g)}
                    />
                    <h2 class="section-header">{g.label}</h2>
                  </div>
                  <div class="list hp-list">
                    <For each={g.rows}>
                      {(row) => (
                        <div
                          class="hp-row hp-visit"
                          classList={{
                            selected: selected().has(keyOf(row)),
                            'ctx-open': menu()?.key === keyOf(row),
                          }}
                          data-url={row.url}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            openMenu(row, { x: e.clientX, y: e.clientY })
                          }}
                        >
                          <input
                            type="checkbox"
                            class="hp-check"
                            aria-label="Select"
                            checked={selected().has(keyOf(row))}
                            onClick={(e) => toggle(row, e.shiftKey)}
                          />
                          <span class="hp-time">{clockTime(row.last)}</span>
                          <span class="hp-icon">
                            <Favicon src={faviconFor(row.url, store.tabs())} />
                          </span>
                          <a
                            class="hp-title"
                            href={row.url}
                            title={`${row.title}\n${row.url}`}
                            onClick={(e) => {
                              e.preventDefault()
                              open(row.url, e.ctrlKey || e.metaKey)
                            }}
                            onAuxClick={(e) => {
                              if (e.button !== 1) return
                              e.preventDefault()
                              open(row.url, true)
                            }}
                          >
                            {row.title === '' ? displayUrl(row.url) : row.title}
                          </a>
                          <Show when={row.visits > 1}>
                            <span class="hp-count" title={`Visited ${row.visits} times that day`}>
                              {row.visits}×
                            </span>
                          </Show>
                          <button
                            class="hp-host"
                            title={`Only ${siteOf(row.host)}`}
                            onClick={() => setSite(siteOf(row.host))}
                          >
                            {row.host}
                          </button>
                          <button
                            class="iconbtn iconbtn--sm hp-remove"
                            title="Remove from history"
                            aria-label="Remove from history"
                            onClick={() => deleteRows([row])}
                          >
                            <Icon name="x" />
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </section>
              )
            }}
          </For>
        </Show>
        <div class="hp-sentinel" ref={sentinel}>
          <Show when={next() !== null}>
            <button class="btn btn--ghost btn--sm" disabled={loadingMore()} onClick={loadMore}>
              {loadingMore() ? 'Loading…' : 'Show more'}
            </button>
          </Show>
        </div>
      </div>

      <Show when={dialog() !== null}>
        <div
          class="hp-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && !busy() && setDialog(null)}
        >
          <div class="hp-dialog" role="dialog" aria-modal="true" aria-labelledby="hp-dialog-title">
            <Show when={clearDialog()}>
              <h2 id="hp-dialog-title" class="hp-dialog-title">
                Clear browsing data
              </h2>
              <label class="hp-field">
                <span>Time range</span>
                <span class="select">
                  <select
                    class="hp-range"
                    aria-label="Time range"
                    value={range()}
                    onChange={(e) => setRange(e.currentTarget.value as HistoryRange)}
                  >
                    <For each={HISTORY_RANGES}>
                      {(r) => <option value={r}>{HISTORY_RANGE_LABELS[r]}</option>}
                    </For>
                  </select>
                  <Icon name="chevron-down" />
                </span>
              </label>
              <div class="hp-options">
                <label class="hp-option">
                  <input
                    type="checkbox"
                    class="hp-opt-history"
                    checked={what().history}
                    onChange={(e) => setWhat({ ...what(), history: e.currentTarget.checked })}
                  />
                  <span class="row-text">
                    <span class="row-title">History</span>
                    <span class="row-desc">
                      The pages you visited. With sync on, also on your other computers.
                    </span>
                  </span>
                </label>
                <label class="hp-option" classList={{ disabled: !allTime() }}>
                  <input
                    type="checkbox"
                    class="hp-opt-cookies"
                    disabled={!allTime()}
                    checked={what().cookies && allTime()}
                    onChange={(e) => setWhat({ ...what(), cookies: e.currentTarget.checked })}
                  />
                  <span class="row-text">
                    <span class="row-title">
                      Cookies and site data
                      <Show when={!allTime()}>
                        <span class="hp-badge">All time only</span>
                      </Show>
                    </span>
                    <span class="row-desc">
                      Signs you out of most sites. Extensions keep theirs.
                    </span>
                  </span>
                </label>
                <label class="hp-option" classList={{ disabled: !allTime() }}>
                  <input
                    type="checkbox"
                    class="hp-opt-cache"
                    disabled={!allTime()}
                    checked={what().cache && allTime()}
                    onChange={(e) => setWhat({ ...what(), cache: e.currentTarget.checked })}
                  />
                  <span class="row-text">
                    <span class="row-title">
                      Cached files
                      <Show when={!allTime()}>
                        <span class="hp-badge">All time only</span>
                      </Show>
                    </span>
                    <span class="row-desc">Images and files kept to load pages faster.</span>
                  </span>
                </label>
                <label class="hp-option">
                  <input
                    type="checkbox"
                    class="hp-opt-downloads"
                    checked={what().downloads}
                    onChange={(e) => setWhat({ ...what(), downloads: e.currentTarget.checked })}
                  />
                  <span class="row-text">
                    <span class="row-title">The downloads list</span>
                    <span class="row-desc">
                      Only the list. The files stay in your Downloads folder.
                    </span>
                  </span>
                </label>
              </div>
              <Show when={!allTime()}>
                <p class="hp-note">
                  <Icon name="circle-alert" />
                  Cookies and cached files can only be cleared for all time: the browser engine
                  keeps no date for them.
                </p>
              </Show>
              <div class="hp-actions">
                <button class="btn btn--ghost" disabled={busy()} onClick={() => setDialog(null)}>
                  Cancel
                </button>
                <button
                  class="btn hp-danger hp-clear-confirm"
                  disabled={
                    busy() ||
                    !(
                      what().history ||
                      what().downloads ||
                      (allTime() && (what().cookies || what().cache))
                    )
                  }
                  onClick={clearData}
                >
                  {busy() ? 'Clearing…' : 'Clear data'}
                </button>
              </div>
            </Show>
            <Show when={siteDialog()}>
              {(s) => (
                <>
                  <h2 id="hp-dialog-title" class="hp-dialog-title">
                    Delete everything from {s().site}?
                  </h2>
                  <p class="hp-dialog-text">
                    This deletes {plural(s().count, 'page')} of {s().site} and its subdomains from
                    your history
                    {summary()?.sync === true ? ', on all your computers' : ''}.
                  </p>
                  <label class="hp-option">
                    <input
                      type="checkbox"
                      class="hp-opt-sitedata"
                      checked={s().siteData}
                      onChange={(e) => setDialog({ ...s(), siteData: e.currentTarget.checked })}
                    />
                    <span class="row-text">
                      <span class="row-title">Also delete its cookies and site data</span>
                      <span class="row-desc">Signs you out of {s().site} on this computer.</span>
                    </span>
                  </label>
                  <div class="hp-actions">
                    <button
                      class="btn btn--ghost"
                      disabled={busy()}
                      onClick={() => setDialog(null)}
                    >
                      Cancel
                    </button>
                    <button
                      class="btn hp-danger hp-site-confirm"
                      disabled={busy()}
                      onClick={() => deleteSite(s().site, s().siteData)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </Show>
            <Show when={selectionDialog()}>
              {(s) => (
                <>
                  <h2 id="hp-dialog-title" class="hp-dialog-title">
                    Remove {plural(s().count, 'item')} from history?
                  </h2>
                  <p class="hp-dialog-text">
                    The selected visits are deleted from your history
                    {summary()?.sync === true ? ', on all your computers' : ''}.
                  </p>
                  <div class="hp-actions">
                    <button class="btn btn--ghost" onClick={() => setDialog(null)}>
                      Cancel
                    </button>
                    <button
                      class="btn hp-danger hp-selection-confirm"
                      onClick={() => {
                        setDialog(null)
                        deleteRows(selectedRows())
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>

      <Show when={menu()}>
        {(m) => (
          <div
            class="hp-menu-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setMenu(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Menu items={m().items} at={m().at} onClose={() => setMenu(null)} />
          </div>
        )}
      </Show>

      <Show when={notice()}>
        {(n) => (
          <div class="hp-notice" role="status">
            <Icon name="check" />
            {n()}
          </div>
        )}
      </Show>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <HistoryPage />, root)
