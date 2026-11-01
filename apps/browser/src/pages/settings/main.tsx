import {
  For,
  Match,
  Show,
  Switch as Branch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js'
import { render } from 'solid-js/web'
import {
  extensionIconUrl,
  type SyncStatus,
  storeExtensionId,
  DEFAULT_SHORTCUTS,
  HISTORY_KEEP_DAYS,
  HISTORY_KEEP_LABELS,
  HISTORY_URL,
  SEARCH_ENGINES,
  SETTINGS_SECTIONS,
  SHORTCUT_IDS,
  SHORTCUT_LABELS,
  chordFromInput,
  chordParts,
  countBookmarks,
  effectiveShortcuts,
  isHistoryKeepDays,
  settingsSectionOf,
  shortcutConflicts,
  expandChord,
  type SearchEngineId,
  type Settings,
  type SettingsSectionId,
  type ShortcutId,
  type ShortcutMap,
} from '@ewe/shared'
import '../../ui/styles/base.css'
import '../pages.css'
import './settings.css'
import { EmptyState } from '../../ui/components/EmptyState'
import { Segmented } from '../../ui/components/Segmented'
import { Switch } from '../../ui/components/Switch'
import { createExtensions } from '../../ui/lib/extensions'
import { api } from '../../ui/lib/api'
import { applyTheme, createBrowserStore } from '../../ui/lib/store'
import { Divider, Group, Row, Select } from './controls'
import { Passwords } from './passwords'
import { Privacy, SitePermissions } from './privacy'

type Update = (patch: Partial<Settings>) => void

const SUBTITLES: Record<SettingsSectionId, string> = {
  appearance: 'How ewe Browser looks. Changes apply right away.',
  browsing: 'Search, history and how a new window starts. Changes apply right away.',
  privacy: 'What sites can learn about you, and how ewe Browser reaches them.',
  permissions: 'What each site may use. Sites ask before they use any of it.',
  passwords: 'Logins, passkeys, cards and addresses come from ewe Safe.',
  sync: 'Bookmarks, history, open tabs and settings on every computer.',
  files: 'Folders and music, right in ewe Browser.',
  extensions: 'Add-ons from the Chrome Web Store.',
  shortcuts: 'Press Edit, then the new keys. Esc cancels, Backspace restores the default.',
}

function Chord(props: { chord: string }): JSX.Element {
  return (
    <span class="kbd-combo">
      <For each={chordParts(props.chord)}>{(part) => <span class="kbd">{part}</span>}</For>
    </span>
  )
}

function sameChords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i])
}

function Shortcuts(props: { settings: () => Settings; update: Update }): JSX.Element {
  const [recording, setRecording] = createSignal<ShortcutId | null>(null)
  const [hint, setHint] = createSignal<string | null>(null)
  const overrides = () => props.settings().shortcuts
  const effective = () => effectiveShortcuts(overrides())
  const conflicts = () => shortcutConflicts(overrides())

  const save = (id: ShortcutId, chords: string[] | null) => {
    const next: ShortcutMap = Object.fromEntries(
      Object.entries(overrides()).filter(([key]) => key !== id),
    )
    if (chords !== null && !sameChords(chords, DEFAULT_SHORTCUTS[id])) next[id] = chords
    props.update({ shortcuts: next })
  }

  const stop = () => {
    if (recording() === null) return
    setRecording(null)
    setHint(null)
    void api.send({ type: 'shortcuts.recording', on: false })
  }

  const onKey = (event: KeyboardEvent) => {
    const id = recording()
    if (id === null) return
    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    if (event.code === 'Escape') {
      stop()
      return
    }
    if (event.code === 'Backspace') {
      save(id, null)
      stop()
      return
    }
    const chord = chordFromInput(
      {
        type: 'keyDown',
        key: event.key,
        code: event.code,
        control: event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
      },
      id === 'tab.select' || id === 'workspace.select',
    )
    if (chord === null) {
      if (!/^(Control|Shift|Alt|Meta)/.test(event.code)) setHint('Hold Ctrl or Alt with a key')
      return
    }
    save(id, [chord])
    stop()
  }

  const start = (id: ShortcutId) => {
    if (recording() === id) {
      stop()
      return
    }
    if (recording() === null) void api.send({ type: 'shortcuts.recording', on: true })
    setHint(null)
    setRecording(id)
  }

  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', stop)
  onCleanup(() => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', stop)
    stop()
  })

  const warning = (id: ShortcutId): string | null => {
    for (const chord of effective()[id].flatMap(expandChord)) {
      const others = conflicts()
        .get(chord)
        ?.filter((other) => other !== id)
      if (others !== undefined && others.length > 0)
        return `${chord} is also bound to ${others.map((o) => SHORTCUT_LABELS[o]).join(', ')}`
    }
    return null
  }

  return (
    <Group
      title="Keyboard shortcuts"
      class="shortcuts"
      action={
        <button
          class="btn btn--ghost btn--sm"
          disabled={Object.keys(overrides()).length === 0}
          onClick={() => props.update({ shortcuts: {} })}
        >
          Reset all
        </button>
      }
    >
      <For each={SHORTCUT_IDS}>
        {(id) => (
          <div class="row shortcut" classList={{ recording: recording() === id }}>
            <span class="row-text">
              <span class="row-title">{SHORTCUT_LABELS[id]}</span>
              <Show when={recording() === id}>
                <span class="row-desc">
                  {hint() ?? 'Esc cancels, Backspace restores the default'}
                </span>
              </Show>
              <Show when={recording() !== id && warning(id)}>
                {(text) => <span class="row-desc row-warning">{text()}</span>}
              </Show>
            </span>
            <span class="chords">
              <Show
                when={recording() === id}
                fallback={<For each={effective()[id]}>{(chord) => <Chord chord={chord} />}</For>}
              >
                <span class="recording-hint">Press keys…</span>
              </Show>
            </span>
            <button class="btn btn--ghost btn--sm" onClick={() => start(id)}>
              {recording() === id ? 'Cancel' : 'Edit'}
            </button>
          </div>
        )}
      </For>
    </Group>
  )
}

function ImportBookmarks(props: { count: number }): JSX.Element {
  const [result, setResult] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  onMount(() => {
    const off = api.onUi((event) => {
      if (event.type !== 'toast') return
      setResult(event.message)
      setBusy(false)
    })
    onCleanup(off)
  })
  return (
    <Row
      title="Import from Chrome"
      description={
        result() ??
        `Copies Chrome’s bookmarks into a folder. You have ${props.count} bookmark${props.count === 1 ? '' : 's'}.`
      }
    >
      <button
        class="btn btn--secondary btn--sm settings-import"
        disabled={busy()}
        onClick={() => {
          setBusy(true)
          setResult(null)
          void api.send({ type: 'bookmarks.importChrome' })
        }}
      >
        {busy() ? 'Importing…' : 'Import'}
      </button>
    </Row>
  )
}

function Appearance(props: { settings: () => Settings; update: Update }): JSX.Element {
  return (
    <>
      <Group>
        <Row title="Theme" description="ewe desktop follows your desktop’s scheme and accent">
          <Segmented
            small
            label="Theme"
            class="settings-theme"
            value={props.settings().theme}
            options={[
              { value: 'system', label: 'ewe desktop' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(value) => props.update({ theme: value as Settings['theme'] })}
          />
        </Row>
      </Group>
      <Group title="Sidebar panels" class="settings-panels">
        <For
          each={props.settings().panels}
          fallback={
            <EmptyState compact icon="panel-right" title="No panels yet">
              Open a site, then press + in the sidebar to keep it there as a panel.
            </EmptyState>
          }
        >
          {(panel, i) => (
            <>
              <Show when={i() > 0}>
                <Divider />
              </Show>
              <Row title={panel.title} description={panel.url} class="settings-panel">
                <button
                  class="btn btn--ghost btn--sm"
                  onClick={() =>
                    props.update({
                      panels: props.settings().panels.filter((p) => p.id !== panel.id),
                    })
                  }
                >
                  Remove
                </button>
              </Row>
            </>
          )}
        </For>
      </Group>
    </>
  )
}

function Browsing(props: {
  settings: () => Settings
  update: Update
  bookmarks: number
}): JSX.Element {
  const [startup, setStartup] = createSignal<{ available: boolean; on: boolean } | null>(null)
  const [busy, setBusy] = createSignal(false)
  onMount(() => void api.startup().then(setStartup))
  const setStartupOn = (on: boolean) => {
    setBusy(true)
    void api.startup(on).then((next) => {
      setStartup(next)
      setBusy(false)
      if (on && !props.settings().background) props.update({ background: true })
    })
  }
  const startupDesc = () => {
    const s = startup()
    if (s === null) return 'Checking…'
    if (!s.available) return 'Only on the ewe desktop'
    return 'Starts hidden, so your first window opens at once'
  }
  return (
    <>
      <Group>
        <Row title="Search engine" description="For text you type in the address field">
          <Select
            label="Search engine"
            class="settings-search-engine"
            value={props.settings().searchEngine}
            options={Object.entries(SEARCH_ENGINES).map(([id, engine]) => ({
              value: id,
              label: engine.name,
            }))}
            onChange={(value) => props.update({ searchEngine: value as SearchEngineId })}
          />
        </Row>
        <Divider />
        <Row title="Restore session" description="Reopen your windows and tabs from last time">
          <Switch
            label="Restore session"
            class="settings-restore"
            checked={props.settings().restoreSession}
            onChange={(on) => props.update({ restoreSession: on })}
          />
        </Row>
        <Divider />
        <Row title="Swipe to go back" description="Two fingers left or right on the touchpad">
          <Switch
            label="Swipe to go back"
            class="settings-swipe"
            checked={props.settings().gestures.swipe}
            onChange={(on) => props.update({ gestures: { swipe: on } })}
          />
        </Row>
        <Divider />
        <Row
          title="Tab list"
          description="Collapsed hides it until you point at the left edge · Ctrl+Shift+S"
        >
          <Segmented
            small
            label="Tab list"
            class="settings-rail"
            value={props.settings().rail}
            options={[
              { value: 'expanded', label: 'Expanded' },
              { value: 'collapsed', label: 'Collapsed' },
            ]}
            onChange={(value) => props.update({ rail: value as Settings['rail'] })}
          />
        </Row>
      </Group>
      <Group title="History">
        <Row title="Keep history for" description="Applies to all your computers while sync is on">
          <Select
            label="Keep history for"
            class="settings-history-keep"
            value={String(props.settings().historyDays)}
            options={HISTORY_KEEP_DAYS.map((days) => ({
              value: String(days),
              label: HISTORY_KEEP_LABELS[days],
            }))}
            onChange={(value) => {
              const days = Number(value)
              if (isHistoryKeepDays(days)) props.update({ historyDays: days })
            }}
          />
        </Row>
        <Divider />
        <Row
          title="Browsing data"
          description="History, cookies, cached files and the downloads list"
        >
          <button
            class="btn btn--secondary btn--sm settings-history-clear"
            onClick={() => void api.send({ type: 'tab.create', url: `${HISTORY_URL}?clear=1` })}
          >
            Clear browsing data…
          </button>
        </Row>
        <Divider />
        <Row title="All history" description="Search it, and see tabs from your other computers">
          <button
            class="btn btn--ghost btn--sm settings-history-open"
            onClick={() => void api.send({ type: 'open.internal', page: 'history' })}
          >
            Open history
          </button>
        </Row>
      </Group>
      <Group title="Start">
        <Row title="Open when I sign in" description={startupDesc()}>
          <Switch
            label="Open when I sign in"
            class="settings-startup"
            checked={startup()?.on ?? false}
            disabled={busy() || startup()?.available !== true}
            onChange={setStartupOn}
          />
        </Row>
        <Divider />
        <Row
          title="Keep running after the last window closes"
          description="Downloads and music carry on, and the next window opens at once"
        >
          <Switch
            label="Keep running after the last window closes"
            class="settings-background"
            checked={props.settings().background}
            onChange={(on) => props.update({ background: on })}
          />
        </Row>
      </Group>
      <Group title="Bookmarks">
        <ImportBookmarks count={props.bookmarks} />
      </Group>
    </>
  )
}

function Files(): JSX.Element {
  const [status, setStatus] = createSignal<{ isDefault: boolean; current: string | null } | null>(
    null,
  )
  const [busy, setBusy] = createSignal(false)
  onMount(() => void api.defaultHandler().then(setStatus))
  const set = (on: boolean) => {
    setBusy(true)
    void api.defaultHandler(on).then((next) => {
      setStatus(next)
      setBusy(false)
    })
  }
  const describe = () => {
    const s = status()
    if (s === null) return 'Checking which app opens folders…'
    if (s.isDefault) return 'Folders you open from other apps open here'
    const app = s.current?.replace(/\.desktop$/, '') ?? 'another app'
    return `Folders open in ${app} now. Type a path like ~/Downloads in the address field to browse here anyway.`
  }
  return (
    <>
      <Group title="Files">
        <Row title="Open folders with ewe Browser" description={describe()}>
          <Switch
            label="Open folders with ewe Browser"
            class="settings-default-folders"
            checked={status()?.isDefault === true}
            disabled={busy() || status() === null}
            onChange={set}
          />
        </Row>
      </Group>
      <Group title="Music">
        <Row title="Music" description="Albums, artists and songs from your Music folder">
          <button
            class="btn btn--secondary btn--sm settings-music-open"
            onClick={() => void api.send({ type: 'open.internal', page: 'music' })}
          >
            Open Music
          </button>
        </Row>
      </Group>
    </>
  )
}

function Extensions(): JSX.Element {
  const state = createExtensions()
  const [link, setLink] = createSignal('')
  const add = () => {
    if (storeExtensionId(link()) === null) return
    void api.send({ type: 'extension.install', source: link() })
    setLink('')
  }
  return (
    <>
      <Group>
        <Row
          title="Chrome Web Store"
          description="Open an extension there and press “Add to ewe Browser” under the address field. Extensions update by themselves."
        >
          <button
            class="btn btn--ghost btn--sm settings-ext-update"
            disabled={state().list.length === 0}
            onClick={() => void api.send({ type: 'extensions.update' })}
          >
            Update now
          </button>
          <button
            class="btn btn--secondary btn--sm settings-ext-store"
            onClick={() =>
              void api.send({ type: 'tab.create', url: 'https://chromewebstore.google.com/' })
            }
          >
            Open store
          </button>
        </Row>
        <Divider />
        <Row title="Add by link" description="A Chrome Web Store link or an extension ID">
          <input
            class="settings-field settings-ext-link"
            value={link()}
            placeholder="chromewebstore.google.com/detail/…"
            spellcheck={false}
            aria-label="Chrome Web Store link or extension ID"
            onInput={(e) => setLink(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
          <button
            class="btn btn--secondary btn--sm settings-ext-add"
            disabled={storeExtensionId(link()) === null}
            onClick={add}
          >
            Add
          </button>
        </Row>
      </Group>
      <Group title="Added">
        <For
          each={state().list}
          fallback={
            <EmptyState compact icon="puzzle" title="No extensions yet">
              Find one on the Chrome Web Store, or paste its link above.
            </EmptyState>
          }
        >
          {(info, i) => (
            <>
              <Show when={i() > 0}>
                <Divider />
              </Show>
              <div class="row settings-extension" data-extension={info.id}>
                <span class="settings-ext-icon">
                  <img class="ext-tile" src={extensionIconUrl(state(), info)} alt="" />
                </span>
                <span class="row-text">
                  <span class="row-title">
                    {info.name} <span class="row-meta">{info.version}</span>
                  </span>
                  <span class="row-desc">{info.description}</span>
                </span>
                <span class="row-trail">
                  <Show when={info.optionsUrl !== null}>
                    <button
                      class="btn btn--ghost btn--sm"
                      onClick={() => void api.send({ type: 'extension.options', id: info.id })}
                    >
                      Options
                    </button>
                  </Show>
                  <button
                    class="btn btn--ghost btn--sm settings-ext-remove"
                    onClick={() => void api.send({ type: 'extension.remove', id: info.id })}
                  >
                    Remove
                  </button>
                </span>
              </div>
            </>
          )}
        </For>
      </Group>
    </>
  )
}

function Sync(props: { settings: () => Settings; update: Update }): JSX.Element {
  const [status, setStatus] = createSignal<SyncStatus | null>(null)
  onMount(() => {
    const off = api.onSync(setStatus)
    void api.sync().then((next) => {
      if (next !== null) setStatus(next)
    })
    onCleanup(off)
  })
  const enabled = () => status()?.enabled ?? false
  const describe = () => {
    const s = status()
    const off = 'Off. Everything stays on this computer.'
    if (s === null) return props.settings().sync ? 'Starting…' : off
    if (!s.enabled) return off
    if (s.state === 'off') return 'Starting…'
    if (s.state === 'syncing') return 'Syncing…'
    if (s.state === 'error') return s.error ?? 'Sync failed'
    if (s.lastSync === null) return 'Waiting for the first sync…'
    const when = new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `Synced ${when}${s.account === null ? '' : ` · ${s.account}`}`
  }
  const accountText = () => {
    const s = status()
    if (s?.signedIn !== true)
      return 'Sign in to your ewe account in ewe Sync, and this follows you to every computer.'
    if (!s.enabled) return 'Off on this computer. Turn Browser on in ewe Sync.'
    return 'On with your ewe account. Tabs from your other computers are on the history page.'
  }
  const statusRow = (button: JSX.Element | undefined) => (
    <div class="row">
      <span class="row-text">
        <span class="row-title">Status</span>
        <span
          class="row-desc settings-sync-status"
          classList={{ 'row-warning': status()?.state === 'error' }}
        >
          {describe()}
        </span>
        <Show when={enabled() ? status()?.warning : null}>
          {(warning) => <span class="row-desc row-warning settings-sync-warning">{warning()}</span>}
        </Show>
      </span>
      <Show when={button !== undefined}>
        <span class="row-trail">{button}</span>
      </Show>
    </div>
  )
  return (
    <Group>
      <Show
        when={status()?.managed === true}
        fallback={
          <>
            <Row
              title="Sync with Nextcloud"
              description="Bookmarks, history, open tabs and settings, in your Nextcloud"
            >
              <Switch
                label="Sync with Nextcloud"
                class="settings-sync"
                checked={props.settings().sync}
                onChange={(on) => props.update({ sync: on })}
              />
            </Row>
            <Divider />
            {statusRow(
              <button
                class="btn btn--secondary btn--sm settings-sync-now"
                disabled={!props.settings().sync || status()?.state === 'syncing'}
                onClick={() => void api.sync(true).then((next) => next !== null && setStatus(next))}
              >
                Sync now
              </button>,
            )}
          </>
        }
      >
        <Row
          title="Sync with your ewe account"
          description={accountText()}
          class="settings-sync-account"
        >
          <button
            class="btn btn--sm settings-sync-manage"
            classList={{
              'btn--primary': status()?.signedIn !== true,
              'btn--secondary': status()?.signedIn === true,
            }}
            onClick={() => void api.eweSync({ op: 'pane', pane: 'overview' })}
          >
            {status()?.signedIn === true ? 'Manage in ewe Sync' : 'Open ewe Sync'}
          </button>
        </Row>
        <Show when={enabled()}>
          <Divider />
          {statusRow(undefined)}
        </Show>
      </Show>
    </Group>
  )
}

function SettingsPage(): JSX.Element {
  const store = createBrowserStore()
  createEffect(() => applyTheme(store.settings, store.theme))
  const update: Update = (patch) => void api.send({ type: 'settings.update', patch })
  const [section, setSection] = createSignal<SettingsSectionId>(settingsSectionOf(location.hash))
  const bookmarkCount = () => {
    const root = store.bookmarks()
    return root === null ? 0 : countBookmarks(root)
  }
  let main: HTMLElement | undefined

  const go = (id: SettingsSectionId) => {
    history.replaceState(null, '', `#${id}`)
    setSection(id)
    main?.scrollTo({ top: 0 })
  }

  onMount(() => {
    const onHash = () => setSection(settingsSectionOf(location.hash))
    window.addEventListener('hashchange', onHash)
    onCleanup(() => window.removeEventListener('hashchange', onHash))
  })

  const label = () => SETTINGS_SECTIONS.find((s) => s.id === section())?.label ?? ''

  return (
    <div class="page page-settings">
      <nav class="settings-nav" aria-label="Settings sections">
        <div class="settings-nav-brand">Settings</div>
        <div class="settings-nav-group">
          <For each={SETTINGS_SECTIONS}>
            {(s) => (
              <a
                class="settings-nav-item"
                classList={{ selected: section() === s.id }}
                href={`#${s.id}`}
                data-section={s.id}
                aria-current={section() === s.id ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  go(s.id)
                }}
              >
                {s.label}
              </a>
            )}
          </For>
        </div>
        <div class="settings-nav-foot">ewe Browser {__APP_VERSION__}</div>
      </nav>
      <main class="settings-main" ref={main} data-section={section()}>
        <header class="settings-head">
          <h1>{label()}</h1>
          <p>{SUBTITLES[section()]}</p>
        </header>
        <Branch>
          <Match when={section() === 'appearance'}>
            <Appearance settings={() => store.settings()} update={update} />
          </Match>
          <Match when={section() === 'browsing'}>
            <Browsing
              settings={() => store.settings()}
              update={update}
              bookmarks={bookmarkCount()}
            />
          </Match>
          <Match when={section() === 'privacy'}>
            <Privacy settings={() => store.settings()} update={update} />
          </Match>
          <Match when={section() === 'permissions'}>
            <SitePermissions />
          </Match>
          <Match when={section() === 'passwords'}>
            <Passwords settings={() => store.settings()} update={update} />
          </Match>
          <Match when={section() === 'sync'}>
            <Sync settings={() => store.settings()} update={update} />
          </Match>
          <Match when={section() === 'files'}>
            <Files />
          </Match>
          <Match when={section() === 'extensions'}>
            <Extensions />
          </Match>
          <Match when={section() === 'shortcuts'}>
            <Shortcuts settings={() => store.settings()} update={update} />
          </Match>
        </Branch>
      </main>
    </div>
  )
}

const root = document.getElementById('root')
if (root !== null) render(() => <SettingsPage />, root)
